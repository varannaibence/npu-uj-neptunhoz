// The run itself. Every network and timing effect arrives through `deps`, so the
// whole engine - including "Stop actually stops" - is testable with fakes.
const interceptor = require("../../interceptor");
const { collectCourses } = require("./plan");
const {
  classifyResponse,
  validateCourseList,
  chooseCombination,
  holdsRankedCourse,
  submissionOutcome,
  msUntilTarget,
  sessionChore,
  tokenExpired,
} = require("./protocol");
const { liveGet, livePost, liveDelay, freshenAuth } = require("./net");
const {
  MAX_ATTEMPTS,
  STATUS_KEY,
  PREFETCH_LEAD_MS,
  PREFETCH_MIN_MS,
  NOT_OPEN_PAUSE_MS,
  NOT_OPEN_WINDOW_MS,
  WATCH_PAUSE_MS,
} = require("./constants");

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
// `prefetched` is the course list read just before the opening, when nothing could
// change it yet: the first attempt posts straight from it. A submission is only sent
// here; runPlan reads back what it did once every subject has had its turn.
async function runSubject(subject, deps, prefetched) {
  if (!subject.groups || subject.groups.length === 0) {
    return { kind: "unconfigured" };
  }
  const excluded = new Set();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (deps.controller.stopped) {
      return { kind: "stopped" };
    }
    const coursesBody = attempt === 0 && prefetched ? prefetched : await deps.get(subject);
    if (isHalted(coursesBody)) {
      return { kind: "stopped" };
    }
    const catalog = validateCourseList(coursesBody);
    if (catalog.kind !== "ok") {
      return catalog;
    }
    const courseIndex = collectCourses(coursesBody).get(subject.subjectId) || new Map();
    if (holdsRankedCourse(subject.groups, courseIndex)) {
      return { kind: "held" };
    }
    const courseIds = chooseCombination(subject.groups, courseIndex, excluded, deps.waitlistMode);
    if (!courseIds) {
      return { kind: "exhausted" };
    }
    if (deps.controller.stopped) {
      return { kind: "stopped" };
    }
    let body = await deps.post(subject, courseIds);
    // Not open yet, right at the start: that answer is measured and processed nothing,
    // so the same POST goes again at once - one at a time, within a bounded window.
    while (
      !isHalted(body) &&
      typeof deps.notOpenUntil === "number" &&
      deps.now() < deps.notOpenUntil &&
      classifyResponse(body).kind === "notOpen"
    ) {
      await deps.pause(NOT_OPEN_PAUSE_MS);
      if (deps.controller.stopped) {
        return { kind: "stopped" };
      }
      body = await deps.post(subject, courseIds);
    }
    if (isHalted(body)) {
      return { kind: "stopped" };
    }
    const result = classifyResponse(body);
    if (result.kind === "submitted") {
      return { kind: "submitted", courseIds };
    }
    if (result.kind === "requirement" || result.kind === "unknown" || result.kind === "notOpen") {
      return result;
    }
    // "full": next-ranked combination, if attempts remain (bounded). Unreachable on
    // purpose until a real "full" rejection is measured: classifyResponse has no such
    // kind yet, so one reads as "unknown" and halts the run (invariant 4).
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
// subject. Stop is checked at every loop boundary, including inside runSubject. The
// next subject goes out as soon as the previous one is answered: still one request at
// a time, but no pause and no read-back in between, since the first seconds after
// opening decide. The read-backs follow once everything is sent, then the watch.
async function runPlan(plan, deps) {
  const outcomes = [];
  const watch = typeof deps.watchUntil === "number";
  let halted = false;
  for (const subject of plan.subjects) {
    if (deps.controller.stopped) {
      outcomes.push({ subject, kind: "stopped" });
      break;
    }
    deps.onEvent(subject, "running");
    const outcome = Object.assign(
      { subject },
      await runSubject(subject, deps, deps.prefetched && deps.prefetched.get(subject.subjectId))
    );
    outcomes.push(outcome);
    const shown = outcome.kind === "submitted" ? "sent" : outcome.kind === "exhausted" && watch ? "watching" : null;
    deps.onEvent(subject, shown || outcome.kind, outcome.message);
    // Registration being shut is not about this subject, so there is no point
    // walking the rest of the queue into the same wall.
    if (outcome.kind === "unknown" || outcome.kind === "notOpen") {
      halted = true;
      break;
    }
    if (deps.controller.stopped) {
      break;
    }
  }
  for (const outcome of outcomes) {
    if (outcome.kind === "submitted") {
      await readBack(outcome, deps);
    }
  }
  if (watch && !halted) {
    await watchFull(outcomes, deps);
  }
  return outcomes;
}

async function readBack(outcome, deps) {
  outcome.kind = (await verifySubmission(outcome.subject, outcome.courseIds, deps)).kind;
  deps.onEvent(outcome.subject, outcome.kind);
}

// Subjects whose every ranked course was full are read again round after round, one
// request at a time, and sent the moment a seat shows up, until the chosen minutes run
// out or Stop. The same runSubject as at the opening, so every answer is classified
// the same way, and an unknown one still halts everything.
async function watchFull(outcomes, deps) {
  const watching = () => outcomes.filter(outcome => outcome.kind === "exhausted");
  let halted = false;
  while (!halted && watching().length > 0 && deps.now() < deps.watchUntil && !deps.controller.stopped) {
    await deps.pause(WATCH_PAUSE_MS);
    for (const outcome of watching()) {
      if (deps.controller.stopped) {
        break;
      }
      const next = await runSubject(outcome.subject, deps);
      if (next.kind === "exhausted" || next.kind === "stopped") {
        continue;
      }
      Object.assign(outcome, next);
      if (next.kind === "submitted") {
        await readBack(outcome, deps);
      } else {
        deps.onEvent(outcome.subject, next.kind, next.message);
      }
      if (next.kind === "unknown" || next.kind === "notOpen") {
        halted = true;
        break;
      }
    }
  }
  watching().forEach(outcome => deps.onEvent(outcome.subject, "exhausted"));
}

// `stopped`: the run was stopped, so it did not finish even when every outcome reads
// as done - a Stop during a submission's check leaves no "stopped" entry.
function summarize(outcomes, stopped) {
  const count = kind => outcomes.filter(o => o.kind === kind).length;
  if (outcomes.some(o => o.kind === "notOpen")) {
    return "A tárgyjelentkezési időszak még nincs nyitva. Ha közben kinyit, vedd fel a tárgyakat kézzel.";
  }
  const registered = count("registered");
  const waitlisted = count("waitlisted");
  const sent = count("submitted") + registered + waitlisted;
  const details = [registered ? `${registered} felvéve` : "", waitlisted ? `${waitlisted} várólistán` : ""].filter(
    Boolean
  );
  const sentText = `${sent}/${outcomes.length} tárgy beküldve${details.length ? `, ebből ${details.join(", ")}` : ""}`;
  const haltedByUnknown = outcomes.some(o => o.kind === "unknown");
  if (haltedByUnknown) {
    return `Leállt ismeretlen hiba miatt (${sentText}). A hiányzó tárgyakat vedd fel kézzel a Neptunban.`;
  }
  return stopped || outcomes.some(o => o.kind === "stopped")
    ? `Leállítva (${sentText}; ellenőrizd a Neptunban).`
    : `Kész: ${sentText}; ellenőrizd a Neptunban.`;
}

function createController() {
  // `timer` is the display tick, `startTimer` the one that actually begins the run.
  const controller = { stopped: false, timer: null, startTimer: null, prefetchTimer: null };
  controller.stop = function stop() {
    controller.stopped = true;
    ["timer", "startTimer", "prefetchTimer"].forEach(key => {
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
// mostly repaints the countdown; being throttled costs nothing there. If the server
// offset moved while waiting, the start timer fires early and simply re-arms once -
// or, when the target turns out to be sooner, the tick starts the run itself.
//
// An institution opening a moment late answers with the measured "not open yet",
// which runSubject resends for a bounded window. Every other answer is classified for
// real, so firing early or late fails safe rather than looping.
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

  // A long run outlives the 5-minute token; renew it before a request would bounce.
  const session = {
    // No header at all is a token a 401 has just retired.
    needsRenewal: () => !interceptor.getAuthHeader() || tokenExpired(interceptor.getAuthTiming(), Date.now()),
    renew: freshenAuth,
    // Stop - pressed by the user or by a user switch - is honoured after every wait.
    shouldContinue: () => !controller.stopped,
  };
  const fresh = request => withRenewal(request, session);
  const get = fresh(liveGet);

  // Read ahead: until the opening nothing can change a course list, so each subject's
  // is read PREFETCH_LEAD_MS early, one at a time, and the opening costs it only its
  // POST. The start waits out the one read in flight rather than overlapping it.
  const prefetched = new Map();
  let prefetching = Promise.resolve();
  function prefetchLater() {
    controller.prefetchTimer = null;
    if (controller.stopped || started) {
      return;
    }
    const wait = waitNow() - PREFETCH_LEAD_MS;
    if (wait > 1000) {
      controller.prefetchTimer = setTimeout(prefetchLater, startTimeout(wait));
      return;
    }
    prefetching = (async () => {
      for (const subject of plan.subjects) {
        if (controller.stopped || started) {
          return;
        }
        const body = await get(subject);
        if (validateCourseList(body).kind === "ok") {
          prefetched.set(subject.subjectId, body);
        }
      }
    })().catch(() => {});
    // Those reads also sampled the server clock: aim the start with the fresh offset.
    prefetching.then(() => {
      if (!started && !controller.stopped) {
        clearTimeout(controller.startTimer);
        armStart();
      }
    });
  }

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
    } else if (!started && controller.startTimer !== null) {
      clearTimeout(controller.startTimer);
      controller.startTimer = null;
      begin();
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
    const startedAt = Date.now();
    const deps = {
      get,
      post: fresh(livePost),
      delay: liveDelay(plan.delaySeconds),
      waitlistMode: plan.waitlistMode,
      prefetched,
      now: Date.now,
      pause: ms => new Promise(resolve => setTimeout(resolve, ms)),
      notOpenUntil: startedAt + NOT_OPEN_WINDOW_MS,
      watchUntil: plan.watchMinutes > 0 ? startedAt + plan.watchMinutes * 60 * 1000 : undefined,
      onEvent: callbacks.onEvent,
      controller,
    };
    prefetching
      .then(() => runPlan(plan, deps))
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
  if (waitNow() > PREFETCH_MIN_MS) {
    prefetchLater();
  }
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
// never sent again (CLAUDE.md invariant 6). A renewal can take seconds, so Stop is
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
