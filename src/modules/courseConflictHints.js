// Timetable conflicts directly on the course rows of subject registration.
//
// The comparison baseline used to be built here: SchedulableSubjects gave
// scheduledCourseIds/isRegistered for the subjects that happened to be on screen, and
// the native per-subject GetSubjectsCourses response filled in each one's own timetable. That
// baseline was blind to any subject outside the CURRENT curriculum filter - a PE
// credit, a free-standing language course, anything the active sample curriculum does
// not list. The planner endpoint is unfiltered, so it can contain registered
// subjects that a curriculum filter would hide. The old per-subject scan never
// fetched those rows and could therefore miss a genuine overlap. The shared layer
// below now merges that endpoint with the native per-subject responses.
// `src/registrationData.js` now owns that merge (the planner endpoint, native
// per-subject responses and the native plan together), so this module only consumes its snapshot:
// `registrationData.install()` + `subscribe(fn)` + `getSnapshot()` -> { termId,
// subjects, courses, baseline, baselineComplete }. Everything that used to live here
// for that purpose - the fetch loop, its own interceptor subscriptions,
// collectScheduleSubjects/collectCourses/buildBaseline -
// moved there; see that file for the merge order and for exactly what
// `baselineComplete` certifies.
//
// What stays here is the DOM side: turning a snapshot into a badge and a schedule
// line on each course row.
//
// The conflict verdict is three-way now, not two. An already enrolled course gets no
// NPU conflict badge at all: Neptun's native row already says "Kurzus felvéve" on the
// right, so repeating that status or its own conflicts is noise.
// It used to be {tone:"warning"} on a clash, {tone:"ok"} on none, and the "ok" branch
// painted nothing at all - so "checked, all clear" and "could not check, the baseline
// is incomplete" looked EXACTLY the same on screen: silence. That indistinguishability
// is what made the feature look broken.
// Now:
//   - a clash is reported by NAME (the clashing subject, not just "Ütközik" or a bare
//     count) - a warning that does not say what it clashes with is not actionable. A
//     genuine clash is reported whatever `baselineComplete` says: a course the student
//     already holds (or the planner already recognised) is real evidence on its own,
//     even while other parts of the baseline are still loading.
//   - "no clash" is only ever said once `baselineComplete` is true, i.e.
//     GetScheduledCourses answered in a shape registrationData recognised. Saying
//     "no clash" from an incomplete baseline would be the exact kind of confident
//     false negative AGENTS.md invariant 5 warns against for a different field.
//   - an already enrolled course is omitted from this badge entirely; its native
//     "Kurzus felvéve" state remains the authoritative visible status.
//   - anything less than that - `baselineComplete === false`, or the candidate course
//     itself has no timetable of its own to compare - draws an explicit neutral label
//     and the title says why, instead of staying silent or showing a cryptic "?".
const router = require("../router");
const { slotsOverlap, setNoteSlotsEnabled } = require("../timetable");
const settings = require("../settings");
const badge = require("../badge");
const registrationData = require("../registrationData");

const ROUTE = "/hallgato_ng/subjects/registration";
const ROW_SELECTOR = "neptun-course-list-item";
const CODE_BLOCK_SELECTOR = ".code-with-time__code";
const HINT_ATTRIBUTE = "data-npu-conflict";
const SCHEDULE_ATTRIBUTE = "data-npu-schedule";
// Any leaf whose text reads as a time range - the row's own timetable line. Matched
// on digits rather than a class name, so it survives a rebuild and does not care
// about the page's own labels.
const TIME_TEXT = /\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}/;

const meta = {
  id: "courseConflictHints",
  group: "registration",
  name: "Órarend és ütközések a kurzusoknál",
  where: "Tárgyak › Tárgyfelvétel: a lenyitott tárgy kurzusainál",
  description:
    "Kiírja a kurzus termét és minden óraalkalmát, megnevezi az ütköző tárgyat, ha " +
    "van ilyen, és jelzi, ha ezt egyelőre nem tudja biztosan eldönteni.",
  needs: [
    {
      capability: "scheduledSubjects",
      to: "a felvett tárgyak figyelembevételéhez",
    },
  ],
  options: [
    {
      id: "noteSlots",
      name: "Időpont a megjegyzésből",
      where: "Tárgyak › Tárgyfelvétel: a megjegyzésben megadott időpontú kurzusoknál",
      description:
        "Ha a kurzusnak nincs órarendi adata, a megjegyzésből olvassa ki a napot, időt és termet " +
        "(pl. „Hétfő 14-15, A1/216”), és az ütközésvizsgálat is számol vele.",
      defaultEnabled: true,
    },
  ],
};

function shouldActivate() {
  return true;
}

function normaliseCode(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

// Ambiguous duplicate course codes are deliberately removed from this lookup. A
// missing hint is safer than attaching another subject's warning to the row.
function uniqueCoursesByCode(courses) {
  const result = new Map();
  const ambiguous = new Set();
  courses.forEach(course => {
    const code = normaliseCode(course.code);
    if (!code) {
      return;
    }
    if (result.has(code)) {
      result.delete(code);
      ambiguous.add(code);
    } else if (!ambiguous.has(code)) {
      result.set(code, course);
    }
  });
  return result;
}

function codeIn(row, knownCodes) {
  const leaf = Array.from(row.querySelectorAll("*")).find(
    element => element.children.length === 0 && knownCodes.has(normaliseCode(element.textContent))
  );
  return leaf ? normaliseCode(leaf.textContent) : null;
}

function formatClock(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

// One warning per other course, even if two repeating slots overlap. The exact pair
// is kept so the row can say both times rather than just announcing a vague clash.
function findCourseConflicts(candidate, baseline) {
  if (!candidate || !Array.isArray(candidate.slots)) {
    return [];
  }
  const conflicts = [];
  baseline.forEach(other => {
    if (!other || !other.course || other.course.id === candidate.id) {
      return;
    }
    let hit = null;
    for (const candidateSlot of candidate.slots) {
      for (const otherSlot of other.course.slots || []) {
        if (slotsOverlap(candidateSlot, otherSlot)) {
          hit = { candidateSlot, otherSlot };
          break;
        }
      }
      if (hit) {
        break;
      }
    }
    if (hit) {
      conflicts.push(Object.assign({ candidate, other }, hit));
    }
  });
  return conflicts.sort((a, b) => {
    return (
      a.candidateSlot.day - b.candidateSlot.day ||
      a.candidateSlot.start - b.candidateSlot.start ||
      String(a.other.subject.title || a.other.subject.code || "").localeCompare(
        String(b.other.subject.title || b.other.subject.code || "")
      )
    );
  });
}

function conflictName(conflict) {
  const subject = conflict.other.subject || {};
  const course = conflict.other.course || {};
  return subject.title || subject.code || course.code || "Ismeretlen tárgy";
}

function unknownReason(candidate) {
  if (!candidate.slots || candidate.slots.length === 0) {
    return "Ehhez a kurzushoz nincs saját órarendi adat, nincs mihez viszonyítani.";
  }
  return "A felvett/tervezett órarended még nem töltődött be teljesen, ezért az ütközésmentesség nem biztos.";
}

// The three-state conflict verdict is computed entirely from the shared snapshot - no
// DOM, so it is trivial to test in isolation. A course already enrolled in returns no
// verdict at all because Neptun's native row already communicates that status.
//
// `baselineComplete` is an explicit parameter rather than something read off ambient
// state on purpose: saying "no clash" without checking it would hide an incomplete
// schedule and make the result look more certain than the data allows.
function hintForCourse(candidate, baseline, baselineComplete) {
  if (!candidate) {
    return null;
  }
  if (candidate.isSigned === true) {
    return null;
  }
  const conflicts = candidate.slots && candidate.slots.length > 0 ? findCourseConflicts(candidate, baseline) : [];
  if (conflicts.length > 0) {
    const lines = conflicts.map(conflict => {
      const candidateSlot = conflict.candidateSlot;
      const otherSlot = conflict.otherSlot;
      const day = candidateSlot.dayLabel || otherSlot.dayLabel || "";
      const ownTime = `${formatClock(candidateSlot.start)}–${formatClock(candidateSlot.end)}`;
      const otherTime = `${formatClock(otherSlot.start)}–${formatClock(otherSlot.end)}`;
      const name = conflictName(conflict);
      const courseCode = conflict.other.course.code;
      const prefix = day ? `${day} ${ownTime}` : ownTime;
      const suffix = courseCode ? ` (${courseCode}, ${otherTime})` : ` (${otherTime})`;
      return `${prefix} — ütközik: ${name}${suffix}`;
    });
    const label = `Ütközik${conflicts.length > 1 ? ` (+${conflicts.length - 1})` : ""}`;
    return { tone: "warning", count: conflicts.length, lines, label, title: lines.join("\n") };
  }
  if (!candidate.slots || candidate.slots.length === 0) {
    return {
      tone: "unknown",
      count: 0,
      lines: [],
      label: "Nincs órarend",
      title: unknownReason(candidate),
    };
  }
  // A clash-free reading is only trustworthy once the baseline itself is complete -
  // otherwise this would be exactly the silent "no clash" the file header explains.
  if (!baselineComplete) {
    return {
      tone: "unknown",
      count: 0,
      lines: [],
      label: "Nem ellenőrizhető",
      title: unknownReason(candidate),
    };
  }
  return {
    tone: "ok",
    count: 0,
    lines: [],
    label: "Nincs ütközés",
    title: "",
  };
}

// The same component the occupancy badges use, so a clash reads as part of the row
// rather than as something bolted onto it. The detail goes in the tooltip: the row is
// already dense, and a multi-line block pushed every course apart.
//
// green/amber/grey below are Neptun's own badge variants (see badge.js), not a colour
// of ours: warning borrows the same "full" red the occupancy badge uses for "gone",
// the confirmed-clear verdict borrows "free" green, and an explicit unknown label
// gets the neutral grey.
function paintHint(row, model) {
  const anchor = row.querySelector(CODE_BLOCK_SELECTOR) || row;
  if (!model) {
    badge.paint(row, anchor, HINT_ATTRIBUTE, null, null, null);
    return;
  }
  const variant = model.tone === "warning" ? "full" : model.tone === "ok" ? "free" : "neutral";
  badge.paint(row, anchor, HINT_ATTRIBUTE, model.label, variant, model.title || null);
}

// Strictly what Neptun leaves off the row, and nothing else.
//
// Neptun already prints the first session's day and time, so repeating it put the
// same line on screen twice - which is what made the list unreadable. For that first
// session only the room is ours to add. Any further session is entirely absent from
// the row, so those are printed in full - as is every slot read from the note, since
// Neptun prints no time at all for those.
function scheduleLines(candidate) {
  const slots = (candidate && candidate.slots) || [];
  if (slots.length === 0) {
    return null;
  }
  const lines = [];
  const neptunPrintsFirst = !slots[0].fromNote;
  if (neptunPrintsFirst && slots[0].rooms) {
    lines.push(slots[0].rooms);
  }
  slots.slice(neptunPrintsFirst ? 1 : 0).forEach(slot => {
    const when = `${slot.dayLabel} ${formatClock(slot.start)}–${formatClock(slot.end)}`.trim();
    lines.push(slot.rooms ? `${when} · ${slot.rooms}` : when);
  });
  return lines.length > 0 ? lines : null;
}

// Cloned from the row's own timetable line, so the type scale and colour are Neptun's.
// Falls back to inheriting, never to a colour of ours.
function scheduleHost(row) {
  const anchor = row.querySelector(CODE_BLOCK_SELECTOR);
  if (!anchor || !anchor.parentElement) {
    return null;
  }
  const timeNode = Array.from(anchor.parentElement.querySelectorAll("*")).find(
    element => element.children.length === 0 && TIME_TEXT.test(element.textContent || "")
  );
  const host = timeNode ? timeNode.cloneNode(false) : row.ownerDocument.createElement("div");
  host.setAttribute(SCHEDULE_ATTRIBUTE, "");
  host.removeAttribute("id");
  if (!timeNode) {
    host.style.cssText = "font:inherit;font-size:13px;opacity:.8";
  }
  host.style.whiteSpace = "pre-line";
  anchor.parentElement.appendChild(host);
  return host;
}

function paintSchedule(row, lines) {
  const existing = row.querySelector(`[${SCHEDULE_ATTRIBUTE}]`);
  if (!lines || lines.length === 0) {
    if (existing) {
      existing.remove();
    }
    return;
  }
  const host = existing || scheduleHost(row);
  if (!host) {
    return;
  }
  const text = lines.join("\n");
  // Guarded like every other write here: this runs from a MutationObserver.
  if (host.textContent !== text) {
    host.textContent = text;
  }
}

function applyHints(root, snapshot) {
  const courses = snapshot.courses;
  const courseByCode = uniqueCoursesByCode(courses);
  const knownCodes = new Set(courseByCode.keys());
  Array.from(root.querySelectorAll(ROW_SELECTOR)).forEach(row => {
    const code = codeIn(row, knownCodes);
    const candidate = code && courseByCode.get(code);
    paintHint(row, candidate ? hintForCourse(candidate, snapshot.baseline, snapshot.baselineComplete) : null);
    paintSchedule(row, candidate ? scheduleLines(candidate) : null);
  });
}

function initialize() {
  setNoteSlotsEnabled(settings.isOptionEnabled({ meta }, meta.options[0], settings.readFlags()));
  registrationData.install();

  function repaint() {
    if (router.getPath() === ROUTE) {
      applyHints(document, registrationData.getSnapshot());
    }
  }

  registrationData.subscribe(repaint);
  router.onChange(path => {
    if (path === ROUTE) {
      repaint();
    }
  });

  // No stylesheet of our own: the badge is Neptun's component.
  let repaintScheduled = false;
  new MutationObserver(() => {
    if (repaintScheduled || router.getPath() !== ROUTE) {
      return;
    }
    repaintScheduled = true;
    setTimeout(() => {
      repaintScheduled = false;
      repaint();
    }, 0);
  }).observe(document.documentElement, { childList: true, subtree: true });
}

module.exports = {
  meta,
  shouldActivate,
  initialize,
  scheduleLines,
  findCourseConflicts,
  hintForCourse,
  uniqueCoursesByCode,
};
