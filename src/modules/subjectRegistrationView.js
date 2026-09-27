// A table replacement for the native course list on the subject-registration page.
//
// The native course row leaves substantial vertical space and repeats information -
// the section header already says `type`, while the row repeats it in badges and
// chips. The student's task on this list is to pick ONE group that
// (1) does not clash with what they already hold, (2) has room, (3) fits their week -
// so this renders one `<table>` per course-type section instead: állapot · kód ·
// nap+idő · terem · létszám · ütközés · akciók, one row per course.
//
// Data comes exclusively from `registrationData` (install/subscribe/getSnapshot) - no
// request of our own, no token store read. The course objects now carry the full
// measured row: {id, subjectId, code, type, isSigned, slots, tutorName, language,
// maxLimit, registeredStudentsCount, waitingStudentsCount, comparationTypeId, room,
// isFull, isOnWaitingList, willBeOnWaitingList}. The optional fields are `null` when
// the server's row did not carry them - a measured `0`/`false` is kept as `0`/`false`,
// never coerced to "unknown" (see registrationData.js's optionalCourseFields). This
// module preserves that distinction everywhere it renders one of these fields: `null`
// gets "—", a real `0` gets "0".
//
//   - "állapot" is your OWN relationship to the course - `isSigned` (already
//     enrolled) or `isOnWaitingList` (already queued on it), personal-status fields,
//     not seat/capacity ones.
//   - "létszám" is built from `registeredStudentsCount`/`maxLimit` directly, coloured
//     via `src/badge.js`'s variants (Neptun's own badge, cloned - never a colour of
//     ours). AGENTS.md invariant 5: `isFull` is not the same claim as
//     `registered >= max`, so the full/waitlist/free read comes from `isFull` and
//     `willBeOnWaitingList` alone - never from arithmetic on the two counts. Those two
//     fields, not `isOnWaitingList`, are the seat-forecast pair: `willBeOnWaitingList`
//     answers "would a NEW application queue", which is exactly what a student
//     browsing this course needs, while `isOnWaitingList` answers "am I already
//     queued" - a fact about a course this student has already applied to, useless
//     for one they have not. `occupancy.js` and `rajtolo/protocol.js` read the same
//     `isFull`+`willBeOnWaitingList` pair for the same reason; see `seatState` for the
//     decision table, including what happens when either is `null`. This also means
//     the `occupancy` module's own `[data-npu-occupancy]` badge is not moved into this
//     table at all: occupancy paints it onto the native row for its own purposes, and
//     that row stays hidden here, so nothing of ours ever stands next to it.
//   - the subject-wide oktató/nyelv summary and the per-row "differs from that"
//     exception both run on `uniformField(courses, "tutorName"/"language")` now that
//     the snapshot actually carries those fields.
//
// `comparationTypeId` (docs/API.md: the course type's language-NEUTRAL guid, distinct
// per Labor/Elmélet) drives the section grouping instead of the display `type` text.
// See groupByType for why the display label is not a safe identity key.
const router = require("../router");
const settings = require("../settings");
const badge = require("../badge");
const { slotsOverlap } = require("../timetable");
const utils = require("../utils");
const registrationData = require("../registrationData");
const tokens = require("../neptunTokens");

const ROUTE = "/hallgato_ng/subjects/registration";
// Neptun's dayOfWeek, 1 = Monday (measured); the full name stays in the chip's title.
const DAY_SHORT = ["V", "H", "K", "Sze", "Cs", "P", "Szo"];
const ROW_SELECTOR = "neptun-course-list-item";
const SUBJECT_ROW_SELECTOR = "neptun-subject-list-item";
const NATIVE_TYPE_SECTION_SELECTOR = "section.subject-type-container";
// Measured in rajtolo/rows.js: the native "Tervezőhöz adás" control's slider, whose
// parent is the whole toggle+label block worth moving as one piece.
const SLIDER_SELECTOR = "neptun-switch-slider";
const COURSE_BOX_SELECTOR = "input.mdc-checkbox__native-control";
const CHECKBOX_HOST_SELECTOR = "mat-checkbox";
const DETAILS_SELECTOR = ".course-details-button";
// Set by the rajtolo module on its own cloned toggle - reused here only to find and
// move that exact element, never to rebuild it. Absent when rajtolo is disabled.
const RAJTOLO_TOGGLE_SELECTOR = "[data-npu-rajtolo]";
const CONTAINER_ATTR = "data-npu-subject-registration-view";
let filterSequence = 0;
let sectionSequence = 0;
const movedControlOrigins = new WeakMap();

const meta = {
  id: "subjectRegistrationView",
  name: "Táblázatos kurzuslista",
  where: "Tárgyak › Tárgyfelvétel: a lenyitott tárgy kurzuslistája",
  description:
    "A kinyitott tárgy kurzusait táblázatként jeleníti meg (állapot, kód, nap/idő, " +
    "terem, létszám, ütközés, akciók) a natív, ismétlődő lista helyett.",
  defaultEnabled: false,
  group: "registration",
  options: [
    {
      id: "sortFilter",
      name: "Rendezés és szűrők",
      where: "Tárgyak › Tárgyfelvétel: a kurzustáblázat fölötti „Nézet” sor",
      description: "Nap/idő, szabad hely és kód szerinti rendezés, plusz ütközésmentes/szabad hely szűrő.",
      defaultEnabled: true,
    },
  ],
};

function shouldActivate() {
  return true;
}

// --- pure decisions: the "oszlopmodell", the comparators, the predicates, the ------
// --- conflict verdict. Everything here is DOM-free and unit-tested. ----------------

// The value every course shares for `key`, or null the moment two disagree (or none
// carry it at all). Drives both the subject-wide oktató/nyelv summary (uniform
// tutorName/language) and, via `differsFromUniform` below, which row still needs to
// repeat its own value.
function uniformField(courses, key) {
  let value;
  let seen = false;
  for (const course of courses || []) {
    const v = course && course[key];
    if (v === undefined || v === null || v === "") {
      continue;
    }
    if (!seen) {
      value = v;
      seen = true;
    } else if (v !== value) {
      return null;
    }
  }
  return seen ? value : null;
}

// Section grouping, in first-seen order - so "Elmélet" before "Labor" survives even
// though Map iteration order is otherwise insertion order anyway; explicit here
// because the caller relies on it for section rendering order.
//
// Keyed by `comparationTypeId`, NOT the display `type` text: docs/API.md measures
// `comparationTypeId` as the course type's language-neutral guid (Labor and Elmélet
// are distinct values), while `type` is a display label. Grouping on `type` itself
// can split one subject's courses when the server returns different labels. Falls
// back to a `type`-derived key only when `comparationTypeId` is missing - and that
// fallback is necessarily less reliable than the measured identity.
function groupByType(courses) {
  const groups = new Map();
  (courses || []).forEach(course => {
    const key = (course && course.comparationTypeId) || `type:${(course && course.type) || ""}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(course);
  });
  return groups;
}

// The section HEADING is still the human-readable `type` text - grouping moved to
// comparationTypeId, display did not. `uniformField` is reused here rather than just
// reading the first course's `type`: courses sharing a comparationTypeId are expected
// to share their `type` text too, but if a mixed response ever disagreed,
// falling back to the first course's own text is safer than asserting a false unity.
function sectionTypeLabel(courses) {
  return uniformField(courses, "type") || (courses[0] && courses[0].type) || "";
}

// The rule behind "csak akkor marad a soron, ha eltér a tárgy kurzusainak közös
// értékétől": nothing to show -> never shown; no common value at all (uniform===null)
// -> every course's own value is worth showing, since there is nothing to omit it
// against; otherwise shown only when it actually differs from that common value.
function differsFromUniform(value, uniform) {
  if (!value) {
    return false;
  }
  return uniform === null || value !== uniform;
}

// Independent of courseConflictHints's conflict search, but the same rule applies:
// `slotsOverlap` is the one source of truth for "do these two sessions collide".
function findConflicts(course, baseline) {
  if (!course || !Array.isArray(course.slots) || course.slots.length === 0) {
    return [];
  }
  return (baseline || []).filter(entry => {
    if (!entry || !entry.course || entry.course.id === course.id) {
      return false;
    }
    const otherSlots = entry.course.slots || [];
    return course.slots.some(slot => otherSlots.some(other => slotsOverlap(slot, other)));
  });
}

function conflictName(entry) {
  const subject = entry.subject || {};
  const course = entry.course || {};
  return subject.title || subject.code || course.code || "Ismeretlen tárgy";
}

function conflictDetails(entry) {
  const name = conflictName(entry);
  const code = entry && entry.course && entry.course.code;
  return code && name !== code ? `${name} (${code})` : name;
}

// A silent "no clash" and a silent "cannot tell" must never render the same way.
// This implementation keeps that invariant local to the table: "ok" is only ever
// said once `baselineComplete` is true.
function conflictVerdict(course, baseline, baselineComplete) {
  if (course && course.isSigned === true) {
    return {
      state: "enrolled",
      label: "",
      title: "",
      names: [],
    };
  }
  const hasSchedule = Boolean(course) && Array.isArray(course.slots) && course.slots.length > 0;
  if (!hasSchedule) {
    return {
      state: "no-schedule",
      label: "Nincs órarend",
      title: "Ehhez a kurzushoz nincs órarendi adat, nincs mihez viszonyítani.",
      names: [],
    };
  }
  const conflicts = findConflicts(course, baseline);
  if (conflicts.length > 0) {
    const names = conflicts.map(conflict => conflictName(conflict)).filter(Boolean);
    const details = conflicts.map(conflict => conflictDetails(conflict)).filter(Boolean);
    const full = details.join(", ");
    const label = `Ütközik${conflicts.length > 1 ? ` (+${conflicts.length - 1})` : ""}`;
    return {
      state: "conflict",
      label: label || "Ütközik",
      title: `Ütközik: ${full}`,
      names,
    };
  }
  if (!baselineComplete) {
    return {
      state: "unknown",
      label: "Nem ellenőrizhető",
      title: "A felvett/tervezett órarended még nem töltődött be teljesen, ezért az ütközésmentesség nem biztos.",
      names: [],
    };
  }
  return {
    state: "ok",
    label: "Nincs ütközés",
    title: "Nem ütközik a felvett vagy tervezett kurzusaiddal.",
    names: [],
  };
}

function sectionSummary(type, totalCount, availableCount, registered = 0) {
  const label = type || "Kurzusok";
  const details = [];
  if (registered > 0) {
    details.push(`${registered} felvett`);
  }
  if (availableCount > 0 || registered === 0) {
    details.push(`${availableCount} felvehető ütközés nélkül`);
  }
  return `${label} — ${totalCount} kurzus, ${details.join(", ")}`;
}

function compareByCode(a, b) {
  return String((a.course && a.course.code) || "").localeCompare(String((b.course && b.course.code) || ""));
}

function compareByTime(a, b) {
  const sa = a.course && a.course.slots && a.course.slots[0];
  const sb = b.course && b.course.slots && b.course.slots[0];
  if (!sa && !sb) {
    return compareByCode(a, b);
  }
  if (!sa) {
    return 1;
  }
  if (!sb) {
    return -1;
  }
  return sa.day - sb.day || sa.start - sb.start || compareByCode(a, b);
}

// free (0) before unknown (1) before full/waitlisted (2): an unknown seat count is
// not evidence the course is full, so it must not sink to the bottom with it.
function seatRank(freeSeat) {
  if (freeSeat === true) {
    return 0;
  }
  return freeSeat === false ? 2 : 1;
}

function compareByFreeSeats(a, b) {
  return seatRank(a.freeSeat) - seatRank(b.freeSeat) || compareByCode(a, b);
}

const SORTERS = { time: compareByTime, freeSeat: compareByFreeSeats, code: compareByCode };

function sortRows(rows, mode) {
  return rows.slice().sort(SORTERS[mode] || compareByTime);
}

// "Csak ütközésmentes" hides a KNOWN clash only; an unknown verdict stays visible; a
// broken/possibly-full read is a UX convenience, not the safety-critical distinction
// the verdict itself carries, so it fails open rather than closed.
function isConflictFree(row) {
  return !row.verdict || row.verdict.state !== "conflict";
}

function hasFreeSeat(row) {
  return row.freeSeat === true;
}

function filterRows(rows, filters) {
  return (rows || []).filter(
    row =>
      (!filters || !filters.conflictFree || isConflictFree(row)) && (!filters || !filters.freeSeat || hasFreeSeat(row))
  );
}

// The headcount text: "registered / limit" only when BOTH counts are real numbers. A `null` on
// either one - the field was never measured for this row - renders as "—", never a
// guessed or zeroed count; a measured `0` prints as "0" like any other number, per the
// null-vs-false/0 distinction registrationData.js now guarantees.
function seatCountText(course) {
  const registered = course && course.registeredStudentsCount;
  const max = course && course.maxLimit;
  if (typeof registered !== "number" || typeof max !== "number") {
    return "—";
  }
  return `${registered} / ${max}`;
}

// Seat state, built from `isFull`/`willBeOnWaitingList` alone - never from
// `registeredStudentsCount >= maxLimit` arithmetic (AGENTS.md invariant 5) and never
// from `isOnWaitingList`, which is a different, PERSONAL fact (see the file header):
// whether the student already sits on the waiting list for a course they already
// applied to, not whether a new application would queue. `occupancy.js`'s own
// `seatState`/`seatsGone` and `rajtolo/protocol.js`/`plan.js` read the same
// `isFull`+`willBeOnWaitingList` pair for exactly this reason - a course at its limit with
// an open waiting list measures `isFull: false, willBeOnWaitingList: true`, and
// treating that as a free seat is the bug their comments already document.
//
// Decision table (null = missing/not measured):
//   isFull=true,  willBeOnWaitingList=anything -> "full"       (isFull alone decides)
//   isFull=false, willBeOnWaitingList=true      -> "waitlist"
//   isFull=false, willBeOnWaitingList=false     -> "free"
//   isFull=false, willBeOnWaitingList=?         -> null         (see below)
//   isFull=?,     willBeOnWaitingList=anything  -> null         (course itself unknown)
//
// The isFull=false/willBeOnWaitingList=null row is deliberate, not an oversight: AGENTS.md
// invariant 5 says not to guess a waiting-list verdict, so "not full" alone must not be
// promoted to "free" - that would silently overclaim there is no queue. `seatsTitle`
// spells out why the cell gets a neutral, explicit unknown label in that case.
function seatState(course) {
  if (!course || typeof course.isFull !== "boolean") {
    return null;
  }
  if (course.isFull) {
    return "full";
  }
  if (typeof course.willBeOnWaitingList !== "boolean") {
    return null;
  }
  return course.willBeOnWaitingList ? "waitlist" : "free";
}

function freeSeatFromCourse(course) {
  const state = seatState(course);
  if (state === "free") {
    return true;
  }
  return state === "full" || state === "waitlist" ? false : null;
}

// Neptun's own badge palette (src/badge.js) - amber for "you can apply, but you queue"
// mirrors occupancy.js's own reading of the same three states.
function seatVariant(state) {
  if (state === "full") {
    return "full";
  }
  if (state === "waitlist") {
    return "partial";
  }
  return state === "free" ? "free" : "neutral";
}

function seatsTitle(state, course) {
  if (state === "full") {
    return "A kurzus betelt.";
  }
  if (state === "waitlist") {
    const waiting = course && typeof course.waitingStudentsCount === "number" ? course.waitingStudentsCount : null;
    if (waiting !== null) {
      return `Várólistára kerülnél (${waiting} fő vár már).`;
    }
    return "Várólistára kerülnél.";
  }
  if (state === "free") {
    return "Van szabad hely.";
  }
  // state === null covers two different unknowns - the course itself (`isFull`) may
  // be unmeasured, or `isFull` may say "not full" while the waiting-list forecast
  // (`willBeOnWaitingList`) is unmeasured. Worth telling apart: the first says nothing
  // at all, the second at least rules out "full".
  if (course && course.isFull === false) {
    return "A kurzus nem telt be, de nem ismert, hogy egy új jelentkezés várólistára kerülne-e.";
  }
  return "Ennél a kurzusnál nem ismert a betelt állapot.";
}

function formatClock(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function formatSlotTime(slot) {
  if (!slot) {
    return "";
  }
  const time = `${formatClock(slot.start)}–${formatClock(slot.end)}`;
  return slot.dayLabel ? `${slot.dayLabel} ${time}` : time;
}

// The "oszlopmodell": everything a row needs to render, computed once, DOM-free.
function buildRowModel(course, baseline, baselineComplete) {
  return {
    course,
    code: (course && course.code) || "",
    slots: (course && course.slots) || [],
    verdict: conflictVerdict(course, baseline, baselineComplete),
    freeSeat: freeSeatFromCourse(course),
  };
}

// --- DOM side: turning the model into a table, moving the real controls into it ----

function normaliseCode(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

// Ambiguous duplicate course codes are dropped rather than guessed at - the same rule
// occupancy.js/courseConflictHints.js apply to the same problem, reimplemented here
// rather than imported, so the table stays independent of the badge module.
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
    el => el.children.length === 0 && knownCodes.has(normaliseCode(el.textContent))
  );
  return leaf ? normaliseCode(leaf.textContent) : null;
}

function findCheckboxControl(row) {
  const input = row.querySelector(COURSE_BOX_SELECTOR);
  if (!input) {
    return null;
  }
  const host = input.closest && input.closest(CHECKBOX_HOST_SELECTOR);
  if (host && row.contains(host)) {
    return host;
  }
  return input.parentElement || input;
}

function findPlannerControl(row) {
  const slider = row.querySelector(SLIDER_SELECTOR);
  return (slider && slider.parentElement) || null;
}

function findRajtoloControl(row) {
  return row.querySelector(RAJTOLO_TOGGLE_SELECTOR);
}

function matchesOrContains(element, selector) {
  return Boolean(
    (element.matches && element.matches(selector)) || (element.querySelector && element.querySelector(selector))
  );
}

function controlsMovedFromRow(cell, row) {
  return Array.from(cell.children).filter(control => {
    const origin = movedControlOrigins.get(control);
    return origin && origin.parent && row.contains(origin.parent);
  });
}

function findExtraButtons(row, claimed) {
  return Array.from(row.querySelectorAll(`${DETAILS_SELECTOR}, button`)).filter(
    control => !claimed.some(item => item && (item === control || item.contains(control)))
  );
}

// Moves the real controls - never clones them - so Angular's own click handlers and
// form bindings travel with them. Idempotent: a control already parented here is left
// alone, so a repeat call from the MutationObserver cannot re-trigger itself.
function moveActionControls(cell, row) {
  const moved = controlsMovedFromRow(cell, row);
  const checkbox =
    findCheckboxControl(row) || moved.find(control => matchesOrContains(control, COURSE_BOX_SELECTOR)) || null;
  const planner = findPlannerControl(row) || moved.find(control => matchesOrContains(control, SLIDER_SELECTOR)) || null;
  const rajtolo =
    findRajtoloControl(row) || moved.find(control => matchesOrContains(control, RAJTOLO_TOGGLE_SELECTOR)) || null;
  const claimed = [checkbox, planner, rajtolo];
  const extras = findExtraButtons(row, claimed).concat(moved.filter(control => !claimed.includes(control)));
  const controls = [checkbox, planner, rajtolo, ...extras].filter(
    (control, index, all) => all.indexOf(control) === index
  );
  Array.from(cell.children).forEach(control => {
    if (!controls.includes(control)) {
      restoreActionControl(control);
    }
  });
  controls.forEach(control => {
    if (control && control.parentElement !== cell) {
      if (!movedControlOrigins.has(control)) {
        movedControlOrigins.set(control, { parent: control.parentElement, nextSibling: control.nextSibling });
      }
      cell.appendChild(control);
    }
  });
}

function restoreActionControl(control) {
  const origin = movedControlOrigins.get(control);
  if (!origin) {
    return;
  }
  if (!origin.parent || !origin.parent.isConnected) {
    control.remove();
    movedControlOrigins.delete(control);
    return;
  }
  const nextSibling =
    origin.nextSibling && origin.nextSibling.parentElement === origin.parent ? origin.nextSibling : null;
  origin.parent.insertBefore(control, nextSibling);
  movedControlOrigins.delete(control);
}

function restoreActionControls(cell) {
  Array.from(cell.children).forEach(restoreActionControl);
}

// Built straight from registeredStudentsCount/maxLimit/isFull/isOnWaitingList - see
// the file header for why this is not the occupancy module's badge moved in. The
// occupancy module still paints its own `[data-npu-occupancy]` badge onto the native
// row for its own, independent purpose; that row stays hidden here, so nothing of
// ours ever stands next to it on screen.
function paintSeatsCell(cell, course) {
  const text = seatCountText(course);
  const meter = cell.querySelector("[data-npu-seat-meter]");
  if (text === "—") {
    const existingBadge = cell.querySelector("[data-npu-seats]");
    if (existingBadge) {
      existingBadge.remove();
    }
    if (meter) {
      meter.remove();
    }
    if (cell.textContent !== "—") {
      cell.textContent = "—";
    }
    return;
  }
  if (cell.children.length === 0 && cell.textContent !== "") {
    // Clears a stray "—" text node left over from an earlier tick where the counts
    // were not yet known - badge.paint only ever manages its own flagged element.
    cell.textContent = "";
  }
  const state = seatState(course);
  badge.paint(cell, cell, "data-npu-seats", text, seatVariant(state), seatsTitle(state, course));
  // How full, at a glance. Drawn from the two counts only; the colour, like the
  // badge's, comes from seatState - never from the arithmetic (invariant 5).
  const bar = meter || cell.ownerDocument.createElement("div");
  if (!meter) {
    bar.setAttribute("data-npu-seat-meter", "");
    bar.setAttribute("aria-hidden", "true");
    bar.appendChild(cell.ownerDocument.createElement("span"));
    cell.appendChild(bar);
  }
  const ratio = course.maxLimit > 0 ? Math.min(course.registeredStudentsCount / course.maxLimit, 1) : 0;
  const width = `${Math.round(ratio * 100)}%`;
  const fill = bar.firstChild;
  if (fill.style.width !== width) {
    fill.style.width = width;
  }
  const tone = seatVariant(state);
  if (bar.getAttribute("data-tone") !== tone) {
    bar.setAttribute("data-tone", tone);
  }
}

// The code cell plus, only when it differs from the subject-wide common value, the
// course's own tutor/language - see differsFromUniform for the exact rule.
function paintCodeCell(cell, course, uniformTutor, uniformLanguage) {
  const codeText = course.code || "—";
  let codeLine = cell.querySelector("[data-npu-code-line]");
  if (!codeLine) {
    cell.textContent = "";
    codeLine = cell.ownerDocument.createElement("div");
    codeLine.setAttribute("data-npu-code-line", "");
    const code = cell.ownerDocument.createElement("span");
    code.setAttribute("data-npu-code-text", "");
    codeLine.appendChild(code);
    cell.appendChild(codeLine);
  }
  const codeSpan = codeLine.querySelector("[data-npu-code-text]");
  if (codeSpan.textContent !== codeText) {
    codeSpan.textContent = codeText;
  }
  // Your own relationship to the course sits right by its code, not in a column of
  // its own that stays empty on every other row.
  paintEnrolledState(codeLine, course);

  const extras = [];
  if (differsFromUniform(course.tutorName, uniformTutor)) {
    extras.push(course.tutorName);
  }
  if (differsFromUniform(course.language, uniformLanguage)) {
    extras.push(course.language);
  }
  let extraLine = cell.querySelector("[data-npu-code-extra]");
  if (extras.length === 0) {
    if (extraLine) {
      extraLine.remove();
    }
    return;
  }
  if (!extraLine) {
    extraLine = cell.ownerDocument.createElement("div");
    extraLine.setAttribute("data-npu-code-extra", "");
    cell.appendChild(extraLine);
  }
  const text = extras.join(" · ");
  if (extraLine.textContent !== text) {
    extraLine.textContent = text;
  }
}

// The subject-wide oktató/nyelv summary line, shown once above all of a subject's
// sections - only when a value is actually uniform across every one of its courses.
// The summary is only shown when the value is uniform across the current subject's
// courses, which keeps repeated data out of the table.
function paintSubjectSummary(container, uniformTutor, uniformLanguage) {
  const parts = [];
  if (uniformTutor) {
    parts.push(`Oktató: ${uniformTutor}`);
  }
  if (uniformLanguage) {
    parts.push(`Nyelv: ${uniformLanguage}`);
  }
  let host = container.querySelector("[data-npu-subject-summary]");
  if (parts.length === 0) {
    if (host) {
      host.remove();
    }
    return;
  }
  if (!host) {
    host = container.ownerDocument.createElement("div");
    host.setAttribute("data-npu-subject-summary", "");
    host.style.cssText = "font-size:13px;opacity:.8;margin-bottom:4px;";
    container.insertBefore(host, container.firstChild);
  }
  const text = parts.join(" · ");
  if (host.textContent !== text) {
    host.textContent = text;
  }
}

// The three-reading "állapot": your OWN relationship to this course, never a seat/
// capacity signal (that is "létszám", built from isFull/willBeOnWaitingList instead -
// see the file header for why the two personal fields, isSigned and isOnWaitingList,
// belong here and the two seat-forecast fields do not). Enrolled beats queued beats
// neither, though a course would not normally measure both isSigned and
// isOnWaitingList true at once. `isOnWaitingList === null` (not measured) shows only
// isSigned - never a guessed waiting-list badge.
function paintEnrolledState(cell, course) {
  if (course.isSigned) {
    badge.paint(cell, cell, "data-npu-enrolled", "Felvéve", "free", "Ezt a kurzust már felvetted.");
    return;
  }
  if (course.isOnWaitingList === true) {
    badge.paint(cell, cell, "data-npu-enrolled", "Várólistán", "partial", "Ezen a kurzuson várólistán állsz.");
    return;
  }
  badge.paint(cell, cell, "data-npu-enrolled", null, null, null);
}

function paintConflictBadge(cell, verdict) {
  const variant =
    verdict.state === "enrolled"
      ? null
      : verdict.state === "conflict"
        ? "full"
        : verdict.state === "ok"
          ? "free"
          : "neutral";
  badge.paint(cell, cell, "data-npu-row-conflict", verdict.label || null, variant, verdict.title || null);
  const pill = cell.querySelector("[data-npu-row-conflict]");
  if (pill && pill !== cell.firstElementChild) {
    cell.insertBefore(pill, cell.firstElementChild);
  }
  // What it clashes with, in words, under the badge: the reason to skip this row.
  const names = verdict.state === "conflict" ? verdict.names.join(", ") : "";
  let line = cell.querySelector("[data-npu-conflict-names]");
  if (!names) {
    if (line) {
      line.remove();
    }
    return;
  }
  if (!line) {
    line = cell.ownerDocument.createElement("div");
    line.setAttribute("data-npu-conflict-names", "");
    cell.appendChild(line);
  }
  if (line.textContent !== names) {
    line.textContent = names;
    line.title = verdict.title || names;
  }
}

function columnLabels() {
  return ["Kurzus", "Időpont", "Létszám", "Ütközés", "Műveletek"];
}

function buildSectionTable(doc) {
  const table = doc.createElement("table");
  table.setAttribute("data-npu-course-table", "");
  table.setAttribute("role", "table");
  table.setAttribute("aria-label", "Kurzusok");
  const colgroup = doc.createElement("colgroup");
  ["23%", "24%", "13%", "17%", "23%"].forEach(width => {
    const col = doc.createElement("col");
    col.style.width = width;
    colgroup.appendChild(col);
  });
  table.appendChild(colgroup);
  const thead = doc.createElement("thead");
  thead.setAttribute("role", "rowgroup");
  const headRow = doc.createElement("tr");
  headRow.setAttribute("role", "row");
  columnLabels().forEach(text => {
    const th = doc.createElement("th");
    th.setAttribute("scope", "col");
    th.setAttribute("role", "columnheader");
    th.textContent = text;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);
  const body = doc.createElement("tbody");
  body.setAttribute("role", "rowgroup");
  table.appendChild(body);
  return table;
}

// One row per course. Extra sessions (rare - see docs/API.md, none were measured in
// the sample) get a continuation row below it holding only nap+idő and terem, per the
// spec: never invent a room/time for a course that plainly has only one.
// One row per course; every weekly session is a line of its own inside the time cell,
// its room beside it - never a room or time invented for a course that has none.
function buildRow(doc, model) {
  const labels = columnLabels();
  const tr = doc.createElement("tr");
  tr.setAttribute("data-npu-course-row", "");
  tr.setAttribute("role", "row");
  const cell = (label, attribute) => {
    const td = doc.createElement("td");
    td.setAttribute("role", "cell");
    td.setAttribute("data-label", label);
    if (attribute) {
      td.setAttribute(attribute, "");
    }
    return td;
  };

  const codeTd = cell(labels[0], "data-npu-course-identity");
  const timeTd = cell(labels[1], "data-npu-schedule");
  if (model.slots.length === 0) {
    timeTd.textContent = "—";
  }
  model.slots.forEach(slot => {
    const line = doc.createElement("div");
    line.setAttribute("data-npu-slot", "");
    const day = doc.createElement("span");
    day.setAttribute("data-npu-day", "");
    day.textContent = DAY_SHORT[slot.day] || slot.dayLabel || "";
    day.title = slot.dayLabel || "";
    const time = doc.createElement("span");
    time.setAttribute("data-npu-time", "");
    time.textContent = `${formatClock(slot.start)}–${formatClock(slot.end)}`;
    line.append(day, time);
    if (slot.rooms) {
      const room = doc.createElement("span");
      room.setAttribute("data-npu-room", "");
      room.textContent = slot.rooms;
      line.appendChild(room);
    }
    timeTd.appendChild(line);
  });
  const seatsTd = cell(labels[2], "data-npu-seats-cell");
  const conflictTd = cell(labels[3], "data-npu-conflict-cell");
  const actionsTd = cell(labels[4]);
  const actionsHost = doc.createElement("div");
  actionsHost.setAttribute("data-npu-actions", "");
  actionsTd.appendChild(actionsHost);

  tr.append(codeTd, timeTd, seatsTd, conflictTd, actionsTd);
  return { tr, extraRows: [], codeTd, seatsTd, conflictTd, actionsTd: actionsHost };
}

function buildFilter(doc, label, onToggle) {
  const reference = doc.querySelector("mat-checkbox");
  const field = reference ? reference.cloneNode(true) : doc.createElement("label");
  field.setAttribute("data-npu-filter", "");
  const input = doc.createElement("input");
  const nativeInput = field.querySelector && field.querySelector(COURSE_BOX_SELECTOR);
  const filterInput = nativeInput || input;
  if (!nativeInput) {
    filterInput.type = "checkbox";
    filterInput.setAttribute("aria-label", label);
    field.appendChild(filterInput);
    field.appendChild(doc.createTextNode(label));
  } else {
    field.removeAttribute("id");
    Array.from(field.querySelectorAll("[id]")).forEach(element => element.removeAttribute("id"));
    const id = `npu-course-filter-${++filterSequence}`;
    filterInput.id = id;
    filterInput.removeAttribute("disabled");
    filterInput.removeAttribute("aria-labelledby");
    filterInput.tabIndex = 0;
    filterInput.setAttribute("aria-label", label);
    field.classList.remove("mat-mdc-checkbox-disabled", "mdc-checkbox--disabled");
    const caption = field.querySelector(".mdc-label");
    if (caption) {
      caption.htmlFor = id;
      caption.textContent = label;
    }
    // A cloned MDC host has no Angular click handler of its own. Handle every
    // decorative child here and suppress label activation, otherwise the click can
    // be ignored or toggle twice depending on which child was hit.
    field.addEventListener("click", event => {
      if (event.target === filterInput) {
        return;
      }
      event.preventDefault();
      filterInput.click();
    });
  }
  filterInput.checked = false;
  const checkboxVisual = field.querySelector && field.querySelector(".mdc-checkbox");
  const syncVisual = () => {
    field.classList.toggle("mat-mdc-checkbox-checked", filterInput.checked);
    if (checkboxVisual) {
      checkboxVisual.classList.toggle("mdc-checkbox--selected", filterInput.checked);
    }
    field.setAttribute("aria-checked", String(filterInput.checked));
  };
  filterInput.addEventListener("change", () => {
    syncVisual();
    onToggle();
  });
  syncVisual();
  return { field, input: filterInput };
}

// One section per course `type` ("Labor", "Elmélet", ...): heading and table. The
// filter/sort controls live once per subject panel so the repeated toolbars do not
// compete with the actual course choices.
function buildSection(container, doc) {
  const root = doc.createElement("section");
  root.setAttribute("data-npu-course-section", "");
  const headingRow = doc.createElement("div");
  headingRow.setAttribute("data-npu-section-heading", "");
  const heading = doc.createElement("h4");
  const headingId = `npu-course-section-${++sectionSequence}`;
  heading.id = headingId;
  headingRow.appendChild(heading);

  const section = {
    root,
    heading,
    tbody: null,
    rows: new Map(),
    emptyRow: null,
    emptyText: "A szűrésnek nincs megfelelő kurzusa.",
  };

  const table = buildSectionTable(doc);
  table.removeAttribute("aria-label");
  table.setAttribute("aria-labelledby", headingId);
  section.tbody = table.querySelector("tbody");
  root.append(headingRow, table);
  container.appendChild(root);
  return section;
}

function buildViewToolbar(doc, state) {
  const toolbar = doc.createElement("div");
  toolbar.setAttribute("data-npu-view-toolbar", "");

  const label = doc.createElement("span");
  label.setAttribute("data-npu-toolbar-label", "");
  label.textContent = "Nézet";
  utils.markNpu(label, "Táblázatos kurzuslista");

  const conflictFilter = buildFilter(doc, "Csak ütközésmentes", () => {
    state.filters.conflictFree = conflictFilter.input.checked;
    applyAllFiltersAndSort(state);
  });
  const seatFilter = buildFilter(doc, "Csak szabad hely", () => {
    state.filters.freeSeat = seatFilter.input.checked;
    applyAllFiltersAndSort(state);
  });

  const sortLabel = doc.createElement("label");
  sortLabel.setAttribute("data-npu-sort", "");
  sortLabel.appendChild(doc.createTextNode("Rendezés"));
  const sortSelect = doc.createElement("select");
  sortSelect.name = "npu-course-sort";
  sortSelect.setAttribute("aria-label", "Kurzusok rendezése");
  [
    ["time", "Nap / idő"],
    ["freeSeat", "Szabad hely"],
    ["code", "Kód"],
  ].forEach(([value, text]) => {
    const option = doc.createElement("option");
    option.value = value;
    option.textContent = text;
    sortSelect.appendChild(option);
  });
  sortSelect.addEventListener("change", () => {
    state.sort = sortSelect.value;
    applyAllFiltersAndSort(state);
  });
  sortLabel.appendChild(sortSelect);
  toolbar.append(label, conflictFilter.field, seatFilter.field, sortLabel);
  return toolbar;
}

// Hides filtered-out rows rather than removing them (they hold the real, moved
// controls) and reorders the visible ones in place - the same guard occupancy.js
// applies to its own row reordering, so a no-op does not retrigger the observer.
function applyFiltersAndSort(section, state) {
  const entries = Array.from(section.rows.values());
  const filtered = filterRows(entries, state.filters);
  const visible = new Set(filtered.map(entry => entry.course.id));
  entries.forEach(entry => {
    const hide = !visible.has(entry.course.id);
    const wanted = hide ? "none" : "";
    if (entry.tr.style.display !== wanted) {
      entry.tr.style.display = wanted;
      entry.extraRows.forEach(tr => {
        tr.style.display = wanted;
      });
    }
  });
  const sorted = sortRows(filtered, state.sort);
  const target = [];
  sorted.forEach(entry => target.push(entry.tr, ...entry.extraRows));
  if (!section.emptyRow) {
    const emptyRow = section.tbody.ownerDocument.createElement("tr");
    emptyRow.setAttribute("data-npu-empty", "");
    emptyRow.setAttribute("role", "row");
    const emptyCell = section.tbody.ownerDocument.createElement("td");
    emptyCell.setAttribute("role", "cell");
    emptyCell.colSpan = 5;
    emptyCell.textContent = section.emptyText;
    emptyRow.appendChild(emptyCell);
    section.emptyRow = emptyRow;
  }
  section.emptyRow.hidden = filtered.length > 0;

  // Compared against the VISIBLE rows only. Hidden rows stay where they are, so with a
  // filter on, comparing against every row never matched and each repaint re-appended
  // the visible rows, moving the real controls inside them and the focus with them.
  const shown = new Set(target);
  const current = Array.from(section.tbody.children).filter(node => shown.has(node));
  const unchanged = current.length === target.length && target.every((node, i) => node === current[i]);
  if (!unchanged) {
    target.forEach(node => section.tbody.appendChild(node));
  }
  if (section.tbody.lastElementChild !== section.emptyRow) {
    section.tbody.appendChild(section.emptyRow);
  }
}

function applyAllFiltersAndSort(state) {
  state.sections.forEach(section => applyFiltersAndSort(section, state));
}

// Builds a row on first sight only: a course already rendered keeps its own <tr> (and
// therefore keeps the real controls already moved into it) across every repaint. Its
// conflict verdict, seat state and tutor/language note are all cheap to recompute and
// can legitimately change between ticks (a native response landing), so
// those are refreshed every time; only the DOM node identity is cached.
function refreshSection(section, courses, rowByCourseId, snapshot, uniformTutor, uniformLanguage, state) {
  const doc = section.tbody.ownerDocument;
  const currentIds = new Set(courses.map(course => course.id));
  section.rows.forEach((entry, id) => {
    if (currentIds.has(id)) {
      return;
    }
    entry.tr.remove();
    entry.extraRows.forEach(row => row.remove());
    section.rows.delete(id);
  });
  courses.forEach(course => {
    let entry = section.rows.get(course.id);
    if (!entry) {
      const model = buildRowModel(course, snapshot.baseline, snapshot.baselineComplete);
      const built = buildRow(doc, model);
      section.tbody.appendChild(built.tr);
      built.extraRows.forEach(tr => section.tbody.appendChild(tr));
      entry = Object.assign({ course }, built);
      section.rows.set(course.id, entry);
    }
    const nativeRow = rowByCourseId.get(course.id);
    if (nativeRow) {
      moveActionControls(entry.actionsTd, nativeRow);
    }
    entry.course = course;
    entry.verdict = conflictVerdict(course, snapshot.baseline, snapshot.baselineComplete);
    entry.freeSeat = freeSeatFromCourse(course);
    paintConflictBadge(entry.conflictTd, entry.verdict);
    paintSeatsCell(entry.seatsTd, course);
    paintCodeCell(entry.codeTd, course, uniformTutor, uniformLanguage);
  });

  const currentRows = Array.from(section.rows.values()).filter(entry => currentIds.has(entry.course.id));
  const registered = currentRows.filter(entry => entry.course.isSigned === true).length;
  const available = currentRows.filter(
    entry =>
      entry.course.isSigned !== true &&
      entry.course.isOnWaitingList !== true &&
      entry.verdict.state === "ok" &&
      entry.freeSeat === true
  ).length;
  const summary = sectionSummary(sectionTypeLabel(courses), courses.length, available, registered);
  if (section.heading.getAttribute("aria-label") !== summary) {
    paintHeading(section.heading, sectionTypeLabel(courses), courses.length, available, registered);
    section.heading.setAttribute("aria-label", summary);
  }
  currentRows.forEach(entry => {
    const rowState = rowStateOf(entry);
    if (entry.tr.getAttribute("data-npu-row-state") !== rowState) {
      entry.tr.setAttribute("data-npu-row-state", rowState);
    }
  });
  applyFiltersAndSort(section, state);
}

// A section title the eye can scan: the type, then its counts as chips. The plain
// sentence stays as the heading's accessible name.
function paintHeading(heading, type, total, available, registered) {
  const doc = heading.ownerDocument;
  heading.textContent = "";
  const name = doc.createElement("span");
  name.setAttribute("data-npu-section-type", "");
  name.textContent = type || "Kurzusok";
  heading.appendChild(name);
  [
    [`${total} kurzus`, "total"],
    [registered > 0 ? `${registered} felvett` : null, "registered"],
    [available > 0 || registered === 0 ? `${available} felvehető ütközés nélkül` : null, "available"],
  ].forEach(([text, kind]) => {
    if (!text) {
      return;
    }
    const chip = doc.createElement("span");
    chip.setAttribute("data-npu-chip", kind);
    chip.setAttribute("aria-hidden", "true");
    chip.textContent = text;
    heading.appendChild(chip);
  });
}

// Which way a row leans, for its accent: held, open to take, or out of reach. Pure.
function rowStateOf(entry) {
  const course = entry.course || {};
  if (course.isSigned === true) {
    return "enrolled";
  }
  if (course.isOnWaitingList === true) {
    return "queued";
  }
  const verdict = entry.verdict || {};
  if (verdict.state === "conflict" || entry.freeSeat === false) {
    return "blocked";
  }
  return verdict.state === "ok" && entry.freeSeat === true ? "available" : "neutral";
}

function buildContainer(doc) {
  const container = doc.createElement("div");
  container.setAttribute(CONTAINER_ATTR, "");
  return container;
}

// One entry per subject expansion panel, so filter/sort choices and already-built
// rows survive a repaint. Lost only if Angular replaces the panel element itself
// (route revisit, list re-render) - an acceptable reset, not a bug: the panel is
// rebuilt fresh from the current snapshot either way.
const panelState = new WeakMap();

function ensurePanelState() {
  return {
    container: null,
    sections: new Map(),
    nativeSections: new Set(),
    filters: { conflictFree: false, freeSeat: false },
    sort: "time",
    toolbar: null,
  };
}

// Renders (or refreshes) one expanded subject's table. `matches` pairs each visible
// native course row with the registrationData course it corresponds to; a subject
// with no matches is left to the native list entirely (registrationData has not
// fetched its courses, or the subject is not the one currently expanded - Angular
// only renders course rows for the open accordion panel, so a collapsed subject
// simply contributes nothing here).
//
// ponytail: a course whose `comparationTypeId` changes between repaints (never
// observed, no evidence it happens) would end up in two sections rather than moving
// between them. Not worth chasing without a measured case; the fix would be tracking
// course->section membership explicitly instead of rebuilding groups each time.
function renderPanel(panel, matches, snapshot, sortFilterEnabled) {
  let state = panelState.get(panel);
  if (!state) {
    state = ensurePanelState();
    panelState.set(panel, state);
  }

  matches.forEach(({ row }) => {
    // Hidden, never removed: the row's own Angular bindings must stay alive
    // underneath, and the row still holds any control we have not moved out yet.
    if (row.style.display !== "none") {
      row.style.display = "none";
    }
  });

  const matchedRows = new Set(matches.map(match => match.row));
  Array.from(panel.querySelectorAll(ROW_SELECTOR)).forEach(row => {
    if (!matchedRows.has(row)) {
      row.style.removeProperty("display");
    }
  });
  const nativeTypeSections = new Set(
    matches.map(match => match.row.closest(NATIVE_TYPE_SECTION_SELECTOR)).filter(Boolean)
  );
  state.nativeSections.forEach(section => {
    if (!nativeTypeSections.has(section)) {
      section.style.removeProperty("display");
    }
  });
  const hideableNativeSections = new Set();
  nativeTypeSections.forEach(section => {
    const rows = Array.from(section.querySelectorAll(ROW_SELECTOR));
    if (rows.length > 0 && rows.every(row => matchedRows.has(row))) {
      section.style.display = "none";
      hideableNativeSections.add(section);
    } else {
      section.style.removeProperty("display");
    }
  });
  state.nativeSections = hideableNativeSections;

  if (!state.container || !state.container.isConnected) {
    state.container = buildContainer(panel.ownerDocument);
    const firstNativeTypeSection = Array.from(nativeTypeSections)[0];
    const nativeTypeHost = firstNativeTypeSection ? firstNativeTypeSection.parentElement : null;
    if (nativeTypeHost) {
      nativeTypeHost.appendChild(state.container);
    } else {
      const anchor = matches[0].row.parentElement;
      if (anchor && anchor.parentElement) {
        anchor.parentElement.insertBefore(state.container, anchor.nextSibling);
      }
    }
    state.sections = new Map();
    state.toolbar = null;
  }

  const firstNativeTypeSection = Array.from(nativeTypeSections)[0];
  const nativeTypeHost = firstNativeTypeSection ? firstNativeTypeSection.parentElement : null;
  // Reparent only after Angular replaced the host. Appending an already-mounted
  // container on every repaint is still a childList mutation, which can race the
  // expansion panel while it is opening and make its state snap back.
  if (nativeTypeHost && state.container.parentElement !== nativeTypeHost) {
    nativeTypeHost.appendChild(state.container);
  }

  const courses = matches.map(m => m.course);
  // Same scope for the row-level exception as for the header summary - "the subject's
  // courses" per the spec's own wording, not just the courses of whichever section a
  // given row happens to sit in.
  const uniformTutor = uniformField(courses, "tutorName");
  const uniformLanguage = uniformField(courses, "language");
  paintSubjectSummary(state.container, uniformTutor, uniformLanguage);

  const groups = groupByType(courses);
  const rowByCourseId = new Map(matches.map(m => [m.course.id, m.row]));

  if (!sortFilterEnabled && state.toolbar) {
    state.toolbar.remove();
    state.toolbar = null;
  } else if (sortFilterEnabled && !state.toolbar) {
    state.toolbar = buildViewToolbar(panel.ownerDocument, state);
    state.container.appendChild(state.toolbar);
  }

  groups.forEach((groupCourses, key) => {
    let section = state.sections.get(key);
    if (!section) {
      section = buildSection(state.container, panel.ownerDocument);
      state.sections.set(key, section);
    }
    refreshSection(section, groupCourses, rowByCourseId, snapshot, uniformTutor, uniformLanguage, state);
  });

  const liveKeys = new Set(groups.keys());
  state.sections.forEach((section, key) => {
    if (liveKeys.has(key)) {
      return;
    }
    section.root.remove();
    state.sections.delete(key);
  });
}

function restoreNativePanel(panel) {
  Array.from(panel.querySelectorAll(ROW_SELECTOR)).forEach(row => {
    row.style.removeProperty("display");
  });
  const state = panelState.get(panel);
  if (!state) {
    return;
  }
  state.sections.forEach(section => {
    section.rows.forEach(entry => restoreActionControls(entry.actionsTd));
  });
  state.nativeSections.forEach(section => section.style.removeProperty("display"));
  if (state.container) {
    state.container.remove();
  }
  state.container = null;
  state.nativeSections = new Set();
  state.sections = new Map();
  state.toolbar = null;
}

function apply(root, snapshot) {
  const flags = settings.readFlags();
  const sortFilterEnabled = settings.isOptionEnabled({ meta }, meta.options[0], flags);
  const courseByCode = uniqueCoursesByCode(snapshot.courses);
  const knownCodes = new Set(courseByCode.keys());

  Array.from(root.querySelectorAll(SUBJECT_ROW_SELECTOR)).forEach(panel => {
    const matches = Array.from(panel.querySelectorAll(ROW_SELECTOR))
      .map(row => {
        const code = codeIn(row, knownCodes);
        const course = code && courseByCode.get(code);
        return course ? { row, course } : null;
      })
      .filter(Boolean);
    if (matches.length > 0) {
      renderPanel(panel, matches, snapshot, sortFilterEnabled);
    } else {
      restoreNativePanel(panel);
    }
  });
}

function injectResponsiveCss() {
  utils.injectCss(`
    [${CONTAINER_ATTR}] {
      --npu-subject-rule: rgba(33,48,85,.12);
      --npu-subject-rule: color-mix(in srgb, ${tokens.text} 12%, transparent);
      --npu-subject-soft: rgba(33,48,85,.04);
      --npu-subject-soft: color-mix(in srgb, ${tokens.text} 4%, transparent);
      --npu-ok: #34b39a;
      --npu-bad: #b3261e;
      --npu-warn: #f5b82e;
      margin-top: 4px;
    }
    [${CONTAINER_ATTR}] [data-npu-view-toolbar] {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px 18px;
      padding: 8px 12px;
      margin: 0 0 14px;
      border-radius: 10px;
      background: var(--npu-subject-soft);
      font-size: 13px;
    }
    [${CONTAINER_ATTR}] [data-npu-toolbar-label] {
      display: inline-flex;
      align-items: center;
      font-weight: 700;
    }
    [${CONTAINER_ATTR}] [data-npu-filter],
    [${CONTAINER_ATTR}] [data-npu-sort] {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 32px;
    }
    [${CONTAINER_ATTR}] [data-npu-filter] input {
      width: 18px;
      height: 18px;
      margin: 0;
    }
    [${CONTAINER_ATTR}] [data-npu-sort] {
      margin-left: auto;
    }
    [${CONTAINER_ATTR}] [data-npu-sort] select {
      min-height: 32px;
      max-width: 12rem;
      padding: 0 8px;
      border: 1px solid var(--npu-subject-rule);
      border-radius: 8px;
      background: ${tokens.surface};
      color: ${tokens.text};
      font: inherit;
    }
    [${CONTAINER_ATTR}] [data-npu-course-section] {
      margin: 0 0 20px;
    }
    [${CONTAINER_ATTR}] [data-npu-section-heading] {
      display: flex;
      align-items: center;
      min-height: 34px;
      margin: 0;
      padding: 2px 0 8px;
    }
    [${CONTAINER_ATTR}] [data-npu-section-heading] h4 {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 8px;
      margin: 0;
      font-size: 16px;
      line-height: 1.3;
    }
    [${CONTAINER_ATTR}] [data-npu-section-type] {
      /* Neptun's own titles (measured): LatoWeb has no heavier face to synthesise. */
      font-family: "Source Sans Pro", sans-serif;
      font-weight: 900 !important;
      margin-right: 4px;
    }
    [${CONTAINER_ATTR}] [data-npu-chip] {
      font-size: 12px;
      font-weight: 600;
      padding: 2px 9px;
      border-radius: 10px;
      background: var(--npu-subject-soft);
    }
    [${CONTAINER_ATTR}] [data-npu-chip="registered"] {
      background: rgba(52,179,154,.16);
    }
    [${CONTAINER_ATTR}] [data-npu-chip="available"] {
      background: rgba(9,67,217,.10);
    }
    [${CONTAINER_ATTR}] [data-npu-course-table] {
      width: 100%;
      table-layout: fixed;
      border-collapse: separate;
      border-spacing: 0;
      margin: 0;
      font: inherit;
      border: 1px solid var(--npu-subject-rule);
      border-radius: 10px;
      overflow: hidden;
    }
    [${CONTAINER_ATTR}] [data-npu-course-table] th {
      padding: 8px 12px;
      border-bottom: 1px solid var(--npu-subject-rule);
      background: var(--npu-subject-soft);
      text-align: left;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .05em;
      text-transform: uppercase;
      line-height: 1.2;
      opacity: .75;
    }
    [${CONTAINER_ATTR}] [data-npu-course-table] td {
      min-width: 0;
      padding: 10px 12px;
      border-bottom: 1px solid var(--npu-subject-rule);
      text-align: left;
      vertical-align: middle;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    [${CONTAINER_ATTR}] [data-npu-course-table] tbody tr:last-child td {
      border-bottom: 0;
    }
    [${CONTAINER_ATTR}] [data-npu-course-table] td:first-child {
      border-left: 3px solid transparent;
    }
    [${CONTAINER_ATTR}] tr[data-npu-row-state="enrolled"] td {
      background: rgba(52,179,154,.07);
    }
    [${CONTAINER_ATTR}] tr[data-npu-row-state="enrolled"] td:first-child {
      border-left-color: var(--npu-ok);
    }
    [${CONTAINER_ATTR}] tr[data-npu-row-state="queued"] td:first-child {
      border-left-color: var(--npu-warn);
    }
    [${CONTAINER_ATTR}] tr[data-npu-row-state="available"] td:first-child {
      border-left-color: ${tokens.primary};
    }
    [${CONTAINER_ATTR}] tr[data-npu-row-state="blocked"] td:not(:last-child) > * {
      opacity: .6;
    }
    [${CONTAINER_ATTR}] [data-npu-course-table] tr[data-npu-empty] td {
      padding: 16px 12px;
      text-align: center;
      opacity: .72;
    }
    [${CONTAINER_ATTR}] [data-npu-course-table] tbody tr:hover td {
      background: rgba(33,48,85,.035);
      background: color-mix(in srgb, ${tokens.text} 3.5%, transparent);
    }
    [${CONTAINER_ATTR}] [data-npu-code-line] {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 8px;
    }
    [${CONTAINER_ATTR}] [data-npu-code-text] {
      font-weight: 700 !important;
      font-variant-numeric: tabular-nums;
    }
    [${CONTAINER_ATTR}] [data-npu-code-extra] {
      margin-top: 3px;
      font-size: 12px;
      line-height: 1.3;
      opacity: .7;
    }
    [${CONTAINER_ATTR}] [data-npu-slot] {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 2px 8px;
    }
    [${CONTAINER_ATTR}] [data-npu-slot] + [data-npu-slot] {
      margin-top: 4px;
    }
    [${CONTAINER_ATTR}] [data-npu-day] {
      min-width: 2.2em;
      padding: 1px 6px;
      border-radius: 6px;
      background: var(--npu-subject-soft);
      border: 1px solid var(--npu-subject-rule);
      font-size: 12px;
      font-weight: 700;
      text-align: center;
    }
    [${CONTAINER_ATTR}] [data-npu-time] {
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    [${CONTAINER_ATTR}] [data-npu-room] {
      flex-basis: 100%;
      font-size: 12px;
      opacity: .7;
    }
    [${CONTAINER_ATTR}] [data-npu-seat-meter] {
      width: 72px;
      max-width: 100%;
      height: 4px;
      margin-top: 5px;
      border-radius: 2px;
      background: var(--npu-subject-rule);
      overflow: hidden;
    }
    [${CONTAINER_ATTR}] [data-npu-seat-meter] > span {
      display: block;
      height: 100%;
      border-radius: 2px;
      background: ${tokens.text};
      opacity: .45;
    }
    [${CONTAINER_ATTR}] [data-npu-seat-meter][data-tone="free"] > span {
      background: var(--npu-ok);
      opacity: 1;
    }
    [${CONTAINER_ATTR}] [data-npu-seat-meter][data-tone="partial"] > span {
      background: var(--npu-warn);
      opacity: 1;
    }
    [${CONTAINER_ATTR}] [data-npu-seat-meter][data-tone="full"] > span {
      background: var(--npu-bad);
      opacity: 1;
    }
    [${CONTAINER_ATTR}] [data-npu-row-conflict] {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      vertical-align: middle;
    }
    [${CONTAINER_ATTR}] [data-npu-conflict-names] {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      margin-top: 4px;
      overflow: hidden;
      font-size: 12px;
      line-height: 1.3;
      opacity: .8;
    }
    [${CONTAINER_ATTR}] [data-npu-actions] {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px 12px;
      min-width: 0;
      font-size: 13px;
    }
    [${CONTAINER_ATTR}] [data-npu-actions] > * {
      max-width: 100%;
      margin: 0 !important;
    }
    [${CONTAINER_ATTR}] [data-npu-view-toolbar] input:focus-visible,
    [${CONTAINER_ATTR}] [data-npu-view-toolbar] select:focus-visible,
    [${CONTAINER_ATTR}] [data-npu-actions] button:focus-visible,
    [${CONTAINER_ATTR}] [data-npu-actions] a:focus-visible {
      outline: 2px solid ${tokens.focus};
      outline-offset: 2px;
    }
    @media (min-width: 1025px) {
      [${CONTAINER_ATTR}] [data-npu-actions] {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        grid-template-areas:
          "checkbox details"
          "planner rajtolo";
        align-items: center;
        gap: 4px 14px;
      }
      [${CONTAINER_ATTR}] [data-npu-actions] > mat-checkbox {
        grid-area: checkbox;
      }
      [${CONTAINER_ATTR}] [data-npu-actions] > .course-details-button {
        grid-area: details;
        justify-self: end;
      }
      [${CONTAINER_ATTR}] [data-npu-actions] > .course-action-status__add {
        justify-content: space-between;
        gap: 6px;
        width: 100%;
        font-size: 13px;
      }
      [${CONTAINER_ATTR}] [data-npu-actions] > .course-action-status__add:not([data-npu-rajtolo]) {
        grid-area: planner;
      }
      [${CONTAINER_ATTR}] [data-npu-actions] > .course-action-status__add[data-npu-rajtolo] {
        grid-area: rajtolo;
      }
      [${CONTAINER_ATTR}] [data-npu-actions] > * {
        white-space: nowrap;
      }
    }
    [${CONTAINER_ATTR}] [data-npu-actions] button,
    [${CONTAINER_ATTR}] [data-npu-actions] a {
      max-width: 100%;
    }
    @media (max-width: 1024px) {
      [${CONTAINER_ATTR}] [data-npu-course-table] {
        border: 0;
        border-radius: 0;
      }
      [${CONTAINER_ATTR}] [data-npu-course-table],
      [${CONTAINER_ATTR}] [data-npu-course-table] thead,
      [${CONTAINER_ATTR}] [data-npu-course-table] tbody,
      [${CONTAINER_ATTR}] [data-npu-course-table] tr,
      [${CONTAINER_ATTR}] [data-npu-course-table] th {
        display: block;
      }
      [${CONTAINER_ATTR}] [data-npu-course-table] colgroup {
        display: none;
      }
      [${CONTAINER_ATTR}] [data-npu-course-table] thead tr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        clip-path: inset(50%);
        white-space: nowrap;
      }
      [${CONTAINER_ATTR}] [data-npu-course-table] tbody tr {
        margin: 0 0 8px;
        padding: 8px 12px;
        border: 1px solid var(--npu-subject-rule);
        border-left-width: 3px;
        border-radius: 10px;
      }
      [${CONTAINER_ATTR}] tr[data-npu-row-state="enrolled"] {
        border-left-color: var(--npu-ok) !important;
      }
      [${CONTAINER_ATTR}] tr[data-npu-row-state="available"] {
        border-left-color: ${tokens.primary} !important;
      }
      [${CONTAINER_ATTR}] [data-npu-course-table] td,
      [${CONTAINER_ATTR}] [data-npu-course-table] td:first-child {
        display: grid;
        grid-template-columns: minmax(6.5rem, 28%) minmax(0, 1fr);
        gap: 8px;
        padding: 4px 0;
        border: 0;
        background: transparent !important;
        overflow-wrap: anywhere;
      }
      [${CONTAINER_ATTR}] [data-npu-course-table] tr[data-npu-empty] td {
        display: block;
        padding: 16px 0;
      }
      [${CONTAINER_ATTR}] [data-npu-course-table] td[data-label]::before {
        content: attr(data-label);
        font-size: 12px;
        font-weight: 700;
        line-height: 1.35;
        opacity: .72;
      }
      [${CONTAINER_ATTR}] [data-npu-course-table] td > * {
        min-width: 0;
      }
      [${CONTAINER_ATTR}] [data-npu-course-table] [data-npu-actions] {
        align-items: flex-start;
        gap: 8px;
        padding-top: 8px;
        margin-top: 4px !important;
        border-top: 1px solid var(--npu-subject-rule);
      }
      [${CONTAINER_ATTR}] [data-npu-actions] > * {
        white-space: normal;
      }
      [${CONTAINER_ATTR}] [data-npu-sort] {
        margin-left: 0;
      }
    }
    @media (max-width: 560px) {
      [${CONTAINER_ATTR}] [data-npu-view-toolbar] {
        align-items: flex-start;
        flex-direction: column;
        gap: 4px;
      }
      [${CONTAINER_ATTR}] [data-npu-sort] {
        width: 100%;
        justify-content: space-between;
      }
      [${CONTAINER_ATTR}] [data-npu-sort] select {
        flex: 1 1 auto;
        max-width: none;
      }
    }
  `);
}

function initialize() {
  registrationData.install();
  injectResponsiveCss();

  let observer = null;
  function repaint() {
    if (router.getPath() === ROUTE) {
      // Do not observe the table while this pass moves Angular-owned controls and
      // builds our rows. Those writes are expected, and feeding them straight back
      // into the global observer makes the accordion compete with its own render.
      if (observer) {
        observer.disconnect();
      }
      try {
        apply(document, registrationData.getSnapshot());
      } finally {
        if (observer) {
          observer.observe(document.documentElement, { childList: true, subtree: true });
        }
      }
    }
  }

  registrationData.subscribe(repaint);
  router.onChange(path => {
    if (path === ROUTE) {
      repaint();
    }
  });

  // ponytail: every observer tick re-scans every subject panel and re-walks every
  // course row's leaf text to match a code. Fine at the size a subject's course list
  // actually reaches (tens of rows); revisit with a targeted per-panel observer only
  // if a real page turns out to churn the whole document constantly.
  let scheduled = false;
  observer = new MutationObserver(() => {
    if (scheduled || router.getPath() !== ROUTE) {
      return;
    }
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      repaint();
    }, 0);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

module.exports = {
  meta,
  shouldActivate,
  initialize,
  uniformField,
  differsFromUniform,
  groupByType,
  sectionTypeLabel,
  conflictVerdict,
  sectionSummary,
  compareByCode,
  compareByTime,
  compareByFreeSeats,
  sortRows,
  isConflictFree,
  hasFreeSeat,
  filterRows,
  applyFiltersAndSort,
  seatCountText,
  seatState,
  freeSeatFromCourse,
  seatVariant,
  formatSlotTime,
  buildRowModel,
  rowStateOf,
};
