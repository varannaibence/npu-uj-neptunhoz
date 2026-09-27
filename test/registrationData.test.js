const assert = require("assert");
const registrationData = require("../src/registrationData");

function slot(day, startTime, endTime) {
  return { dayOfWeek: day, startTime, endTime, dayOfWeekText: "" };
}

// --- collectPlannerCourses: recognised only within the measured limit --------------
// The test data is synthetic and minimal. The waitlisted/planned branches exercise
// the response states without depending on an account-specific response.

// no `data` array at all: the envelope itself is not recognised
assert.deepStrictEqual(registrationData.collectPlannerCourses({}), { entries: [], recognized: false });
assert.deepStrictEqual(registrationData.collectPlannerCourses({ data: "not an array" }), {
  entries: [],
  recognized: false,
});

// an empty planner is a legitimate, structurally-confirmed answer
assert.deepStrictEqual(registrationData.collectPlannerCourses({ data: [] }), { entries: [], recognized: true });

// a row missing every field this endpoint is known to carry
assert.strictEqual(
  registrationData.collectPlannerCourses({ data: [{ foo: 1 }] }).recognized,
  false,
  "a row with none of the measured fields is not guessed at"
);

// the measured branch: isSigned/isRegistered true, isOnWaitingList false -> registered
const registeredRow = {
  id: "course-1",
  subjectId: "subject-1",
  code: "TEST-01",
  title: "Test subject",
  classInstanceInfos: [slot(1, "10:00", "12:00")],
  isSigned: true,
  isRegistered: true,
  isOnWaitingList: false,
};
const registeredResult = registrationData.collectPlannerCourses({ data: [registeredRow] });
assert.strictEqual(registeredResult.recognized, true);
assert.strictEqual(registeredResult.entries.length, 1);
assert.strictEqual(registeredResult.entries[0].source, "registered");
assert.strictEqual(registeredResult.entries[0].subjectTitle, "Test subject");
assert.strictEqual(registeredResult.entries[0].code, "TEST-01");
assert.strictEqual(registeredResult.entries[0].slots.length, 1);
// `registeredRow` above carries none of tutorName/language/maxLimit/... - recognition
// must not require them, and their absence must read as null, never a guessed 0/"".
assert.strictEqual(registeredResult.recognized, true, "recognition does not depend on the optional fields at all");
[
  "tutorName",
  "language",
  "maxLimit",
  "registeredStudentsCount",
  "waitingStudentsCount",
  "comparationTypeId",
  "room",
  "isFull",
  "willBeOnWaitingList",
  "isOnWaitingList",
].forEach(field => {
  // isOnWaitingList is the one field the row DOES carry (false, to pick the
  // "registered" branch), so it is null here for every field except that one -
  // willBeOnWaitingList included: this row never sets it, and recognition must not
  // require it either.
  if (field === "isOnWaitingList") {
    assert.strictEqual(registeredResult.entries[0][field], false);
  } else {
    assert.strictEqual(registeredResult.entries[0][field], null, `${field} must be null, not a guessed default`);
  }
});

// the same optional fields, now present on the row, must be carried through untouched
const fullyPopulatedRow = Object.assign({}, registeredRow, {
  id: "course-full",
  tutorName: "Dr. Teszt Elek",
  language: "magyar",
  maxLimit: 10,
  registeredStudentsCount: 7,
  waitingStudentsCount: 1,
  comparationTypeId: "comparation-guid-1",
  room: "Room 101",
  isFull: false,
  // A seat forecast, deliberately the OPPOSITE of isOnWaitingList (the student's own
  // current status, which registeredRow already sets to false): a course can be
  // isFull:false but still forecast willBeOnWaitingList:true for a NEW applicant,
  // exactly the "at the limit with an open waitlist" reading occupancy.js relies on.
  willBeOnWaitingList: true,
});
const fullyPopulatedResult = registrationData.collectPlannerCourses({ data: [fullyPopulatedRow] }).entries[0];
assert.strictEqual(fullyPopulatedResult.tutorName, "Dr. Teszt Elek");
assert.strictEqual(fullyPopulatedResult.language, "magyar");
assert.strictEqual(fullyPopulatedResult.maxLimit, 10);
assert.strictEqual(fullyPopulatedResult.registeredStudentsCount, 7);
assert.strictEqual(fullyPopulatedResult.waitingStudentsCount, 1);
assert.strictEqual(fullyPopulatedResult.comparationTypeId, "comparation-guid-1");
assert.strictEqual(fullyPopulatedResult.room, "Room 101");
assert.strictEqual(fullyPopulatedResult.isFull, false, "a measured false must stay false, not become null");
assert.strictEqual(fullyPopulatedResult.willBeOnWaitingList, true, "a measured forecast flag must pass through");
assert.strictEqual(
  fullyPopulatedResult.isOnWaitingList,
  false,
  "isOnWaitingList (own status) and willBeOnWaitingList (forecast) must stay independent"
);

// the forecast flag is also not exempt from "a measured false stays false"
const forecastFalseRow = Object.assign({}, registeredRow, {
  id: "course-forecast-false",
  willBeOnWaitingList: false,
});
assert.strictEqual(
  registrationData.collectPlannerCourses({ data: [forecastFalseRow] }).entries[0].willBeOnWaitingList,
  false,
  "a measured false forecast must stay false, not become null"
);

// isOnWaitingList wins over isSigned/isRegistered, whatever they say
const waitlistedRow = Object.assign({}, registeredRow, { id: "course-2", isOnWaitingList: true });
assert.strictEqual(registrationData.collectPlannerCourses({ data: [waitlistedRow] }).entries[0].source, "waitlisted");

// all three false but the fields are present (recognised shape): the unmeasured
// "planned" default, per Neptun's own legend for this panel
const plannedRow = Object.assign({}, registeredRow, {
  id: "course-3",
  isSigned: false,
  isRegistered: false,
  isOnWaitingList: false,
});
assert.strictEqual(registrationData.collectPlannerCourses({ data: [plannedRow] }).entries[0].source, "planned");

// willBeOnWaitingList must never be read as current state (AGENTS.md invariant 5): a
// row that only carries it, without any of the three measured state fields, is not
// recognised at all - it is not evidence of anything current.
const forecastOnlyRow = {
  id: "course-4",
  subjectId: "subject-1",
  classInstanceInfos: [],
  willBeOnWaitingList: true,
};
assert.strictEqual(
  registrationData.collectPlannerCourses({ data: [forecastOnlyRow] }).recognized,
  false,
  "willBeOnWaitingList alone is a forecast, not a recognisable current state"
);

// one bad row poisons the whole response: a half-guessed baseline is worse than an
// honestly incomplete one
assert.deepStrictEqual(registrationData.collectPlannerCourses({ data: [registeredRow, { foo: 1 }] }), {
  entries: [],
  recognized: false,
});

// --- collectCourses: the same optional, previously-unused measured fields ---------
const coursesWithOptionalFields = registrationData.collectCourses({
  data: [
    {
      id: "c-optional-missing",
      subjectId: "s1",
      code: "OPT-01",
      type: "Elmélet",
      classInstanceInfos: [],
      // No tutorName/language/maxLimit/... at all - the common case outside a
      // registration period, and the one a headcount column must not fake a 0 for.
    },
    {
      id: "c-optional-present",
      subjectId: "s1",
      code: "OPT-02",
      type: "Labor",
      classInstanceInfos: [],
      tutorName: "Dr. Teszt Elek",
      language: "magyar",
      maxLimit: 12,
      registeredStudentsCount: 0,
      waitingStudentsCount: 0,
      comparationTypeId: "comparation-guid-2",
      room: "Room 201",
      isFull: false,
      willBeOnWaitingList: true,
      isOnWaitingList: false,
    },
  ],
});

const missingOptional = coursesWithOptionalFields.get("c-optional-missing");
[
  "tutorName",
  "language",
  "maxLimit",
  "registeredStudentsCount",
  "waitingStudentsCount",
  "comparationTypeId",
  "room",
  "isFull",
  "willBeOnWaitingList",
  "isOnWaitingList",
].forEach(field => {
  assert.strictEqual(missingOptional[field], null, `${field} must stay null when the row does not carry it`);
});

const presentOptional = coursesWithOptionalFields.get("c-optional-present");
assert.strictEqual(presentOptional.tutorName, "Dr. Teszt Elek");
assert.strictEqual(presentOptional.language, "magyar");
assert.strictEqual(presentOptional.maxLimit, 12);
// Both counts are measured zeroes, not missing data - they must read as 0, not null.
assert.strictEqual(presentOptional.registeredStudentsCount, 0, "a measured zero headcount must not collapse into null");
assert.strictEqual(presentOptional.waitingStudentsCount, 0);
assert.strictEqual(presentOptional.comparationTypeId, "comparation-guid-2");
assert.strictEqual(presentOptional.room, "Room 201");
assert.strictEqual(presentOptional.isFull, false, "a measured false must stay false, not become null");
assert.strictEqual(
  presentOptional.willBeOnWaitingList,
  true,
  "the forecast flag is carried through, distinct from isFull"
);
assert.strictEqual(presentOptional.isOnWaitingList, false);
// `type` stays the display label; `comparationTypeId` is the language-neutral key a
// view is expected to group or match on instead.
assert.strictEqual(presentOptional.type, "Labor");

// --- buildBaseline: erősorrend (priority) and "a course appears exactly once" ------
const baselineCourses = new Map([
  ["c-x", { id: "c-x", subjectId: "s-x", code: "X-01", type: "", isSigned: false, slots: [] }],
]);
const baselineSubjects = new Map([
  [
    "s-x",
    {
      subjectId: "s-x",
      termId: "t",
      curriculumTemplateId: "c",
      curriculumTemplateLineId: "l",
      title: "X",
      code: "X-01",
      source: "planned",
      registered: false,
      courseIds: ["c-x"],
    },
  ],
]);

// planned (native plan, source #3) vs waitlisted (planner, source #2): waitlisted wins
let baseline = registrationData.buildBaseline(baselineSubjects, baselineCourses, [
  { id: "c-x", subjectId: "s-x", source: "waitlisted", slots: [], code: "X-01", subjectTitle: "X" },
]);
assert.strictEqual(baseline.length, 1, "a course appears exactly once even when two sources name it");
assert.strictEqual(baseline[0].source, "waitlisted", "waitlisted outranks planned");

// registered (course row's own isSigned, source #1) beats waitlisted (source #2)
baselineCourses.get("c-x").isSigned = true;
baseline = registrationData.buildBaseline(baselineSubjects, baselineCourses, [
  { id: "c-x", subjectId: "s-x", source: "waitlisted", slots: [], code: "X-01", subjectTitle: "X" },
]);
assert.strictEqual(baseline.length, 1);
assert.strictEqual(baseline[0].source, "registered", "registered outranks waitlisted");

// a planner row for a subject the current filter never fetched still enters the
// baseline, named from the planner row's own title/code - this is the whole point of
// folding the planner endpoint in (see the file header)
const unfilteredBaseline = registrationData.buildBaseline(new Map(), new Map(), [
  { id: "c-y", subjectId: "s-y", source: "registered", slots: [], code: "Y-01", subjectTitle: "Outside subject" },
]);
assert.strictEqual(unfilteredBaseline.length, 1);
assert.strictEqual(unfilteredBaseline[0].subject.title, "Outside subject");
assert.strictEqual(unfilteredBaseline[0].course.code, "Y-01");

// --- baselineComplete: false until the planner answers with a recognised shape -----
// félévváltás resetel (term change resets), and baselineComplete goes back to false
// with it - driven through the exported ingest* functions directly, with an explicit
// `path`, so no fake XHR or fake global `location` is needed to prove it.
registrationData.ingestSubjects({
  data: [
    {
      id: "s-term-a",
      termId: "term-A",
      curriculumTemplateId: "ct",
      curriculumTemplateLineId: "ctl",
      isRegistered: true,
      scheduledCourseIds: [],
    },
  ],
});
assert.strictEqual(registrationData.getSnapshot().termId, "term-A");
assert.strictEqual(registrationData.getSnapshot().baselineComplete, false, "no planner response yet");

registrationData.ingestCourses({
  notification: [],
  data: [
    {
      id: "c-term-a",
      subjectId: "s-term-a",
      code: "A-01",
      isSigned: true,
      classInstanceInfos: [slot(1, "10:00", "11:00")],
    },
  ],
});
assert.strictEqual(registrationData.getSnapshot().courses.size, 1, "the course fetch for term A landed");
assert.strictEqual(registrationData.getSnapshot().baseline.length, 1);

// A body with a business notification is not a successful course snapshot, even
// when it happens to contain an array-shaped data field.
registrationData.ingestCourses({
  data: [{ id: "c-error", subjectId: "s-term-a", code: "ERROR-01" }],
  notification: [{ type: 3, description: "not a course snapshot" }],
});
assert.strictEqual(registrationData.getSnapshot().courses.has("c-error"), false);
assert.strictEqual(
  registrationData.isSuccessfulCollection({ data: [], notification: [] }, 200),
  true,
  "an empty successful collection is still a valid API envelope"
);
assert.strictEqual(
  registrationData.isSuccessfulCollection({ data: [], notification: [] }, 500),
  false,
  "a failing HTTP status must not be treated as a usable collection"
);

// an unrecognised planner body keeps baselineComplete false and adds nothing
registrationData.ingestPlanner({ data: [{ nonsense: true }], notification: [] });
assert.strictEqual(registrationData.getSnapshot().baselineComplete, false);
assert.strictEqual(registrationData.getSnapshot().baseline.length, 1, "the course-row baseline is unaffected");

// a recognised planner body flips it to true
registrationData.ingestPlanner({
  notification: [],
  data: [
    {
      id: "c-term-a",
      subjectId: "s-term-a",
      code: "A-01",
      title: "Term A subject",
      classInstanceInfos: [slot(1, "10:00", "11:00")],
      isSigned: true,
      isRegistered: true,
      isOnWaitingList: false,
    },
  ],
});
assert.strictEqual(
  registrationData.getSnapshot().baselineComplete,
  true,
  "a recognised planner body completes the baseline"
);

// a new term GUID resets everything, including baselineComplete
registrationData.ingestSubjects({
  data: [
    {
      id: "s-term-b",
      termId: "term-B",
      curriculumTemplateId: "ct",
      curriculumTemplateLineId: "ctl",
      isRegistered: false,
      scheduledCourseIds: ["c-term-b"],
    },
  ],
});
const afterTermChange = registrationData.getSnapshot();
assert.strictEqual(afterTermChange.termId, "term-B", "the new term is now active");
assert.strictEqual(afterTermChange.courses.size, 0, "term A's courses do not survive the reset");
assert.strictEqual(afterTermChange.baseline.length, 0, "term A's baseline does not survive the reset");
assert.strictEqual(afterTermChange.baselineComplete, false, "a new term starts incomplete again");

// leaving the registration route resets too, per the same fail-closed invariant
registrationData.handleRouteChange("/hallgato_ng/dashboard");
assert.strictEqual(registrationData.getSnapshot().termId, null, "leaving the route clears the active term");

// --- subscribe: every ingest notifies, and unsubscribing stops it -----------------
let notifications = 0;
const unsubscribe = registrationData.subscribe(() => notifications++);
registrationData.ingestSubjects({
  data: [
    {
      id: "s-notify",
      termId: "term-C",
      curriculumTemplateId: "ct",
      curriculumTemplateLineId: "ctl",
      isRegistered: true,
      scheduledCourseIds: [],
    },
  ],
});
assert.strictEqual(notifications, 1);
unsubscribe();
registrationData.ingestSubjects({
  data: [
    {
      id: "s-notify-2",
      termId: "term-D",
      curriculumTemplateId: "ct",
      curriculumTemplateLineId: "ctl",
      isRegistered: true,
      scheduledCourseIds: [],
    },
  ],
});
assert.strictEqual(notifications, 1, "an unsubscribed listener must not fire again");

// The planner request may answer before the subject list establishes the active term.
// It must be adopted later, otherwise every course with a timetable stays "unknown"
// until the user opens the planner panel and causes a second request.
const previousLocation = global.location;
global.location = { origin: "https://npu.test" };
try {
  registrationData.handleRouteChange("/hallgato_ng/dashboard");
  registrationData.ingestPlanner(
    {
      data: [Object.assign({}, registeredRow, { id: "c-early-planner", termId: "term-E" })],
      notification: [],
    },
    { url: "/hallgato_ng/api/SubjectApplication/GetScheduledCourses?request.termId=42" }
  );
  assert.strictEqual(registrationData.getSnapshot().baselineComplete, false);
  registrationData.ingestSubjects(
    {
      data: [
        {
          id: "s-early-planner",
          termId: "term-E",
          curriculumTemplateId: "ct",
          curriculumTemplateLineId: "ctl",
          isRegistered: false,
          scheduledCourseIds: [],
        },
      ],
    },
    { url: "/hallgato_ng/api/SubjectApplication/SchedulableSubjects?request.termId=42" }
  );
  assert.strictEqual(
    registrationData.getSnapshot().baselineComplete,
    true,
    "a planner response that won the race is adopted for the matching term"
  );
  assert.strictEqual(registrationData.getSnapshot().baseline[0].course.id, "c-early-planner");

  // An empty list of another term names no GUID; the numeric term alone moves the layer.
  registrationData.ingestSubjects(
    { data: [], notification: [] },
    { url: "/hallgato_ng/api/SubjectApplication/SchedulableSubjects?request.termId=43" }
  );
  assert.strictEqual(registrationData.getSnapshot().termId, null, "the old term is dropped");
  assert.strictEqual(registrationData.getSnapshot().baseline.length, 0, "and its planner with it");
} finally {
  if (typeof previousLocation === "undefined") {
    delete global.location;
  } else {
    global.location = previousLocation;
  }
}

// --- install(): callable once, second call is a no-op -----------------------------
let onResponseCalls = 0;
let onAuthChangeCalls = 0;
let onChangeCalls = 0;
const fakeInterceptor = require("../src/interceptor");
const fakeRouter = require("../src/router");
const originalOnResponse = fakeInterceptor.onResponse;
const originalOnAuthChange = fakeInterceptor.onAuthChange;
const originalOnChange = fakeRouter.onChange;
fakeInterceptor.onResponse = (...args) => {
  onResponseCalls++;
  return originalOnResponse.apply(fakeInterceptor, args);
};
fakeInterceptor.onAuthChange = (...args) => {
  onAuthChangeCalls++;
  return originalOnAuthChange.apply(fakeInterceptor, args);
};
fakeRouter.onChange = (...args) => {
  onChangeCalls++;
  return originalOnChange.apply(fakeRouter, args);
};
try {
  registrationData.install();
  const callsAfterFirstInstall = { onResponseCalls, onAuthChangeCalls, onChangeCalls };
  registrationData.install();
  assert.deepStrictEqual(
    { onResponseCalls, onAuthChangeCalls, onChangeCalls },
    callsAfterFirstInstall,
    "a second install() must not subscribe a second time"
  );
} finally {
  fakeInterceptor.onResponse = originalOnResponse;
  fakeInterceptor.onAuthChange = originalOnAuthChange;
  fakeRouter.onChange = originalOnChange;
}

// A failed fallback must not become a permanent "already asked" state. It may retry
// after a genuinely new auth header, but not repeatedly with the same broken session.
{
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const originalXHR = global.XMLHttpRequest;
  const originalLocation = global.location;
  const originalGetPath = fakeRouter.getPath;
  const originalGetAuthHeader = fakeInterceptor.getAuthHeader;
  const timers = [];
  let requests = 0;
  let activeAuth = "Bearer fallback-old";

  class FailingXHR {
    constructor() {
      this.listeners = {};
    }

    addEventListener(type, listener) {
      (this.listeners[type] = this.listeners[type] || []).push(listener);
    }

    open() {}

    setRequestHeader() {}

    send() {
      requests++;
      (this.listeners.error || []).forEach(listener => listener());
    }
  }

  global.setTimeout = callback => {
    timers.push(callback);
    return timers.length;
  };
  global.clearTimeout = () => {};
  global.XMLHttpRequest = FailingXHR;
  global.location = { origin: "https://npu.test" };
  fakeRouter.getPath = () => "/hallgato_ng/subjects/registration";
  fakeInterceptor.getAuthHeader = () => activeAuth;

  try {
    fakeRouter.getPath();
    registrationData.handleRouteChange("/outside");
    registrationData.ingestSubjects(
      {
        notification: [],
        data: [{ id: "fallback-subject", termId: "fallback-term" }],
      },
      { url: "https://npu.test/hallgato_ng/api/SubjectApplication/SchedulableSubjects?request.termId=42" }
    );
    registrationData.schedulePlannerFallback();
    timers.shift()();
    assert.strictEqual(requests, 1, "the first fallback request is attempted");

    registrationData.schedulePlannerFallback();
    timers.shift()();
    assert.strictEqual(requests, 1, "the same failed auth is not retried in a loop");

    activeAuth = "Bearer fallback-new";
    registrationData.schedulePlannerFallback();
    timers.shift()();
    assert.strictEqual(requests, 2, "a fresh auth header re-enables one fallback attempt");
  } finally {
    registrationData.handleRouteChange("/outside");
    fakeRouter.getPath = originalGetPath;
    fakeInterceptor.getAuthHeader = originalGetAuthHeader;
    if (typeof originalSetTimeout === "undefined") delete global.setTimeout;
    else global.setTimeout = originalSetTimeout;
    if (typeof originalClearTimeout === "undefined") delete global.clearTimeout;
    else global.clearTimeout = originalClearTimeout;
    if (typeof originalXHR === "undefined") delete global.XMLHttpRequest;
    else global.XMLHttpRequest = originalXHR;
    if (typeof originalLocation === "undefined") delete global.location;
    else global.location = originalLocation;
  }
}
