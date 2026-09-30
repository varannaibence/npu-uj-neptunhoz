// Measured anchors and tuning knobs shared across the Rajtoló's files.
const ROUTE = "/hallgato_ng/subjects/registration";
// Measured, stable (reused by hideFullCourses/courseAutoList).
const FILTER_BUTTON_ID = "filter-table";
const LAUNCHER_ID = "npu-rajtolo-launcher";
const PLANNER_ID = "npu-rajtolo-planner";
const PLANS_KEY = "rajtoloPlans";

const SUBJECTS_ENDPOINT = "SubjectApplication/SchedulableSubjects";
const COURSES_ENDPOINT = "SubjectApplication/GetSubjectsCourses";
// The registration a click sends, one subject at a time.
const SIGNIN_ENDPOINT = "SubjectApplication/SubjectSignin";
// Neptun's own planner ("Tervezőhöz adás"), measured on unideb: add takes the four
// subject ids and courseIds[], remove takes courseId, subjectId and termId (GUIDs).
const SCHEDULE_ENDPOINT = "SubjectApplication/ScheduleSubjectAndCourses";
const UNSCHEDULE_ENDPOINT = "SubjectApplication/UnScheduleCourse";
// The same response creditBreakdown rides for the header. It issues the GET; this
// module only listens, rather than importing it.
const CREDITS_ENDPOINT = "SubjectApplication/ScheduledSubjectsWithScheduledCourses";
const API_BASE = "/hallgato_ng/api/";

// A deadlock breaker, not a patience limit: XHR fires "error" for network failures,
// never for a hang. Deliberately long - a real registration can spin for ~90s, and a
// timed-out POST cannot be retried, so the timeout must never kill a request that
// was about to answer.
const REQUEST_TIMEOUT_MS = 180000;

// One click's registrations at most: the first choice, then the next-ranked course
// each time the one just sent turned out full. Each has its own course, never a resend.
const MAX_ATTEMPTS = 4;

// Neptun renews its 5-minute token only when its own next request finds it expired,
// and only that renewal extends the 15-minute session cookie (measured on unideb).
// infiniteSession: a token this old asks for a renewal, well before the cookie runs out.
const KEEPALIVE_AGE_MS = 10 * 60 * 1000;
// How long a button press may take to bring a new header; measured about 2 s.
const FRESHEN_TIMEOUT_MS = 10 * 1000;

// Ranking courses: the order is irrelevant, points decide. Shown wherever a course is
// listed, so the ranking editor never implies a control that does nothing.
const RANKING_NOTE = () => " — rangsoros: a sorrend itt nem számít, pontszám dönt";
// How a group's course is picked from the user's own ranking, set per plan in the
// dialog. The pick never goes outside that ranking in any mode.
//   seatFirst - the highest-ranked course with a seat, else the highest-ranked queue
//   order      - the highest-ranked course that is not full, seat or queue alike
//   never      - seats only, never a waiting list
const WAITLIST_MODES = ["seatFirst", "order", "never"];
const DEFAULT_WAITLIST_MODE = "seatFirst";
// Where httpRequest parks the HTTP status for the callers that judge it. Prefixed so
// it can never collide with a real field in the response body.
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
  CREDITS_ENDPOINT,
  API_BASE,
  REQUEST_TIMEOUT_MS,
  MAX_ATTEMPTS,
  RANKING_NOTE,
  STATUS_KEY,
  WAITLIST_MODES,
  DEFAULT_WAITLIST_MODE,
  KEEPALIVE_AGE_MS,
  FRESHEN_TIMEOUT_MS,
};
