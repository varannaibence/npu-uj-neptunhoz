// The planner dialog and everything drawn inside it.
const utils = require("../../utils");
const modal = require("../../modal");
const interceptor = require("../../interceptor");
const tokens = require("../../neptunTokens");
const registrationData = require("../../registrationData");
const { LAUNCHER_ID, PLANNER_ID, WAITLIST_MODES, WATCH_MINUTES } = require("./constants");
const plan = require("./plan");
const {
  chooseCombination,
  wallClockToEpoch,
  formatWallClock,
  formatDistance,
  startChecks,
  isNeptunTimeZone,
  defaultPeriod,
  formatCountdown,
  statusLabel,
  courseLabel,
} = require("./protocol");
const { liveGet, liveGetPeriods } = require("./net");
const { formatClock } = require("../../timetable");
const { showToast } = require("../../toast");

const {
  collectCourses,
  periodLoadResult,
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

// --- UI. The planner is a real Neptun dialog, not a panel of our own. Every DOM
// touch is guarded, so a layout mismatch fails quietly. ---

function buildLauncher(referenceButton) {
  const launcher = utils.cloneButton(referenceButton);
  launcher.id = LAUNCHER_ID;
  utils.setButtonLabel(launcher, "Rajtoló");
  utils.markNpu(launcher, "Ütemezett tárgyfelvétel");
  return launcher;
}

// Every colour is a Neptun token (so an institution's theme and the NPU hue still
// win) or one of the three signal colours the toasts already use. One accent only:
// the checkered start line on the left of the start panel, whose colour says where
// the Rajtoló stands.
const MUTED = `color-mix(in srgb, ${tokens.text} 68%, transparent)`;
const HAIRLINE = "rgba(154,158,188,.45)";
let plannerCssInjected = false;
function injectPlannerCss() {
  if (plannerCssInjected) {
    return;
  }
  plannerCssInjected = true;
  utils.injectCss(`
.npu-rj { display:flex; flex-direction:column; gap:32px; color:${tokens.text}; font-size:15px; line-height:1.5; }
.npu-rj p { margin:0; }
.npu-rj h3 { margin:0; font-size:18px; font-weight:700; line-height:1.3; }
.npu-rj-muted { color:rgba(33,48,85,.68); color:${MUTED}; }

.npu-rj-start {
  --npu-rj-line: rgba(33,48,85,.3);
  position:relative; display:flex; flex-direction:column; gap:2px;
  padding:20px 24px 20px 52px; border-radius:12px; background:${tokens.subtleSurface};
}
.npu-rj-start::before {
  content:""; position:absolute; left:20px; top:18px; bottom:18px; width:12px; border-radius:2px;
  background:repeating-conic-gradient(var(--npu-rj-line) 0 25%, transparent 0 50%) 0 0 / 12px 12px;
}
.npu-rj-start[data-tone="ready"] { --npu-rj-line: ${tokens.primary}; }
.npu-rj-start[data-tone="armed"] { --npu-rj-line: ${tokens.primary}; }
.npu-rj-start[data-tone="armed"]::before { animation: npu-rj-march 1.6s linear infinite; }
.npu-rj-start[data-tone="blocked"] { --npu-rj-line: #f2994a; }
.npu-rj-start[data-tone="done"] { --npu-rj-line: #1a9e5c; }
@keyframes npu-rj-march { to { background-position: 0 12px; } }
@media (prefers-reduced-motion: reduce) { .npu-rj-start[data-tone="armed"]::before { animation:none; } }
.npu-rj-state { font-size:14px; font-weight:600; }
.npu-rj-start[data-tone="ready"] .npu-rj-state,
.npu-rj-start[data-tone="armed"] .npu-rj-state { color:${tokens.primary}; }
.npu-rj-start[data-tone="blocked"] .npu-rj-state { color:#8a4b0f; }
.npu-rj-start[data-tone="done"] .npu-rj-state { color:#146c40; }
.npu-rj-when { font-size:26px; font-weight:700; line-height:1.25; font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }
.npu-rj-count { font-size:16px; font-variant-numeric:tabular-nums; }
.npu-rj-start[data-tone="armed"] .npu-rj-count { font-size:20px; font-weight:700; }
.npu-rj-detail { margin-top:6px !important; font-size:14px; }
.npu-rj-detail:empty, .npu-rj-session:empty { display:none; }
.npu-rj-session { margin-top:6px !important; font-size:14px; font-weight:600; color:#8a4b0f; }

.npu-rj-checks { display:flex; flex-wrap:wrap; gap:6px 20px; margin:-16px 0 0; padding:0; list-style:none; font-size:14px; }
.npu-rj-checks li { display:flex; align-items:baseline; gap:6px; }
.npu-rj-checks b { font-weight:900; color:#1a9e5c; }
.npu-rj-checks [data-ok="false"] b { color:#c0392b; }

.npu-rj-section { display:flex; flex-direction:column; gap:14px; }
.npu-rj-trial {
  padding:10px 14px; border-left:3px solid #f2994a; border-radius:0 8px 8px 0;
  background:rgba(242,153,74,.1); font-size:14px;
}
.npu-rj-section-head { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:baseline; gap:4px 16px; }
.npu-rj-fields { display:grid; grid-template-columns:max-content minmax(0, 1fr); gap:12px 24px; align-items:center; }
.npu-rj-fields > .npu-rj-label { font-size:14px; font-weight:600; }
.npu-dialog .npu-rj-fields select,
.npu-dialog .npu-rj-fields input[type="datetime-local"] { width:100%; max-width:600px; }
.npu-rj-hint { grid-column:2; margin-top:-6px !important; font-size:13px; }
.npu-rj-inline { display:flex; flex-wrap:wrap; align-items:center; gap:8px 16px; }

.npu-rj-seg { display:inline-flex; flex-wrap:wrap; gap:4px; padding:4px; border-radius:10px; background:${tokens.subtleSurface}; justify-self:start; }
.npu-dialog .npu-rj-seg label { position:relative; display:block; gap:0; cursor:pointer; font-size:14px; }
.npu-dialog .npu-rj-seg input[type="radio"] {
  position:absolute; opacity:0; width:1px; height:1px; margin:0; padding:0; border:0;
}
.npu-rj-seg span { display:block; padding:8px 14px; border-radius:7px; font-weight:600; }
.npu-rj-seg input:checked + span { background:${tokens.surface}; color:${tokens.primary}; box-shadow:0 1px 3px rgba(33,48,85,.2); }
.npu-rj-seg input:focus-visible + span { outline:2px solid ${tokens.focus}; outline-offset:1px; }
.npu-rj-seg input:disabled + span { opacity:.55; cursor:not-allowed; }

.npu-rj-list { margin:0; padding:0; list-style:none; border:1px solid ${HAIRLINE}; border-radius:12px; }
.npu-rj-subject { display:grid; grid-template-columns:28px minmax(0, 1fr) auto; gap:6px 14px; padding:16px; }
.npu-rj-subject + .npu-rj-subject { border-top:1px solid ${HAIRLINE}; }
.npu-rj-rank {
  display:grid; place-items:center; width:28px; height:28px; border-radius:50%;
  background:${tokens.subtleSurface}; font-size:14px; font-weight:700; font-variant-numeric:tabular-nums;
}
.npu-rj-subject-title { align-self:center; font-size:16px; font-weight:700; overflow-wrap:anywhere; }
.npu-rj-tools { display:flex; gap:4px; align-self:start; }
.npu-rj-body { grid-column:2 / -1; display:flex; flex-direction:column; gap:10px; }
.npu-rj-status { grid-column:2 / -1; font-size:14px; font-weight:600; }
.npu-rj-status:empty { display:none; }
.npu-rj-clash {
  grid-column:2 / -1; padding:6px 10px; border-left:3px solid #f2994a; border-radius:0 6px 6px 0;
  background:rgba(242,153,74,.12); font-size:13px; overflow-wrap:anywhere;
}
.npu-rj-group-label { font-size:13px; font-weight:600; }
.npu-rj-courses { margin:2px 0 0; padding:0; list-style:none; display:flex; flex-direction:column; gap:2px; }
.npu-rj-course { display:grid; grid-template-columns:20px minmax(0, 1fr) auto; align-items:baseline; gap:8px; min-height:34px; font-size:14px; }
.npu-rj-course .npu-rj-tools { align-self:center; }
.npu-rj-course-n { font-size:13px; font-variant-numeric:tabular-nums; }
.npu-rj-course-main { display:flex; flex-wrap:wrap; align-items:baseline; gap:2px 10px; min-width:0; }
.npu-rj-code { font-weight:600; overflow-wrap:anywhere; }
.npu-rj-slot { font-size:13px; font-variant-numeric:tabular-nums; }
.npu-rj-seat { padding:1px 8px; border-radius:999px; font-size:12px; font-weight:600; white-space:nowrap; }
.npu-rj-seat[data-seat="free"] { background:rgba(26,158,92,.12); color:#146c40; }
.npu-rj-seat[data-seat="waitlist"] { background:rgba(242,153,74,.18); color:#8a4b0f; }
.npu-rj-seat[data-seat="full"] { background:rgba(192,57,43,.1); color:#a1281b; }
.npu-rj-icon {
  display:grid; place-items:center; width:32px; height:32px; padding:0; border:1px solid ${HAIRLINE};
  border-radius:8px; background:${tokens.surface}; color:${tokens.text}; font:inherit; font-size:13px; cursor:pointer;
}
.npu-rj-icon:hover:not(:disabled) { background:${tokens.subtleSurface}; }
.npu-rj-icon:disabled { opacity:.35; cursor:not-allowed; }
.npu-rj-course .npu-rj-icon { width:28px; height:28px; border-color:transparent; background:transparent; font-size:12px; }
.npu-rj-course .npu-rj-icon:disabled { opacity:.2; }
.npu-rj-icon:focus-visible, .npu-rj-text-button:focus-visible { outline:2px solid ${tokens.focus}; outline-offset:2px; }
.npu-rj-text-button {
  padding:0; border:0; background:none; color:${tokens.primary}; font:inherit; font-size:13px; font-weight:600;
  text-decoration:underline; cursor:pointer;
}
.npu-rj-text-button:disabled { opacity:.55; cursor:not-allowed; }
.npu-rj-empty { padding:20px 24px; border:1px dashed rgba(154,158,188,.8); border-radius:12px; }
.npu-rj-warning {
  padding:12px 16px; border:1px solid rgba(242,153,74,.55); border-radius:12px; font-size:14px;
}
.npu-rj-warning ul { margin:6px 0 0; padding-left:1.2em; overflow-wrap:anywhere; }
.npu-rj-credits { font-size:14px; font-variant-numeric:tabular-nums; }
.npu-rj-credits summary { cursor:pointer; }
.npu-rj-credits ul { margin:4px 0 0; padding-left:1.2em; }
.npu-rj-foot { display:flex; flex-direction:column; gap:6px; font-size:13px; }

@media (max-width: 640px) {
  .npu-rj-fields { grid-template-columns:minmax(0, 1fr); gap:6px; }
  .npu-rj-hint { grid-column:1; margin-top:0 !important; }
  .npu-rj-fields > .npu-rj-label:not(:first-child) { margin-top:10px; }
  .npu-rj-start { padding-left:44px; }
  .npu-rj-start::before { left:16px; }
  .npu-rj-when { font-size:22px; }
  .npu-rj-body, .npu-rj-status, .npu-rj-clash { grid-column:1 / -1; }
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

function textButton(label, focusKey) {
  const button = el("button", "npu-rj-text-button", label);
  button.type = "button";
  button.setAttribute("data-npu-focus-key", focusKey);
  return button;
}

// The GUID form Periods/GetPeriods wants: the plan's termId once a subject has been
// picked, or any subject already harvested off the page.
function planTermId(state) {
  if (state.plan.termId) {
    return state.plan.termId;
  }
  const first = state.subjectCatalog.values().next().value;
  return (first && first.termId) || null;
}

// Once per term, and only while the planner is open - never on page load. httpRequest
// never rejects, so a failure comes back as a body with nothing usable in it and the
// picker simply does not appear.
function loadPeriods(state, force) {
  const termId = planTermId(state);
  if (!termId || state.periodsLoadingTermId === termId) {
    return;
  }
  if (!force && state.periodsTermId === termId && state.periodsStatus !== "idle") {
    return;
  }
  state.periodsLoadingTermId = termId;
  state.periodsStatus = "loading";
  state.periodsError = null;
  state.periodsErrorReason = null;
  render(state);
  liveGetPeriods(termId).then(json => {
    // A later call may have finished while this one was in flight.
    if (state.periodsLoadingTermId !== termId) {
      return;
    }
    state.periodsLoadingTermId = null;
    state.periodsTermId = termId;
    const result = periodLoadResult(json);
    state.periods = result.periods.length > 0 ? result.periods : null;
    state.periodsStatus = result.periods.length > 0 ? "ready" : "error";
    state.periodsError = result.message;
    state.periodsErrorReason = result.reason;
    render(state);
  });
}

function plannedCourseIds(subject) {
  return (subject.groups || []).reduce((ids, group) => ids.concat(group.ranking || []), []);
}

// One subject at a time with a short gap between them, never in parallel. `get` is
// injectable so the queue is testable without a network.
function loadPlannedCourses(state, force, get = liveGet) {
  if (state.courseLoadQueue) {
    // A forced retry (a renewed token) runs after the walk in flight, not instead of it.
    return force ? state.courseLoadQueue.then(() => loadPlannedCourses(state, true, get)) : state.courseLoadQueue;
  }
  const targets = state.plan.subjects.slice();
  const generation = state.courseCatalogGeneration;
  state.courseLoadQueue = targets
    .reduce((promise, subject, index) => {
      return promise.then(() => {
        if (generation !== state.courseCatalogGeneration) {
          return undefined;
        }
        // The gap used to REPLACE the load for every subject after the first, so only
        // the first planned subject ever got its course labels and conflict check.
        const pause = index > 0 ? new Promise(resolve => setTimeout(resolve, 150)) : Promise.resolve();
        return pause.then(() => loadPlannedCourse(state, subject, force, generation, get));
      });
    }, Promise.resolve())
    .finally(() => {
      state.courseLoadQueue = null;
    });
  return state.courseLoadQueue;
}

function loadPlannedCourse(state, subject, force, generation, get = liveGet) {
  if (generation !== state.courseCatalogGeneration) {
    return Promise.resolve();
  }
  const wantedIds = plannedCourseIds(subject);
  if (!wantedIds.length) {
    return Promise.resolve();
  }
  const known = state.courseCatalog.get(subject.subjectId);
  if (known && wantedIds.every(id => known.has(id))) {
    state.courseLoadErrors.delete(subject.subjectId);
    return Promise.resolve();
  }
  if (state.courseLoads.has(subject.subjectId) || (!force && state.courseLoadErrors.has(subject.subjectId))) {
    return Promise.resolve();
  }

  state.courseLoads.add(subject.subjectId);
  state.courseLoadErrors.delete(subject.subjectId);
  render(state);
  return get(subject).then(json => {
    if (generation !== state.courseCatalogGeneration) {
      state.courseLoads.delete(subject.subjectId);
      return;
    }
    state.courseLoads.delete(subject.subjectId);
    state.courseCatalog = collectCourses(json, state.courseCatalog);
    const loaded = state.courseCatalog.get(subject.subjectId);
    if (!loaded || !wantedIds.every(id => loaded.has(id))) {
      state.courseLoadErrors.add(subject.subjectId);
    }
    render(state);
  });
}

// Null before one is loaded or chosen.
function selectedPeriod(state) {
  return (state.periods || []).find(p => p.periodId === state.selectedPeriodId) || null;
}

// The server-corrected now, the clock the start and the closing are judged by.
function serverNow() {
  return Date.now() + (interceptor.getServerOffsetMs() || 0);
}

// The same checks Start makes (protocol.startChecks), for the list under the panel.
function currentChecks(state) {
  const period = selectedPeriod(state);
  return startChecks({
    hasAuth: Boolean(interceptor.getAuthHeader()),
    subjectCount: state.plan.subjects.length,
    startMs: wallClockToEpoch(state.plan.startAt),
    closeMs: period ? wallClockToEpoch(period.toDate) : NaN,
    nowMs: serverNow(),
  });
}

// The single footer action doubles as Start and Stop, relabelled from render(). Its
// handler returns false because the dialog has to stay up to show the run.
function openPlanner(state) {
  injectPlannerCss();
  state.dialog = modal.open({
    title: "Rajtoló",
    build(content) {
      const body = el("div", "npu-rj");
      body.id = `${PLANNER_ID}-body`;
      content.appendChild(body);
    },
    actions: [
      { label: "Bezár" },
      {
        label: state.running ? "Leállítás" : "Élesítés",
        primary: true,
        onClick() {
          state.onStartStop();
          return false;
        },
      },
    ],
    // Another NPU dialog would close this one, and closing it stops the run.
    busy: () => (state.running ? "A Rajtoló élesítve van; előbb állítsd le, utána nyílhat meg más NPU-ablak." : null),
    onClose() {
      if (state.running && state.controller) {
        state.statusText = "Leállítás folyamatban…";
        state.controller.stop();
      }
      state.dialog = null;
    },
  });
  render(state);
  loadPeriods(state); // Fetch only when the planner opens, not on every page load.
  loadPlannedCourses(state);
}

// What would actually be submitted right now. Reuses chooseCombination - the same
// call runSubject makes on its first attempt - so this warning can never disagree
// with what a real run would send. An unconfigured or exhausted subject contributes
// nothing, since nothing would be submitted for it.
function buildPlanPicks(state) {
  const picks = [];
  state.plan.subjects.forEach(subject => {
    if (!subject.groups || subject.groups.length === 0) {
      return;
    }
    const courseIndex = state.courseCatalog.get(subject.subjectId) || new Map();
    const courseIds = chooseCombination(subject.groups, courseIndex, new Set(), state.plan.waitlistMode);
    if (!courseIds) {
      return;
    }
    subject.groups.forEach((group, i) => {
      const course = courseIndex.get(courseIds[i]);
      if (course) {
        picks.push({
          subjectId: subject.subjectId,
          subjectTitle: subject.title || subject.code || "Ismeretlen tárgy",
          groupType: group.type,
          course,
        });
      }
    });
  });
  return picks;
}

function planConflicts(state) {
  return findPlanConflicts(buildPlanPicks(state));
}

function sideText(pick, slot) {
  return `${pick.subjectTitle} (${pick.course.code || "Ismeretlen kurzus"}, ${formatClock(slot.start)}–${formatClock(slot.end)})`;
}

// One line for the warning box: both sides, day, times.
function conflictText(conflict) {
  const dayLabel = conflict.slotA.dayLabel || conflict.slotB.dayLabel || "";
  const prefix = dayLabel ? `${dayLabel}: ` : "";
  return `${prefix}${sideText(conflict.a, conflict.slotA)} ütközik ezzel — ${sideText(conflict.b, conflict.slotB)}`;
}

// One line per conflict, naming the OTHER side, so a row says which of its choices is
// the problem without repeating the pair the warning box already spelled out.
function subjectConflictNotes(conflicts) {
  const notes = new Map();
  function add(subjectId, text) {
    const list = notes.get(subjectId) || [];
    list.push(text);
    notes.set(subjectId, list);
  }
  conflicts.forEach(conflict => {
    const dayLabel = conflict.slotA.dayLabel || conflict.slotB.dayLabel || "";
    const prefix = dayLabel ? `${dayLabel} ` : "";
    add(
      conflict.a.subjectId,
      `${prefix}${formatClock(conflict.slotA.start)}–${formatClock(conflict.slotA.end)} ütközik: ${sideText(conflict.b, conflict.slotB)}`
    );
    add(
      conflict.b.subjectId,
      `${prefix}${formatClock(conflict.slotB.start)}–${formatClock(conflict.slotB.end)} ütközik: ${sideText(conflict.a, conflict.slotA)}`
    );
  });
  return notes;
}

// A warning, not an error: two top-ranked courses colliding is something the user may
// genuinely want anyway. This only detects and shows it - the run is unchanged.
function buildConflictWarning(conflicts) {
  const notice = el("div", "npu-rj-warning");
  notice.appendChild(el("p", null, "A mostani választás szerint ezek az órák ütköznek:")).style.fontWeight = "700";
  const list = el("ul");
  conflicts.forEach(conflict => list.appendChild(el("li", null, conflictText(conflict))));
  notice.appendChild(list);
  return notice;
}

// Where the Rajtoló stands, in one sentence and one time: the dialog's first thing.
// `tone` colours the start line - ready, armed, blocked, or idle grey.
function buildStartPanel(state, checks) {
  const startMs = wallClockToEpoch(state.plan.startAt);
  const when = formatWallClock(state.plan.startAt);
  const waitMs = startMs - serverNow();
  const blocked = checks.some(check => !check.ok && check.id !== "time");
  // After a run the panel reports it, with the summary below, until the next arming.
  const ran = !state.running && state.subjectStatus.size > 0;

  let tone = "idle";
  let stateText = "Nincs élesítve";
  let countText = "";
  if (state.running) {
    tone = "armed";
    stateText = "Élesítve";
    countText = waitMs > 0 ? `${formatCountdown(waitMs)} múlva indul` : "Fut…";
  } else if (ran) {
    tone = Array.from(state.subjectStatus.values()).every(kind => kind === "registered") ? "done" : "blocked";
    stateText = "A legutóbbi futás véget ért";
  } else if (!when) {
    stateText = "Még nincs nyitási időpont";
  } else if (blocked) {
    tone = "blocked";
    stateText = checks.find(check => !check.ok && check.id !== "time").text;
  } else {
    tone = "ready";
    stateText = "Élesítésre kész";
    countText = waitMs > 0 ? `${formatDistance(waitMs)} múlva nyit` : "Az időpont elmúlt: élesítéskor azonnal indul.";
  }

  const panel = el("section", "npu-rj-start");
  panel.setAttribute("data-tone", tone);
  panel.setAttribute("aria-label", "A Rajtoló állapota");
  panel.appendChild(el("p", "npu-rj-state", stateText));
  panel.appendChild(el("p", "npu-rj-when", when || "Válaszd ki lent a tárgyjelentkezési időszakot."));
  const count = el("p", "npu-rj-count", countText);
  count.id = `${PLANNER_ID}-countdown`;
  if (!countText) {
    count.hidden = true;
  }
  panel.appendChild(count);
  const detail = el("p", "npu-rj-detail", state.statusText || "");
  detail.id = `${PLANNER_ID}-status`;
  detail.setAttribute("role", "status");
  detail.setAttribute("aria-live", "polite");
  panel.appendChild(detail);
  const session = el("p", "npu-rj-session", state.running ? state.sessionWarning.replace(/^ – /, "") : "");
  session.id = `${PLANNER_ID}-session`;
  panel.appendChild(session);
  return panel;
}

// The same checks Start makes, so a missing piece is visible before the click.
function buildChecks(checks) {
  const list = el("ul", "npu-rj-checks");
  list.setAttribute("aria-label", "Élesítés feltételei");
  checks.forEach(check => {
    const item = el("li");
    item.setAttribute("data-ok", String(check.ok));
    item.appendChild(el("b", null, check.ok ? "✓" : "!")).setAttribute("aria-hidden", "true");
    item.appendChild(el("span", null, check.text));
    list.appendChild(item);
  });
  return list;
}

function periodOptionText(period) {
  const from = formatWallClock(period.fromDate);
  const to = formatWallClock(period.toDate);
  return from ? `${period.label} (${from}${to ? ` – ${to}` : ""})` : period.label;
}

// The period decides the opening: picking one fills the time, which stays editable.
// A plan without a time takes the current or next period's opening on its own; it is
// only a proposal until Start, which the panel above already spells out.
function buildTimeSection(state) {
  const section = el("section", "npu-rj-section");
  section.appendChild(el("h3", null, "Nyitás"));
  const fields = el("div", "npu-rj-fields");

  const periodLabel = el("label", "npu-rj-label", "Időszak");
  periodLabel.htmlFor = `${PLANNER_ID}-period`;
  fields.appendChild(periodLabel);
  if (state.periods && state.periods.length > 0) {
    if (!state.periods.some(p => p.periodId === state.selectedPeriodId)) {
      const matching = state.periods.find(p => p.fromDate === state.plan.startAt);
      state.selectedPeriodId = (matching || defaultPeriod(state.periods, serverNow())).periodId;
    }
    if (!state.plan.startAt && !state.running) {
      state.plan.startAt = selectedPeriod(state).fromDate;
    }
    const select = el("select");
    select.id = `${PLANNER_ID}-period`;
    select.setAttribute("data-npu-focus-key", "period");
    select.disabled = state.running;
    state.periods.forEach(period => {
      const option = el("option", null, periodOptionText(period));
      option.value = period.periodId;
      select.appendChild(option);
    });
    select.value = state.selectedPeriodId;
    select.addEventListener("change", () => {
      state.selectedPeriodId = select.value;
      state.plan.startAt = selectedPeriod(state).fromDate;
      persistPlan(state);
      render(state);
    });
    fields.appendChild(select);
  } else {
    const row = el("div", "npu-rj-inline");
    row.appendChild(
      el(
        "span",
        "npu-rj-muted",
        state.periodsStatus === "loading"
          ? "Az időszakok betöltése…"
          : state.periodsError || "Az időszakok a Rajtolóba tett első tárgy után tölthetők be."
      )
    );
    const reload = textButton(state.periodsStatus === "error" ? "Újratöltés" : "Betöltés", "reload-periods");
    reload.disabled = state.running || state.periodsStatus === "loading" || !planTermId(state);
    reload.addEventListener("click", () => loadPeriods(state, true));
    row.appendChild(reload);
    fields.appendChild(row);
  }

  const startLabel = el("label", "npu-rj-label", "Időpont");
  startLabel.htmlFor = `${PLANNER_ID}-start`;
  fields.appendChild(startLabel);
  const startInput = el("input");
  startInput.id = `${PLANNER_ID}-start`;
  startInput.type = "datetime-local";
  startInput.setAttribute("data-npu-focus-key", "start-at");
  startInput.disabled = state.running;
  startInput.value = state.plan.startAt || "";
  startInput.addEventListener("change", () => {
    state.plan.startAt = startInput.value || null;
    persistPlan(state);
    render(state);
  });
  fields.appendChild(startInput);

  const period = selectedPeriod(state);
  const hints = [];
  if (!isNeptunTimeZone()) {
    hints.push("Magyar idő szerint, a géped időzónájától függetlenül.");
  }
  if (period && state.plan.startAt && state.plan.startAt !== period.fromDate) {
    hints.push(`Kézzel megadott időpont; az időszak ${formatWallClock(period.fromDate) || period.fromDate}-kor nyit.`);
  }
  if (period && period.toDate) {
    hints.push(`Az időszak zárása: ${formatWallClock(period.toDate) || period.toDate}.`);
  }
  if (hints.length > 0) {
    const hint = el("p", "npu-rj-hint npu-rj-muted", hints.join(" "));
    if (period && state.plan.startAt !== period.fromDate && !state.running) {
      const reset = textButton("Az időszak nyitására", "reset-start");
      reset.style.marginLeft = "8px";
      reset.addEventListener("click", () => {
        state.plan.startAt = period.fromDate;
        persistPlan(state);
        render(state);
      });
      hint.appendChild(reset);
    }
    fields.appendChild(hint);
  }
  section.appendChild(fields);
  return section;
}

// A three- or five-way choice as one row of native radios: every option in sight,
// arrow keys move between them, and the checked one reads as pressed.
function segmented(name, labelText, options, value, disabled, onChange) {
  const label = el("span", "npu-rj-label", labelText);
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
    input.disabled = disabled;
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
    hint: "Csak szabad helyre jelentkezik; ha nincs, a tárgyat kihagyja.",
  },
};

function buildStrategySection(state) {
  const section = el("section", "npu-rj-section");
  section.appendChild(el("h3", null, "Ha nincs mindenhol hely"));
  const fields = el("div", "npu-rj-fields");
  const mode = state.plan.waitlistMode;
  segmented(
    "waitlist-mode",
    "Kurzusválasztás",
    WAITLIST_MODES.map(value => ({ value, label: WAITLIST_MODE_TEXT[value].label })),
    mode,
    state.running,
    value => {
      state.plan.waitlistMode = value;
      persistPlan(state);
      render(state);
    }
  ).forEach(node => fields.appendChild(node));
  fields.appendChild(el("p", "npu-rj-hint npu-rj-muted", WAITLIST_MODE_TEXT[mode].hint));

  const minutes = state.plan.watchMinutes || 0;
  segmented(
    "watch-minutes",
    "Betelt tárgy figyelése",
    WATCH_MINUTES.map(value => ({ value, label: value > 0 ? `${value} perc` : "Ki" })),
    minutes,
    state.running,
    value => {
      state.plan.watchMinutes = value;
      persistPlan(state);
      render(state);
    }
  ).forEach(node => fields.appendChild(node));
  fields.appendChild(
    el(
      "p",
      "npu-rj-hint npu-rj-muted",
      minutes > 0
        ? `Ha egy tárgy minden bejelölt kurzusa betelt, ${minutes} percig másodpercenként újraolvassa, és ha hely szabadul fel, azonnal jelentkezik.`
        : "Ha egy tárgy minden bejelölt kurzusa betelt, a tárgyat kihagyja."
    )
  );
  section.appendChild(fields);
  return section;
}

// Registered credits and what the plan would add, beside the plan's heading. Null
// until a response has been seen: a "0" in that gap would read as "you have zero
// credits" instead of "not loaded yet".
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

function buildPlanSection(state, conflicts) {
  const section = el("section", "npu-rj-section");
  const head = el("div", "npu-rj-section-head");
  const courseCount = state.plan.subjects.reduce((sum, subject) => sum + plannedCourseIds(subject).length, 0);
  const title = el("h3", null, "Sorrend");
  head.appendChild(title);
  if (state.plan.subjects.length > 0) {
    title.appendChild(
      el("span", "npu-rj-muted", ` ${state.plan.subjects.length} tárgy, ${courseCount} kurzus`)
    ).style.fontWeight = "400";
  }
  const credits = buildCreditForecast(state);
  if (credits) {
    head.appendChild(credits);
  }
  section.appendChild(head);

  if (conflicts.length > 0) {
    section.appendChild(buildConflictWarning(conflicts));
  }

  if (state.plan.subjects.length === 0) {
    const empty = el("div", "npu-rj-empty");
    empty.appendChild(el("p", null, "Még üres a sor.")).style.fontWeight = "700";
    empty.appendChild(
      el(
        "p",
        "npu-rj-muted",
        "A tárgylistában nyisd le a tárgyat, és a kívánt kurzusoknál kapcsold be a „Rajtolóhoz” kapcsolót. A sorrendet itt állíthatod."
      )
    );
    section.appendChild(empty);
    return section;
  }

  const list = el("ol", "npu-rj-list");
  const conflictNotes = subjectConflictNotes(conflicts);
  state.plan.subjects.forEach((subject, index) => {
    list.appendChild(renderSubjectRow(state, subject, index, conflictNotes.get(subject.subjectId)));
  });
  section.appendChild(list);
  return section;
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
  const focusKey = body.contains(activeElement) ? activeElement.getAttribute("data-npu-focus-key") : null;
  body.innerHTML = "";

  // Built first: picking the default period may fill the start time the panel shows.
  const timeSection = buildTimeSection(state);
  const checks = currentChecks(state);
  const conflicts = planConflicts(state);

  // The footer button is the run control; keep its label honest on every repaint.
  const startStop = state.dialog.buttons[state.dialog.buttons.length - 1];
  if (startStop) {
    const future = wallClockToEpoch(state.plan.startAt) > serverNow();
    utils.setButtonLabel(startStop, state.running ? "Leállítás" : future ? "Élesítés" : "Indítás");
    startStop.setAttribute("aria-pressed", String(state.running));
  }

  body.appendChild(buildStartPanel(state, checks));
  if (!state.running) {
    body.appendChild(buildChecks(checks));
  }
  // Said where the run is armed, and kept up while it runs: that is when it counts.
  const trial = el("p", "npu-rj-trial");
  trial.appendChild(el("strong", null, "Még nincs minden helyzetben élesben kipróbálva. "));
  trial.appendChild(
    document.createTextNode(
      "Nyitáskor legyél a gépnél, a kurzusaid listájával, és ha a Rajtoló megáll vagy hibát jelez, vedd fel a tárgyakat azonnal kézzel."
    )
  );
  body.appendChild(trial);
  body.appendChild(timeSection);
  body.appendChild(buildPlanSection(state, conflicts));
  body.appendChild(buildStrategySection(state));

  const foot = el("div", "npu-rj-foot npu-rj-muted");
  foot.appendChild(
    el(
      "p",
      null,
      "A kétfaktoros belépés miatt a Rajtoló nem tud helyetted bejelentkezni: maradj bejelentkezve ezen az oldalon a nyitásig. Az ablak bezárása leállítja a futást."
    )
  );
  foot.appendChild(
    el(
      "p",
      null,
      "Nem hivatalos Neptun-funkció: az intézményi szabályzat szerint, saját felelősségre használd. A beküldés nem jelent felvételt, az eredményt mindig ellenőrizd a Neptunban."
    )
  );
  body.appendChild(foot);

  if (focusKey) {
    const target = Array.from(body.querySelectorAll("[data-npu-focus-key]")).find(
      element => element.getAttribute("data-npu-focus-key") === focusKey
    );
    if (target && typeof target.focus === "function") {
      setTimeout(() => {
        if (target.isConnected) {
          target.focus();
        }
      }, 0);
    }
  }
}

const SEAT_TEXT = { free: "van hely", waitlist: "várólista", full: "betelt" };

function slotText(course) {
  return (course.slots || [])
    .map(slot => `${slot.dayLabel ? `${slot.dayLabel} ` : ""}${formatClock(slot.start)}–${formatClock(slot.end)}`)
    .join(", ");
}

function renderSubjectRow(state, subject, index, conflictNotes) {
  const item = el("li", "npu-rj-subject");
  item.appendChild(el("span", "npu-rj-rank", String(index + 1))).setAttribute("aria-hidden", "true");
  item.appendChild(el("span", "npu-rj-subject-title", subject.title || subject.code || "Ismeretlen tárgy"));

  const tools = el("span", "npu-rj-tools");
  const up = iconButton("▲", "Előrébb", `subject-${subject.subjectId}-up`);
  up.disabled = state.running || index === 0;
  up.addEventListener("click", () => {
    state.plan.subjects = moveUp(state.plan.subjects, index);
    persistPlan(state);
    render(state);
  });
  const down = iconButton("▼", "Hátrébb", `subject-${subject.subjectId}-down`);
  down.disabled = state.running || index === state.plan.subjects.length - 1;
  down.addEventListener("click", () => {
    state.plan.subjects = moveDown(state.plan.subjects, index);
    persistPlan(state);
    render(state);
  });
  const remove = iconButton("✕", "Eltávolítás a sorból", `subject-${subject.subjectId}-remove`);
  remove.disabled = state.running;
  remove.addEventListener("click", () => {
    state.plan = removeSubject(state.plan, subject.subjectId);
    persistPlan(state);
    render(state);
  });
  [up, down, remove].forEach(button => tools.appendChild(button));
  item.appendChild(tools);

  // Filled in place by the run's events; empty (and hidden) until the first one.
  const kind = state.subjectStatus.get(subject.subjectId);
  const status = el("div", "npu-rj-status", kind ? statusLabel(kind) : "");
  status.setAttribute("data-npu-subject-status", subject.subjectId);
  item.appendChild(status);

  // Marks the row when the course it would submit clashes with another subject's.
  // Short by design: the full pair is in the warning box above.
  if (conflictNotes && conflictNotes.length > 0) {
    item.appendChild(el("div", "npu-rj-clash", `Ütközés: ${conflictNotes.join("; ")}`));
  }

  const body = el("div", "npu-rj-body");
  const coursesBySubject = state.courseCatalog.get(subject.subjectId);
  const groups = coursesBySubject ? pruneGroups(subject.groups, Array.from(coursesBySubject.values())) : subject.groups;
  if (!groups || groups.length === 0) {
    body.appendChild(
      el(
        "p",
        "npu-rj-muted",
        "Nincs kiválasztott kurzus: a tárgylistában kapcsold be a „Rajtolóhoz” kapcsolót a kurzusoknál."
      )
    );
  } else {
    groups.forEach((group, groupIndex) => {
      body.appendChild(renderGroup(state, subject, group, coursesBySubject, groupIndex));
    });
  }
  item.appendChild(body);
  return item;
}

function renderGroup(state, subject, group, coursesBySubject, groupIndex) {
  const wrapper = el("div");
  wrapper.appendChild(el("p", "npu-rj-group-label npu-rj-muted", group.type || "Kurzustípus ismeretlen"));
  const list = el("ol", "npu-rj-courses");
  group.ranking.forEach((courseId, courseIndex) => {
    const course = coursesBySubject && coursesBySubject.get(courseId);
    const row = el("li", "npu-rj-course");
    row.appendChild(el("span", "npu-rj-course-n npu-rj-muted", `${courseIndex + 1}.`));
    const main = el("span", "npu-rj-course-main");
    if (course) {
      main.appendChild(el("span", "npu-rj-code", courseLabel(course)));
      const when = slotText(course);
      if (when) {
        main.appendChild(el("span", "npu-rj-slot npu-rj-muted", when));
      }
      const seat = registrationData.seatState(course);
      if (seat) {
        main.appendChild(el("span", "npu-rj-seat", SEAT_TEXT[seat])).setAttribute("data-seat", seat);
      }
    } else {
      main.appendChild(
        el(
          "span",
          "npu-rj-muted",
          state.courseLoadErrors.has(subject.subjectId) ? "A kurzusadat nem tölthető be." : "Kurzusadat betöltése…"
        )
      );
    }
    row.appendChild(main);

    const tools = el("span", "npu-rj-tools");
    const keyBase = `subject-${subject.subjectId}-group-${groupIndex}-${courseIndex}`;
    const up = iconButton("▲", "Előrébb", `${keyBase}-up`);
    up.disabled = state.running || courseIndex === 0;
    // `group` may be a pruned copy (see renderSubjectRow), so the move goes through
    // the plan itself, by course id.
    up.addEventListener("click", () => {
      state.plan = swapCourses(state.plan, subject.subjectId, courseId, group.ranking[courseIndex - 1]);
      persistPlan(state);
      render(state);
    });
    const down = iconButton("▼", "Hátrébb", `${keyBase}-down`);
    down.disabled = state.running || courseIndex === group.ranking.length - 1;
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

// Null when the planner is closed, so a user who closes it mid-run stops seeing
// updates rather than breaking the run.
function dialogQuery(state, selector) {
  return state.dialog ? state.dialog.content.querySelector(selector) : null;
}

module.exports = {
  buildLauncher,
  persistPlan,
  openPlanner,
  render,
  loadPeriods,
  loadPlannedCourses,
  selectedPeriod,
  planTermId,
  dialogQuery,
};
