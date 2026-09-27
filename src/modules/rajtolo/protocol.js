// What the server's answers mean, and which combination to send next. Pure.
const { STATUS_KEY, RANKING_NOTE, PRESTART_FRESHEN_MS, KEEPALIVE_AGE_MS, FRESHEN_RETRY_MS } = require("./constants");

// The only rejection text ever measured.
const REQUIREMENT_MESSAGE = "Végső tárgykövetelmény nem teljesült";

// What the server says when registration is not open. Matched on a fragment so
// punctuation changes do not break it.
const NOT_OPEN_HINT = "nincs tárgyjelentkezési időszak";

// Only the measured response envelope is accepted. SubjectSignin's successful
// business payload is not measured yet, so an empty notification array means only
// "the request was answered without a known business error"; the UI must still ask
// the user to verify the result in Neptun.
function classifyResponse(body) {
  if (
    !body ||
    typeof body !== "object" ||
    !Array.isArray(body.notification) ||
    !Object.prototype.hasOwnProperty.call(body, "data")
  ) {
    return {
      kind: "unknown",
      message: "Érvénytelen vagy ismeretlen szerverválasz.",
    };
  }
  const errors = body.notification.filter(n => n && n.type === 3);
  const status = body && body[STATUS_KEY];
  if (errors.length === 0) {
    if (typeof status === "number" && status !== 0 && (status < 200 || status > 299)) {
      return {
        kind: "unknown",
        message: `Ismeretlen szerverválasz (HTTP ${status}).`,
      };
    }
    if (body.notification.length > 0) {
      return {
        kind: "unknown",
        message: "Ismeretlen szerverértesítés.",
      };
    }
    return { kind: "submitted" };
  }
  const message = errors[0].description || "";
  const lowered = message.toLowerCase();
  if (lowered.indexOf(NOT_OPEN_HINT) !== -1) {
    return { kind: "notOpen", message };
  }
  if (message === REQUIREMENT_MESSAGE) {
    return { kind: "requirement", message };
  }
  return { kind: "unknown", message };
}

function validateCourseList(body) {
  const result = classifyResponse(body);
  if (result.kind !== "submitted") {
    return result;
  }
  if (!Array.isArray(body.data)) {
    return {
      kind: "unknown",
      message: "Érvénytelen kurzuslista érkezett.",
    };
  }
  return { kind: "ok" };
}

// One courseId per group, highest-ranked first, skipping anything full, already held
// or already queued on. Null as soon as one group has nothing left to offer.
function chooseCombination(groups, courseIndex, excluded) {
  const courseIds = [];
  for (const group of groups) {
    const pick = group.ranking.find(id => {
      if (excluded.has(id)) {
        return false;
      }
      const course = courseIndex.get(id);
      return Boolean(course) && course.isFull === false && course.isSigned !== true && course.isOnWaitingList !== true;
    });
    if (!pick) {
      return null;
    }
    courseIds.push(pick);
  }
  return courseIds;
}

// What the course list says about the courses just submitted, read right after the
// submission was answered. Only the student's own status decides, never a seat
// forecast: `isSigned` on every sent course -> "registered" (measured: true exactly on
// the courses the student holds), `isOnWaitingList` on any of them -> "waitlisted".
// Anything else (a course missing from the list, a field not carried, `isSigned`
// still false) is null, and the outcome stays "submitted", sending the user to
// Neptun to check.
function submissionOutcome(courseIndex, courseIds) {
  const courses = (courseIds || []).map(id => courseIndex && courseIndex.get(id));
  if (courses.length === 0 || courses.some(course => !course)) {
    return null;
  }
  if (courses.some(course => course.isOnWaitingList === true)) {
    return "waitlisted";
  }
  return courses.every(course => course.isSigned === true) ? "registered" : null;
}

// How many local ms remain until the local clock reaches the point the server clock
// would read `targetEpochMs`. Falls back to offset 0 before any response has told us.
function msUntilTarget(targetEpochMs, serverOffsetMs, nowMs) {
  const offset = typeof serverOffsetMs === "number" ? serverOffsetMs : 0;
  return targetEpochMs - offset - nowMs;
}

// The tab title while armed and after the run, so a background tab still shows where
// the Rajtoló stands. `base` is the page's own title, restored afterwards.
function runTitle(waitMs, done, base) {
  if (done) {
    return `✔ Rajtoló kész – ${base}`;
  }
  return `${waitMs > 0 ? formatCountdown(waitMs) : "Rajtoló fut…"} – ${base}`;
}

// Whether the armed Rajtoló should make the page renew its session now. Pressing
// the search button renews only an expired token, so before the start this waits for
// the token to run out; the keep-alive fires only long after that anyway. Local
// clock on purpose: Neptun judges the token's expiry by this browser's clock too.
function sessionChore(nowMs, waitMs, timing, lastAttemptMs) {
  if (typeof lastAttemptMs === "number" && nowMs - lastAttemptMs < FRESHEN_RETRY_MS) {
    return false;
  }
  const expired = !timing || typeof timing.expiresAtMs !== "number" || timing.expiresAtMs <= nowMs;
  if (expired && waitMs <= PRESTART_FRESHEN_MS) {
    return true;
  }
  // Expired as well as old: a longer-lived token elsewhere would not be renewed by
  // the press, which would then only repeat and warn.
  return (
    expired && Boolean(timing) && typeof timing.issuedAtMs === "number" && nowMs - timing.issuedAtMs >= KEEPALIVE_AGE_MS
  );
}

// Whether a request would go out on a token the server already refuses.
function tokenExpired(timing, nowMs) {
  return Boolean(timing) && typeof timing.expiresAtMs === "number" && timing.expiresAtMs <= nowMs;
}

// Neptun's period dates and the datetime-local field carry no offset: they are
// Hungarian wall-clock time. Date.parse reads such a string in THIS browser's zone,
// which put the start an hour or more off for a student registering from abroad.
const NEPTUN_TIME_ZONE = "Europe/Budapest";
const WALL_CLOCK_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/;

// How far `timeZone`'s wall clock runs ahead of UTC at `epochMs`.
function zoneOffsetMs(epochMs, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(epochMs));
  const field = type => Number(parts.find(part => part.type === type).value);
  const wall = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    field("hour"),
    field("minute"),
    field("second")
  );
  return wall - Math.floor(epochMs / 1000) * 1000;
}

// "2026-02-02T10:00" as Budapest time -> epoch ms. NaN for anything unparseable.
function wallClockToEpoch(value, timeZone = NEPTUN_TIME_ZONE) {
  const match = typeof value === "string" && WALL_CLOCK_RE.exec(value);
  if (!match) {
    return NaN;
  }
  const [year, month, day, hour, minute, second] = match.slice(1).map(part => Number(part || 0));
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  try {
    // The second pass re-reads the offset at the first guess, which is what keeps a
    // time right next to a daylight-saving switch correct.
    const guess = asUtc - zoneOffsetMs(asUtc, timeZone);
    return asUtc - zoneOffsetMs(guess, timeZone);
  } catch (e) {
    // No time zone data in this engine: the browser's own zone, as before.
    return Date.parse(value);
  }
}

function isNeptunTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone === NEPTUN_TIME_ZONE;
  } catch (e) {
    return true;
  }
}

// The period a student most likely means: the earliest one that is still open or yet
// to open. Only when every period is over does it fall back to the latest. A period
// without a readable closing time counts as still open.
function defaultPeriod(periods, nowMs) {
  const list = periods || [];
  const start = period => wallClockToEpoch(period.fromDate);
  const live = list.filter(period => {
    const end = wallClockToEpoch(period.toDate);
    return Number.isNaN(end) || end > nowMs;
  });
  if (live.length > 0) {
    return live.reduce((best, period) => (start(period) < start(best) ? period : best));
  }
  return list.reduce((best, period) => (!best || start(period) > start(best) ? period : best), null);
}

function formatCountdown(ms) {
  if (ms <= 0) {
    return "indul…";
  }
  const totalSeconds = Math.ceil(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (days) {
    parts.push(`${days} nap`);
  }
  if (days || hours) {
    parts.push(`${hours}ó`);
  }
  if (days || hours || minutes) {
    parts.push(`${minutes}p`);
  }
  parts.push(`${seconds}mp`);
  return parts.join(" ");
}

const STATUS_LABELS = {
  idle: () => "Vár",
  running: () => "Folyamatban…",
  submitted: () => "Beküldve — ellenőrizd a Neptunban",
  registered: () => "Felvéve (a Neptun kurzuslistája szerint)",
  waitlisted: () => "Várólistára került, ellenőrizd a Neptunban",
  requirement: () => "Követelmény nem teljesült",
  full: () => "Betelt (a próbálkozások kimerültek)",
  exhausted: () => "Nincs elérhető kurzus",
  unconfigured: () => "Nincs rangsorolva kurzus ehhez a tárgyhoz — kihagyva",
  notOpen: () => "Még nincs tárgyjelentkezési időszak",
  unknown: () => "Ismeretlen hiba — a teljes futás leállt",
  stopped: () => "Leállítva",
};

// Which tone a run outcome deserves. Only a confirmed registration is green: a
// waiting-list place or an unconfirmed submission is neither a win nor a failure.
function toastTone(kind) {
  if (kind === "registered") {
    return "ok";
  }
  return kind === "submitted" || kind === "waitlisted" ? "warn" : "error";
}

function statusLabel(kind, message) {
  const known = STATUS_LABELS[kind];
  const label = known ? known() : kind;
  return message ? `${label}: ${message}` : label;
}

function courseLabel(course) {
  return `${course.code || "Kurzusadat betöltése…"}${course.isRankingCourse ? RANKING_NOTE() : ""}`;
}

module.exports = {
  classifyResponse,
  validateCourseList,
  chooseCombination,
  submissionOutcome,
  msUntilTarget,
  sessionChore,
  tokenExpired,
  runTitle,
  wallClockToEpoch,
  isNeptunTimeZone,
  defaultPeriod,
  formatCountdown,
  statusLabel,
  courseLabel,
  toastTone,
  REQUIREMENT_MESSAGE,
  NOT_OPEN_HINT,
};
