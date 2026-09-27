// Measured anchors and tuning knobs shared across the Rajtoló's files.
const ROUTE = "/hallgato_ng/subjects/registration";
// Measured, stable (reused by hideFullCourses/courseAutoList).
const FILTER_BUTTON_ID = "filter-table";
const LAUNCHER_ID = "npu-rajtolo-launcher";
const PLANNER_ID = "npu-rajtolo-planner";
const PLANS_KEY = "rajtoloPlans";

const SUBJECTS_ENDPOINT = "SubjectApplication/SchedulableSubjects";
const COURSES_ENDPOINT = "SubjectApplication/GetSubjectsCourses";
const SIGNIN_ENDPOINT = "SubjectApplication/SubjectSignin";
// Neptun's own planner ("Tervezőhöz adás"), measured on unideb: add takes the four
// subject ids and courseIds[], remove takes courseId, subjectId and termId (GUIDs).
const SCHEDULE_ENDPOINT = "SubjectApplication/ScheduleSubjectAndCourses";
const UNSCHEDULE_ENDPOINT = "SubjectApplication/UnScheduleCourse";
// Not called by the app's own traffic on this page; this module originates it.
const PERIODS_ENDPOINT = "Periods/GetPeriods";
// The same response creditBreakdown rides for the header. It issues the GET; this
// module only listens, rather than importing it.
const CREDITS_ENDPOINT = "SubjectApplication/ScheduledSubjectsWithScheduledCourses";
const API_BASE = "/hallgato_ng/api/";

// Bounded: 1 try + 3 retries against a race-condition "full" - the course was open
// when we read it and filled by the time our POST landed.
const MAX_ATTEMPTS = 4;
const DEFAULT_DELAY_SECONDS = 2;
// A deadlock breaker, not a patience limit: XHR fires "error" for network failures,
// never for a hang. Deliberately long - a real registration can spin for ~90s, and a
// timed-out POST cannot be retried, so the timeout must never kill a request that
// was about to answer.
const REQUEST_TIMEOUT_MS = 180000;

// Neptun renews its 5-minute token only when its own next request finds it expired,
// and only that renewal extends the 15-minute session cookie (measured on unideb).
// Before the start: the window in which an expired token is renewed. Wide enough that
// a hidden tab, whose chained timers run once a minute, still gets a tick inside it.
const PRESTART_FRESHEN_MS = 90 * 1000;
// While armed: a token this old asks for a renewal, well before the cookie runs out.
const KEEPALIVE_AGE_MS = 10 * 60 * 1000;
// A renewal that did not come is not asked for again sooner than this.
const FRESHEN_RETRY_MS = 60 * 1000;
// How long a button press may take to bring a new header; measured about 2 s.
const FRESHEN_TIMEOUT_MS = 10 * 1000;

// Ranking courses: submission order is irrelevant, points decide. Shown wherever a
// course is listed, so the ranking editor never implies a control that does nothing.
const RANKING_NOTE = () => " — rangsoros: a sorrend itt nem számít, pontszám dönt";
// Where httpRequest parks the HTTP status for classifyResponse. Prefixed so it can
// never collide with a real field in the response body.
const STATUS_KEY = "__npuStatus";

module.exports = {
  ROUTE,
  FILTER_BUTTON_ID,
  LAUNCHER_ID,
  PLANNER_ID,
  PLANS_KEY,
  SUBJECTS_ENDPOINT,
  COURSES_ENDPOINT,
  SIGNIN_ENDPOINT,
  SCHEDULE_ENDPOINT,
  UNSCHEDULE_ENDPOINT,
  PERIODS_ENDPOINT,
  CREDITS_ENDPOINT,
  API_BASE,
  MAX_ATTEMPTS,
  DEFAULT_DELAY_SECONDS,
  REQUEST_TIMEOUT_MS,
  RANKING_NOTE,
  STATUS_KEY,
  PRESTART_FRESHEN_MS,
  KEEPALIVE_AGE_MS,
  FRESHEN_RETRY_MS,
  FRESHEN_TIMEOUT_MS,
};
