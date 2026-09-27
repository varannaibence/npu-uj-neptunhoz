// "Órarendjavaslatok": timetable suggestions inside Neptun's own "Órarendtervező"
// panel. The student's held courses stay fixed; every course group they chose - in
// the Rajtoló plan or in Neptun's planner - is re-picked by timetableSolver under
// three strategies and previewed as ghost cards on the planner's own week grid. Apply
// reorders the Rajtoló's own groups and, after the student confirms the exact list,
// moves the planned courses in Neptun's planner with the calls its "Tervezőhöz adás"
// switch makes (docs/API.md).
//
// The grid is FullCalendar (docs/QOL.md §6, measured): columns carry `data-date`,
// 30-minute lanes carry `data-time`. Week changes rebuild the columns, so the ghost
// layer lives in `.fc-timegrid-body`, which survives them, and is redrawn from the
// geometry whenever the grid changes.
const utils = require("../../utils");
const tokens = require("../../neptunTokens");
const registrationData = require("../../registrationData");
const interceptor = require("../../interceptor");
const { suggestSchedules, STRATEGIES } = require("../../timetableSolver");
const logo = require("../../logo");
const plan = require("./plan");
const { liveGet, liveSchedule, liveUnschedule, freshenAuth } = require("./net");
const { STATUS_KEY } = require("./constants");
const { withRenewal, isHalted } = require("./engine");
const modal = require("../../modal");
const { showToast } = require("../../toast");
const ui = require("./ui");

const BUTTON_ID = "npu-suggest-button";
const PANEL_ID = "npu-suggest-panel";
const LAYER_ID = "npu-suggest-layer";
const PREVIEW_CLASS = "npu-suggest-preview";
// The same pacing as the planner's own course loads: one subject at a time.
const LOAD_GAP_MS = 150;
// A token this close to its 5-minute expiry is renewed first: our own requests with
// an expired one get 401, and that retires the captured header altogether.
const AUTH_MARGIN_MS = 10000;

const STRATEGY_LABELS = {
  gaps: "Kevesebb lyukas óra",
  freeDays: "Több szabad nap",
  closest: "Legkevesebb csere",
};

// --- pure: what to plan, and how a chosen variant lands in the Rajtoló plan ---

// The groups the student chose, by subject: the Rajtoló plan first, then courses
// sitting only in Neptun's planner. A Rajtoló group whose type the student already
// holds is done and left out. A planner course of a type already held is a swap the
// student is weighing: that group comes along with the held course as its `swap`, so
// keeping it stays one of the options. A subject without the ids a course lookup
// needs is left out.
function planTargets(currentPlan, baseline) {
  // Held courses by type id and, for rows without one, by type label - never by the
  // subject alone, or a held lecture would pass for the held lab.
  const heldById = new Map();
  const heldByLabel = new Map();
  (baseline || []).forEach(item => {
    if (isHeld(item)) {
      const typeId = item.course.comparationTypeId || item.course.typeId;
      if (typeId && !heldById.has(`${item.course.subjectId}|${typeId}`)) {
        heldById.set(`${item.course.subjectId}|${typeId}`, item.course.id);
      }
      const label = `${item.course.subjectId}|${item.course.type || ""}`;
      if (item.course.type && !heldByLabel.has(label)) {
        heldByLabel.set(label, item.course.id);
      }
    }
  });
  const heldIn = (subjectId, typeId, type) =>
    (typeId ? heldById.get(`${subjectId}|${typeId}`) : type ? heldByLabel.get(`${subjectId}|${type}`) : null) || null;

  const targets = new Map();
  ((currentPlan && currentPlan.subjects) || []).forEach(subject => {
    const groups = (subject.groups || [])
      .filter(group => !heldIn(subject.subjectId, group.typeId, group.type))
      .map(group => ({
        type: group.type,
        typeId: group.typeId || null,
        ranking: group.ranking.slice(),
        swap: null,
        planned: [],
      }));
    if (groups.length > 0) {
      targets.set(subject.subjectId, { record: subject, groups, fromPlan: true });
    }
  });
  const sameType = (group, course) =>
    course.comparationTypeId ? group.typeId === course.comparationTypeId : !group.typeId && group.type === course.type;
  (baseline || []).forEach(item => {
    // Only what the planner endpoint itself said: the per-subject list behind it is
    // not re-read after a planner write, so it can still name a removed course.
    if (!item || item.source !== "planned" || item.origin !== "planner" || !item.course) {
      return;
    }
    // What sits in Neptun's planner is remembered per group, so applying a suggestion
    // can move it there too; a Rajtoló subject keeps its own ranking.
    const planned = targets.get(item.course.subjectId);
    if (planned && planned.fromPlan) {
      const group = planned.groups.find(g => sameType(g, item.course));
      if (group) {
        group.planned.push(item.course.id);
      }
      return;
    }
    const subject = item.subject || {};
    const record = {
      subjectId: item.course.subjectId,
      termId: subject.termId,
      curriculumTemplateId: subject.curriculumTemplateId,
      curriculumTemplateLineId: subject.curriculumTemplateLineId,
      title: subject.title || "",
      code: subject.code || "",
    };
    if (!record.termId || !record.curriculumTemplateId || !record.curriculumTemplateLineId) {
      return;
    }
    const typeId = item.course.comparationTypeId || null;
    const target = targets.get(record.subjectId) || { record, groups: [], fromPlan: false };
    const group = target.groups.find(g => sameType(g, item.course));
    if (group) {
      group.ranking.push(item.course.id);
      group.planned.push(item.course.id);
    } else {
      target.groups.push({
        type: item.course.type || "",
        typeId,
        ranking: [item.course.id],
        swap: heldIn(record.subjectId, typeId, item.course.type),
        planned: [item.course.id],
      });
    }
    targets.set(record.subjectId, target);
  });
  return Array.from(targets.values());
}

// Held means the course row or the planner endpoint says so. A subject row's
// planner ids are upgraded to "registered" when the subject is, which a merely
// planned course of a registered subject is not.
function isHeld(item) {
  return Boolean(item && item.source === "registered" && item.course && item.origin !== "subject");
}

function courseLabel(course) {
  return course.code || course.type || "Kurzus";
}

// The solver's input. Every course of the group's type is an option: the student's
// own ranking first, the rest by code. A swap group's held course is no longer fixed
// but one of its options. `info` maps a group key back to its subject.
function solverInput(targets, catalog, baseline) {
  const swapped = new Set();
  targets.forEach(target => target.groups.forEach(group => group.swap && swapped.add(group.swap)));
  const fixed = (baseline || [])
    .filter(item => isHeld(item) && !swapped.has(item.course.id))
    .map(item => ({
      label: [item.subject && item.subject.title, item.course.type || item.course.code].filter(Boolean).join(" – "),
      slots: item.course.slots || [],
    }));
  const info = new Map();
  const groups = [];
  targets.forEach(target => {
    const courses = Array.from((catalog.get(target.record.subjectId) || new Map()).values());
    target.groups.forEach(group => {
      const members = courses.filter(course => plan.sameCourseGroup(group, course));
      if (members.length === 0) {
        return;
      }
      const ranked = group.ranking.map(id => members.find(course => course.id === id)).filter(Boolean);
      const rest = members
        .filter(course => !ranked.includes(course))
        .sort((a, b) => String(a.code || "").localeCompare(String(b.code || ""), "hu"));
      const key = `${target.record.subjectId}|${group.typeId || group.type}`;
      const type = group.type || members[0].type || "";
      info.set(key, {
        record: target.record,
        type,
        swap: group.swap || null,
        fromPlan: Boolean(target.fromPlan),
        ranking: group.ranking.slice(),
        current: ranked.length > 0 ? ranked[0].id : null,
        planned: (group.planned || []).slice(),
        courses: new Map(members.map(course => [course.id, course])),
      });
      groups.push({
        key,
        subjectId: target.record.subjectId,
        label: [target.record.title || target.record.code, type].filter(Boolean).join(" – "),
        current: ranked.length > 0 ? ranked[0].id : null,
        options: ranked.concat(rest).map(course => ({
          id: course.id,
          label: courseLabel(course),
          slots: course.slots,
          isFull: course.isFull,
          willBeOnWaitingList: course.willBeOnWaitingList,
          isOnWaitingList: course.isOnWaitingList,
          isSigned: course.isSigned,
          isRankingCourse: course.isRankingCourse,
        })),
      });
    });
  });
  return { input: { fixed, groups }, info };
}

// The variant written into the Rajtoló plan: only groups the plan already ranks. Each
// keeps every course it had: the pick moves to the top, then the ones that fit this
// variant in the strategy's order, then the rest as they were. A subject only in
// Neptun's planner is never added - that would put it up for automatic registration
// behind the student's back. A swap is left alone: the Rajtoló only applies for new
// courses, so a held course is changed in Neptun. Immutable.
function applyVariant(currentPlan, variant, strategy, info) {
  let next = currentPlan;
  variant.picks.forEach(pick => {
    const meta = info.get(pick.groupKey);
    const course = pick.courseId && meta && meta.courses.get(pick.courseId);
    if (!course || meta.swap) {
      return;
    }
    const subject = next.subjects.find(s => s.subjectId === meta.record.subjectId);
    const group = subject && subject.groups.find(g => plan.sameCourseGroup(g, course));
    if (!group) {
      return;
    }
    const order = (pick.rankings && pick.rankings[strategy]) || [pick.courseId];
    const fitting = order.filter(id => id !== pick.courseId && group.ranking.includes(id));
    const ranking = [pick.courseId].concat(
      fitting,
      group.ranking.filter(id => id !== pick.courseId && !fitting.includes(id))
    );
    const groups = subject.groups.map(g => (g === group ? Object.assign({}, g, { ranking }) : g));
    next = Object.assign({}, next, {
      subjects: next.subjects.map(s => (s === subject ? Object.assign({}, s, { groups }) : s)),
    });
  });
  return next;
}

// The rankings applyVariant would change, as they are now, so an undo restores just
// those groups and leaves later edits of the plan alone. Pure.
function touchedRankings(currentPlan, variant, info) {
  const saved = [];
  variant.picks.forEach(pick => {
    const meta = info.get(pick.groupKey);
    const course = pick.courseId && meta && meta.courses.get(pick.courseId);
    const subject = course && !meta.swap && currentPlan.subjects.find(s => s.subjectId === meta.record.subjectId);
    const group = subject && subject.groups.find(g => plan.sameCourseGroup(g, course));
    if (group) {
      saved.push({
        subjectId: subject.subjectId,
        type: group.type,
        typeId: group.typeId,
        ranking: group.ranking.slice(),
      });
    }
  });
  return saved;
}

// Puts saved rankings back into whichever of their groups still exist. Pure.
function restoreRankings(currentPlan, saved) {
  return saved.reduce((next, entry) => {
    const subject = next.subjects.find(s => s.subjectId === entry.subjectId);
    const group = subject && subject.groups.find(g => plan.sameCourseGroup(g, entry));
    if (!group) {
      return next;
    }
    const groups = subject.groups.map(g =>
      g === group ? Object.assign({}, g, { ranking: entry.ranking.slice() }) : g
    );
    return Object.assign({}, next, {
      subjects: next.subjects.map(s => (s === subject ? Object.assign({}, s, { groups }) : s)),
    });
  }, currentPlan);
}

// What applying a variant changes in Neptun's own planner: per group that has a
// course there, the planned courses the pick replaces and the pick itself. A group
// left out keeps what is planned; keeping a held course drops the planned swap. Pure.
function plannerOps(variant, info) {
  const ops = [];
  variant.picks.forEach(pick => {
    const meta = info.get(pick.groupKey);
    if (!meta || !pick.courseId || !meta.planned || meta.planned.length === 0) {
      return;
    }
    const target = pick.courseId === meta.swap ? null : pick.courseId;
    const remove = meta.planned.filter(id => id !== target);
    const add = target && !meta.planned.includes(target) ? target : null;
    if (remove.length > 0 || add) {
      ops.push({ groupKey: pick.groupKey, record: meta.record, remove, add });
    }
  });
  return ops;
}

// One request each, removals first, so a group never holds two courses of a type.
function plannerSteps(ops) {
  return ops.reduce(
    (steps, op) =>
      steps.concat(
        op.remove.map(courseId => ({ kind: "remove", courseId, record: op.record })),
        op.add ? [{ kind: "add", courseId: op.add, record: op.record }] : []
      ),
    []
  );
}

// The steps that undo `done`, newest first. Pure.
function inverseSteps(done) {
  return done
    .slice()
    .reverse()
    .map(step => Object.assign({}, step, { kind: step.kind === "add" ? "remove" : "add" }));
}

// Neptun's answer to a planner call. Only a 2xx with an empty notification list is
// taken as done; anything else stops the batch, its text shown as it came.
function plannerAnswer(json, statusKey) {
  const status = json && json[statusKey];
  const notes = (json && Array.isArray(json.notification) && json.notification) || null;
  if (typeof status === "number" && status >= 200 && status < 300 && notes && notes.length === 0) {
    return { ok: true, message: "" };
  }
  const text = notes && notes.map(n => n && n.description).filter(Boolean)[0];
  return { ok: false, message: text || (typeof status === "number" ? `HTTP ${status}` : "ismeretlen válasz") };
}

function clock(minutes) {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

function warningText(warning, groupLabel, code) {
  switch (warning.kind) {
    case "unplaced":
      return `${groupLabel}: nem fér be ütközés nélkül.`;
    case "full":
      return `${groupLabel}: a(z) ${code} betelt.`;
    case "waitlist":
      return `${groupLabel}: a(z) ${code} jelentkezéskor várólistára kerülne.`;
    case "queued":
      return `${groupLabel}: a(z) ${code} kurzuson várólistán vagy.`;
    case "ranking":
      return `${groupLabel}: a(z) ${code} rangsoros, a hely nem biztos.`;
    case "unknownTime":
      return `${groupLabel}: a(z) ${code} időpontja nem ismert, az ütközés nem ellenőrizhető.`;
    case "irregular":
      return `${groupLabel}: a(z) ${code} nem minden héten van; hetiként ellenőrizve.`;
    default:
      return `${groupLabel}: ${code}`;
  }
}

// One line on what a variant costs. Rounded to half hours: nobody plans in minutes.
function summaryText(metrics) {
  const hours = Math.round(metrics.gapMinutes / 30) / 2;
  const parts = [
    `${metrics.busyDays} nap órákkal`,
    hours > 0 ? `${String(hours).replace(".", ",")} óra lyuk` : "lyukas óra nélkül",
    metrics.changes > 0 ? `${metrics.changes} csere` : "csere nélkül",
  ];
  return parts.join(" · ");
}

function verdictText(variant, exhaustive) {
  const base = variant.complete
    ? "Nincs ismert ütközés."
    : variant.metrics.unplaced > 0
      ? `${variant.metrics.unplaced} csoport nem fér be ütközés nélkül.`
      : "Betelt vagy várólistás kurzus is van benne.";
  return exhaustive ? base : `${base} Túl sok a lehetőség: ez a legjobb talált, nem biztosan a legjobb.`;
}

// Where a ghost card goes: the column whose date falls on the slot's weekday, the
// lanes' own pixel rows for the times. Null when that day is not on screen or the
// class lies wholly outside the drawn hours; clipped when it lies partly outside.
function ghostBox(slot, columns, lanes) {
  const column = columns.find(c => c.day === slot.day);
  if (!column || lanes.length === 0) {
    return null;
  }
  const first = lanes[0];
  const last = lanes[lanes.length - 1];
  const pxPerMinute = first.height / first.minutes;
  const from = Math.max(slot.start, first.at);
  const to = Math.min(slot.end, last.at + last.minutes);
  if (to <= from) {
    return null;
  }
  return {
    left: column.left,
    width: column.width,
    top: first.top + (from - first.at) * pxPerMinute,
    height: (to - from) * pxPerMinute,
    clipped: from !== slot.start || to !== slot.end,
  };
}

function weekdayOf(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate || "");
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay() : null;
}

// What a pick means for its group, in one word and one line. Pure. For a swap the
// student is weighing, "the plan" is the planner course, not the held one.
function pickStatus(pick, meta) {
  const course = meta && pick.courseId ? meta.courses.get(pick.courseId) : null;
  if (!course) {
    return { kind: "unplaced", text: "Nem fér be ütközés nélkül" };
  }
  if (meta.swap) {
    if (pick.courseId === meta.swap) {
      return { kind: "keep", text: "Maradjon a felvett kurzus" };
    }
    const held = meta.courses.get(meta.swap);
    const instead = `csere a felvett ${held ? courseLabel(held) : "kurzus"} helyett`;
    return pick.changed
      ? { kind: "swap", text: `Más, mint a terved: ${instead}` }
      : { kind: "same", text: `A terved szerint: ${instead}` };
  }
  return pick.changed ? { kind: "changed", text: "Más, mint a terved" } : { kind: "same", text: "A terved szerint" };
}

// Nothing to change: every group placed, and every pick already the plan's. Pure.
function isOptimal(variant) {
  return Boolean(variant) && variant.metrics.unplaced === 0 && variant.picks.every(pick => !pick.changed);
}

// The one line the collapsed bar says about a variant. Pure.
function headline(variant, exhaustive) {
  if (isOptimal(variant)) {
    return variant.complete ? "A terved már optimális." : "A terved már a legjobb, de van benne kockázat.";
  }
  const changes = variant.picks.filter(pick => pick.changed).length;
  const verdict = verdictText(variant, exhaustive);
  return `${changes} módosítás javasolt. ${verdict}`;
}

// --- DOM ---

let cssInjected = false;
function injectCss() {
  if (cssInjected) {
    return;
  }
  cssInjected = true;
  // A slim bar in the planner's own colours; Neptun's event colours for the verdict,
  // so it reads like the grid under it.
  utils.injectCss(`
    #${PANEL_ID}{margin:0 0 8px;padding:8px 12px;border-radius:10px;background:${tokens.surface};
      color:${tokens.text};box-shadow:0 4px 16px rgba(0,0,0,.06);font-size:14px;line-height:1.4}
    #${PANEL_ID} .npu-sg-bar{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center}
    #${PANEL_ID} .npu-sg-title{display:inline-flex;align-items:center;font-family:'Source Sans Pro',sans-serif;font-weight:900!important;font-size:16px;white-space:nowrap}
    #${PANEL_ID} .npu-sg-tabs{display:inline-flex;border:1px solid ${tokens.primary};border-radius:8px;overflow:hidden}
    #${PANEL_ID} .npu-sg-tab{border:0;background:transparent;color:${tokens.primary};padding:4px 10px;
      cursor:pointer;font:inherit;font-size:13px;font-weight:600;white-space:nowrap}
    #${PANEL_ID} .npu-sg-tab+.npu-sg-tab{border-left:1px solid ${tokens.primary}}
    #${PANEL_ID} .npu-sg-tab[aria-pressed="true"]{background:${tokens.primary};color:#fff}
    #${PANEL_ID} .npu-sg-message{display:inline-flex;flex-wrap:wrap;gap:4px 10px;align-items:center;flex:1 1 260px;min-width:0}
    #${PANEL_ID} .npu-sg-pill{font-weight:700;font-size:13px;padding:3px 10px;border-radius:12px}
    #${PANEL_ID} .npu-sg-ok{background:rgba(52,179,154,.18)}
    #${PANEL_ID} .npu-sg-warnbg{background:rgba(245,184,46,.25)}
    #${PANEL_ID} .npu-sg-bad{background:rgba(179,38,30,.12)}
    #${PANEL_ID} .npu-sg-stats{font-size:13px;opacity:.75}
    #${PANEL_ID} .npu-sg-actions{display:inline-flex;gap:6px;align-items:center;margin-left:auto}
    #${PANEL_ID} .npu-sg-act{min-height:32px;padding:4px 12px;border-radius:8px;cursor:pointer;font:inherit;font-size:13px;
      font-weight:600;border:1px solid rgba(33,48,85,.2);background:${tokens.subtleSurface};color:${tokens.text};white-space:nowrap}
    #${PANEL_ID} .npu-sg-act.npu-sg-primary{background:${tokens.primary};border-color:${tokens.primary};color:#fff}
    #${PANEL_ID} .npu-sg-act:disabled{opacity:.5;cursor:default}
    #${PANEL_ID} .npu-sg-act:focus-visible,#${PANEL_ID} .npu-sg-tab:focus-visible{outline:2px solid ${tokens.focus};outline-offset:2px}
    #${PANEL_ID} .npu-sg-details{margin-top:10px;max-height:45vh;overflow:auto;border-top:1px solid rgba(33,48,85,.12)}
    #${PANEL_ID} .npu-sg-tr{display:grid;grid-template-columns:minmax(170px,1.5fr) minmax(140px,1fr) 24px minmax(160px,1.2fr) minmax(170px,1.1fr);
      gap:4px 14px;align-items:center;padding:9px 10px;border-left:3px solid transparent;border-bottom:1px solid rgba(33,48,85,.08)}
    #${PANEL_ID} .npu-sg-thead{position:sticky;top:0;z-index:1;background:${tokens.surface};padding-top:8px;padding-bottom:6px;
      border-bottom:1px solid rgba(33,48,85,.16)}
    #${PANEL_ID} .npu-sg-th{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;opacity:.55}
    #${PANEL_ID} .npu-sg-row-changed,#${PANEL_ID} .npu-sg-row-swap{border-left-color:${tokens.primary};background:rgba(9,67,217,.035)}
    #${PANEL_ID} .npu-sg-row-keep{border-left-color:#f5b82e;background:rgba(245,184,46,.06)}
    #${PANEL_ID} .npu-sg-row-unplaced{border-left-color:#b3261e;background:rgba(179,38,30,.05)}
    #${PANEL_ID} .npu-sg-subject,#${PANEL_ID} .npu-sg-course{display:flex;flex-direction:column;gap:3px;min-width:0}
    #${PANEL_ID} .npu-sg-name{font-weight:700;overflow-wrap:anywhere}
    #${PANEL_ID} .npu-sg-type{font-size:12px;opacity:.65}
    #${PANEL_ID} .npu-sg-code{font-weight:600;font-variant-numeric:tabular-nums}
    #${PANEL_ID} .npu-sg-row-changed .npu-sg-after .npu-sg-code,#${PANEL_ID} .npu-sg-row-swap .npu-sg-after .npu-sg-code{color:${tokens.primary}}
    #${PANEL_ID} .npu-sg-times{display:flex;flex-wrap:wrap;gap:4px}
    #${PANEL_ID} .npu-sg-time{font-size:12px;padding:1px 7px;border-radius:6px;background:${tokens.subtleSurface};
      border:1px solid rgba(33,48,85,.12);font-variant-numeric:tabular-nums;white-space:nowrap}
    #${PANEL_ID} .npu-sg-muted{font-size:12px;opacity:.6}
    #${PANEL_ID} .npu-sg-arrow{text-align:center;font-weight:700;opacity:.35}
    #${PANEL_ID} .npu-sg-row-changed .npu-sg-arrow,#${PANEL_ID} .npu-sg-row-swap .npu-sg-arrow{opacity:1;color:${tokens.primary}}
    #${PANEL_ID} .npu-sg-badge{display:inline-flex;gap:6px;align-items:center;font-size:12px;font-weight:600;padding:3px 9px;border-radius:10px}
    #${PANEL_ID} .npu-sg-icon{font-weight:800}
    #${PANEL_ID} .npu-sg-badge-same{background:rgba(52,179,154,.16)}
    #${PANEL_ID} .npu-sg-badge-changed,#${PANEL_ID} .npu-sg-badge-swap{background:rgba(9,67,217,.12)}
    #${PANEL_ID} .npu-sg-badge-keep{background:rgba(245,184,46,.22)}
    #${PANEL_ID} .npu-sg-badge-unplaced{background:rgba(179,38,30,.12)}
    #${PANEL_ID} .npu-sg-rowwarn{grid-column:1/-1;font-size:12px;padding:4px 8px;border-radius:6px;background:rgba(245,184,46,.16)}
    #${PANEL_ID} .npu-sg-rowwarn::before{content:"⚠ "}
    #${PANEL_ID} .npu-sg-hint{margin:8px 10px 0;font-size:13px;opacity:.75}
    @media (max-width:860px){#${PANEL_ID} .npu-sg-tr{grid-template-columns:1fr 1fr}
      #${PANEL_ID} .npu-sg-thead,#${PANEL_ID} .npu-sg-arrow{display:none}
      #${PANEL_ID} .npu-sg-subject,#${PANEL_ID} .npu-sg-state{grid-column:1/-1}}
    .${PREVIEW_CLASS} a.fc-event.event--yellow{opacity:.25}
    #${LAYER_ID}{position:absolute;inset:0;pointer-events:none;z-index:5}
    #${LAYER_ID} .npu-sg-ghost{position:absolute;box-sizing:border-box;padding:4px 8px;overflow:hidden;
      border:2px dashed ${tokens.primary};border-radius:6px;background:rgba(9,67,217,.08);
      color:${tokens.text};font-size:12px;line-height:1.35}
    #${LAYER_ID} .npu-sg-ghost b{display:block;font-weight:700}
    #${LAYER_ID} .npu-sg-ghost.npu-sg-new{background:rgba(9,67,217,.18)}
  `);
}

// A planner or Rajtoló write in flight. Module-level on purpose: the panel (and
// `view` with it) can be dropped by Angular mid-write, and a reopened panel must
// neither compute on a half-written planner nor start a second write.
let writing = false;

// Suggestion state lives here, not on the Rajtoló's: it is thrown away with the panel.
const view = {
  status: "",
  result: null,
  info: null,
  strategy: "gaps",
  undo: null,
  details: false,
  stale: false,
  partial: false,
  busy: false,
  needsReload: false,
  loading: false,
  generation: 0,
};

function plannerRoot() {
  return document.querySelector("neptun-timetable-planner");
}

function selectedVariant() {
  const variants = (view.result && view.result.variants) || [];
  return variants.find(variant => variant.strategies.includes(view.strategy)) || null;
}

function groupLabelOf(key) {
  const meta = view.info && view.info.get(key);
  return meta ? [meta.record.title || meta.record.code, meta.type].filter(Boolean).join(" – ") : "";
}

function courseOf(key, courseId) {
  const meta = view.info && view.info.get(key);
  return (meta && courseId && meta.courses.get(courseId)) || null;
}

function drawGhosts() {
  const root = plannerRoot();
  const body = root && root.querySelector(".fc-timegrid-body");
  // An optimal plan has nothing to preview: the grid already shows it.
  const variant = isOptimal(selectedVariant()) ? null : selectedVariant();
  const existing = document.getElementById(LAYER_ID);
  if (!body || !variant) {
    if (existing) {
      existing.remove();
    }
    if (root) {
      root.classList.remove(PREVIEW_CLASS);
    }
    return;
  }
  const origin = body.getBoundingClientRect();
  const columns = Array.from(root.querySelectorAll("td.fc-timegrid-col[data-date]")).map(td => {
    const rect = td.getBoundingClientRect();
    return { day: weekdayOf(td.getAttribute("data-date")), left: rect.left - origin.left, width: rect.width };
  });
  const lanes = Array.from(root.querySelectorAll(".fc-timegrid-slot-lane[data-time]"))
    .map(lane => {
      const rect = lane.getBoundingClientRect();
      const at = plan.toMinutes(String(lane.getAttribute("data-time")).slice(0, 5));
      return { at, top: rect.top - origin.top, height: rect.height, minutes: 30 };
    })
    .filter(lane => lane.at !== null);
  const signature = JSON.stringify([view.strategy, columns, lanes.length && lanes[0], lanes.length]);
  if (existing && existing.getAttribute("data-signature") === signature) {
    return;
  }
  const layer = existing || document.createElement("div");
  layer.id = LAYER_ID;
  layer.setAttribute("data-signature", signature);
  layer.setAttribute("aria-hidden", "true");
  layer.innerHTML = "";
  variant.picks.forEach(pick => {
    const meta = view.info.get(pick.groupKey);
    const course = courseOf(pick.groupKey, pick.courseId);
    // A held course kept is already on the grid, green.
    if (!course || (meta && meta.swap === pick.courseId)) {
      return;
    }
    const status = pickStatus(pick, meta);
    (course.slots || []).forEach(slot => {
      const box = ghostBox(slot, columns, lanes);
      if (!box) {
        return;
      }
      const card = document.createElement("div");
      card.className = `npu-sg-ghost${status.kind === "same" ? "" : " npu-sg-new"}`;
      card.style.cssText = `left:${box.left + 2}px;width:${Math.max(box.width - 4, 0)}px;top:${box.top}px;height:${box.height}px;`;
      const time = document.createElement("b");
      time.textContent = `${clock(slot.start)} – ${clock(slot.end)} · javaslat`;
      card.appendChild(time);
      card.appendChild(document.createTextNode(`${groupLabelOf(pick.groupKey)} · ${courseLabel(course)}`));
      layer.appendChild(card);
    });
  });
  if (!existing) {
    body.appendChild(layer);
  }
  root.classList.add(PREVIEW_CLASS);
}

function verdictTone(variant) {
  if (variant.complete) {
    return "npu-sg-ok";
  }
  return variant.metrics.unplaced > 0 ? "npu-sg-bad" : "npu-sg-warnbg";
}

function smallAction(label, primary, aria) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `npu-sg-act${primary ? " npu-sg-primary" : ""}`;
  button.textContent = label;
  if (aria) {
    button.setAttribute("aria-label", aria);
    button.title = aria;
  }
  return button;
}

// One compact bar over the grid - the ghosts on the grid are the suggestion itself,
// so the table and the notes wait behind "Részletek" and the week stays in view.
function renderPanel(state) {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) {
    return;
  }
  panel.innerHTML = "";
  const variant = selectedVariant();
  const bar = document.createElement("div");
  bar.className = "npu-sg-bar";

  const title = document.createElement("span");
  title.className = "npu-sg-title";
  title.appendChild(logo.icon(document, 18));
  title.appendChild(document.createTextNode("Javaslatok"));
  title.title = "Órarendjavaslatok – NPU-funkció";
  bar.appendChild(title);

  const tabs = document.createElement("div");
  tabs.className = "npu-sg-tabs";
  tabs.setAttribute("role", "group");
  tabs.setAttribute("aria-label", "Szempont");
  STRATEGIES.forEach(strategy => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "npu-sg-tab";
    tab.setAttribute("aria-pressed", String(strategy === view.strategy));
    tab.textContent = STRATEGY_LABELS[strategy];
    tab.disabled = view.busy;
    tab.addEventListener("click", () => {
      view.strategy = strategy;
      renderPanel(state);
    });
    tabs.appendChild(tab);
  });
  bar.appendChild(tabs);

  const message = document.createElement("span");
  message.className = "npu-sg-message";
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  if (variant) {
    const pill = document.createElement("span");
    pill.className = `npu-sg-pill ${verdictTone(variant)}`;
    pill.textContent = headline(variant, view.result.exhaustive);
    message.appendChild(pill);
    const stats = document.createElement("span");
    stats.className = "npu-sg-stats";
    const changes = variant.picks.filter(pick => pick.changed).length;
    stats.textContent = summaryText(Object.assign({}, variant.metrics, { changes }));
    message.appendChild(stats);
  }
  if (view.status) {
    const status = document.createElement("span");
    status.className = "npu-sg-stats";
    status.textContent = view.status;
    message.appendChild(status);
  }
  bar.appendChild(message);

  const actions = document.createElement("span");
  actions.className = "npu-sg-actions";
  const notes = variant ? notesFor(variant) : [];
  if (variant) {
    const details = smallAction(
      `Részletek${notes.length > 0 ? ` (${notes.length} ⚠)` : ""} ${view.details ? "▴" : "▾"}`
    );
    details.setAttribute("aria-expanded", String(view.details));
    details.addEventListener("click", () => {
      view.details = !view.details;
      renderPanel(state);
    });
    actions.appendChild(details);
  }
  const ops = variant && !isOptimal(variant) ? plannerOps(variant, view.info) : [];
  const rajtoloChanges = Boolean(variant) && !isOptimal(variant) && rajtoloAffected(variant);
  // Offered once per computed suggestion: after an apply (or a failed one) the planner
  // it was computed from is gone, so only a recompute may offer it again.
  if ((ops.length > 0 || rajtoloChanges) && !view.busy && !view.stale && !view.partial) {
    const apply = smallAction(ops.length > 0 ? "Alkalmazás…" : "Alkalmazás a Rajtolóba", true);
    apply.disabled = state.running;
    apply.title = state.running
      ? "A Rajtoló fut; leállítás után alkalmazható."
      : ops.length > 0
        ? "A Neptun Tervezőjében és a Rajtolóban alkalmazza; előtte megmutatja, mi változik."
        : "A Rajtoló sorrendjét rendezi át; visszavonható.";
    apply.addEventListener("click", () => {
      if (state.running) {
        return;
      }
      confirmApply(state, variant, ops, rajtoloChanges);
    });
    actions.appendChild(apply);
  }
  if (view.undo && !view.busy) {
    const undo = smallAction("Visszavonás");
    undo.disabled = state.running;
    undo.addEventListener("click", () => undoApply(state));
    actions.appendChild(undo);
  }
  if (view.needsReload && !view.busy) {
    const reload = smallAction(
      "Újratöltés",
      !view.undo,
      "Az oldal újratöltése, hogy a rács a frissült Tervezőt mutassa"
    );
    reload.textContent = "Újratöltés";
    reload.addEventListener("click", () => location.reload());
    actions.appendChild(reload);
  }
  const refresh = smallAction("↻", false, "Újraszámolás");
  refresh.disabled = view.loading || view.busy;
  if (view.stale && !view.busy) {
    refresh.classList.add("npu-sg-primary");
  }
  refresh.addEventListener("click", () => compute(state));
  actions.appendChild(refresh);
  const close = smallAction("✕", false, "Javaslatok bezárása");
  close.disabled = view.busy;
  close.addEventListener("click", closePanel);
  actions.appendChild(close);
  bar.appendChild(actions);
  panel.appendChild(bar);

  if (variant && view.details) {
    panel.appendChild(renderDetails(variant));
  }
  drawGhosts();
}

// Whether the Rajtoló plan would change: a changed pick outside a swap.
// Whether the Rajtoló plan would change: a changed pick in a group it already ranks.
function rajtoloAffected(variant) {
  return variant.picks.some(pick => {
    const meta = view.info.get(pick.groupKey);
    return pick.changed && pick.courseId && meta && meta.fromPlan && !meta.swap;
  });
}

function applyToRajtolo(state, variant) {
  if (writing || view.busy || view.stale) {
    return;
  }
  view.undo = {
    code: utils.getNeptunCode(),
    termId: state.plan.termId,
    saved: touchedRankings(state.plan, variant, view.info),
    steps: [],
  };
  state.plan = applyVariant(state.plan, variant, view.strategy, view.info);
  ui.persistPlan(state);
  ui.render(state);
  view.stale = true;
  setStatus(state, "A Rajtoló sorrendje frissült.");
}

// The Rajtoló groups the variant reorders, as lines for the confirmation. A course
// the student never ranked is named as such: the next run would apply for it.
function rajtoloLines(variant) {
  return variant.picks
    .filter(pick => {
      const meta = view.info.get(pick.groupKey);
      return pick.changed && pick.courseId && meta && meta.fromPlan && !meta.swap;
    })
    .map(pick => {
      const meta = view.info.get(pick.groupKey);
      const course = courseOf(pick.groupKey, pick.courseId);
      const fresh = !meta.ranking.includes(pick.courseId);
      return `${groupLabelOf(pick.groupKey)}: ${course ? courseLabel(course) : "kurzus"} a sor elejére${
        fresh ? " (eddig nem volt a sorrendedben, a Rajtoló erre is jelentkezni fog)" : ""
      }`;
    });
}

function describeOp(op) {
  const code = id => {
    const course = courseOf(op.groupKey, id);
    return course ? courseLabel(course) : "ismeretlen kurzus";
  };
  const label = groupLabelOf(op.groupKey);
  if (op.add && op.remove.length > 0) {
    return `${label}: ${op.remove.map(code).join(", ")} helyett ${code(op.add)}`;
  }
  if (op.add) {
    return `${label}: ${code(op.add)} a Tervezőbe`;
  }
  return `${label}: ${op.remove.map(code).join(", ")} ki a Tervezőből`;
}

// Shown before anything is written: exactly which planner rows change in Neptun and
// which Rajtoló groups are reordered.
function confirmApply(state, variant, ops, rajtoloChanges) {
  const lines = rajtoloChanges ? rajtoloLines(variant) : [];
  const list = (content, items) => {
    const ul = document.createElement("ul");
    items.forEach(text => {
      const li = document.createElement("li");
      li.textContent = text;
      ul.appendChild(li);
    });
    content.appendChild(ul);
  };
  modal.open({
    title: "Javaslat alkalmazása",
    small: true,
    build(content) {
      if (ops.length > 0) {
        const intro = document.createElement("p");
        intro.textContent = "A Neptun Tervezőjében (a szerveren) ezek változnak:";
        content.appendChild(intro);
        list(content, ops.map(describeOp));
      }
      if (lines.length > 0) {
        const intro = document.createElement("p");
        intro.textContent = "A Rajtoló sorrendjében (a böngésződben):";
        content.appendChild(intro);
        list(content, lines);
      }
      const rest = document.createElement("p");
      rest.textContent = "Felvett kurzust ez nem érint. A panelen visszavonható, amíg újra nem számolod.";
      content.appendChild(rest);
    },
    actions: [
      { label: "Mégse" },
      {
        label: "Alkalmazás",
        primary: true,
        onClick() {
          if (ops.length > 0) {
            runApply(state, variant, ops, rajtoloChanges);
          } else {
            applyToRajtolo(state, variant);
          }
        },
      },
    ],
  });
}

// One planner step against Neptun.
function liveStep(step) {
  return (step.kind === "add" ? liveSchedule : liveUnschedule)(step.record, step.courseId);
}

// Planner steps for one student: renewed like the Rajtoló's requests (a 401 on these
// calls is measured unprocessed - Neptun itself resends it, docs/API.md), and never
// sent once another user is logged in.
function plannerSender(code) {
  const session = {
    needsRenewal: () => authLeftMs() <= 0,
    renew: freshenAuth,
    shouldContinue: () => utils.getNeptunCode() === code,
  };
  const renewed = withRenewal(liveStep, session);
  return step => (session.shouldContinue() ? renewed(step) : Promise.resolve({ halted: true }));
}

// The planner as Neptun holds it now: true/false for applied or not, null when it
// could not be read back - never a guess from the old snapshot.
function plannerReader() {
  return (checked, applied) =>
    ensureAuth()
      .then(() => registrationData.refreshPlanner())
      .then(ok => (ok ? plannerMatches(checked, applied) : null));
}

// Sequential, stopping at the first refusal. `send` makes one step's request.
function runSteps(steps, send = liveStep) {
  const done = [];
  return steps
    .reduce(
      (promise, step) =>
        promise.then(failure => {
          if (failure) {
            return failure;
          }
          return send(step).then(json => {
            if (json && (json.halted || isHalted(json))) {
              return { step, message: "másik felhasználó lépett be, a módosítás megállt" };
            }
            const answer = plannerAnswer(json, STATUS_KEY);
            if (answer.ok) {
              done.push(step);
              return null;
            }
            return { step, message: answer.message };
          });
        }),
      Promise.resolve(null)
    )
    .then(failure => ({ done, failure }));
}

// All or nothing, judged by the planner read back rather than by the answers: a
// refused step may still have happened (a timeout says nothing). `readBack(steps,
// applied)` re-reads the planner and says whether it shows them applied or not.
async function applySteps(steps, send, readBack) {
  const { done, failure } = await runSteps(steps, send);
  if (!failure) {
    return { ok: true, done, matches: await readBack(done, true) };
  }
  await runSteps(inverseSteps(done), send);
  return { ok: false, done, failure, restored: await readBack(done.concat(failure.step), false) };
}

// Whether the planner, read back from Neptun, is in the state after the steps
// (`applied`) or before them. Only the planner endpoint's own rows count.
function plannerMatches(steps, applied) {
  const planned = new Set(
    registrationData
      .getSnapshot()
      .baseline.filter(item => item.source === "planned" && item.origin === "planner" && item.course)
      .map(item => item.course.id)
  );
  return steps.every(step => planned.has(step.courseId) === ((step.kind === "add") === applied));
}

// All or nothing: a refused step rolls back the ones before it. Everything the run
// needs is taken now, so closing the panel or switching strategy meanwhile changes
// nothing; the result is read back from Neptun whichever way it went.
function runApply(state, variant, ops, rajtoloChanges) {
  if (writing || view.busy || view.stale) {
    return;
  }
  const info = view.info;
  const strategy = view.strategy;
  const generation = view.generation;
  const code = utils.getNeptunCode();
  const termId = state.plan.termId;
  const steps = plannerSteps(ops);
  const report = text => {
    writing = false;
    if (generation === view.generation) {
      view.busy = false;
      view.needsReload = true;
      setStatus(state, text);
    } else {
      showToast(`${text} (A panel közben bezárult, így a visszavonás már nem érhető el.)`, "info");
    }
  };
  writing = true;
  view.busy = true;
  view.stale = true;
  setStatus(state, "A Tervező módosítása…");
  ensureAuth()
    .then(ok => {
      if (!ok) {
        writing = false;
        view.busy = false;
        view.stale = false;
        setStatus(state, "A Neptun nem adott friss munkamenetet; kattints valahova a Neptunban, majd próbáld újra.");
        return undefined;
      }
      return applySteps(steps, plannerSender(code), plannerReader()).then(outcome => {
        if (!outcome.ok) {
          report(
            outcome.restored === true
              ? `A Tervező nem módosult: ${outcome.failure.message}`
              : outcome.restored === null
                ? `A Tervező módosítása megszakadt (${outcome.failure.message}), és az állapota nem ellenőrizhető; nézd meg a Tervezőt.`
                : `A Tervező módosítása megszakadt (${outcome.failure.message}), és a Tervező most eltér az eredetitől; nézd meg a Tervezőt.`
          );
          return;
        }
        const saved = rajtoloChanges ? touchedRankings(state.plan, variant, info) : [];
        const rajtoloApplied = rajtoloChanges && utils.getNeptunCode() === code && state.plan.termId === termId;
        if (rajtoloApplied) {
          state.plan = applyVariant(state.plan, variant, strategy, info);
          ui.persistPlan(state);
          ui.render(state);
        }
        if (generation === view.generation) {
          view.undo = { code, termId, saved: rajtoloApplied ? saved : [], steps: outcome.done };
        }
        report(
          outcome.matches === true
            ? `A Tervező frissült${rajtoloApplied ? ", és a Rajtoló sorrendje is" : ""}. A rács az oldal újratöltése után mutatja.`
            : outcome.matches === null
              ? "A Neptun elfogadta a módosítást, de a Tervező nem olvasható vissza; nézd meg a Tervezőt."
              : "A Neptun elfogadta a módosítást, de a visszaolvasott Tervező eltér; nézd meg a Tervezőt."
        );
      });
    })
    .catch(() => report("A Tervező módosítása nem sikerült; nézd meg a Tervezőt."));
}

// Undoes one apply, for the student and term it was made for: the rankings it touched
// go back (later edits stay), and the planner steps are reversed and read back.
function undoApply(state) {
  const undo = view.undo;
  if (writing || state.running || view.busy || !undo) {
    return;
  }
  view.undo = null;
  // The suggestion on screen was computed for the applied planner: recompute first.
  view.stale = true;
  if (undo.code !== utils.getNeptunCode() || undo.termId !== state.plan.termId) {
    setStatus(state, "A visszavonás már nem érvényes: más felhasználó vagy félév van betöltve.");
    return;
  }
  if (undo.saved.length > 0) {
    state.plan = restoreRankings(state.plan, undo.saved);
    ui.persistPlan(state);
    ui.render(state);
  }
  if (undo.steps.length === 0) {
    setStatus(state, "Visszaállítva.");
    return;
  }
  const generation = view.generation;
  writing = true;
  view.busy = true;
  setStatus(state, "A Tervező visszaállítása…");
  const finish = text => {
    writing = false;
    if (generation === view.generation) {
      view.busy = false;
      view.needsReload = true;
      setStatus(state, text);
    } else {
      showToast(text, "info");
    }
  };
  const send = plannerSender(undo.code);
  const readBack = plannerReader();
  ensureAuth()
    .then(ok => (ok ? runSteps(inverseSteps(undo.steps), send) : { failure: { message: "nincs friss munkamenet" } }))
    .then(({ failure }) =>
      readBack(undo.steps, false).then(restored =>
        finish(
          !failure && restored === true
            ? "Visszaállítva. A rács az oldal újratöltése után mutatja."
            : !failure && restored === null
              ? "A visszaállítás elküldve, de a Tervező nem olvasható vissza; nézd meg a Tervezőt."
              : `A Tervező visszaállítása nem sikerült teljesen${failure ? ` (${failure.message})` : ""}; nézd meg a Tervezőt.`
        )
      )
    )
    .catch(() => finish("A Tervező visszaállítása nem sikerült; nézd meg a Tervezőt."));
}

const DAY_SHORT = ["V", "H", "K", "Sze", "Cs", "P", "Szo"];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

// A course as the table shows it: its code, then one chip per weekly slot.
function courseCell(course, emptyText) {
  const box = el("div", "npu-sg-course");
  if (!course) {
    box.appendChild(el("span", "npu-sg-muted", emptyText));
    return box;
  }
  box.appendChild(el("span", "npu-sg-code", courseLabel(course)));
  const times = el("div", "npu-sg-times");
  (course.slots || []).forEach(slot => {
    times.appendChild(
      el("span", "npu-sg-time", `${DAY_SHORT[slot.day] || ""} ${clock(slot.start)}–${clock(slot.end)}`.trim())
    );
  });
  if (!course.slots || course.slots.length === 0) {
    times.appendChild(el("span", "npu-sg-muted", "időpont nélkül"));
  }
  box.appendChild(times);
  return box;
}

const STATUS_ICONS = { same: "✓", keep: "↺", changed: "↔", swap: "↔", unplaced: "!" };

// Before and after, one subject group per row: what the plan holds now, what the
// variant picks, the fallbacks the Rajtoló would try next, and any warning in place.
function renderDetails(variant) {
  const details = el("div", "npu-sg-details");
  const table = el("div", "npu-sg-table");
  table.setAttribute("role", "table");
  const head = el("div", "npu-sg-tr npu-sg-thead");
  head.setAttribute("role", "row");
  ["Tárgy", "A terved", "", "Javaslat", ""].forEach(text => {
    const th = el("div", "npu-sg-th", text);
    th.setAttribute("role", "columnheader");
    head.appendChild(th);
  });
  table.appendChild(head);
  variant.picks.forEach(pick => {
    const meta = view.info.get(pick.groupKey);
    if (!meta) {
      return;
    }
    const status = pickStatus(pick, meta);
    const current = meta.current ? meta.courses.get(meta.current) : null;
    const suggested = courseOf(pick.groupKey, pick.courseId);
    const row = el("div", `npu-sg-tr npu-sg-row-${status.kind}`);
    row.setAttribute("role", "row");

    const subject = el("div", "npu-sg-subject");
    subject.appendChild(el("span", "npu-sg-name", meta.record.title || meta.record.code || "Tárgy"));
    subject.appendChild(el("span", "npu-sg-type", meta.type || "Kurzus"));
    row.appendChild(subject);

    const before = courseCell(current, "nincs");
    if (meta.swap) {
      const held = meta.courses.get(meta.swap);
      before.appendChild(el("span", "npu-sg-muted", `felvett: ${held ? courseLabel(held) : "–"}`));
    }
    row.appendChild(before);

    row.appendChild(el("div", "npu-sg-arrow", status.kind === "same" ? "=" : "→"));

    const after = courseCell(suggested, "nem fér be");
    after.classList.add("npu-sg-after");
    const fallbacks = ((pick.rankings && pick.rankings[view.strategy]) || [])
      .slice(1, 4)
      .map(id => courseOf(pick.groupKey, id))
      .filter(Boolean)
      .map(courseLabel);
    if (fallbacks.length > 0 && !meta.swap) {
      after.appendChild(el("span", "npu-sg-muted", `tartalék: ${fallbacks.join(", ")}`));
    }
    row.appendChild(after);

    const badgeCell = el("div", "npu-sg-state");
    const badge = el("span", `npu-sg-badge npu-sg-badge-${status.kind}`);
    badge.appendChild(el("span", "npu-sg-icon", STATUS_ICONS[status.kind] || ""));
    badge.appendChild(document.createTextNode(status.text));
    badgeCell.appendChild(badge);
    row.appendChild(badgeCell);

    variant.warnings
      .filter(w => w.groupKey === pick.groupKey && w.kind !== "unplaced")
      .forEach(w => {
        const course = courseOf(w.groupKey, w.courseId);
        const line = el(
          "div",
          "npu-sg-rowwarn",
          warningText(w, "", course ? courseLabel(course) : "").replace(/^: /, "")
        );
        line.setAttribute("role", "note");
        row.appendChild(line);
      });
    table.appendChild(row);
  });
  details.appendChild(table);

  const footer = [];
  if (variant.strategies.length > 1) {
    footer.push(
      variant.strategies.length === STRATEGIES.length
        ? "Mindhárom szempont szerint ez a legjobb."
        : `Ugyanez a legjobb így is: ${variant.strategies
            .filter(strategy => strategy !== view.strategy)
            .map(strategy => STRATEGY_LABELS[strategy].toLowerCase())
            .join(", ")}.`
    );
  }
  if (variant.picks.some(pick => view.info.get(pick.groupKey) && view.info.get(pick.groupKey).swap)) {
    footer.push(
      "Felvett kurzust a Neptunban, kurzusmódosítással cserélhetsz; az Alkalmazás csak a Tervezőt és a Rajtolót módosítja."
    );
  }
  footer.forEach(text => details.appendChild(el("p", "npu-sg-hint", text)));
  return details;
}

function notesFor(variant) {
  const notes = variant.warnings
    .filter(w => w.kind !== "unplaced")
    .map(w => {
      const course = courseOf(w.groupKey, w.courseId);
      return warningText(w, groupLabelOf(w.groupKey), course ? courseLabel(course) : "");
    });
  if (variant.picks.some(pick => view.info.get(pick.groupKey) && view.info.get(pick.groupKey).swap)) {
    notes.push(
      "Felvett kurzust a Neptunban, kurzusmódosítással cserélhetsz; az Alkalmazás csak a Tervezőt és a Rajtolót módosítja."
    );
  }
  return notes;
}

function closePanel() {
  view.generation++;
  view.result = null;
  view.info = null;
  view.undo = null;
  view.loading = false;
  view.busy = false;
  view.stale = false;
  view.partial = false;
  view.status = "";
  const panel = document.getElementById(PANEL_ID);
  if (panel) {
    panel.remove();
  }
  drawGhosts();
}

function setStatus(state, text) {
  view.status = text;
  renderPanel(state);
}

// Re-reads the planner - the page's last copy may predate the student's latest
// "Tervezőhöz adás" - then loads every target subject's courses afresh, one at a
// time, and solves. A newer compute or a close abandons an older one.
function compute(state) {
  if (writing) {
    setStatus(state, "Egy módosítás még folyamatban van; várd meg, majd számold újra.");
    return;
  }
  const generation = ++view.generation;
  view.loading = true;
  view.result = null;
  view.info = null;
  view.stale = false;
  view.partial = false;
  // A new suggestion is computed on the current planner; an older undo would no
  // longer describe it.
  view.undo = null;
  setStatus(state, "A Tervező frissítése…");
  const auth = ensureAuth();
  auth
    .then(ok => {
      if (generation !== view.generation) {
        return false;
      }
      if (!ok || !interceptor.getAuthHeader()) {
        view.loading = false;
        setStatus(state, "A Neptun nem adott friss munkamenetet; kattints valahova a Neptunban, majd számold újra.");
        return false;
      }
      return registrationData.refreshPlanner().then(read => {
        if (!read && generation === view.generation) {
          view.loading = false;
          setStatus(state, "A Tervező nem olvasható be friss állapotban; próbáld újra.");
        }
        return read;
      });
    })
    .then(ready => {
      if (!ready || generation !== view.generation) {
        return;
      }
      const snapshot = registrationData.getSnapshot();
      if (!snapshot.baselineComplete) {
        view.loading = false;
        setStatus(state, "A felvett kurzusok nem tölthetők be; frissítsd az oldalt, majd számold újra.");
        return;
      }
      const targets = planTargets(state.plan, snapshot.baseline);
      if (targets.length === 0) {
        view.loading = false;
        setStatus(state, "Nincs mit átrendezni: tegyél kurzust a Tervezőbe vagy a Rajtolóba.");
        return;
      }
      const catalog = new Map();
      const failed = [];
      targets
        .reduce(
          (promise, target, index) =>
            promise.then(() => {
              if (generation !== view.generation) {
                return undefined;
              }
              setStatus(state, `Kurzusok betöltése… (${index + 1}/${targets.length})`);
              // Renewed per subject: a long list can outlast a 5-minute token.
              return ensureAuth()
                .then(ok => (ok ? liveGet(target.record) : null))
                .then(json => {
                  const courses = plan.collectCourses(json).get(target.record.subjectId);
                  if (courses && courses.size > 0) {
                    catalog.set(target.record.subjectId, courses);
                  } else {
                    failed.push(target.record.title || target.record.code || "egy tárgy");
                  }
                  return new Promise(resolve => setTimeout(resolve, LOAD_GAP_MS));
                });
            }),
          Promise.resolve()
        )
        .then(() => {
          if (generation !== view.generation) {
            return;
          }
          const { input, info } = solverInput(targets, catalog, snapshot.baseline);
          const result = suggestSchedules(input);
          view.loading = false;
          view.info = info;
          view.result = result.variants.length > 0 ? result : null;
          // A subject that did not load is missing from the week, so a suggestion
          // could clash with it: shown, never applied.
          view.partial = failed.length > 0;
          const failure = view.partial
            ? `Nem sikerült betölteni: ${failed.join(", ")}; alkalmazni csak ↻ után lehet.`
            : "";
          view.status = view.result ? failure : `Nincs mit átrendezni. ${failure}`.trim();
          renderPanel(state);
        })
        .catch(() => {
          if (generation === view.generation) {
            view.loading = false;
            setStatus(state, "A kurzusok betöltése nem sikerült.");
          }
        });
    });
}

// Milliseconds the captured token has left, on the server's clock; Infinity when its
// expiry is unknown, 0 or less when it is gone.
function authLeftMs() {
  if (!interceptor.getAuthHeader()) {
    return 0;
  }
  const timing = interceptor.getAuthTiming();
  const now = Date.now() + (interceptor.getServerOffsetMs() || 0);
  return timing && typeof timing.expiresAtMs === "number" ? timing.expiresAtMs - now : Infinity;
}

// Neptun renews only an EXPIRED token, and only on its own request: its search button
// makes one (the Rajtoló's path too). A token about to expire is waited out first -
// pressed early, the search goes out with the old token and nothing is renewed.
function ensureAuth() {
  const left = authLeftMs();
  if (left > AUTH_MARGIN_MS) {
    return Promise.resolve(true);
  }
  const pause = left > 0 ? left + 1000 : 0;
  return new Promise(resolve => setTimeout(resolve, pause)).then(freshenAuth).then(() => authLeftMs() > 0);
}

function openPanel(state) {
  const content = document.querySelector("neptun-timetable-planner section.timetable-planner__content");
  if (!content) {
    return;
  }
  injectCss();
  let panel = document.getElementById(PANEL_ID);
  if (!panel) {
    panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.setAttribute("aria-label", "Órarendjavaslatok");
    panel.setAttribute("data-npu-feature", "");
    content.insertBefore(panel, content.firstChild);
  }
  compute(state);
}

// Idempotent, called on every DOM change on the registration page. Keeps the ghost
// layer in step with the grid: a week change rebuilds the columns under it.
function mount(state) {
  const root = plannerRoot();
  // The week view has a "Ma" button to sit beside and to clone; the list view has
  // neither, so there the button goes first in the header's right side, cloned from
  // the header's own toggle. The list view gets the bar without ghost cards.
  const right = root && root.querySelector(".timetable-planner__container-right");
  const today = root && root.querySelector(".timetable-planner__today-button");
  const toggle = root && root.querySelector(".timetable-planner__toggle-button");
  const reference = today || toggle;
  const anchor = today || (right && right.firstElementChild);
  if (reference && anchor && !document.getElementById(BUTTON_ID)) {
    const launcher = utils.cloneButton(reference);
    // The toggle's chevron and its "close the planner" label mean nothing here.
    launcher
      .querySelectorAll(".neptun-button__postfix-icon, .neptun-button__prefix-icon, mat-icon")
      .forEach(n => n.remove());
    launcher.removeAttribute("aria-label");
    if (!today) {
      // Outlined like the week view's "Ma", not flat like the toggle it came from.
      launcher.classList.remove("flat", "small-padding");
      launcher.classList.add("stroked");
    }
    launcher.id = BUTTON_ID;
    utils.setButtonLabel(launcher, "Javaslatok");
    utils.markNpu(launcher, "Ütközésmentes órarendjavaslatok");
    launcher.addEventListener("click", () => {
      if (view.busy) {
        return;
      }
      if (document.getElementById(PANEL_ID)) {
        closePanel();
      } else {
        openPanel(state);
      }
    });
    anchor.parentElement.insertBefore(launcher, anchor);
  }
  if (view.result || view.loading || view.busy) {
    if (!document.getElementById(PANEL_ID)) {
      // Angular dropped the panel with the planner; the preview goes with it.
      closePanel();
    } else {
      drawGhosts();
    }
  }
}

module.exports = {
  mount,
  planTargets,
  solverInput,
  applyVariant,
  ghostBox,
  weekdayOf,
  pickStatus,
  plannerOps,
  touchedRankings,
  restoreRankings,
  plannerSteps,
  inverseSteps,
  plannerAnswer,
  runSteps,
  applySteps,
  isOptimal,
  headline,
  summaryText,
  verdictText,
  warningText,
};
