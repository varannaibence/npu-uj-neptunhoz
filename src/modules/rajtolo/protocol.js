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
    // httpRequest's own failures (timeout, network, no login) carry their reason: a
    // timed-out POST must say the registration may have gone through.
    const own = body && Array.isArray(body.notification) && body.notification.find(n => n && n.description);
    return {
      kind: "unknown",
      message: own ? own.description : "Érvénytelen vagy ismeretlen szerverválasz.",
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

// Whether the student already holds, or is queued on, a ranked course of this subject.
// Picking the next-ranked course then would send a swap nobody asked for, so the run
// leaves such a subject alone.
function holdsRankedCourse(groups, courseIndex) {
  return groups.some(group =>
    group.ranking.some(id => {
      const course = courseIndex.get(id);
      return Boolean(course) && (course.isSigned === true || course.isOnWaitingList === true);
    })
  );
}

// One courseId per group, only ever from the group's own ranking, skipping anything
// full. `mode` (constants.WAITLIST_MODES) decides between a seat and a queue place
// (invariant 5: a waiting list is not a seat): by default the highest-ranked with a
// seat, else the highest-ranked that only queues. "never" takes only a course whose
// forecast is known to be a seat. Null as soon as one group has nothing left to
// offer, or when the student already holds a ranked course of this subject.
function chooseCombination(groups, courseIndex, excluded, mode = "seatFirst") {
  if (holdsRankedCourse(groups, courseIndex)) {
    return null;
  }
  const courseIds = [];
  for (const group of groups) {
    const open = group.ranking.filter(id => {
      const course = courseIndex.get(id);
      return (
        !excluded.has(id) &&
        Boolean(course) &&
        course.isFull === false &&
        (mode !== "never" || course.willBeOnWaitingList === false)
      );
    });
    const pick =
      mode === "seatFirst" ? open.find(id => courseIndex.get(id).willBeOnWaitingList !== true) || open[0] : open[0];
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

const MONTHS = [
  "január",
  "február",
  "március",
  "április",
  "május",
  "június",
  "július",
  "augusztus",
  "szeptember",
  "október",
  "november",
  "december",
];
const WEEKDAYS = ["vasárnap", "hétfő", "kedd", "szerda", "csütörtök", "péntek", "szombat"];

// "2026-02-02T10:00" -> "2026. február 2., hétfő 10:00". Wall-clock text in and out:
// the weekday comes from the date alone, never through this browser's time zone.
// Null for anything unparseable.
function formatWallClock(value) {
  const match = typeof value === "string" && WALL_CLOCK_RE.exec(value);
  if (!match) {
    return null;
  }
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  const clock = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return `${year}. ${MONTHS[month - 1]} ${day}., ${weekday} ${clock}`;
}

// A coarse "how far off", for the idle panel: it is not redrawn every second, so it
// must not show seconds that would stand still. `ms` is positive.
function formatDistance(ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days) {
    return hours ? `${days} nap ${hours} óra` : `${days} nap`;
  }
  if (hours) {
    return rest ? `${hours} óra ${rest} perc` : `${hours} óra`;
  }
  return `${rest} perc`;
}

// The armed countdown's one line; the tick rewrites it every second or two.
function countdownText(waitMs) {
  return waitMs > 0 ? `${formatCountdown(waitMs)} múlva indul` : "Indul…";
}

// What has to hold before the Rajtoló may be armed, in the order a missing one is
// reported: the dialog lists them, and Start refuses on the first failing one, so the
// two can never disagree. `nowMs` is the server-corrected now; NaN means unknown.
// The period check is left out while no period with a closing time is chosen.
function startChecks({ hasAuth, subjectCount, startMs, closeMs, nowMs }) {
  const timed = !Number.isNaN(startMs);
  const checks = [
    {
      id: "auth",
      ok: hasAuth,
      text: hasAuth ? "Bejelentkezve" : "Nincs érzékelt bejelentkezés",
      problem: "Nincs érzékelt bejelentkezés - jelentkezz be, majd nyisd meg újra ezt az oldalt.",
    },
    {
      id: "plan",
      ok: subjectCount > 0,
      text: subjectCount > 0 ? `${subjectCount} tárgy a sorban` : "Nincs tárgy a sorban",
      problem: "Adj hozzá legalább egy tárgyat a listához.",
    },
    {
      id: "time",
      ok: timed,
      text: timed ? "Nyitás megadva" : "Nincs nyitási időpont",
      problem: "Adj meg egy érvényes nyitási időpontot.",
    },
  ];
  if (!Number.isNaN(closeMs)) {
    const open = closeMs > nowMs;
    checks.push({
      id: "period",
      ok: open,
      text: open ? "Az időszak még nem zárult le" : "Az időszak már lezárult",
      problem: "A kiválasztott tárgyjelentkezési időszak már lezárult.",
    });
  }
  return checks;
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
  sent: () => "Beküldve — az eredményt a többi tárgy után ellenőrzi",
  watching: () => "Minden kurzus betelt — figyeli, szabad helyre azonnal jelentkezik",
  submitted: () => "Beküldve — ellenőrizd a Neptunban",
  registered: () => "Felvéve (a Neptun kurzuslistája szerint)",
  waitlisted: () => "Várólistára került, ellenőrizd a Neptunban",
  requirement: () => "Követelmény nem teljesült",
  full: () => "Betelt (a próbálkozások kimerültek)",
  exhausted: () => "Nincs elérhető kurzus",
  held: () => "Már van felvett vagy várólistás kurzusod ebből a tárgyból — kihagyva, ellenőrizd a Neptunban",
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
  return kind === "submitted" || kind === "waitlisted" || kind === "held" ? "warn" : "error";
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
  holdsRankedCourse,
  submissionOutcome,
  msUntilTarget,
  sessionChore,
  tokenExpired,
  runTitle,
  wallClockToEpoch,
  formatWallClock,
  formatDistance,
  countdownText,
  startChecks,
  isNeptunTimeZone,
  defaultPeriod,
  formatCountdown,
  statusLabel,
  courseLabel,
  toastTone,
  REQUIREMENT_MESSAGE,
  NOT_OPEN_HINT,
};
