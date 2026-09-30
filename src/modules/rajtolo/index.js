// Rajtoló: a saved, ranked course plan and a dialog to click through it. One click
// registers one subject with the same two requests a registration by hand makes: a
// fresh course list and a SubjectSignin. It never registers by itself: no timer, no
// background watching, no resend of the same course.
//
// This file holds only the wiring: the shared state, the interceptor handlers that
// feed it, and mounting. The parts live next door -
//   plan.js      the plan's data and every pure transformation of it
//   protocol.js  which courses a click sends, and what Neptun's answers mean
//   engine.js    one click, with its requests injected
//   net.js       this module's own authenticated requests
//   ui.js        the dialog
//   rows.js      the switch and the badge on the page
//   suggest.js   the timetable suggestions
const interceptor = require("../../interceptor");
const router = require("../../router");
const storage = require("../../storage");
const utils = require("../../utils");
const devlog = require("../../devlog");
const { showToast } = require("../../toast");
const { ROUTE, FILTER_BUTTON_ID, LAUNCHER_ID } = require("./constants");
const { SUBJECTS_ENDPOINT, COURSES_ENDPOINT, CREDITS_ENDPOINT } = require("./constants");
const plan = require("./plan");
const protocol = require("./protocol");
const engine = require("./engine");
const { liveGet, livePost, withRenewal, freshenAuth } = require("./net");
const ui = require("./ui");
const rows = require("./rows");
const suggest = require("./suggest");
const settings = require("../../settings");
const registrationData = require("../../registrationData");
const { termIdFromUrl } = require("../creditBreakdown");

const { collectSubjects, collectCourses, registeredCredits, emptyPlan, loadPlan } = plan;
const { outcomeText, outcomeTone, DONE } = protocol;
const { render, openPlanner, buildLauncher } = ui;
const { decorateCourseRows, decorateSubjectRows, rememberSubjectFromUrl } = rows;

// Shown in the settings panel; `id` is also the key the switch is stored under.
const meta = {
  id: "rajtolo",
  group: "rajtolo",
  name: "Rajtoló",
  where: "Tárgyak › Tárgyfelvétel: „Rajtoló” gomb a szűrők mellett, „Rajtolóhoz” kapcsoló a kurzusoknál",
  description:
    "Mentett kurzussorrend tartalékkurzusokkal. Az ablakában egy kattintás egy tárgy: friss kurzuslista, és felvétel a sorrended szerinti szabad kurzusokkal. Magától semmit nem küld el.",
  // Only the credit forecast needs this.
  needs: [
    {
      capability: "scheduledSubjects",
      to: "a kredit-előrejelzéshez",
    },
  ],
  options: [
    {
      id: "suggestions",
      name: "Órarendjavaslatok",
      where: "Tárgyak › Tárgyfelvétel: a lap alján nyíló Órarendtervező fejlécében, „Javaslatok” gomb",
      description:
        "„Javaslatok” gomb a Neptun Órarendtervezőjében: ütközésmentes kurzusválasztást keres a felvett órák mellé (kevesebb lyukas óra, több szabad nap vagy legkevesebb csere), előnézetben megmutatja a heti rácson, és kérésre átrendezi a Rajtoló sorrendjét. Megerősítés után a Neptun Tervezőjében is a javasolt kurzusokra cseréli a tervezetteket.",
      defaultEnabled: true,
    },
  ],
};

function shouldActivate() {
  return true;
}

// Two lifetimes, hence two functions.
//
// The state, its handlers and its observer must exist exactly ONCE per page load:
// registering them twice gives two independent states, each repainting the row switch
// from its own copy of the plan - the switch flickered dozens of times per click.
//
// The launcher BUTTON has the opposite lifetime: Angular owns the toolbar and throws
// it away on every route change, so it must be re-insertable. Sharing one latch meant
// the button was gone after navigating away and back, until a full reload.
let plannerState = null;

function ensureState() {
  if (plannerState) {
    return plannerState;
  }
  const created = {
    // Null while the dialog is closed; rendering is skipped then.
    dialog: null,
    plan: emptyPlan(null),
    subjectCatalog: new Map(),
    courseCatalog: new Map(),
    statusText: "",
    // The click in progress (one at a time), its step, and each subject's last result.
    busySubjectId: null,
    stepText: "",
    flowToken: 0,
    subjectStatus: new Map(),
    // Which <details> the student opened, so a rebuild keeps them open.
    openDetails: new Set(),
    nextFocus: null,
    catalogTermId: null,
    // The numeric request.termId of the last subject list: an empty list names no
    // term GUID, so only this shows that the page moved to another term.
    catalogRequestTermId: null,
    planLoadedForIdentity: null,
    // Null until a response has been seen; this module never issues that request
    // itself, only rides creditBreakdown's.
    registeredCredits: null,
    registeredCreditsTermId: null,
    onRegister: subjectId => onRegister(plannerState, subjectId),
  };
  // Claimed before a single handler is registered: a second ensureState() must find
  // it already set.
  plannerState = created;

  function resetForTerm(state, termId) {
    // A click in flight belongs to the old term or user: its result is dropped.
    state.flowToken++;
    state.busySubjectId = null;
    state.stepText = "";
    state.subjectStatus = new Map();
    state.catalogTermId = termId || null;
    state.plan = emptyPlan(termId);
    state.planLoadedForIdentity = null;
    state.subjectCatalog = new Map();
    state.courseCatalog = new Map();
  }

  function adoptStoredPlan(state, termId) {
    const identity = utils.getNeptunCode();
    if (!termId || !identity || state.plan.subjects.length > 0 || state.planLoadedForIdentity === identity) {
      return;
    }
    storage
      .whenReady()
      .then(() => {
        if (
          utils.getNeptunCode() !== identity ||
          state.plan.subjects.length > 0 ||
          state.planLoadedForIdentity === identity
        ) {
          return;
        }
        state.plan = loadPlan(termId);
        state.planLoadedForIdentity = identity;
        render(state);
      })
      .catch(() => {
        // No persisted plan is safer than guessing that storage is ready.
      });
  }

  utils.onNeptunCodeChange((code, previous) => {
    if (!plannerState) {
      return;
    }
    if (!code || (previous && previous !== code)) {
      resetForTerm(plannerState, null);
      // Another user's credits: "not loaded yet" until their own answer.
      plannerState.registeredCredits = null;
      plannerState.statusText = code
        ? "Új felhasználó érzékelve; a terv újratöltése folyamatban."
        : "A munkamenet lejárt; a terv törölve a memóriából.";
    } else if (code) {
      // Initial identity capture can race the subject response. Keep that page's
      // catalogue, but never carry a pre-identity plan into the identified user.
      plannerState.plan = emptyPlan(plannerState.catalogTermId);
      plannerState.planLoadedForIdentity = null;
      const first = plannerState.subjectCatalog.values().next().value;
      adoptStoredPlan(plannerState, (first && first.termId) || plannerState.catalogTermId);
    }
    render(plannerState);
  });

  interceptor.onResponse(CREDITS_ENDPOINT, (json, info) => {
    if (!registrationData.isSuccessfulCollection(json, info && info.status)) {
      return;
    }
    plannerState.registeredCredits = registeredCredits(json);
    // Kept with its term: this can answer before the new term's subject list does.
    plannerState.registeredCreditsTermId = termIdFromUrl(info && info.url);
    render(plannerState);
  });
  interceptor.onResponse(SUBJECTS_ENDPOINT, (json, info) => {
    if (!registrationData.isSuccessfulCollection(json, info && info.status)) {
      return;
    }
    const incoming = Array.isArray(json && json.data)
      ? json.data.find(row => row && typeof row.termId === "string" && row.termId)
      : null;
    const requestTermId = termIdFromUrl(info && info.url);
    const movedToEmptyTerm =
      !incoming &&
      requestTermId &&
      plannerState.catalogRequestTermId &&
      requestTermId !== plannerState.catalogRequestTermId;
    plannerState.catalogRequestTermId = requestTermId || plannerState.catalogRequestTermId;
    if (incoming && plannerState.catalogTermId && plannerState.catalogTermId !== incoming.termId) {
      resetForTerm(plannerState, incoming.termId);
    } else if (movedToEmptyTerm) {
      // Otherwise the previous term's plan would stay usable on a term with no subjects.
      resetForTerm(plannerState, null);
    } else if (incoming && !plannerState.catalogTermId) {
      plannerState.catalogTermId = incoming.termId;
    }
    plannerState.subjectCatalog = collectSubjects(json, plannerState.subjectCatalog);
    const first = plannerState.subjectCatalog.values().next().value;
    // Only adopt the stored plan while ours is untouched: a later refresh would
    // overwrite what the user just picked.
    if (first && plannerState.plan.subjects.length === 0) {
      adoptStoredPlan(plannerState, first.termId);
    }
    render(plannerState);
  });
  interceptor.onResponse(COURSES_ENDPOINT, (json, info) => {
    if (!registrationData.isSuccessfulCollection(json, info && info.status)) {
      return;
    }
    const incoming = Array.isArray(json && json.data)
      ? json.data.find(row => row && typeof row.termId === "string" && row.termId)
      : null;
    if (incoming && plannerState.catalogTermId && plannerState.catalogTermId !== incoming.termId) {
      resetForTerm(plannerState, incoming.termId);
    } else if (incoming && !plannerState.catalogTermId) {
      plannerState.catalogTermId = incoming.termId;
    }
    plannerState.courseCatalog = collectCourses(json, plannerState.courseCatalog);
    // The URL carries the subject's four ids, so the row switch does not depend on the
    // subject also being in the SchedulableSubjects catalogue.
    rememberSubjectFromUrl(plannerState, info && info.url);
    decorateCourseRows(plannerState);
    decorateSubjectRows(plannerState);
    render(plannerState);
  });
  // Rows are re-rendered as subjects expand and collapse, so the switches have to be
  // re-attached on any DOM change. decorateCourseRows is a no-op once a row carries
  // one, which keeps this from retriggering itself.
  let pending = false;
  new MutationObserver(() => {
    if (pending) {
      return;
    }
    pending = true;
    setTimeout(() => {
      pending = false;
      if (location.pathname === ROUTE) {
        decorateCourseRows(plannerState);
        decorateSubjectRows(plannerState);
      }
    }, 0);
  }).observe(document.documentElement, { childList: true, subtree: true });

  return plannerState;
}

// The first subject after `subject` still waiting for its click.
function nextPending(state, subject) {
  const index = state.plan.subjects.indexOf(subject);
  return state.plan.subjects.slice(index + 1).find(item => {
    const outcome = state.subjectStatus.get(item.subjectId);
    const record = state.subjectCatalog.get(item.subjectId);
    return !(outcome && DONE.includes(outcome.kind)) && !(record && record.isRegistered) && item.groups.length > 0;
  });
}

// Neptun renews its token only on its own request; ours would go out on a dead one.
function tokenExpired() {
  const timing = interceptor.getAuthTiming();
  return (
    !interceptor.getAuthHeader() ||
    (Boolean(timing) && typeof timing.expiresAtMs === "number" && timing.expiresAtMs <= Date.now())
  );
}

// One click, one subject. Only one at a time: Neptun forbids parallel registrations.
async function onRegister(state, subjectId, run = engine.registerSubject) {
  const subject = state.plan.subjects.find(item => item.subjectId === subjectId);
  if (state.busySubjectId || !subject) {
    return;
  }
  const token = ++state.flowToken;
  const identity = utils.getNeptunCode();
  const gone = () => state.flowToken !== token || location.pathname !== ROUTE || utils.getNeptunCode() !== identity;
  // By plan position, not by name: the log may end up in a bug report.
  const position = state.plan.subjects.indexOf(subject) + 1;
  state.busySubjectId = subjectId;
  state.stepText = "";
  state.subjectStatus.delete(subjectId);
  render(state);
  devlog.log("rajtolo", `felvétel: #${position}`);
  // An expired token is renewed first, through Neptun's own search button, and a 401
  // gets one renewal and one resend, as Neptun's own client does.
  const session = { needsRenewal: tokenExpired, renew: freshenAuth, shouldContinue: () => !gone() };
  let outcome;
  try {
    outcome = await run(subject, state, {
      get: withRenewal(liveGet, session),
      post: withRenewal(livePost, session),
      report: text => {
        if (!gone()) {
          state.stepText = text;
          render(state);
        }
      },
      stopped: gone,
    });
  } catch (error) {
    devlog.error("rajtolo felvétel", error);
    outcome = { kind: "failed", message: "Váratlan hiba; nézd meg a Neptunban." };
  }
  if (state.flowToken !== token) {
    return;
  }
  state.busySubjectId = null;
  state.stepText = "";
  state.subjectStatus.set(subjectId, outcome);
  devlog.log("rajtolo", `felvétel: #${position} ${outcome.kind}`);
  const next = DONE.includes(outcome.kind) ? nextPending(state, subject) : subject;
  state.nextFocus = next ? `go-${next.subjectId}` : null;
  if (!state.dialog) {
    showToast(
      `${subject.title || subject.code || "Ismeretlen tárgy"}: ${outcomeText(outcome)}`,
      outcomeTone(outcome.kind)
    );
  }
  render(state);
}

// Re-inserted whenever Angular gives us a toolbar. Idempotent, so the observer can
// call it on every DOM change.
function mount() {
  const filterButton = document.getElementById(FILTER_BUTTON_ID);
  if (!filterButton || !filterButton.parentElement || document.getElementById(LAUNCHER_ID)) {
    return;
  }
  try {
    ensureState();
    const launcher = buildLauncher(filterButton);
    launcher.addEventListener("click", () => {
      if (plannerState.dialog) {
        plannerState.dialog.close();
        return;
      }
      openPlanner(plannerState);
    });
    // Keep the add-on action beside the native search action. Appending after it
    // makes both custom controls wrap into a second, visually detached toolbar row.
    filterButton.parentElement.insertBefore(launcher, filterButton);

    render(plannerState);
  } catch (e) {
    // fail quietly: no launcher, never a throw inside Angular's rendering.
  }
}

function initialize() {
  let scheduled = false;
  const suggestions = settings.isOptionEnabled(
    { meta },
    meta.options.find(option => option.id === "suggestions"),
    settings.readFlags()
  );
  // The suggestions read the planner through it; the modules that otherwise install
  // it can all be switched off. Idempotent.
  if (suggestions) {
    registrationData.install();
  }
  function tick() {
    scheduled = false;
    if (location.pathname !== ROUTE) {
      return;
    }
    mount();
    if (suggestions && plannerState) {
      suggest.mount(plannerState);
    }
  }
  function scheduleTick() {
    if (scheduled) {
      return;
    }
    scheduled = true;
    setTimeout(tick, 0);
  }
  // Router-gated plus an observer: the filter button can arrive after a direct load
  // just as easily as after an in-app navigation.
  router.onChange(scheduleTick);
  new MutationObserver(scheduleTick).observe(document.documentElement, { childList: true, subtree: true });
  scheduleTick();
}

module.exports = {
  meta,
  shouldActivate,
  initialize,
  onRegister,
  // pure logic, re-exported so selfcheck.js has one entry point
  collectSubjects: plan.collectSubjects,
  collectCourses: plan.collectCourses,
  registeredCredits: plan.registeredCredits,
  plannedCredits: plan.plannedCredits,
  mergeCredits: plan.mergeCredits,
  totalCredits: plan.totalCredits,
  toMinutes: plan.toMinutes,
  slotsOverlap: plan.slotsOverlap,
  findPlanConflicts: plan.findPlanConflicts,
  emptyPlan: plan.emptyPlan,
  addSubject: plan.addSubject,
  removeSubject: plan.removeSubject,
  pruneGroups: plan.pruneGroups,
  toggleCourseInPlan: plan.toggleCourseInPlan,
  isCourseInPlan: plan.isCourseInPlan,
  moveUp: plan.moveUp,
  moveDown: plan.moveDown,
  swapCourses: plan.swapCourses,
  plannedCount: rows.plannedCount,
  subjectCodeIn: rows.subjectCodeIn,
  pickCourse: protocol.pickCourse,
  preselection: protocol.preselection,
  signinOutcome: protocol.signinOutcome,
  outcomeText: protocol.outcomeText,
  wallClockToEpoch: protocol.wallClockToEpoch,
  courseLabel: protocol.courseLabel,
  planTargets: suggest.planTargets,
  solverInput: suggest.solverInput,
  applyVariant: suggest.applyVariant,
  ghostBox: suggest.ghostBox,
};
