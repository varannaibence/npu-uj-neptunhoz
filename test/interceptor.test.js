const assert = require("assert");
const interceptor = require("../src/interceptor");
const utils = require("../src/utils");
const { FakeXHR } = require("./helpers");

const fakeWindow = { XMLHttpRequest: FakeXHR };
interceptor.install(fakeWindow);

// a module rewriting sortAndPage.lastRow (paginationFixes' whole reason to exist)
interceptor.onRequest("SubjectApplication/SchedulableSubjects", url => url.replace("lastRow=50", "lastRow=500"));

let received;
interceptor.onResponse("SubjectApplication/SchedulableSubjects", json => {
  received = json;
});

const xhr = new fakeWindow.XMLHttpRequest();
xhr.open("GET", "/hallgato_ng/api/SubjectApplication/SchedulableSubjects?sortAndPage.lastRow=50");
assert.strictEqual(xhr.url, "/hallgato_ng/api/SubjectApplication/SchedulableSubjects?sortAndPage.lastRow=500");
xhr.send();
assert.deepStrictEqual(received, { data: [{ id: 1, isFull: false }], notification: [] });

// a different endpoint must not trigger another endpoint's handler, and must be left unrewritten
let crossFired = false;
interceptor.onResponse("SubjectApplication/SchedulableSubjects", () => {
  crossFired = true;
});
const other = new fakeWindow.XMLHttpRequest();
other.open("GET", "/hallgato_ng/api/SubjectApplication/SystemParameters");
assert.strictEqual(other.url, "/hallgato_ng/api/SubjectApplication/SystemParameters");
other.send();
assert.ok(!crossFired, "handler for a different endpoint must not fire");

// A URL that merely contains the API path on another origin is not a Neptun API
// request. It must not inherit endpoint handlers or expose its headers to modules.
const external = new fakeWindow.XMLHttpRequest();
const externalUrl = "https://external.invalid/hallgato_ng/api/SubjectApplication/SchedulableSubjects";
external.open("GET", externalUrl);
assert.strictEqual(external.url, externalUrl, "foreign origins stay outside the interceptor");

// A handler that throws must not be able to fail the app's own request. rewriteUrl
// runs inside the page's XMLHttpRequest.open(), so an uncaught exception there is
// Angular's request dying, not our feature's - and creditBreakdown really did open a
// second XHR from inside that call. dispatchResponse is contained for the second
// reason as well: one throwing handler used to swallow every later one's response.
interceptor.onRequest("Fault/Endpoint", () => {
  throw new Error("a feature blew up");
});
let rewroteAfterThrow = false;
interceptor.onRequest("Fault/Endpoint", url => {
  rewroteAfterThrow = true;
  return `${url}&rewritten=1`;
});
interceptor.onResponse("Fault/Endpoint", () => {
  throw new Error("a feature blew up");
});
let respondedAfterThrow = false;
interceptor.onResponse("Fault/Endpoint", () => {
  respondedAfterThrow = true;
});

const faulty = new fakeWindow.XMLHttpRequest();
assert.doesNotThrow(
  () => faulty.open("GET", "/hallgato_ng/api/Fault/Endpoint?a=1"),
  "a throwing request handler must not reach the app's open()"
);
assert.strictEqual(faulty.url, "/hallgato_ng/api/Fault/Endpoint?a=1&rewritten=1", "later handlers still rewrite");
assert.ok(rewroteAfterThrow, "one handler throwing must not skip the rest");
assert.doesNotThrow(() => faulty.send(), "a throwing response handler must not reach the app's send()");
assert.ok(respondedAfterThrow, "a throwing response handler must not swallow the next one's response");

// --- neptun code capture: storage.getForUser() keys on this, so it must survive
// whichever endpoint happens to carry it ---
assert.strictEqual(utils.getNeptunCode(), null, "starts empty");

// the measured Account/Authenticate envelope
assert.strictEqual(utils.findProp({ data: { neptunCode: "test01" }, notification: [] }, "neptunCode"), "test01");
// the 202 step carries a null code - must not be mistaken for a real one
assert.strictEqual(utils.findProp({ data: { neptunCode: null }, notification: [] }, "neptunCode"), undefined);
// nested deeper, in case UserInfo wraps it differently
assert.strictEqual(utils.findProp({ data: { user: { neptunCode: "test01" } } }, "neptunCode"), "test01");
assert.strictEqual(utils.findProp({ data: {} }, "neptunCode"), undefined);

utils.setNeptunCode("test01");
assert.strictEqual(utils.getNeptunCode(), "TEST01", "stored uppercased - storage keys are case-sensitive");
const identityEvents = [];
const unsubscribeIdentity = utils.onNeptunCodeChange((next, previous) => {
  identityEvents.push({ next, previous });
});
utils.setNeptunCode("test02");
utils.setNeptunCode("TEST02");
utils.setNeptunCode(null);
unsubscribeIdentity();
utils.setNeptunCode("test01");
assert.deepStrictEqual(
  identityEvents,
  [
    { next: "TEST02", previous: "TEST01" },
    { next: null, previous: "TEST02" },
  ],
  "identity observers fire only when the normalized code changes"
);

// --- interceptor: capturing the Authorization header for infiniteSession ---
assert.strictEqual(interceptor.getAuthHeader(), null, "no request has set one yet");
const authXhr = new fakeWindow.XMLHttpRequest();
authXhr.open("GET", "/hallgato_ng/api/UserInfo");
authXhr.setRequestHeader("Authorization", "Bearer abc.def.ghi");
assert.strictEqual(interceptor.getAuthHeader(), "Bearer abc.def.ghi");
// case-insensitive header name, like the real fetch/XHR header matching is
authXhr.setRequestHeader("authorization", "Bearer next-token");
assert.strictEqual(interceptor.getAuthHeader(), "Bearer next-token");
// an unrelated header must not overwrite the captured value
authXhr.setRequestHeader("Content-Type", "application/json");
assert.strictEqual(interceptor.getAuthHeader(), "Bearer next-token");
let observedAuthLoss;
const unsubscribeAuthLoss = interceptor.onAuthChange(auth => {
  observedAuthLoss = auth;
});
authXhr.send();
// Measured: the page sends some API calls without Authorization at all. That is not
// a logout; taking it for one wiped the Neptun code right after every page load.
const anonymousXhr = new fakeWindow.XMLHttpRequest();
anonymousXhr.open("GET", "/hallgato_ng/api/General/GetHWebErrorReportingEmailSystemParameter");
anonymousXhr.send();
assert.strictEqual(observedAuthLoss, undefined, "an anonymous page call leaves the session alone");
assert.strictEqual(interceptor.getAuthHeader(), "Bearer next-token");
assert.strictEqual(interceptor.isAuthSignal("Account/Authenticate", null), true);
assert.strictEqual(
  interceptor.isAuthSignal("Account/SomethingUnmeasured", null),
  false,
  "only the measured login call is a header-less boundary"
);
assert.strictEqual(interceptor.isAuthSignal("General/GetHWebErrorReportingEmailSystemParameter", null), false);
assert.strictEqual(interceptor.isAuthSignal("UserInfo", "Bearer x"), true);
const noAuthXhr = new fakeWindow.XMLHttpRequest();
noAuthXhr.open("POST", "/hallgato_ng/api/Account/Authenticate");
noAuthXhr.send();
assert.strictEqual(observedAuthLoss, null, "a header-less login call reports auth disappearance");
assert.strictEqual(interceptor.getAuthHeader(), null, "a missing API Authorization header cannot retain the old token");
unsubscribeAuthLoss();

// A 401 retires the captured auth before the response body is dispatched. The
// page's own request still runs with its header, but NPU must not replay the same
// failed value until a new value or an explicit retry is observed.
const authFailureEvents = [];
const unsubscribeAuthFailure = interceptor.onAuthChange((auth, metadata) => {
  authFailureEvents.push({ auth, source: metadata && metadata.source });
});
const expiringAuthXhr = new fakeWindow.XMLHttpRequest();
expiringAuthXhr.open("GET", "/hallgato_ng/api/UserInfo");
expiringAuthXhr.setRequestHeader("Authorization", "Bearer expired");
authFailureEvents.length = 0;
expiringAuthXhr.status = 401;
expiringAuthXhr.send();
assert.strictEqual(interceptor.getAuthHeader(), null, "a 401 retires the captured Authorization");
assert.deepStrictEqual(authFailureEvents, [{ auth: null, source: "xhr-401" }]);
const repeatedExpiredAuthXhr = new fakeWindow.XMLHttpRequest();
repeatedExpiredAuthXhr.open("GET", "/hallgato_ng/api/UserInfo");
repeatedExpiredAuthXhr.setRequestHeader("Authorization", "Bearer expired");
assert.strictEqual(interceptor.getAuthHeader(), null, "the same failed Authorization stays blocked");
const freshAuthXhr = new fakeWindow.XMLHttpRequest();
freshAuthXhr.open("GET", "/hallgato_ng/api/UserInfo");
freshAuthXhr.setRequestHeader("Authorization", "Bearer fresh");
assert.strictEqual(interceptor.getAuthHeader(), "Bearer fresh", "a new Authorization reopens capture");
interceptor.clearAuthHeader();
interceptor.allowAuthRetry();
unsubscribeAuthFailure();

// --- the 5-minute token: a renewal within one session is not a new user ---
// Artificial JWTs with only the claims the code reads; the signature is never checked.
const fakeJwt = claims => `Bearer x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
assert.deepStrictEqual(
  interceptor.readAuthClaims(fakeJwt({ SessionId: "s-1", iat: 1000, exp: 1300 })),
  { sessionId: "s-1", issuedAtMs: 1000000, expiresAtMs: 1300000 },
  "SessionId and the token's lifetime, in ms"
);
assert.deepStrictEqual(
  interceptor.readAuthClaims("Bearer not-a-jwt"),
  { sessionId: null, issuedAtMs: null, expiresAtMs: null },
  "an unreadable header yields nothing, never a guess"
);
assert.strictEqual(interceptor.isUserBoundary("s-1", "h", "s-1", undefined), false, "renewed token, same session");
assert.strictEqual(interceptor.isUserBoundary("s-1", "h", "s-2", undefined), true, "another login");
assert.strictEqual(interceptor.isUserBoundary("s-1", "h", null, undefined), true, "unreadable: fail closed");
assert.strictEqual(interceptor.isUserBoundary(null, "h", "s-1", undefined), true, "first sight of a session");
assert.strictEqual(interceptor.isUserBoundary("s-1", null, null, 401), false, "a 401 only says the token died");
assert.strictEqual(interceptor.isUserBoundary("s-1", null, null, undefined), true, "a header-less request is logout");

{
  const events = [];
  const unsubscribe = interceptor.onAuthChange((auth, info) => {
    events.push({ auth: Boolean(auth), userBoundary: info.userBoundary, previous: info.previousSessionId });
  });
  const request = (header, status) => {
    const req = new fakeWindow.XMLHttpRequest();
    req.open("GET", `/hallgato_ng/api/${header ? "SubjectApplication/SchedulableSubjects" : "Account/Authenticate"}`);
    if (header) {
      req.setRequestHeader("Authorization", header);
    }
    req.status = status || 200;
    req.send();
  };
  request(fakeJwt({ SessionId: "s-1", iat: 1000, exp: 1300 }));
  request(fakeJwt({ SessionId: "s-1", iat: 1300, exp: 1600 }));
  assert.deepStrictEqual(interceptor.getAuthTiming(), { issuedAtMs: 1300000, expiresAtMs: 1600000 });
  request(fakeJwt({ SessionId: "s-1", iat: 1600, exp: 1900 }), 401);
  assert.deepStrictEqual(
    interceptor.getAuthTiming(),
    { issuedAtMs: 1600000, expiresAtMs: 1900000 },
    "a retired header keeps its timing for the keep-alive"
  );
  request(fakeJwt({ SessionId: "s-1", iat: 1900, exp: 2200 }));
  request(fakeJwt({ SessionId: "s-2", iat: 2000, exp: 2300 }));
  request(null);
  // The next login: its first request is a boundary FROM no session. index.js keeps
  // the code the login response set, and clears only when leaving a known session.
  request(fakeJwt({ SessionId: "s-3", iat: 3000, exp: 3300 }));
  assert.deepStrictEqual(events, [
    { auth: true, userBoundary: true, previous: null },
    { auth: true, userBoundary: false, previous: "s-1" },
    { auth: true, userBoundary: false, previous: "s-1" },
    { auth: false, userBoundary: false, previous: "s-1" },
    { auth: true, userBoundary: false, previous: "s-1" },
    { auth: true, userBoundary: true, previous: "s-1" },
    { auth: false, userBoundary: true, previous: "s-2" },
    { auth: true, userBoundary: true, previous: null },
  ]);
  unsubscribe();
  interceptor.allowAuthRetry();
}

module.exports = { fakeWindow };
