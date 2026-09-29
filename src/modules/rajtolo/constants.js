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
// when we read it and filled by the time our POST landed. Dormant until that rejection
// is measured: protocol.classifyResponse does not recognise it yet (engine.runSubject).
const MAX_ATTEMPTS = 4;
// The pause before such a retry only; subjects follow each other without one.
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

// Speed at the opening. The course lists are read this long before it (nothing can
// change them until then), so each subject costs only its POST when it opens; not
// for a run armed closer to the start than PREFETCH_MIN_MS.
const PREFETCH_LEAD_MS = 20 * 1000;
const PREFETCH_MIN_MS = 5 * 1000;
// "Még nincs tárgyjelentkezési időszak" (measured, processes nothing) is sent again
// after this pause, for this long after the start: a server opening a moment late
// then gets the POST the moment it opens.
// ponytail: fixed pause, ~3 POST/s at most; a backoff if an institution throttles it.
const NOT_OPEN_PAUSE_MS = 300;
const NOT_OPEN_WINDOW_MS = 30 * 1000;
// Watching subjects whose every ranked course was full: one round of reads, one
// request at a time, then this pause. The minutes are the user's choice per plan.
// ponytail: a fixed pause per round; per-subject pacing if many subjects are watched.
const WATCH_PAUSE_MS = 1000;
const WATCH_MINUTES = [0, 5, 15, 30, 60];

// Ranking courses: submission order is irrelevant, points decide. Shown wherever a
// course is listed, so the ranking editor never implies a control that does nothing.
const RANKING_NOTE = () => " — rangsoros: a sorrend itt nem számít, pontszám dönt";
// How a group's course is picked from the user's own ranking, set per plan in the
// dialog. The run never goes outside that ranking in any mode.
//   seatFirst - the highest-ranked course with a seat, else the highest-ranked queue
//   order      - the highest-ranked course that is not full, seat or queue alike
//   never      - seats only, never a waiting list
const WAITLIST_MODES = ["seatFirst", "order", "never"];
const DEFAULT_WAITLIST_MODE = "seatFirst";
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
  WAITLIST_MODES,
  DEFAULT_WAITLIST_MODE,
  PRESTART_FRESHEN_MS,
  KEEPALIVE_AGE_MS,
  FRESHEN_RETRY_MS,
  FRESHEN_TIMEOUT_MS,
  PREFETCH_LEAD_MS,
  PREFETCH_MIN_MS,
  NOT_OPEN_PAUSE_MS,
  NOT_OPEN_WINDOW_MS,
  WATCH_PAUSE_MS,
  WATCH_MINUTES,
};
