// The impure edge: this module's own authenticated calls.
const interceptor = require("../../interceptor");
const {
  API_BASE,
  COURSES_ENDPOINT,
  SIGNIN_ENDPOINT,
  SCHEDULE_ENDPOINT,
  UNSCHEDULE_ENDPOINT,
  PERIODS_ENDPOINT,
  REQUEST_TIMEOUT_MS,
  DEFAULT_DELAY_SECONDS,
  STATUS_KEY,
  FILTER_BUTTON_ID,
  FRESHEN_TIMEOUT_MS,
} = require("./constants");

// --- Live I/O: the impure edge the engine is injected into. This module originates
// its own authenticated calls, which the usual "ride the app's own requests" rule
// forbids elsewhere, using interceptor.getAuthHeader() as infiniteSession does. ---

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
      // A timed-out POST is the one case that must never be retried: the server may
      // well have processed it and simply failed to answer in time, so a retry could
      // register twice. The message deliberately matches no hint in the classifier,
      // which makes it "unknown" - halt the run and show the text, the same fail-closed
      // path an unrecognised rejection takes.
      xhr.timeout = REQUEST_TIMEOUT_MS;
      xhr.addEventListener("timeout", () => {
        resolve({
          notification: [
            { description: "A szerver nem válaszolt időben. A jelentkezés állapota bizonytalan.", type: 3 },
          ],
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

// The one call made outside a run. Neptun knows the window's exact open/close
// instants, so reading them beats letting the user type the time by hand and risk the
// typo that costs a registration. termId must be the GUID form carried on a subject
// record, not the numeric id other requests use.
function liveGetPeriods(termId) {
  const query = new URLSearchParams({
    "request.termId": termId,
    "sortAndPage.firstRow": "0",
    "sortAndPage.lastRow": "500",
    "sortAndPage.fromDate": "asc",
  }).toString();
  return httpRequest("GET", `${API_BASE}${PERIODS_ENDPOINT}?${query}`);
}

function liveDelay(seconds) {
  const parsed = Number(seconds);
  const safeSeconds = Number.isFinite(parsed) && parsed >= 1 ? parsed : DEFAULT_DELAY_SECONDS;
  const ms = safeSeconds * 1000;
  return () => new Promise(resolve => setTimeout(resolve, ms));
}

// Makes Neptun renew its own token rather than calling GetNewTokens ourselves: its
// search button sends a request, and with an expired token the page renews it first
// (measured: GetNewTokens, then the search). True once a new header shows up.
// Single-flight: the Rajtoló's keep-alive, its pre-start check, the suggestion panel
// and infiniteSession may all ask at once, and two presses could race two renewals
// on one refresh cookie. Every caller shares the press already in flight.
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
      resolve(false);
      return;
    }
    let off = () => {};
    const timer = setTimeout(() => {
      off();
      resolve(false);
    }, FRESHEN_TIMEOUT_MS);
    off = interceptor.onAuthChange(auth => {
      if (auth) {
        off();
        clearTimeout(timer);
        resolve(true);
      }
    });
    button.click();
  });
}

module.exports = {
  httpRequest,
  liveGet,
  livePost,
  liveSchedule,
  liveUnschedule,
  liveGetPeriods,
  liveDelay,
  freshenAuth,
};
