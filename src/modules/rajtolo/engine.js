// The run itself. Every network and timing effect arrives through `deps`, so the
// whole engine - including "Stop actually stops" - is testable with fakes.
const interceptor = require("../../interceptor");
const { collectCourses } = require("./plan");
const {
  classifyResponse,
  validateCourseList,
  chooseCombination,
  submissionOutcome,
  msUntilTarget,
  sessionChore,
  tokenExpired,
} = require("./protocol");
const { liveGet, livePost, liveDelay, freshenAuth } = require("./net");
const { MAX_ATTEMPTS, STATUS_KEY } = require("./constants");

// --- The run engine. Every network and timing effect is injected via `deps`, so the
// whole thing - including "Stop actually stops" - is testable with fakes. ---

// One more read of the same course list right after a submission was answered, so
// the result can say "felvéve" or "várólistán" instead of only "beküldve". Stop is
// respected, since it means no further requests, and a failed or unreadable answer
// never halts the run: the outcome simply stays "submitted".
async function verifySubmission(subject, courseIds, deps) {
  const submitted = { kind: "submitted" };
  if (deps.controller.stopped) {
    return submitted;
  }
  let body;
  try {
    body = await deps.get(subject);
  } catch (e) {
    return submitted;
  }
  if (validateCourseList(body).kind !== "ok") {
    return submitted;
  }
  const courseIndex = collectCourses(body).get(subject.subjectId) || new Map();
  const kind = submissionOutcome(courseIndex, courseIds);
  return kind ? { kind } : submitted;
}

// Compose the best still-available combination, POST, classify, then either stop or
// retry the next-best up to MAX_ATTEMPTS. Never posts a subject with nothing ranked.
async function runSubject(subject, deps) {
  if (!subject.groups || subject.groups.length === 0) {
    return { kind: "unconfigured" };
  }
  const excluded = new Set();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (deps.controller.stopped) {
      return { kind: "stopped" };
    }
    const coursesBody = await deps.get(subject);
    if (isHalted(coursesBody)) {
      return { kind: "stopped" };
    }
    const catalog = validateCourseList(coursesBody);
    if (catalog.kind !== "ok") {
      return catalog;
    }
    const courseIndex = collectCourses(coursesBody).get(subject.subjectId) || new Map();
    const courseIds = chooseCombination(subject.groups, courseIndex, excluded);
    if (!courseIds) {
      return { kind: "exhausted" };
    }
    if (deps.controller.stopped) {
      return { kind: "stopped" };
    }
    const body = await deps.post(subject, courseIds);
    if (isHalted(body)) {
      return { kind: "stopped" };
    }
    const result = classifyResponse(body);
    if (result.kind === "submitted") {
      return verifySubmission(subject, courseIds, deps);
    }
    if (result.kind === "requirement" || result.kind === "unknown" || result.kind === "notOpen") {
      return result;
    }
    // "full": next-ranked combination, if attempts remain (bounded).
    courseIds.forEach(id => excluded.add(id));
    if (attempt < MAX_ATTEMPTS - 1) {
      await deps.delay();
    }
  }
  return { kind: "full" };
}

// Walks the priority-ordered subject list. An "unknown" classification halts the
// ENTIRE run: ploughing on through a response nobody understands is worse than
// stopping and showing the text. Every other terminal state advances to the next
// subject. Stop is checked at every loop boundary, including inside runSubject.
async function runPlan(plan, deps) {
  const outcomes = [];
  for (const subject of plan.subjects) {
    if (deps.controller.stopped) {
      outcomes.push({ subject, kind: "stopped" });
      break;
    }
    deps.onEvent(subject, "running");
    const outcome = await runSubject(subject, deps);
    outcomes.push(Object.assign({ subject }, outcome));
    deps.onEvent(subject, outcome.kind, outcome.message);
    // Registration being shut is not about this subject, so there is no point
    // walking the rest of the queue into the same wall.
    if (outcome.kind === "unknown" || outcome.kind === "notOpen") {
      break;
    }
    if (deps.controller.stopped) {
      break;
    }
    await deps.delay(); // pace between subjects too (sequential, never parallel)
  }
  return outcomes;
}

function summarize(outcomes) {
  const count = kind => outcomes.filter(o => o.kind === kind).length;
  if (outcomes.some(o => o.kind === "notOpen")) {
    return "A tárgyjelentkezési időszak még nincs nyitva.";
  }
  const registered = count("registered");
  const waitlisted = count("waitlisted");
  const sent = count("submitted") + registered + waitlisted;
  const details = [registered ? `${registered} felvéve` : "", waitlisted ? `${waitlisted} várólistán` : ""].filter(
    Boolean
  );
  const sentText = `${sent}/${outcomes.length} tárgy beküldve${details.length ? `, ebből ${details.join(", ")}` : ""}`;
  const haltedByUnknown = outcomes.some(o => o.kind === "unknown");
  return haltedByUnknown
    ? `Leállt ismeretlen hiba miatt (${sentText}; ellenőrizd a Neptunban).`
    : `Kész: ${sentText}; ellenőrizd a Neptunban.`;
}

function createController() {
  // `timer` is the display tick, `startTimer` the one that actually begins the run.
  const controller = { stopped: false, timer: null, startTimer: null };
  controller.stop = function stop() {
    controller.stopped = true;
    ["timer", "startTimer"].forEach(key => {
      if (controller[key] !== null) {
        clearTimeout(controller[key]);
        controller[key] = null;
      }
    });
  };
  return controller;
}

// setTimeout keeps its delay in a signed 32-bit int; anything longer fires at once.
const MAX_TIMEOUT_MS = 2147483647;

// How long the start timer should sleep. Never negative, never past what setTimeout
// can hold: a clamped wait simply re-arms when it fires.
function startTimeout(waitMs) {
  return Math.min(Math.max(0, waitMs), MAX_TIMEOUT_MS);
}

// Schedules against the server-corrected clock. The last seconds are local timer
// checks only: a pre-flight GET here used to fire several duplicate requests before
// the run and added load without improving the server-side decision.
//
// The start is ONE timer armed straight from the click, not the end of a timer chain.
// Chrome runs chained timers in a tab hidden for 5+ minutes only once a minute, so a
// chained countdown could start the run up to a minute late. The chained tick below
// only repaints the countdown; being throttled costs nothing there. If the server
// offset moved while waiting, the start timer fires early and simply re-arms once.
//
// Detecting the ACTUAL opening (an institution can open late) would need a measured
// closed-vs-open response shape, which we do not have. So this does only the safe
// half. The real safety net is downstream: every attempt is classified for real, so
// firing early or late fails safe rather than looping.
function scheduleRun(targetEpochMs, plan, controller, callbacks) {
  let finished = false;
  function finish(outcomes) {
    if (finished) {
      return;
    }
    finished = true;
    if (controller.timer !== null) {
      clearTimeout(controller.timer);
      controller.timer = null;
    }
    callbacks.onDone(outcomes);
  }
  const waitNow = () => msUntilTarget(targetEpochMs, interceptor.getServerOffsetMs(), Date.now());
  // Stop clears the timers, so before the start nothing would ever report back: the
  // status stayed on "Leállítás folyamatban…" for good. Once running, runPlan does.
  let started = false;
  const stop = controller.stop;
  controller.stop = function stopScheduled() {
    stop();
    if (!started) {
      finish([]);
    }
  };

  // Keeps the session alive while armed, and renews the token just before the start.
  let freshening = false;
  let lastFreshenAt = null;
  function keepSession(wait) {
    const now = Date.now();
    if (freshening || !sessionChore(now, wait, interceptor.getAuthTiming(), lastFreshenAt)) {
      return;
    }
    freshening = true;
    lastFreshenAt = now;
    freshenAuth().then(ok => {
      freshening = false;
      if (!finished) {
        callbacks.onSession(ok);
      }
    });
  }

  function tick() {
    controller.timer = null;
    if (controller.stopped) {
      finish([]);
      return;
    }
    const wait = waitNow();
    callbacks.onTick(wait);
    keepSession(wait);
    if (wait > 0) {
      controller.timer = setTimeout(tick, wait > 5000 ? 2000 : 1000);
    }
  }
  function armStart() {
    controller.startTimer = null;
    if (controller.stopped) {
      finish([]);
      return;
    }
    const wait = waitNow();
    if (wait > 0) {
      controller.startTimer = setTimeout(armStart, startTimeout(wait));
      return;
    }
    begin();
  }
  function begin() {
    started = true;
    // A long run outlives the 5-minute token; renew it before a request would bounce.
    const session = {
      // No header at all is a token a 401 has just retired.
      needsRenewal: () => !interceptor.getAuthHeader() || tokenExpired(interceptor.getAuthTiming(), Date.now()),
      renew: freshenAuth,
      // Stop - pressed by the user or by a user switch - is honoured after every wait.
      shouldContinue: () => !controller.stopped,
    };
    const fresh = request => withRenewal(request, session);
    const deps = {
      get: fresh(liveGet),
      post: fresh(livePost),
      delay: liveDelay(plan.delaySeconds),
      onEvent: callbacks.onEvent,
      controller,
    };
    runPlan(plan, deps)
      .then(finish)
      .catch(error => {
        finish([
          {
            kind: "unknown",
            message: error && error.message ? error.message : "Ismeretlen futási hiba.",
          },
        ]);
      });
  }
  tick();
  armStart();
}

// What a wrapped request answers when Stop came while it waited for a renewal: it was
// never sent. The run reads it as "stopped".
const HALTED = "__npuHalted";
function isHalted(body) {
  return Boolean(body && body[HALTED]);
}

// Wraps a live request: renews a missing or expired token first, and answers a 401
// with one renewal and one resend. That a 401 means nothing was processed is an
// inference, not a measurement for SubjectSignin: JWT validation rejects before the
// action runs (measured only for the planner calls, docs/API.md). Anything else, a
// timeout included, comes back as it came: a request that may have been processed is
// never sent again (AGENTS.md invariant 6). A renewal can take seconds, so Stop is
// checked again after each one, and a stopped run sends nothing more.
function withRenewal(request, session) {
  const halted = () => typeof session.shouldContinue === "function" && !session.shouldContinue();
  return async (...args) => {
    if (session.needsRenewal()) {
      await session.renew();
      if (halted()) {
        return { [HALTED]: true };
      }
    }
    const response = await request(...args);
    if (!response || response[STATUS_KEY] !== 401 || !(await session.renew())) {
      return response;
    }
    if (halted()) {
      return { [HALTED]: true };
    }
    return request(...args);
  };
}

module.exports = { runSubject, runPlan, summarize, createController, scheduleRun, startTimeout, withRenewal, isHalted };
