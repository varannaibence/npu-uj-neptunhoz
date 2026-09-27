// The subject-registration page's shared data layer: one snapshot of "what does the
// student already hold or plan", built from three sources, for courseConflictHints,
// occupancy and any future view to subscribe to instead of each re-deriving its own
// copy.
//
// Why a shared layer at all: courseConflictHints's baseline (see its own file) only
// covers subjects that show up in the CURRENT curriculum-filtered list, because the
// native course response is scoped to the subject being opened. A registered course
// whose subject sits outside that filter - a PE credit, a free-standing language
// course, anything not on the active sample curriculum - is invisible to it, so a real
// clash against it is never reported.
// `SubjectApplication/GetScheduledCourses` sidesteps this: it is fired by Neptun's own
// "Órarendtervező" panel on page load, without any filter, and its rows carry their
// own subject title and schedule directly - so a course this module never had a reason
// to fetch can still enter the baseline. The implementation recognises only the
// response shape and state fields that have been verified; it does not infer missing
// planned or waitlisted rows. See collectPlannerCourses for exactly what is trusted
// from a row and what happens when the shape does not match at all.
//
// GetSubjectsCourses remains passive here: the Neptun page requests it when a subject
// is opened, and this layer consumes that response. It never walks the whole subject
// catalogue in the background just to populate a collapsed view.
const interceptor = require("./interceptor");
const router = require("./router");
const utils = require("./utils");
const { courseSlots } = require("./timetable");

const ROUTE = "/hallgato_ng/subjects/registration";
const API_BASE = "/hallgato_ng/api/";
const SUBJECTS_ENDPOINT = "SubjectApplication/SchedulableSubjects";
const SCHEDULED_ENDPOINT = "SubjectApplication/ScheduledSubjectsWithScheduledCourses";
const COURSES_ENDPOINT = "SubjectApplication/GetSubjectsCourses";
// Usually fired by the planner panel itself. Some Neptun instances wait until the
// panel opens, so install() schedules one delayed same-origin fallback when no answer
// arrives after the term is known.
const PLANNER_ENDPOINT = "SubjectApplication/GetScheduledCourses";
const REQUEST_TIMEOUT_MS = 30000;
// Lets the app's own page-load request win without leaving the first course rows in an
// unknown state forever on instances that only request this endpoint on panel open.
const PLANNER_FALLBACK_DELAY_MS = 1000;

// registered beats waitlisted beats planned, whichever of the three sources below
// said so. Ties (same source twice for the same course) keep whichever course/subject
// object is already recorded.
const SOURCE_RANK = { registered: 3, waitlisted: 2, planned: 1 };

function truthy(value) {
  return value === true || value === "true";
}

function cleanIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value.filter(id => typeof id === "string" && id.trim()).map(id => id.trim())));
}

// Lifted from courseConflictHints.collectScheduleSubjects - same reasoning applies
// here verbatim, so its comments are kept rather than paraphrased.
//
// Accumulates subjects because a filtered or paged list can deliver the same term in
// several responses. A row's own course-id list is a fresh snapshot, though: keeping
// an old id after the user replaced/removed it would create a phantom conflict.
//
// A registered subject counts even with an empty `scheduledCourseIds`. Measured
// That field belongs to Neptun's own *planner*. It may be empty even when a registered
// subject is present, so keying the baseline on it alone can make the baseline empty.
// Which courses the student actually holds is on the course rows instead (`isSigned`),
// so a registered subject stays in the snapshot and is joined when Neptun supplies its
// course rows.
function collectScheduleSubjects(json, into) {
  const map = into || new Map();
  const rows = (json && Array.isArray(json.data) && json.data) || [];
  rows.forEach(row => {
    if (!row || !row.id) {
      return;
    }
    const registered = truthy(row.isRegistered);
    if (!Array.isArray(row.scheduledCourseIds) && !registered) {
      return;
    }
    const courseIds = cleanIds(row.scheduledCourseIds);
    if (courseIds.length === 0 && !registered) {
      map.delete(row.id);
      return;
    }
    const previous = map.get(row.id) || { courseIds: [], source: "planned" };
    const hasRegistrationState = Object.prototype.hasOwnProperty.call(row, "isRegistered");
    map.set(row.id, {
      subjectId: row.id,
      termId: row.termId || previous.termId,
      curriculumTemplateId: row.curriculumTemplateId || previous.curriculumTemplateId,
      curriculumTemplateLineId: row.curriculumTemplateLineId || previous.curriculumTemplateLineId,
      title: row.title || previous.title || "",
      code: row.code || previous.code || "",
      source: hasRegistrationState ? (registered ? "registered" : "planned") : previous.source,
      registered: hasRegistrationState ? registered : Boolean(previous.registered),
      courseIds,
    });
  });
  return map;
}

// Measured (docs/API.md, "A kurzussor teljes mezőlistája"), previously collected by
// neither collectCourses nor collectPlannerCourses because courseConflictHints - the
// function this was lifted from - never needed more than the conflict check itself.
// The shared store serves more than that now, so these come along too.
//
// Each one stays missing (null) rather than being coerced to 0/""/false when the row
// does not carry it: a view built on this has to be able to tell "no data" from
// "counted, and it came back zero" - a headcount column would otherwise show an
// invented zero exactly where the true answer is "unknown".
function optionalCourseFields(row) {
  return {
    tutorName: typeof row.tutorName === "string" ? row.tutorName : null,
    language: typeof row.language === "string" ? row.language : null,
    maxLimit: typeof row.maxLimit === "number" ? row.maxLimit : null,
    registeredStudentsCount: typeof row.registeredStudentsCount === "number" ? row.registeredStudentsCount : null,
    waitingStudentsCount: typeof row.waitingStudentsCount === "number" ? row.waitingStudentsCount : null,
    // The course type's language-NEUTRAL guid (Labor and Elmélet are distinct
    // values), unlike `type` itself, which is only a display label - grouping or
    // matching on `type` is not a stable identity check.
    comparationTypeId:
      typeof row.comparationTypeId === "string" && row.comparationTypeId.trim() ? row.comparationTypeId.trim() : null,
    room: typeof row.room === "string" ? row.room : null,
    isFull: typeof row.isFull === "boolean" ? row.isFull : null,
    // Two different things that sound alike, per occupancy.js's seatState/seatsGone
    // and rajtolo/protocol.js and plan.js reading the same pair the same way:
    //
    // `willBeOnWaitingList` is a FORECAST for a hypothetical NEW application, and is
    // exactly what a seat-status view needs alongside `isFull` - a course at its limit
    // with an open waitlist measures as `isFull: false, willBeOnWaitingList: true`,
    // and occupancy.js's own history is that reading `isFull` alone there called a
    // full course free. So this field is fine, even required, for FÉRŐHELY status.
    // What it must never do is stand in for the student's own current relationship
    // to the course - per AGENTS.md invariant 5, that is exactly the line
    // collectPlannerCourses' source classification (registered/waitlisted/planned)
    // has to respect, so that classifier deliberately does not read this field.
    //
    // `isOnWaitingList` is the opposite kind of fact: the student's OWN current
    // status on this course (are they on the waitlist right now), not a seat count -
    // that one IS safe to classify a baseline source from, and is what
    // collectPlannerCourses' source branch below actually reads.
    willBeOnWaitingList: typeof row.willBeOnWaitingList === "boolean" ? row.willBeOnWaitingList : null,
    isOnWaitingList: typeof row.isOnWaitingList === "boolean" ? row.isOnWaitingList : null,
  };
}

// Lifted from courseConflictHints.collectCourses, plus optionalCourseFields above.
function collectCourses(json, into) {
  const map = into || new Map();
  const rows = (json && Array.isArray(json.data) && json.data) || [];
  rows.forEach(row => {
    if (!row || !row.id || !row.subjectId) {
      return;
    }
    map.set(row.id, {
      id: row.id,
      subjectId: row.subjectId,
      code: row.code ? String(row.code).trim() : "",
      type: row.type || "",
      // Measured: true exactly on the courses the student holds.
      isSigned: truthy(row.isSigned),
      slots: courseSlots(row),
      ...optionalCourseFields(row),
    });
  });
  return map;
}

// --- the planner endpoint: partly measured, recognised only within that limit ------
//
// `GetScheduledCourses?request.termId=<numeric>` carries
// `id` (course guid), `subjectId`, `title` (the SUBJECT's name, unlike a
// GetSubjectsCourses course row which never carries it), `code`, `classInstanceInfos`
// (identical shape to GetSubjectsCourses' - `normaliseSlot` applies unchanged) and a
// `classInstanceTimeTableList` second schedule source, same as that other endpoint.
//
// `isOnWaitingList`, `isRegistered` and `isSigned` are the state fields required for
// recognition. `willBeOnWaitingList` is deliberately never read here: per
// AGENTS.md invariant 5, it forecasts a hypothetical NEW application, not this
// course's current status.
const PLANNER_STATE_FIELDS = ["isOnWaitingList", "isRegistered", "isSigned"];

// A row is recognised once it has an id, a subject id, a schedule-shaped array, and
// at least one of the three state fields the measured sample always carried. Missing
// any of these means a shape this code has never seen, not a guess worth making.
function recognisePlannerRow(row) {
  if (!row || typeof row !== "object") {
    return null;
  }
  const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : null;
  const subjectId = typeof row.subjectId === "string" && row.subjectId.trim() ? row.subjectId.trim() : null;
  const scheduleField = Array.isArray(row.classInstanceInfos)
    ? "classInstanceInfos"
    : Array.isArray(row.classInstanceTimeTableList)
      ? "classInstanceTimeTableList"
      : null;
  if (!id || !subjectId || !scheduleField || !PLANNER_STATE_FIELDS.some(field => typeof row[field] === "boolean")) {
    return null;
  }
  const source = truthy(row.isOnWaitingList)
    ? "waitlisted"
    : truthy(row.isRegistered) || truthy(row.isSigned)
      ? "registered"
      : "planned";
  return {
    id,
    subjectId,
    source,
    slots: courseSlots(row, row[scheduleField]),
    code: typeof row.code === "string" ? row.code.trim() : "",
    subjectTitle: typeof row.title === "string" ? row.title : "",
    // The four ids GetSubjectsCourses and SubjectSignin take, measured on these rows
    // too, so a subject planned only in Neptun's own planner can still be looked up.
    termId: typeof row.termId === "string" && row.termId ? row.termId : null,
    curriculumTemplateId: typeof row.curriculumTemplateId === "string" ? row.curriculumTemplateId : null,
    curriculumTemplateLineId: typeof row.curriculumTemplateLineId === "string" ? row.curriculumTemplateLineId : null,
    type: typeof row.type === "string" ? row.type : "",
    // Measured present on this endpoint's rows too, and optional on purpose: none of
    // these gate recognition, or a single missing optional field would make an
    // otherwise-fine response unrecognised and cost the whole page baselineComplete.
    ...optionalCourseFields(row),
  };
}

// One unrecognised row distrusts the whole body: a baseline half-built from a guessed
// row shape is worse than one that honestly says it is incomplete, which is exactly
// the distinction `baselineComplete` exists to carry.
//
// An empty `data` array is the one case kept as "recognised": the envelope itself
// (see docs/API.md's common `{data, notification}` contract) is confirmed, and there
// is nothing here to check a field name against - a planner with nothing in it is a
// legitimate, ordinary answer.
function collectPlannerCourses(json) {
  if (!json || !Array.isArray(json.data)) {
    return { entries: [], recognized: false };
  }
  const rows = json.data;
  if (rows.length === 0) {
    return { entries: [], recognized: true };
  }
  const entries = [];
  for (const row of rows) {
    const recognised = recognisePlannerRow(row);
    if (!recognised) {
      return { entries: [], recognized: false };
    }
    entries.push(recognised);
  }
  return { entries, recognized: true };
}

// --- the baseline: three sources merged into one course-id -> verdict map ----------
//
// registered > waitlisted > planned wins on a shared course id, regardless of which
// of the three sources said so - a course row's own `isSigned`, a recognised planner
// row, or (last, and often empty per courseConflictHints's own measurement) Neptun's
// native per-subject plan. Every course ends up here at most once.
function buildBaseline(subjects, courses, plannerEntries) {
  const byCourse = new Map();
  const unknownSubject = { title: "", code: "" };

  // `origin` says which source it was: a view that acts on the planner trusts only
  // "planner", since the per-subject list is not re-read after a planner write.
  function consider(courseId, source, course, subject, origin) {
    if (!courseId || !source || !course) {
      return;
    }
    const existing = byCourse.get(courseId);
    if (!existing || SOURCE_RANK[source] > SOURCE_RANK[existing.source]) {
      byCourse.set(courseId, { course, subject: subject || unknownSubject, source, origin });
    }
  }

  // 1) The strongest, measured signal: the course row itself says the student holds
  // it (courseConflictHints' strongest available signal).
  courses.forEach(course => {
    if (course.isSigned) {
      consider(course.id, "registered", course, subjects.get(course.subjectId), "course");
    }
  });

  // 2) The planner endpoint, only when its shape was recognised. This is what lets a
  // subject outside the current curriculum filter - never fetched via
  // GetSubjectsCourses, never in `subjects` either - still enter the baseline: the
  // planner row carries its own course code and subject title, so the stand-in built
  // here is not just an id with no name attached.
  (plannerEntries || []).forEach(entry => {
    const course = courses.get(entry.id) || {
      id: entry.id,
      subjectId: entry.subjectId,
      code: entry.code,
      type: entry.type || "",
      isSigned: entry.source === "registered",
      slots: entry.slots,
      tutorName: entry.tutorName,
      language: entry.language,
      maxLimit: entry.maxLimit,
      registeredStudentsCount: entry.registeredStudentsCount,
      waitingStudentsCount: entry.waitingStudentsCount,
      comparationTypeId: entry.comparationTypeId,
      room: entry.room,
      isFull: entry.isFull,
      willBeOnWaitingList: entry.willBeOnWaitingList,
      isOnWaitingList: entry.isOnWaitingList,
    };
    const subject = subjects.get(entry.subjectId) || {
      subjectId: entry.subjectId,
      title: entry.subjectTitle || "",
      code: "",
      termId: entry.termId,
      curriculumTemplateId: entry.curriculumTemplateId,
      curriculumTemplateLineId: entry.curriculumTemplateLineId,
    };
    consider(entry.id, entry.source, course, subject, "planner");
  });

  // 3) Neptun's own native per-subject plan. Kept as a last resort exactly because
  // courseConflictHints measured it empty for a student who never opened the planner
  // panel - it costs nothing to also check, and helps whoever did.
  subjects.forEach(subject => {
    subject.courseIds.forEach(courseId => {
      const course = courses.get(courseId);
      if (!course) {
        return;
      }
      consider(courseId, subject.source, course, subject, "subject");
    });
  });

  return Array.from(byCourse.values());
}

// --- mutable snapshot state ---------------------------------------------------------
// Module-scoped rather than closed over inside install(), so getSnapshot()/subscribe()
// work whether or not install() has run yet, and so tests can drive ingestSubjects/
// ingestCourses/ingestPlanner/handleRouteChange directly - without a fake XHR or a
// fake `location` - to prove the reset and merge behaviour.
let activeTermId = null;
let activeNumericTermId = null;
let subjects = new Map();
let courses = new Map();
let plannerEntries = [];
let plannerRecognized = false;
let pendingPlanner = null;
let plannerFallbackTimer = null;
let plannerResponseSeen = false;
let plannerFallbackAsked = false;
let plannerFallbackInFlight = false;
let plannerFallbackFailedAuth = null;
let plannerFallbackRequest = null;
let generation = 0;
let installed = false;
const listeners = new Set();

function getSnapshot() {
  return {
    termId: activeTermId,
    subjects: new Map(subjects),
    courses: new Map(courses),
    baseline: buildBaseline(subjects, courses, plannerEntries),
    // True only once GetScheduledCourses answered with a shape collectPlannerCourses
    // could recognise. This is the field the rest of the page has to check before it
    // is allowed to say "no clash" - see the module comment at the top of this file.
    baselineComplete: plannerRecognized,
  };
}

function notify() {
  const snapshot = getSnapshot();
  listeners.forEach(fn => {
    try {
      fn(snapshot);
    } catch (e) {
      // An observer is advisory and must not break ingestion for the others.
    }
  });
}

function subscribe(fn) {
  if (typeof fn !== "function") {
    return () => {};
  }
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// A full-semester reset, same as courseConflictHints's: a new term GUID invalidates
// every id collected so far, and the generation counter invalidates a delayed planner
// fallback rather than mixing two terms' answers.
function reset(termId, numericTermId) {
  if (plannerFallbackTimer !== null) {
    clearTimeout(plannerFallbackTimer);
    plannerFallbackTimer = null;
  }
  if (plannerFallbackRequest && typeof plannerFallbackRequest.abort === "function") {
    try {
      plannerFallbackRequest.abort();
    } catch (e) {
      // The request is already dead; the state reset below is what matters.
    }
  }
  plannerFallbackRequest = null;
  plannerFallbackInFlight = false;
  activeTermId = termId || null;
  activeNumericTermId = numericTermId || null;
  subjects = new Map();
  courses = new Map();
  plannerEntries = [];
  plannerRecognized = false;
  plannerResponseSeen = false;
  plannerFallbackAsked = false;
  plannerFallbackFailedAuth = null;
  if (!termId) {
    pendingPlanner = null;
  }
  generation++;
}

function adoptPendingPlanner(termGuid, numericTermId) {
  if (!pendingPlanner) {
    return;
  }
  const sameNumericTerm =
    pendingPlanner.numericTermId && numericTermId && pendingPlanner.numericTermId === numericTermId;
  const sameGuidTerm = pendingPlanner.termGuid && termGuid && pendingPlanner.termGuid === termGuid;
  if (!sameNumericTerm && !sameGuidTerm) {
    return;
  }
  plannerEntries = pendingPlanner.result.entries;
  plannerRecognized = pendingPlanner.result.recognized;
  plannerResponseSeen = true;
  pendingPlanner = null;
}

function schedulePlannerFallback() {
  if (
    plannerFallbackTimer !== null ||
    plannerFallbackInFlight ||
    plannerResponseSeen ||
    plannerFallbackAsked ||
    plannerRecognized ||
    !activeNumericTermId
  ) {
    return;
  }
  const runGeneration = generation;
  plannerFallbackTimer = setTimeout(() => {
    plannerFallbackTimer = null;
    if (runGeneration !== generation || router.getPath() !== ROUTE || plannerRecognized || !activeNumericTermId) {
      return;
    }
    const auth = interceptor.getAuthHeader();
    if (!auth) {
      return;
    }
    if (plannerFallbackFailedAuth === auth) {
      return;
    }
    let settled = false;
    try {
      const xhr = new XMLHttpRequest();
      // Ours, not the page's: Neptun's logout countdown does not see it.
      xhr.__npuOwn = true;
      plannerFallbackRequest = xhr;
      plannerFallbackInFlight = true;
      const finish = success => {
        if (settled) {
          return;
        }
        settled = true;
        if (plannerFallbackRequest === xhr) {
          plannerFallbackRequest = null;
        }
        plannerFallbackInFlight = false;
        if (success) {
          plannerFallbackAsked = true;
        } else {
          plannerFallbackAsked = false;
          plannerFallbackFailedAuth = auth;
        }
      };
      xhr.addEventListener("load", () => {
        let response = xhr.response;
        if (typeof response === "string") {
          try {
            response = JSON.parse(response);
          } catch (e) {
            response = null;
          }
        } else if (!response && typeof xhr.responseText === "string") {
          try {
            response = JSON.parse(xhr.responseText);
          } catch (e) {
            response = null;
          }
        }
        finish(isSuccessfulCollection(response, xhr.status));
      });
      xhr.addEventListener("error", () => finish(false));
      xhr.addEventListener("timeout", () => finish(false));
      xhr.addEventListener("abort", () => finish(false));
      xhr.open("GET", `${API_BASE}${PLANNER_ENDPOINT}?request.termId=${activeNumericTermId}`);
      xhr.setRequestHeader("Authorization", auth);
      xhr.timeout = REQUEST_TIMEOUT_MS;
      xhr.send(null);
    } catch (e) {
      plannerFallbackInFlight = false;
      plannerFallbackRequest = null;
      plannerFallbackAsked = false;
      plannerFallbackFailedAuth = auth;
    }
  }, PLANNER_FALLBACK_DELAY_MS);
}

// A fresh planner read on demand, for a view about to act on what is planned. Whether
// Neptun re-reads the planner after its own "Tervezőhöz adás" is unmeasured, so the
// page's last response may predate the student's latest change. Resolves true once a
// recognised answer is in the snapshot; a term change meanwhile discards it.
function refreshPlanner() {
  const auth = interceptor.getAuthHeader();
  if (!auth || !activeNumericTermId || router.getPath() !== ROUTE) {
    return Promise.resolve(false);
  }
  const url = `${API_BASE}${PLANNER_ENDPOINT}?request.termId=${activeNumericTermId}`;
  const runGeneration = generation;
  return new Promise(resolve => {
    try {
      const xhr = new XMLHttpRequest();
      // Ours, not the page's: Neptun's logout countdown does not see it.
      xhr.__npuOwn = true;
      xhr.addEventListener("load", () => {
        let json = null;
        try {
          json = JSON.parse(xhr.responseText);
        } catch (e) {
          json = null;
        }
        if (runGeneration !== generation || !isSuccessfulCollection(json, xhr.status)) {
          resolve(false);
          return;
        }
        ingestPlanner(json, { url, status: xhr.status }, router.getPath());
        resolve(plannerRecognized);
      });
      xhr.addEventListener("error", () => resolve(false));
      xhr.addEventListener("timeout", () => resolve(false));
      xhr.open("GET", url);
      xhr.setRequestHeader("Authorization", auth);
      xhr.timeout = REQUEST_TIMEOUT_MS;
      xhr.send(null);
    } catch (e) {
      resolve(false);
    }
  });
}

function termIn(json) {
  const rows = (json && Array.isArray(json.data) && json.data) || [];
  const row = rows.find(item => item && item.termId);
  return row ? String(row.termId) : null;
}

// Best-effort only: a response missing its own URL (or a `location` that cannot
// resolve a relative one, e.g. outside a browser) must not throw.
function queryValue(url, name) {
  if (typeof url !== "string") {
    return null;
  }
  try {
    return new URL(url, location.origin).searchParams.get(name);
  } catch (e) {
    return null;
  }
}

function isSuccessfulCollection(json, status) {
  const code = Number(status);
  return Boolean(
    json &&
      Array.isArray(json.data) &&
      Array.isArray(json.notification) &&
      json.notification.length === 0 &&
      (Number.isNaN(code) || code === 0 || (code >= 200 && code < 300))
  );
}

// Pure state transitions. `install()` wires these to the real interceptor/router;
// tests call them directly with a hand-built body and an explicit `path`, so none of
// this needs a fake XHR or a fake global `location` to exercise.

function ingestSubjects(json, info) {
  const meta = info || {};
  const termGuid = termIn(json);
  if (!termGuid) {
    return;
  }
  const numericTermId = queryValue(meta.url, "request.termId");
  if (activeTermId !== termGuid) {
    reset(termGuid, numericTermId || activeNumericTermId);
  } else if (numericTermId && !activeNumericTermId) {
    activeNumericTermId = numericTermId;
  }
  adoptPendingPlanner(termGuid, activeNumericTermId);
  collectScheduleSubjects(json, subjects);
  notify();
}

function ingestCourses(json, info, path = ROUTE) {
  const meta = info || {};
  if (path !== ROUTE || !activeTermId) {
    return;
  }
  const responseTerm = queryValue(meta.url, "termId");
  if (responseTerm && responseTerm !== activeTermId) {
    return;
  }
  const valid = isSuccessfulCollection(json, meta.status);
  if (valid) {
    collectCourses(json, courses);
  }
  notify();
}

function ingestPlanner(json, info, path = ROUTE) {
  const meta = info || {};
  if (path !== ROUTE) {
    return;
  }
  const responseTerm = queryValue(meta.url, "request.termId");
  const responseGuid = termIn(json);
  if (
    activeTermId &&
    ((activeNumericTermId && responseTerm && responseTerm !== activeNumericTermId) ||
      (responseGuid && responseGuid !== activeTermId))
  ) {
    return;
  }
  const validEnvelope = isSuccessfulCollection(json, meta.status);
  const result = validEnvelope ? collectPlannerCourses(json) : { entries: [], recognized: false };
  plannerResponseSeen = true;
  if (plannerFallbackTimer !== null) {
    clearTimeout(plannerFallbackTimer);
    plannerFallbackTimer = null;
  }
  if (!activeTermId) {
    // The app can answer this request before the subject list tells us which term is
    // active. Keep the measured response and adopt it from ingestSubjects once the
    // request/body identifiers can be checked against that term.
    pendingPlanner = { numericTermId: responseTerm, termGuid: responseGuid, result };
    return;
  }
  plannerEntries = result.entries;
  plannerRecognized = result.recognized;
  notify();
}

// Leaving the route is a full reset, same invariant as courseConflictHints: nothing
// carries over to a page the user is not looking at any more.
function handleRouteChange(path) {
  if (path !== ROUTE) {
    reset(null, null);
  }
  notify();
}

// Subscribes to the interceptor and the router. Callable once: a second call is a
// no-op rather than registering every handler twice.
function install() {
  if (installed) {
    return;
  }
  installed = true;

  interceptor.onResponse(SUBJECTS_ENDPOINT, (json, info) => {
    if (!isSuccessfulCollection(json, info && info.status)) {
      return;
    }
    ingestSubjects(json, info);
    schedulePlannerFallback();
  });
  interceptor.onResponse(SCHEDULED_ENDPOINT, (json, info) => {
    if (!isSuccessfulCollection(json, info && info.status)) {
      return;
    }
    ingestSubjects(json, info);
    schedulePlannerFallback();
  });
  interceptor.onResponse(COURSES_ENDPOINT, (json, info) => {
    ingestCourses(json, info, router.getPath());
  });
  // Prefer the planner panel's own request. schedulePlannerFallback() only adds one
  // delayed GET for instances that do not fire it until the panel is opened.
  interceptor.onResponse(PLANNER_ENDPOINT, (json, info) => {
    if (!isSuccessfulCollection(json, info && info.status)) {
      return;
    }
    ingestPlanner(json, info, router.getPath());
  });

  interceptor.onAuthChange(auth => {
    if (!auth) {
      plannerFallbackFailedAuth = null;
      plannerFallbackAsked = false;
      return;
    }
    // A renewed token may retry a failed fallback, but must not repeat a successful
    // one: that came every five minutes. A new user resets through the Neptun code.
    if (auth !== plannerFallbackFailedAuth) {
      plannerFallbackFailedAuth = null;
    }
    schedulePlannerFallback();
  });

  utils.onNeptunCodeChange((code, previous) => {
    if (!code || (previous && previous !== code)) {
      reset(null, null);
      notify();
    }
  });

  router.onChange(handleRouteChange);
}

module.exports = {
  install,
  subscribe,
  getSnapshot,
  collectScheduleSubjects,
  collectCourses,
  collectPlannerCourses,
  buildBaseline,
  // Exposed so a test can drive a reset or a merge without a fake XHR or a fake
  // global `location`: each takes its route/URL context as an explicit argument
  // instead of asking the real router/interceptor for it.
  ingestSubjects,
  ingestCourses,
  ingestPlanner,
  isSuccessfulCollection,
  handleRouteChange,
  schedulePlannerFallback,
  refreshPlanner,
};
