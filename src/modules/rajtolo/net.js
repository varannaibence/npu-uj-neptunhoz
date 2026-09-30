// The impure edge: this module's own authenticated calls.
const interceptor = require("../../interceptor");
const devlog = require("../../devlog");
const {
  API_BASE,
  COURSES_ENDPOINT,
  SIGNIN_ENDPOINT,
  SCHEDULE_ENDPOINT,
  UNSCHEDULE_ENDPOINT,
  REQUEST_TIMEOUT_MS,
  STATUS_KEY,
  FILTER_BUTTON_ID,
  FRESHEN_TIMEOUT_MS,
} = require("./constants");

// --- Live I/O: a Rajtoló click's course list and registration, and the suggestion
// panel's reads and planner writes. Each is one request the student's click asked
// for; authenticated with interceptor.getAuthHeader(), as infiniteSession is. ---

// What Neptun's own Angular client sends as Accept (its HttpClient default).
const ACCEPT = "application/json, text/plain, */*";

function httpRequest(method, url, body) {
  return new Promise(resolve => {
    const auth = interceptor.getAuthHeader();
    if (!auth) {
      // No header captured means no human session to ride. Fail visibly.
      resolve({ notification: [{ description: "Nincs érzékelt bejelentkezés.", type: 3 }] });
      return;
    }
    try {
      const xhr = new XMLHttpRequest();
      // Ours, not the page's: Neptun's logout countdown does not see it.
      xhr.__npuOwn = true;
      xhr.open(method, url);
      xhr.setRequestHeader("Authorization", auth);
      xhr.setRequestHeader("Accept", ACCEPT);
      if (body) {
        xhr.setRequestHeader("Content-Type", "application/json");
      }
      xhr.addEventListener("load", () => {
        let parsed;
        try {
          parsed = JSON.parse(xhr.responseText);
        } catch (e) {
          resolve({
            notification: [{ description: "Érvénytelen szerverválasz.", type: 3 }],
            [STATUS_KEY]: xhr.status,
          });
          return;
        }
        // The status has to travel with the body: classifyResponse must see a failing
        // status even when the body carries no error it recognises.
        resolve(Object.assign(parsed && typeof parsed === "object" ? parsed : {}, { [STATUS_KEY]: xhr.status }));
      });
      xhr.addEventListener("error", () => {
        resolve({ notification: [{ description: "Hálózati hiba.", type: 3 }] });
      });
      // A timed-out write is never retried: the server may have processed it and
      // simply failed to answer in time.
      xhr.timeout = REQUEST_TIMEOUT_MS;
      xhr.addEventListener("timeout", () => {
        resolve({
          notification: [{ description: "A szerver nem válaszolt időben, az eredmény bizonytalan.", type: 3 }],
        });
      });
      xhr.send(body ? JSON.stringify(body) : null);
    } catch (e) {
      resolve({ notification: [{ description: "Hálózati hiba.", type: 3 }] });
    }
  });
}

function liveGet(subject) {
  const query = new URLSearchParams({
    subjectId: subject.subjectId,
    termId: subject.termId,
    curriculumTemplateId: subject.curriculumTemplateId,
    curriculumTemplateLineId: subject.curriculumTemplateLineId,
  }).toString();
  return httpRequest("GET", `${API_BASE}${COURSES_ENDPOINT}?${query}`);
}

// The same body Neptun's own "Tárgy felvétele" sends (docs/API.md, measured).
function livePost(subject, courseIds) {
  return httpRequest("POST", `${API_BASE}${SIGNIN_ENDPOINT}`, {
    subjectId: subject.subjectId,
    termId: subject.termId,
    curriculumTemplateId: subject.curriculumTemplateId,
    curriculumTemplateLineId: subject.curriculumTemplateLineId,
    courseIds,
  });
}

// Neptun's own planner, the same two calls its "Tervezőhöz adás" switch makes. Only
// the suggestion panel uses them, after the student confirms the list of changes.
function liveSchedule(subject, courseId) {
  return httpRequest("POST", `${API_BASE}${SCHEDULE_ENDPOINT}`, {
    subjectId: subject.subjectId,
    termId: subject.termId,
    curriculumTemplateId: subject.curriculumTemplateId,
    curriculumTemplateLineId: subject.curriculumTemplateLineId,
    courseIds: [courseId],
  });
}

function liveUnschedule(subject, courseId) {
  return httpRequest("POST", `${API_BASE}${UNSCHEDULE_ENDPOINT}`, {
    courseId,
    subjectId: subject.subjectId,
    termId: subject.termId,
  });
}

// Makes Neptun renew its own token rather than calling GetNewTokens ourselves: its
// search button sends a request, and with an expired token the page renews it first
// (measured: GetNewTokens, then the search). True once a new header shows up.
// Single-flight: the suggestion panel and infiniteSession may ask at once, and two
// presses could race two renewals on one refresh cookie. Every caller shares the press
// already in flight.
let pendingFreshen = null;
function freshenAuth() {
  if (!pendingFreshen) {
    const settle = ok => {
      pendingFreshen = null;
      return ok;
    };
    pendingFreshen = pressForRenewal().then(settle, () => settle(false));
  }
  return pendingFreshen;
}

function pressForRenewal() {
  return new Promise(resolve => {
    const button = typeof document !== "undefined" && document.getElementById(FILTER_BUTTON_ID);
    if (!button || button.disabled) {
      devlog.log("auth", "Neptun-frissítés: nincs használható „Tárgy keresése” gomb");
      resolve(false);
      return;
    }
    let off = () => {};
    const timer = setTimeout(() => {
      off();
      devlog.log("auth", "Neptun-frissítés: nem jött új fejléc időben");
      resolve(false);
    }, FRESHEN_TIMEOUT_MS);
    off = interceptor.onAuthChange(auth => {
      if (auth) {
        off();
        clearTimeout(timer);
        devlog.log("auth", "Neptun-frissítés: megjött az új fejléc");
        resolve(true);
      }
    });
    devlog.log("auth", "Neptun-frissítés: „Tárgy keresése” gomb megnyomva");
    button.click();
  });
}

// What a wrapped request answers when the caller gave up while it waited for a
// renewal: it was never sent.
const HALTED = "__npuHalted";
function isHalted(body) {
  return Boolean(body && body[HALTED]);
}

// Wraps a live request: renews a missing or expired token first, and answers a 401
// with one renewal and one resend. That a 401 means nothing was processed is measured
// for the planner calls (docs/API.md). Anything else, a timeout included, comes back
// as it came: a request that may have been processed is never sent again (CLAUDE.md
// invariant 6). A renewal can take seconds, so `shouldContinue` is asked again after
// each one.
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

module.exports = {
  httpRequest,
  liveGet,
  livePost,
  liveSchedule,
  liveUnschedule,
  freshenAuth,
  withRenewal,
  isHalted,
};
