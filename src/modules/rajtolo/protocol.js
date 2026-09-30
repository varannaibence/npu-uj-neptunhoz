// Which courses a click sends for a subject, and what Neptun's answers mean. Pure.
const { RANKING_NOTE, STATUS_KEY } = require("./constants");
const { pruneGroups } = require("./plan");

// Whether the student already holds, or is queued on, a ranked course of this subject.
// Ticking the next-ranked course then would ask for a swap nobody wanted, so such a
// subject is left alone.
function holdsRankedCourse(groups, courseIndex) {
  return groups.some(group =>
    group.ranking.some(id => {
      const course = courseIndex.get(id);
      return Boolean(course) && (course.isSigned === true || course.isOnWaitingList === true);
    })
  );
}

// The course to tick in one group, only ever from the group's own ranking, never a
// full one. `mode` (constants.WAITLIST_MODES) decides between a seat and a queue place
// (invariant 5: a waiting list is not a seat): by default the highest-ranked with a
// seat, else the highest-ranked that only queues. "never" takes only a course whose
// forecast is known to be a seat. `excluded` holds courses that filled during this
// click. Null when the group has nothing left to offer.
function pickCourse(group, courseIndex, mode = "seatFirst", excluded = new Set()) {
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
  return pick || null;
}

// What a click sends for one subject, from the course list just read. One pick per
// group; a group whose every ranked course is full gets none. A subject the student
// already holds a ranked course of gets nothing: the next one would ask for a swap.
//   pick        every group has a course
//   partial     some groups do, the rest are full
//   exhausted   no group has one
//   held        a ranked course is already taken or queued on
//   unconfigured nothing ranked that still exists
function preselection(groups, courseIndex, mode, excluded) {
  const live = pruneGroups(groups, Array.from(courseIndex.values()));
  if (live.length === 0) {
    return { kind: "unconfigured", picks: [] };
  }
  if (holdsRankedCourse(live, courseIndex)) {
    return { kind: "held", picks: [] };
  }
  const picks = live.map(group => ({ group, courseId: pickCourse(group, courseIndex, mode, excluded) }));
  const found = picks.filter(pick => pick.courseId).length;
  const kind = found === picks.length ? "pick" : found > 0 ? "partial" : "exhausted";
  return { kind, picks };
}

// A course list is used only in the measured envelope: 2xx, no error notification, an
// array of rows. Anything else is reported in words, never guessed at. httpRequest's
// own failures (no login, network, timeout) arrive as an error notification too.
function listProblem(json) {
  const notes = json && Array.isArray(json.notification) ? json.notification : null;
  const error = notes && notes.find(note => note && note.type === 3);
  if (error) {
    return error.description || "A Neptun hibát jelzett.";
  }
  const status = json && json[STATUS_KEY];
  if (typeof status === "number" && status !== 0 && (status < 200 || status > 299)) {
    return `A kurzuslista nem tölthető be (HTTP ${status}).`;
  }
  return json && Array.isArray(json.data) ? null : "A kurzuslista nem tölthető be.";
}

// The answer to a SubjectSignin. The success shape is read from Neptun's own client
// (docs/API.md, "A natív kliens elvárásai"), not measured, so only explicit fields
// decide, and anything else sends the student to check in Neptun (invariant 4: no
// success from the HTTP status alone). An error without an HTTP status is httpRequest's
// own - a timeout or a lost connection, which may have gone through: never a refusal.
function signinOutcome(json, status, courseIds) {
  const notes = json && Array.isArray(json.notification) ? json.notification : null;
  const error = notes && notes.find(note => note && note.type === 3);
  if (error) {
    const kind = typeof status === "number" && status > 0 ? "rejected" : "unknown";
    return { kind, message: error.description || "" };
  }
  if (!(status >= 200 && status <= 299) || !notes || !json.data || typeof json.data !== "object") {
    return { kind: "unknown", message: status ? `HTTP ${status}` : "" };
  }
  if (notes.length > 0) {
    return {
      kind: "unknown",
      message: notes
        .map(note => note && note.description)
        .filter(Boolean)
        .join(" "),
    };
  }
  if (json.data.isWaiting === true) {
    return { kind: "waitlisted" };
  }
  const signed = json.data.signedCourses || {};
  const all = courseIds.length > 0 && courseIds.every(id => signed[id] && signed[id].isSigned === true);
  return { kind: all ? "registered" : "submitted" };
}

// What a course list read after an unclear answer says about the courses just sent.
// Only the student's own, measured fields decide (invariant 5): `isOnWaitingList` on any
// of them -> waitlisted, `isSigned` on all -> registered. Null otherwise.
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

// A finished subject: its button turns into the result and stays off.
const DONE = ["registered", "waitlisted"];

function listText(items) {
  return items.join(", ");
}

// One line under the subject for every outcome of a click.
function outcomeText(outcome) {
  const message = outcome.message ? `: ${outcome.message}` : "";
  const codes = outcome.codes && outcome.codes.length > 0 ? ` (${listText(outcome.codes)})` : "";
  switch (outcome.kind) {
    case "registered":
      return `Felvéve${codes}.`;
    case "waitlisted":
      return `Várólistára került${codes}.`;
    case "submitted":
      return `Elküldve${codes}. Az eredményt nézd meg a Neptunban.`;
    case "rejected":
      return `A Neptun nem vette fel${message}`;
    case "incomplete": {
      const filled = outcome.filled && outcome.filled.length > 0 ? ` (közben betelt: ${listText(outcome.filled)})` : "";
      return `${listText(outcome.empty)}: nincs szabad kurzus a sorrendedben${filled}. Válassz kézzel a Neptunban, vagy kapcsolj be másik kurzust a Rajtolóhoz.`;
    }
    case "held":
      return "Ebből a tárgyból már van felvett vagy várólistás kurzusod.";
    case "stopped":
      return "Leállt, nem ment el.";
    case "unknown":
      return `Bizonytalan, nézd meg a Neptunban${message}`;
    default:
      return outcome.message || "Nem sikerült, próbáld újra.";
  }
}

function outcomeTone(kind) {
  if (kind === "registered") {
    return "ok";
  }
  return kind === "rejected" || kind === "failed" ? "error" : "warn";
}

// Neptun's dates carry no offset: they are Hungarian wall-clock time. Date.parse
// reads such a string in THIS browser's zone, an hour or more off abroad.
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

function courseLabel(course) {
  return `${course.code || "Ismeretlen kurzus"}${course.isRankingCourse ? RANKING_NOTE() : ""}`;
}

module.exports = {
  holdsRankedCourse,
  pickCourse,
  preselection,
  listProblem,
  signinOutcome,
  submissionOutcome,
  outcomeText,
  outcomeTone,
  DONE,
  wallClockToEpoch,
  courseLabel,
};
