// The planner dialog and everything drawn inside it.
const utils = require("../../utils");
const modal = require("../../modal");
const interceptor = require("../../interceptor");
const tokens = require("../../neptunTokens");
const { LAUNCHER_ID, PLANNER_ID, DEFAULT_DELAY_SECONDS } = require("./constants");
const plan = require("./plan");
const {
  chooseCombination,
  msUntilTarget,
  wallClockToEpoch,
  isNeptunTimeZone,
  defaultPeriod,
  formatCountdown,
  statusLabel,
  courseLabel,
} = require("./protocol");
const { liveGet, liveGetPeriods } = require("./net");

let smallButtonCssInjected = false;

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

function persistPlan(state) {
  savePlan(state.plan).then(saved => {
    if (!saved) {
      state.statusText = "A Rajtoló terve nem menthető. Jelentkezz be újra, majd próbáld ismét.";
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

// The small row-level controls. Built from `var(--…)` with the measured value as a
// fallback, not cloned: a full-size primary button in a table row would be shouting.
function smallButton(label, title) {
  if (!smallButtonCssInjected) {
    smallButtonCssInjected = true;
    utils.injectCss(
      `[data-npu-rajtolo-small-button]{cursor:pointer;}` +
        `[data-npu-rajtolo-small-button]:focus-visible{outline:2px solid ${tokens.focus};outline-offset:2px;}` +
        `[data-npu-rajtolo-small-button]:disabled{opacity:.55;cursor:not-allowed;}`
    );
  }
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.setAttribute("data-npu-rajtolo-small-button", "");
  button.setAttribute("aria-label", title || label);
  if (title) {
    button.title = title;
  }
  // The dialog's own control hairline: a pale surface border is too faint, which
  // made these read as bare text rather than controls.
  button.style.cssText =
    `background:${tokens.surface};` +
    `color:${tokens.text};` +
    `border:1px solid rgba(33,48,85,.3);border:1px solid color-mix(in srgb, ${tokens.text} 30%, transparent);` +
    "border-radius:8px;" +
    "min-height:36px;padding:6px 12px;margin-left:4px;font:inherit;font-size:13px;";
  return button;
}

// Shown every time the planner opens. The script cannot log the user in, and a
// scheduler implying "set it and forget it" would lie about the one thing that
// decides whether it works.
function buildSessionNotice() {
  const notice = document.createElement("p");
  notice.style.cssText =
    "margin:0 0 20px;padding:12px 16px;border-radius:12px;font-size:14px;line-height:1.45;" +
    `background:${tokens.subtleSurface};` +
    `color:${tokens.text};`;
  notice.textContent =
    "A kétfaktoros hitelesítés miatt a szkript nem tud helyetted bejelentkezni. Legyél bejelentkezve, ezen az " +
    "oldalon, pár perccel a nyitás előtt - a Rajtoló csak addig működik, amíg a munkameneted él. " +
    "Az ablak bezárása a folyamatban lévő futást leállítja.";
  return notice;
}

function buildResponsibilityNotice() {
  const notice = document.createElement("p");
  notice.style.cssText =
    "margin:-8px 0 20px;padding:10px 16px;border-left:3px solid rgba(242,153,74,.75);" +
    `font-size:13px;line-height:1.45;color:${tokens.text};`;
  notice.textContent =
    "A Rajtoló nem hivatalos Neptun-funkció. Csak az intézményi szabályzatot betartva használd, saját felelősségre; " +
    "a jelentkezések eredményét mindig ellenőrizd a Neptunban. A beküldés önmagában nem jelent felvételt.";
  return notice;
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
    return state.courseLoadQueue;
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

// Server-corrected like the start countdown. formatCountdown is only reused while
// there is something to count down to: past the deadline it says "indul…", which
// would be a lie about a window that is over.
function periodClosingText(state) {
  const period = selectedPeriod(state);
  const targetMs = period ? wallClockToEpoch(period.toDate) : NaN;
  if (Number.isNaN(targetMs)) {
    return null;
  }
  const wait = msUntilTarget(targetMs, interceptor.getServerOffsetMs(), Date.now());
  const countdown = wait > 0 ? ` (${formatCountdown(wait)})` : "";
  return `Az időszak zárása: ${period.toDate.replace("T", " ")}${countdown}`;
}

// The single footer action doubles as Start and Stop, relabelled from render(). Its
// handler returns false because the dialog has to stay up to show the run.
function openPlanner(state) {
  state.dialog = modal.open({
    title: "Rajtoló",
    build(content) {
      content.appendChild(buildSessionNotice());
      content.appendChild(buildResponsibilityNotice());
      const body = document.createElement("div");
      body.id = `${PLANNER_ID}-body`;
      content.appendChild(body);
    },
    actions: [
      { label: "Bezár" },
      {
        label: state.running ? "Leállítás" : "Indítás",
        primary: true,
        onClick() {
          state.onStartStop();
          return false;
        },
      },
    ],
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
    const courseIds = chooseCombination(subject.groups, courseIndex, new Set());
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

function formatClock(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
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
  const notice = document.createElement("div");
  notice.style.cssText =
    "margin:0 0 16px;padding:12px 16px;border-radius:12px;font-size:14px;line-height:1.45;" +
    // Amber carries the signal (border + tint); the text is dark navy. Amber on an
    // amber wash is ~2:1 contrast - fine for a border, unreadable as body copy.
    `background:rgba(242,243,251,.14);background:color-mix(in srgb, ${tokens.subtleSurface} 14%, transparent);` +
    `color:${tokens.text};` +
    "border:1px solid rgba(242,153,74,.55);";
  const title = document.createElement("p");
  title.style.cssText = "margin:0 0 6px;font-weight:700;";
  title.textContent = "A jelenlegi választás szerint ütköző időpontok vannak:";
  notice.appendChild(title);
  const list = document.createElement("ul");
  list.style.cssText = "margin:0;padding-left:1.2em;overflow-wrap:anywhere;";
  conflicts.forEach(conflict => {
    const item = document.createElement("li");
    item.textContent = conflictText(conflict);
    list.appendChild(item);
  });
  notice.appendChild(list);
  return notice;
}

// Registered credits and what the plan would add. Information, not a warning, so it
// borrows the understated typography around it rather than a boxed callout. Null
// until a response has been seen: a "0" in that gap would read as "you have zero
// credits" instead of "not loaded yet".
function buildCreditForecast(state) {
  if (!state.registeredCredits) {
    return null;
  }
  const planned = plannedCredits(state.plan, state.subjectCatalog);
  const merged = mergeCredits(state.registeredCredits, planned);
  const currentTotal = totalCredits(state.registeredCredits);
  const plannedTotal = totalCredits(planned);

  const wrapper = document.createElement("div");
  wrapper.style.cssText = `margin:0 0 16px;font-size:13px;line-height:1.5;color:${tokens.text};`;

  const summary = document.createElement("p");
  summary.style.cssText = "margin:0 0 2px;";
  summary.textContent =
    plannedTotal > 0
      ? `Jelenleg ${currentTotal} kredit · a terv +${plannedTotal} → ${totalCredits(merged)}`
      : `Jelenleg ${currentTotal} kredit`;
  wrapper.appendChild(summary);

  if (merged.size > 0) {
    const list = document.createElement("ul");
    list.style.cssText = "margin:0;padding-left:1.2em;opacity:.75;";
    merged.forEach((total, type) => {
      const currentByType = state.registeredCredits.get(type) || 0;
      const plannedByType = planned.get(type) || 0;
      const item = document.createElement("li");
      item.textContent =
        plannedByType > 0 ? `${type}: ${currentByType} +${plannedByType} → ${total}` : `${type}: ${currentByType}`;
      list.appendChild(item);
    });
    wrapper.appendChild(list);
  }

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
  const focusKey = body.contains(activeElement) ? activeElement.getAttribute("data-npu-focus-key") : null;
  body.innerHTML = "";

  // The footer button is the run control; keep its label honest on every repaint.
  const startStop = state.dialog.buttons[state.dialog.buttons.length - 1];
  if (startStop) {
    utils.setButtonLabel(startStop, state.running ? "Leállítás" : "Indítás");
    startStop.setAttribute("aria-pressed", String(state.running));
  }

  // Computed fresh every render from what would actually be submitted right now.
  const conflicts = planConflicts(state);
  if (conflicts.length > 0) {
    body.appendChild(buildConflictWarning(conflicts));
  }

  // Right above the schedule controls it informs.
  const creditForecast = buildCreditForecast(state);
  if (creditForecast) {
    body.appendChild(creditForecast);
  }

  // --- schedule controls ---
  const scheduleRow = document.createElement("div");
  scheduleRow.style.cssText = "display:flex;flex-wrap:wrap;gap:16px;align-items:center;margin-bottom:16px;";

  const startLabel = document.createElement("label");
  // Said only where it matters: to someone whose browser is not on Hungarian time.
  startLabel.textContent = isNeptunTimeZone() ? "Nyitás időpontja: " : "Nyitás időpontja (magyar idő szerint): ";
  const startInput = document.createElement("input");
  startInput.setAttribute("data-npu-focus-key", "start-at");
  startInput.type = "datetime-local";
  startInput.disabled = state.running;
  startInput.value = state.plan.startAt || "";
  startInput.addEventListener("change", () => {
    state.plan.startAt = startInput.value || null;
    persistPlan(state);
  });
  startLabel.appendChild(startInput);
  scheduleRow.appendChild(startLabel);

  // --- Period picker. Lists every period returned, never picking one for the user,
  // plus a button that copies the chosen fromDate into the field above. Fails quiet:
  // while state.periods is null this section simply does not exist. ---
  if (state.periods && state.periods.length > 0) {
    // Keep the highlighted option valid rather than pointing at one that fell out. The
    // first pick is the current or next period: the list's first entry is often one
    // that is long over, and "Nyitás kitöltése" on it scheduled a run for the past.
    if (!state.periods.some(p => p.periodId === state.selectedPeriodId)) {
      const now = Date.now() + (interceptor.getServerOffsetMs() || 0);
      state.selectedPeriodId = defaultPeriod(state.periods, now).periodId;
    }
    const periodSelect = document.createElement("select");
    periodSelect.setAttribute("data-npu-focus-key", "period");
    periodSelect.setAttribute("aria-label", "Tárgyfelvételi időszak");
    periodSelect.disabled = state.running;
    state.periods.forEach(period => {
      const option = document.createElement("option");
      option.value = period.periodId;
      option.textContent = period.label;
      periodSelect.appendChild(option);
    });
    periodSelect.value = state.selectedPeriodId;
    periodSelect.addEventListener("change", () => {
      state.selectedPeriodId = periodSelect.value;
      render(state); // Repaint the closing-time line under the status.
    });
    const fillButton = smallButton("Nyitás kitöltése", "Nyitás időpontjának kitöltése a kiválasztott időszakból");
    fillButton.setAttribute("data-npu-focus-key", "fill-period");
    fillButton.disabled = state.running;
    fillButton.addEventListener("click", () => {
      const period = selectedPeriod(state);
      if (!period) {
        return;
      }
      startInput.value = period.fromDate;
      state.plan.startAt = period.fromDate;
      persistPlan(state);
      render(state);
    });
    scheduleRow.appendChild(periodSelect);
    scheduleRow.appendChild(fillButton);
  } else {
    const periodStatus = document.createElement("span");
    periodStatus.style.cssText = "font-size:13px;opacity:.8;max-width:32rem;";
    periodStatus.textContent =
      state.periodsStatus === "loading"
        ? "Tárgyfelvételi időszakok betöltése…"
        : state.periodsError || "Az időszakok betöltéséhez adj hozzá legalább egy tárgyat.";
    scheduleRow.appendChild(periodStatus);

    const reloadPeriods = smallButton(
      state.periodsStatus === "error" ? "Időszakok újratöltése" : "Időszakok betöltése",
      "Tárgyfelvételi időszakok lekérése a Neptunból"
    );
    reloadPeriods.setAttribute("data-npu-focus-key", "reload-periods");
    reloadPeriods.disabled = state.running || state.periodsStatus === "loading" || !planTermId(state);
    reloadPeriods.addEventListener("click", () => loadPeriods(state, true));
    scheduleRow.appendChild(reloadPeriods);
  }

  const delayLabel = document.createElement("label");
  delayLabel.textContent = "Késleltetés (mp): ";
  const delayInput = document.createElement("input");
  delayInput.setAttribute("data-npu-focus-key", "delay");
  delayInput.type = "number";
  delayInput.min = "1";
  delayInput.step = "0.5";
  delayInput.style.width = "4em";
  delayInput.disabled = state.running;
  delayInput.value = String(state.plan.delaySeconds);
  delayInput.addEventListener("change", () => {
    const value = parseFloat(delayInput.value);
    state.plan.delaySeconds = Number.isFinite(value) && value >= 1 ? value : DEFAULT_DELAY_SECONDS;
    persistPlan(state);
  });
  delayLabel.appendChild(delayInput);
  scheduleRow.appendChild(delayLabel);
  body.appendChild(scheduleRow);

  const statusLine = document.createElement("p");
  statusLine.id = `${PLANNER_ID}-status`;
  statusLine.setAttribute("role", "status");
  statusLine.setAttribute("aria-live", "polite");
  statusLine.style.cssText = `margin:0 0 16px;font-size:14px;min-height:1.4em;color:${tokens.text};`;
  statusLine.textContent = state.statusText || "";
  body.appendChild(statusLine);

  // The selected period's closing time, once one is picked.
  const closingText = periodClosingText(state);
  if (closingText) {
    const closingLine = document.createElement("p");
    closingLine.style.cssText = `margin:-12px 0 16px;font-size:13px;opacity:.75;color:${tokens.text};`;
    closingLine.textContent = closingText;
    body.appendChild(closingLine);
  }

  // --- the priority-ordered plan itself ---
  if (state.plan.subjects.length === 0) {
    const empty = document.createElement("p");
    empty.style.cssText = "margin:8px 0 0;font-size:14px;opacity:.75;line-height:1.45;";
    empty.textContent =
      "Még nincs kurzus a Rajtolóban. Nyisd le a tárgyat a listában, és jelöld be a kiválasztott kurzusokat.";
    body.appendChild(empty);
  } else {
    const list = document.createElement("ol");
    list.style.cssText = "list-style:none;margin:0;padding:0;";
    const conflictNotes = subjectConflictNotes(conflicts);
    state.plan.subjects.forEach((subject, index) => {
      list.appendChild(renderSubjectRow(state, subject, index, conflictNotes.get(subject.subjectId)));
    });
    body.appendChild(list);
  }

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

function renderSubjectRow(state, subject, index, conflictNotes) {
  const item = document.createElement("li");
  // Measured off a native subject panel on this page, so a plan entry sits in the
  // dialog the way a subject sits in the list behind it.
  item.style.cssText =
    `background:${tokens.subtleSurface};border-radius:12px;` + "padding:12px 16px;margin-bottom:8px;";

  const header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;";
  const title = document.createElement("span");
  title.textContent = `${index + 1}. ${subject.title || subject.code || "Ismeretlen tárgy"}`;
  header.appendChild(title);

  const controls = document.createElement("span");
  const up = smallButton("▲", "Előrébb");
  up.setAttribute("data-npu-focus-key", `subject-${subject.subjectId}-up`);
  up.disabled = state.running || index === 0;
  up.addEventListener("click", () => {
    state.plan.subjects = moveUp(state.plan.subjects, index);
    persistPlan(state);
    render(state);
  });
  const down = smallButton("▼", "Hátrébb");
  down.setAttribute("data-npu-focus-key", `subject-${subject.subjectId}-down`);
  down.disabled = state.running || index === state.plan.subjects.length - 1;
  down.addEventListener("click", () => {
    state.plan.subjects = moveDown(state.plan.subjects, index);
    persistPlan(state);
    render(state);
  });
  const remove = smallButton("Törlés");
  remove.setAttribute("data-npu-focus-key", `subject-${subject.subjectId}-remove`);
  remove.disabled = state.running;
  remove.addEventListener("click", () => {
    state.plan = removeSubject(state.plan, subject.subjectId);
    persistPlan(state);
    render(state);
  });
  controls.appendChild(up);
  controls.appendChild(down);
  controls.appendChild(remove);
  header.appendChild(controls);
  item.appendChild(header);

  const status = document.createElement("div");
  status.setAttribute("data-npu-subject-status", subject.subjectId);
  status.style.cssText = "font-size:.85em;opacity:.8;margin-top:2px;";
  status.textContent = statusLabel(state.subjectStatus.get(subject.subjectId) || "idle");
  item.appendChild(status);

  // Marks the row when the course it would submit clashes with another subject's.
  // Short by design: the full pair is in the warning box above.
  if (conflictNotes && conflictNotes.length > 0) {
    const warn = document.createElement("div");
    // Amber is a chip behind dark text, never the text colour.
    warn.style.cssText =
      "font-size:.85em;font-weight:600;margin-top:4px;display:inline-block;" +
      "padding:2px 8px;border-radius:12px;background:rgba(242,153,74,.18);max-width:100%;" +
      "overflow-wrap:anywhere;box-sizing:border-box;" +
      `color:${tokens.text};`;
    warn.textContent = `⚠ ${conflictNotes.join("; ")}`;
    item.appendChild(warn);
  }

  const coursesBySubject = state.courseCatalog.get(subject.subjectId);
  const groups = coursesBySubject ? pruneGroups(subject.groups, Array.from(coursesBySubject.values())) : subject.groups;
  if (!groups || groups.length === 0) {
    const hint = document.createElement("p");
    hint.style.cssText = "font-size:.8em;opacity:.7;margin:4px 0 0;";
    hint.textContent = "Nyisd le a tárgyat a listában, és jelöld be a kurzusokat a \u201eRajtolóhoz\u201d kapcsolóval.";
    item.appendChild(hint);
  } else {
    groups.forEach((group, groupIndex) => {
      item.appendChild(renderGroup(state, subject, group, coursesBySubject, groupIndex));
    });
  }
  return item;
}

function renderGroup(state, subject, group, coursesBySubject, groupIndex) {
  const wrapper = document.createElement("div");
  wrapper.style.cssText = "margin-top:6px;";
  const label = document.createElement("div");
  label.style.cssText = "font-size:.85em;font-weight:bold;";
  label.textContent = group.type || "Kurzustípus ismeretlen";
  wrapper.appendChild(label);

  const list = document.createElement("ol");
  list.style.cssText = "list-style:decimal;margin:2px 0 0 1.4em;padding:0;font-size:.85em;";
  group.ranking.forEach((courseId, courseIndex) => {
    const course = coursesBySubject && coursesBySubject.get(courseId);
    const row = document.createElement("li");
    const label2 = document.createElement("span");
    label2.textContent = course
      ? courseLabel(course)
      : state.courseLoadErrors.has(subject.subjectId)
        ? "A kurzusadat nem tölthető be."
        : "Kurzusadat betöltése…";
    row.appendChild(label2);
    const up = smallButton("▲", "Előrébb");
    up.setAttribute("data-npu-focus-key", `subject-${subject.subjectId}-group-${groupIndex}-${courseIndex}-up`);
    up.disabled = state.running || courseIndex === 0;
    // `group` may be a pruned copy (see renderSubjectRow), so the move goes through
    // the plan itself, by course id.
    up.addEventListener("click", () => {
      state.plan = swapCourses(state.plan, subject.subjectId, courseId, group.ranking[courseIndex - 1]);
      persistPlan(state);
      render(state);
    });
    const down = smallButton("▼", "Hátrébb");
    down.setAttribute("data-npu-focus-key", `subject-${subject.subjectId}-group-${groupIndex}-${courseIndex}-down`);
    down.disabled = state.running || courseIndex === group.ranking.length - 1;
    down.addEventListener("click", () => {
      state.plan = swapCourses(state.plan, subject.subjectId, courseId, group.ranking[courseIndex + 1]);
      persistPlan(state);
      render(state);
    });
    row.appendChild(up);
    row.appendChild(down);
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
