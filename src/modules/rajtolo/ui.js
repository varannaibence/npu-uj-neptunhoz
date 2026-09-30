// The Rajtoló dialog: the plan in order, one "Felvétel" button per subject. A click
// runs engine.js through index.js; this file only draws.
const utils = require("../../utils");
const modal = require("../../modal");
const tokens = require("../../neptunTokens");
const registrationData = require("../../registrationData");
const { LAUNCHER_ID, PLANNER_ID, WAITLIST_MODES } = require("./constants");
const plan = require("./plan");
const { pickCourse, holdsRankedCourse, courseLabel, outcomeText, outcomeTone, DONE } = require("./protocol");
const { formatClock } = require("../../timetable");
const { showToast } = require("../../toast");

const {
  plannedCredits,
  mergeCredits,
  totalCredits,
  findPlanConflicts,
  pruneGroups,
  savePlan,
  removeSubject,
  moveUp,
  moveDown,
  swapCourses,
} = plan;

// The one save path for the dialog and the row switches alike: the toast reaches a
// user whose dialog is closed, the status line one who has it open.
function persistPlan(state) {
  savePlan(state.plan).then(saved => {
    if (!saved) {
      state.statusText = "A Rajtoló terve nem menthető. Jelentkezz be újra, majd próbáld ismét.";
      showToast(state.statusText, "error");
      render(state);
    }
  });
}

function buildLauncher(referenceButton) {
  const launcher = utils.cloneButton(referenceButton);
  launcher.id = LAUNCHER_ID;
  utils.setButtonLabel(launcher, "Rajtoló");
  utils.markNpu(launcher, "Tárgyfelvétel a sorrended szerint");
  return launcher;
}

// Every colour is a Neptun token (so an institution's theme and the NPU hue still
// win) or one of the three signal colours the toasts already use.
const MUTED = `color-mix(in srgb, ${tokens.text} 68%, transparent)`;
const HAIRLINE = "rgba(154,158,188,.45)";
let plannerCssInjected = false;
function injectPlannerCss() {
  if (plannerCssInjected) {
    return;
  }
  plannerCssInjected = true;
  utils.injectCss(`
.npu-rj { display:flex; flex-direction:column; gap:24px; color:${tokens.text}; font-size:15px; line-height:1.5; }
.npu-rj p { margin:0; }
.npu-rj-muted { color:rgba(33,48,85,.68); color:${MUTED}; }
.npu-rj-intro { font-size:14px; }
.npu-rj-note { font-size:14px; font-weight:600; color:#8a4b0f; }
.npu-rj-note:empty { display:none; }

.npu-rj-list { margin:0; padding:0; list-style:none; border:1px solid ${HAIRLINE}; border-radius:12px; }
.npu-rj-subject { display:grid; grid-template-columns:28px minmax(0, 1fr) auto; align-items:center; gap:4px 16px; padding:14px 16px; }
.npu-rj-subject + .npu-rj-subject { border-top:1px solid ${HAIRLINE}; }
.npu-rj-subject[data-state="done"] { background:rgba(26,158,92,.06); }
.npu-rj-rank {
  display:grid; place-items:center; width:28px; height:28px; border-radius:50%;
  background:${tokens.subtleSurface}; font-size:14px; font-weight:700; font-variant-numeric:tabular-nums;
}
.npu-rj-subject > button:disabled { opacity:.45; cursor:not-allowed; }
.npu-rj-main { display:flex; flex-direction:column; gap:2px; min-width:0; }
.npu-rj-title { font-size:16px; font-weight:700; overflow-wrap:anywhere; }
.npu-rj-title small { margin-left:8px; font-size:13px; font-weight:400; }
.npu-rj-picks { display:flex; flex-wrap:wrap; gap:2px 14px; font-size:13px; }
.npu-rj-seat { margin-left:4px; padding:0 6px; border-radius:999px; font-size:12px; font-weight:600; white-space:nowrap; }
.npu-rj-seat[data-seat="free"] { background:rgba(26,158,92,.12); color:#146c40; }
.npu-rj-seat[data-seat="waitlist"] { background:rgba(242,153,74,.18); color:#8a4b0f; }
.npu-rj-seat[data-seat="full"] { background:rgba(192,57,43,.1); color:#a1281b; }
.npu-rj-status, .npu-rj-clash, .npu-rj-edit { grid-column:2 / -1; }
.npu-rj-status { font-size:14px; font-weight:600; }
.npu-rj-status:empty { display:none; }
.npu-rj-status[data-tone="working"] { color:${tokens.primary}; }
.npu-rj-status[data-tone="ok"] { color:#146c40; }
.npu-rj-status[data-tone="warn"] { color:#8a4b0f; }
.npu-rj-status[data-tone="error"] { color:#a1281b; }
.npu-rj-clash {
  padding:4px 10px; border-left:3px solid #f2994a; border-radius:0 6px 6px 0;
  background:rgba(242,153,74,.12); font-size:13px; overflow-wrap:anywhere;
}
.npu-rj-edit summary, .npu-rj-why summary { cursor:pointer; font-size:13px; font-weight:600; color:${tokens.primary}; }
.npu-rj-edit[open] summary { margin-bottom:8px; }
.npu-rj-edit-body { display:flex; flex-direction:column; gap:10px; }
.npu-rj-tools { display:flex; gap:4px; align-items:center; }
.npu-rj-group-label { font-size:13px; font-weight:600; }
.npu-rj-courses { margin:2px 0 0; padding:0; list-style:none; display:flex; flex-direction:column; gap:2px; }
.npu-rj-course { display:grid; grid-template-columns:20px minmax(0, 1fr) auto; align-items:center; gap:8px; min-height:32px; font-size:14px; }
.npu-rj-course-main { display:flex; flex-wrap:wrap; align-items:baseline; gap:2px 10px; min-width:0; }
.npu-rj-code { font-weight:600; overflow-wrap:anywhere; }
.npu-rj-slot { font-size:13px; font-variant-numeric:tabular-nums; }
.npu-rj-icon {
  display:grid; place-items:center; width:30px; height:30px; padding:0; border:1px solid ${HAIRLINE};
  border-radius:8px; background:${tokens.surface}; color:${tokens.text}; font:inherit; font-size:13px; cursor:pointer;
}
.npu-rj-icon:hover:not(:disabled) { background:${tokens.subtleSurface}; }
.npu-rj-icon:disabled { opacity:.3; cursor:not-allowed; }
.npu-rj-icon:focus-visible { outline:2px solid ${tokens.focus}; outline-offset:2px; }
.npu-rj-empty { padding:20px 24px; border:1px dashed rgba(154,158,188,.8); border-radius:12px; }
.npu-rj-warning { padding:12px 16px; border:1px solid rgba(242,153,74,.55); border-radius:12px; font-size:14px; }
.npu-rj-warning ul { margin:6px 0 0; padding-left:1.2em; overflow-wrap:anywhere; }

.npu-rj-settings { display:flex; flex-wrap:wrap; align-items:center; gap:8px 16px; font-size:14px; }
.npu-rj-settings > span { font-weight:600; }
.npu-rj-seg { display:inline-flex; flex-wrap:wrap; gap:4px; padding:4px; border-radius:10px; background:${tokens.subtleSurface}; }
.npu-dialog .npu-rj-seg label { position:relative; display:block; gap:0; cursor:pointer; font-size:14px; }
.npu-dialog .npu-rj-seg input[type="radio"] { position:absolute; opacity:0; width:1px; height:1px; margin:0; padding:0; border:0; }
.npu-rj-seg span { display:block; padding:6px 12px; border-radius:7px; font-weight:600; }
.npu-rj-seg input:checked + span { background:${tokens.surface}; color:${tokens.primary}; box-shadow:0 1px 3px rgba(33,48,85,.2); }
.npu-rj-seg input:focus-visible + span { outline:2px solid ${tokens.focus}; outline-offset:1px; }
.npu-rj-hint { flex-basis:100%; font-size:13px; }
.npu-rj-credits { font-size:14px; font-variant-numeric:tabular-nums; }
.npu-rj-credits summary { cursor:pointer; }
.npu-rj-credits ul { margin:4px 0 0; padding-left:1.2em; }
.npu-rj-why { font-size:14px; }
.npu-rj-why p + p { margin-top:8px; }
.npu-rj-why[open] summary { margin-bottom:8px; }

@media (max-width: 640px) {
  .npu-rj-subject { grid-template-columns:28px minmax(0, 1fr); }
  .npu-rj-subject > button { grid-column:2; justify-self:start; }
}
`);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (typeof text === "string") {
    node.textContent = text;
  }
  return node;
}

function iconButton(symbol, label, focusKey) {
  const button = el("button", "npu-rj-icon", symbol);
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.setAttribute("data-npu-focus-key", focusKey);
  return button;
}

// A <details> that stays open across a full rebuild of the dialog body.
function lasting(state, key, className, summaryText) {
  const details = el("details", className);
  details.open = state.openDetails.has(key);
  details.appendChild(el("summary", null, summaryText));
  details.addEventListener("toggle", () => {
    if (details.open) {
      state.openDetails.add(key);
    } else {
      state.openDetails.delete(key);
    }
  });
  return details;
}

// What the dialog knows of a ranked course: the list Neptun last showed (seats
// included), else the code and times the plan kept.
function courseInfo(state, subject, courseId) {
  const live = state.courseCatalog.get(subject.subjectId);
  const fresh = live && live.get(courseId);
  if (fresh) {
    return fresh;
  }
  const note = subject.courses && subject.courses[courseId];
  return note ? Object.assign({ id: courseId, isFull: null, willBeOnWaitingList: null }, note) : null;
}

function knownCourses(state, subject) {
  const index = new Map();
  (subject.groups || []).forEach(group =>
    group.ranking.forEach(id => {
      const course = courseInfo(state, subject, id);
      if (course) {
        index.set(id, course);
      }
    })
  );
  return index;
}

// What a click would tick, per group, for the clash check: with seats known, the same
// pick the click makes; without them, the first choice.
function buildPlanPicks(state) {
  const picks = [];
  state.plan.subjects.forEach(subject => {
    const index = knownCourses(state, subject);
    const groups = pruneGroups(subject.groups, Array.from(index.values()));
    if (holdsRankedCourse(groups, index)) {
      return;
    }
    groups.forEach(group => {
      const seatsKnown = group.ranking.some(id => typeof index.get(id).isFull === "boolean");
      const courseId = seatsKnown ? pickCourse(group, index, state.plan.waitlistMode) : group.ranking[0];
      if (courseId) {
        picks.push({
          subjectId: subject.subjectId,
          subjectTitle: subject.title || subject.code || "Ismeretlen tárgy",
          groupType: group.type,
          course: index.get(courseId),
        });
      }
    });
  });
  return picks;
}

function sideText(pick, slot) {
  return `${pick.subjectTitle} (${pick.course.code || "Ismeretlen kurzus"}, ${formatClock(slot.start)}–${formatClock(slot.end)})`;
}

function conflictText(conflict) {
  const dayLabel = conflict.slotA.dayLabel || conflict.slotB.dayLabel || "";
  const prefix = dayLabel ? `${dayLabel}: ` : "";
  return `${prefix}${sideText(conflict.a, conflict.slotA)} ütközik ezzel: ${sideText(conflict.b, conflict.slotB)}`;
}

// One note per clash on each side's row, naming the other side.
function subjectConflictNotes(conflicts) {
  const notes = new Map();
  function add(subjectId, text) {
    notes.set(subjectId, (notes.get(subjectId) || []).concat(text));
  }
  conflicts.forEach(conflict => {
    add(conflict.a.subjectId, sideText(conflict.b, conflict.slotB));
    add(conflict.b.subjectId, sideText(conflict.a, conflict.slotA));
  });
  return notes;
}

// A warning, not an error: two first choices colliding may be what the student wants.
function buildConflictWarning(conflicts) {
  const notice = el("div", "npu-rj-warning");
  notice.appendChild(el("p", null, "Ezek az órák ütköznek:")).style.fontWeight = "700";
  const list = el("ul");
  conflicts.forEach(conflict => list.appendChild(el("li", null, conflictText(conflict))));
  notice.appendChild(list);
  return notice;
}

// A three-way choice as one row of native radios: every option in sight, arrow keys
// move between them, and the checked one reads as pressed.
function segmented(name, labelText, options, value, onChange) {
  const label = el("span", null, labelText);
  label.id = `${PLANNER_ID}-${name}-label`;
  const group = el("div", "npu-rj-seg");
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-labelledby", label.id);
  options.forEach(option => {
    const item = el("label");
    const input = el("input");
    input.type = "radio";
    input.name = `${PLANNER_ID}-${name}`;
    input.value = String(option.value);
    input.checked = option.value === value;
    input.setAttribute("data-npu-focus-key", `${name}-${option.value}`);
    input.addEventListener("change", () => onChange(option.value));
    item.appendChild(input);
    item.appendChild(el("span", null, option.label));
    group.appendChild(item);
  });
  return [label, group];
}

const WAITLIST_MODE_TEXT = {
  seatFirst: {
    label: "Szabad hely előnyben",
    hint: "A sorrendedben az első kurzus, ahol van hely; ha sehol sincs, a legjobb várólistás.",
  },
  order: {
    label: "Pontos sorrend",
    hint: "A sorrendedben az első nem betelt kurzus, akkor is, ha ott csak várólista van.",
  },
  never: {
    label: "Várólista nélkül",
    hint: "Csak szabad helyes kurzusra jelentkezik; ha nincs, a tárgyat nem küldi el.",
  },
};

function buildSettings(state) {
  const row = el("section", "npu-rj-settings");
  const mode = state.plan.waitlistMode;
  segmented(
    "waitlist-mode",
    "Ha az első választásod betelt:",
    WAITLIST_MODES.map(value => ({ value, label: WAITLIST_MODE_TEXT[value].label })),
    mode,
    value => {
      state.plan.waitlistMode = value;
      persistPlan(state);
      render(state);
    }
  ).forEach(node => row.appendChild(node));
  row.appendChild(el("p", "npu-rj-hint npu-rj-muted", WAITLIST_MODE_TEXT[mode].hint));
  return row;
}

// Registered credits and what the plan would add. Null until a response has been
// seen: a "0" in that gap would read as "you have zero credits".
function buildCreditForecast(state) {
  const otherTerm =
    state.registeredCreditsTermId &&
    state.catalogRequestTermId &&
    state.registeredCreditsTermId !== state.catalogRequestTermId;
  if (!state.registeredCredits || otherTerm) {
    return null;
  }
  const planned = plannedCredits(state.plan, state.subjectCatalog);
  const merged = mergeCredits(state.registeredCredits, planned);
  const currentTotal = totalCredits(state.registeredCredits);
  const plannedTotal = totalCredits(planned);
  const details = el("details", "npu-rj-credits");
  details.appendChild(
    el(
      "summary",
      null,
      plannedTotal > 0
        ? `${currentTotal} kredit felvéve, a sorral ${totalCredits(merged)}`
        : `${currentTotal} kredit felvéve`
    )
  );
  const list = el("ul", "npu-rj-muted");
  merged.forEach((total, type) => {
    const current = state.registeredCredits.get(type) || 0;
    const add = planned.get(type) || 0;
    list.appendChild(el("li", null, add > 0 ? `${type}: ${current} + ${add} = ${total}` : `${type}: ${current}`));
  });
  details.appendChild(list);
  return details;
}

function buildWhy(state) {
  const why = lasting(state, "why", "npu-rj-why", "Miért nem jelentkezik helyetted?");
  why.appendChild(
    el(
      "p",
      null,
      "Utánanéztünk: az időzítve vagy újra és újra beküldő scriptek terhelik a Neptun szerverét, előnyt adnak a többiekkel szemben, és volt már rá példa, hogy egyetem fegyelmi eljárást indított miattuk."
    )
  );
  why.appendChild(
    el(
      "p",
      null,
      "Ezért a Rajtoló csak azt teszi, amit te is megtennél, csak gyorsabban: egy kattintásra egy tárgyat vesz fel, ugyanazokkal a kérésekkel, amiket a Neptun is küld, ha kézzel veszed fel. Nincs időzítés, ismételgetés vagy háttérben figyelés, így a szervert sem terheli jobban, mint a kézi felvétel. Reméljük, így senki nem kerül bajba."
    )
  );
  why.appendChild(
    el(
      "p",
      null,
      "Nem hivatalos kiegészítő, saját felelősségre: az intézményed szabályzata ettől még tilthatja, ezért használat előtt nézd meg."
    )
  );
  return why;
}

// Where a subject stands: the step of a click in progress, the last click's result,
// or what Neptun's list already says.
function subjectState(state, subject) {
  if (state.busySubjectId === subject.subjectId) {
    return { state: "working", text: state.stepText || "Folyamatban…", tone: "working", label: "Folyamatban…" };
  }
  const outcome = state.subjectStatus.get(subject.subjectId);
  if (outcome) {
    const done = DONE.includes(outcome.kind);
    return {
      state: done ? "done" : "idle",
      text: outcomeText(outcome),
      tone: outcomeTone(outcome.kind),
      label: outcome.kind === "waitlisted" ? "Várólistán" : done ? "Felvéve" : "Újra",
    };
  }
  const record = state.subjectCatalog.get(subject.subjectId);
  const index = state.courseCatalog.get(subject.subjectId);
  if ((record && record.isRegistered) || (index && holdsRankedCourse(subject.groups, index))) {
    return { state: "done", text: "Már felvetted (a Neptun listája szerint).", tone: "ok", label: "Felvéve" };
  }
  if (!subject.groups || subject.groups.length === 0) {
    return { state: "idle", text: "Nincs bekapcsolt kurzus ehhez a tárgyhoz.", tone: "warn", label: "Felvétel" };
  }
  return { state: "idle", text: "", tone: "", label: "Felvétel" };
}

// The ranked courses of each group in one line, seats where the last list showed them.
function buildPicks(state, subject) {
  const line = el("div", "npu-rj-picks");
  (subject.groups || []).forEach(group => {
    const part = el("span");
    part.appendChild(el("span", "npu-rj-muted", `${group.type || "Egyéb"}: `));
    group.ranking.forEach((id, index) => {
      const course = courseInfo(state, subject, id);
      part.appendChild(document.createTextNode(`${index > 0 ? " › " : ""}${(course && course.code) || "?"}`));
      const seat = course && registrationData.seatState(course);
      if (seat) {
        part.appendChild(el("span", "npu-rj-seat", SEAT_TEXT[seat])).setAttribute("data-seat", seat);
      }
    });
    line.appendChild(part);
  });
  return line;
}

const SEAT_TEXT = { free: "van hely", waitlist: "várólista", full: "betelt" };

function slotText(course) {
  return (course.slots || [])
    .map(slot => `${slot.dayLabel ? `${slot.dayLabel} ` : ""}${formatClock(slot.start)}–${formatClock(slot.end)}`)
    .join(", ");
}

function renderSubjectRow(state, subject, index, conflictNotes) {
  const item = el("li", "npu-rj-subject");
  const where = subjectState(state, subject);
  item.setAttribute("data-state", where.state);
  item.appendChild(el("span", "npu-rj-rank", String(index + 1))).setAttribute("aria-hidden", "true");

  const main = el("div", "npu-rj-main");
  const title = el("div", "npu-rj-title", subject.title || subject.code || "Ismeretlen tárgy");
  if (subject.code && subject.title) {
    title.appendChild(el("small", "npu-rj-muted", subject.code));
  }
  main.appendChild(title);
  main.appendChild(buildPicks(state, subject));
  item.appendChild(main);

  const go = modal.actionButton(where.label, true);
  go.setAttribute("data-npu-focus-key", `go-${subject.subjectId}`);
  go.setAttribute("aria-label", `${where.label}: ${subject.title || subject.code || "Ismeretlen tárgy"}`);
  go.disabled =
    Boolean(state.busySubjectId) || where.state === "done" || !subject.groups || subject.groups.length === 0;
  go.addEventListener("click", () => state.onRegister(subject.subjectId));
  item.appendChild(go);

  const status = el("div", "npu-rj-status", where.text);
  status.setAttribute("data-tone", where.tone);
  status.setAttribute("role", "status");
  item.appendChild(status);

  if (conflictNotes && conflictNotes.length > 0) {
    item.appendChild(el("div", "npu-rj-clash", `Ütközik: ${conflictNotes.join("; ")}`));
  }

  const edit = lasting(state, `edit-${subject.subjectId}`, "npu-rj-edit", "Sorrend szerkesztése");
  const editBody = el("div", "npu-rj-edit-body");
  const tools = el("div", "npu-rj-tools");
  const up = iconButton("▲", "A tárgy előrébb", `subject-${subject.subjectId}-up`);
  up.disabled = index === 0;
  up.addEventListener("click", () => {
    state.plan.subjects = moveUp(state.plan.subjects, index);
    persistPlan(state);
    render(state);
  });
  const down = iconButton("▼", "A tárgy hátrébb", `subject-${subject.subjectId}-down`);
  down.disabled = index === state.plan.subjects.length - 1;
  down.addEventListener("click", () => {
    state.plan.subjects = moveDown(state.plan.subjects, index);
    persistPlan(state);
    render(state);
  });
  const remove = iconButton("✕", "Kivétel a Rajtolóból", `subject-${subject.subjectId}-remove`);
  remove.addEventListener("click", () => {
    state.plan = removeSubject(state.plan, subject.subjectId);
    persistPlan(state);
    render(state);
  });
  [up, down, remove].forEach(button => tools.appendChild(button));
  editBody.appendChild(tools);
  const known = knownCourses(state, subject);
  pruneGroups(subject.groups, Array.from(known.values())).forEach((group, groupIndex) => {
    editBody.appendChild(renderGroup(state, subject, group, groupIndex));
  });
  edit.appendChild(editBody);
  item.appendChild(edit);
  return item;
}

function renderGroup(state, subject, group, groupIndex) {
  const wrapper = el("div");
  wrapper.appendChild(el("p", "npu-rj-group-label npu-rj-muted", group.type || "Egyéb"));
  const list = el("ol", "npu-rj-courses");
  group.ranking.forEach((courseId, courseIndex) => {
    const course = courseInfo(state, subject, courseId);
    const row = el("li", "npu-rj-course");
    row.appendChild(el("span", "npu-rj-muted", `${courseIndex + 1}.`));
    const main = el("span", "npu-rj-course-main");
    main.appendChild(el("span", "npu-rj-code", course ? courseLabel(course) : "Ismeretlen kurzus"));
    const when = course && slotText(course);
    if (when) {
      main.appendChild(el("span", "npu-rj-slot npu-rj-muted", when));
    }
    row.appendChild(main);
    const tools = el("span", "npu-rj-tools");
    const keyBase = `subject-${subject.subjectId}-group-${groupIndex}-${courseIndex}`;
    // `group` is a pruned copy, so a move goes through the plan by course id.
    const up = iconButton("▲", "Előrébb", `${keyBase}-up`);
    up.disabled = courseIndex === 0;
    up.addEventListener("click", () => {
      state.plan = swapCourses(state.plan, subject.subjectId, courseId, group.ranking[courseIndex - 1]);
      persistPlan(state);
      render(state);
    });
    const down = iconButton("▼", "Hátrébb", `${keyBase}-down`);
    down.disabled = courseIndex === group.ranking.length - 1;
    down.addEventListener("click", () => {
      state.plan = swapCourses(state.plan, subject.subjectId, courseId, group.ranking[courseIndex + 1]);
      persistPlan(state);
      render(state);
    });
    tools.appendChild(up);
    tools.appendChild(down);
    row.appendChild(tools);
    list.appendChild(row);
  });
  wrapper.appendChild(list);
  return wrapper;
}

// The whole body is rebuilt on every change rather than patched. Plans hold a handful
// of subjects, so a full rebuild is cheap and far simpler than diffing.
function render(state) {
  // Called on every catalogue response, open or not: a closed dialog is normal.
  if (!state.dialog) {
    return;
  }
  const body = state.dialog.content.querySelector(`#${PLANNER_ID}-body`);
  if (!body) {
    return;
  }
  const activeElement = body.ownerDocument.activeElement;
  const focusKey =
    state.nextFocus || (body.contains(activeElement) ? activeElement.getAttribute("data-npu-focus-key") : null);
  state.nextFocus = null;
  body.innerHTML = "";

  body.appendChild(
    el(
      "p",
      "npu-rj-intro npu-rj-muted",
      "Kattints a tárgy Felvétel gombjára: a Rajtoló friss kurzuslistát kér, és a sorrended szerinti szabad kurzusokkal felveszi a tárgyat. Ha egy kurzus közben betelt, a következővel próbálja. Egyszerre egy tárgy megy."
    )
  );
  body.appendChild(el("p", "npu-rj-note", state.statusText || ""));

  const conflicts = findPlanConflicts(buildPlanPicks(state));
  if (conflicts.length > 0) {
    body.appendChild(buildConflictWarning(conflicts));
  }

  if (state.plan.subjects.length === 0) {
    const empty = el("div", "npu-rj-empty");
    empty.appendChild(el("p", null, "Még üres a sor.")).style.fontWeight = "700";
    empty.appendChild(
      el(
        "p",
        "npu-rj-muted",
        "A tárgylistában nyisd le a tárgyat, és a kívánt kurzusoknál kapcsold be a „Rajtolóhoz” kapcsolót. Egy kurzustípuson belül a bekapcsolás sorrendje a rangsor."
      )
    );
    body.appendChild(empty);
  } else {
    const list = el("ol", "npu-rj-list");
    const notes = subjectConflictNotes(conflicts);
    state.plan.subjects.forEach((subject, index) => {
      list.appendChild(renderSubjectRow(state, subject, index, notes.get(subject.subjectId)));
    });
    body.appendChild(list);
  }

  body.appendChild(buildSettings(state));
  const credits = buildCreditForecast(state);
  if (credits) {
    body.appendChild(credits);
  }
  body.appendChild(buildWhy(state));

  if (focusKey) {
    const target = Array.from(body.querySelectorAll("[data-npu-focus-key]")).find(
      element => element.getAttribute("data-npu-focus-key") === focusKey
    );
    if (target && typeof target.focus === "function") {
      setTimeout(() => {
        if (target.isConnected && !target.disabled) {
          target.focus();
        }
      }, 0);
    }
  }
}

function openPlanner(state) {
  injectPlannerCss();
  state.dialog = modal.open({
    title: "Rajtoló",
    build(content) {
      const body = el("div", "npu-rj");
      body.id = `${PLANNER_ID}-body`;
      content.appendChild(body);
    },
    actions: [{ label: "Bezár" }],
    busy: () => (state.busySubjectId ? "A Rajtoló épp felvesz egy tárgyat; várd meg, amíg végez." : null),
    onClose() {
      state.dialog = null;
    },
  });
  render(state);
}

module.exports = {
  buildLauncher,
  persistPlan,
  openPlanner,
  render,
};
