// Pure timetable decisions shared by the Rajtoló and the subject-registration
// conflict hints. These functions know nothing about the DOM, storage or network.

const TIME_RE = /^(\d{1,2}):(\d{2})$/;

// "16:00" -> 960. Null for anything unparseable, so malformed server data cannot
// silently turn into a midnight class.
function toMinutes(hhmm) {
  const match = typeof hhmm === "string" && TIME_RE.exec(hhmm);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

// dayOfWeek is the language-neutral comparison key. dayOfWeekText is only a label;
// it is never used to decide whether two classes collide.
function normaliseSlot(info) {
  if (!info) {
    return null;
  }
  const day = info.dayOfWeek;
  const start = toMinutes(info.startTime);
  const end = toMinutes(info.endTime);
  if (typeof day !== "number" || start === null || end === null || end <= start) {
    return null;
  }
  const slot = { day, start, end, rooms: info.rooms || "", dayLabel: info.dayOfWeekText || "" };
  // Every measured slot said `repetition: true`; what false means is unknown, so it
  // is only flagged, and still checked as if it ran every week.
  if (info.repetition === false) {
    slot.irregular = true;
  }
  return slot;
}

// Some tutors leave Neptun's schedule empty and type the class into the course note
// instead ("Hétfő 14-15, A1/216"). Only full day names are recognised: a lone "K" or
// "P" is too ambiguous in free text. Neptun's dayOfWeek: 1 = Monday, verified; Sunday
// as 0 follows the .NET enum and is unverified.
// ponytail: full Hungarian day names only, add abbreviations if real notes need them.
const NOTE_DAYS = [
  ["vas[aá]rnap", 0, "Vasárnap"],
  ["h[eé]tf[oőö]", 1, "Hétfő"],
  ["kedd", 2, "Kedd"],
  ["szerd[aá]", 3, "Szerda"],
  ["cs[uüű]t[oöő]rt[oöő]k", 4, "Csütörtök"],
  ["p[eé]ntek", 5, "Péntek"],
  ["szombat", 6, "Szombat"],
];
const NOTE_DAY_SOURCE = NOTE_DAYS.map(([pattern]) => pattern).join("|");
// After a comma comes the room, unless it is the next day ("Hétfő 14-15, Kedd 10-12").
const NOTE_SLOT_RE = new RegExp(
  `(${NOTE_DAY_SOURCE})\\S*\\s*(\\d{1,2})(?:[:.](\\d{2}))?\\s*(?:h|óra)?\\s*[-–—]\\s*(\\d{1,2})(?:[:.](\\d{2}))?(?!\\.?\\s*h[eé]t)(?:\\s*(?:h|óra)\\b)?(?:\\s*,(?!\\s*(?:${NOTE_DAY_SOURCE}))\\s*([^,;\\n]+))?`,
  "gi"
);

function clock(hours, minutes) {
  return `${hours}:${minutes || "00"}`;
}

// Normalised slots read out of a course note, marked `fromNote` because Neptun shows
// none of them on the row. Empty for anything that does not look like a class time.
function slotsFromNote(note) {
  if (typeof note !== "string" || !note.trim()) {
    return [];
  }
  return Array.from(note.matchAll(NOTE_SLOT_RE))
    .map(match => {
      const day = NOTE_DAYS.find(([pattern]) => new RegExp(`^${pattern}$`, "i").test(match[1]));
      const slot = normaliseSlot({
        dayOfWeek: day[1],
        dayOfWeekText: day[2],
        startTime: clock(match[2], match[3]),
        endTime: clock(match[4], match[5]),
        rooms: match[6] ? match[6].trim() : "",
      });
      return slot && Object.assign(slot, { fromNote: true });
    })
    .filter(Boolean);
}

// Off until the owning module's settings switch turns it on, so a user who disabled
// it never gets a guess read out of free text.
let noteSlotsEnabled = false;
function setNoteSlotsEnabled(enabled) {
  noteSlotsEnabled = Boolean(enabled);
}

// A course row's slots: Neptun's own schedule, or the note when that is empty.
function courseSlots(row, infos) {
  const list = Array.isArray(infos)
    ? infos
    : row && Array.isArray(row.classInstanceInfos)
      ? row.classInstanceInfos
      : [];
  const slots = list.map(normaliseSlot).filter(Boolean);
  return slots.length > 0 || !noteSlotsEnabled ? slots : slotsFromNote(row && row.note);
}

// Half-open intervals: a class ending at 18:00 and another beginning at 18:00 are
// back-to-back, not a conflict.
function slotsOverlap(a, b) {
  if (!a || !b || a.day === undefined || a.day === null || b.day === undefined || b.day === null) {
    return false;
  }
  if (typeof a.start !== "number" || typeof a.end !== "number") {
    return false;
  }
  if (typeof b.start !== "number" || typeof b.end !== "number") {
    return false;
  }
  return a.day === b.day && a.start < b.end && b.start < a.end;
}

// Every clashing pair among picks shaped as { course: { id, slots } }. A pair is
// reported once even if more than one of its slots overlaps.
function findPlanConflicts(picks) {
  const conflicts = [];
  for (let i = 0; i < picks.length; i++) {
    for (let j = i + 1; j < picks.length; j++) {
      const a = picks[i];
      const b = picks[j];
      if (!a || !b || !a.course || !b.course || a.course.id === b.course.id) {
        continue;
      }
      const slotsA = a.course.slots || [];
      const slotsB = b.course.slots || [];
      let hit = null;
      for (let x = 0; x < slotsA.length && !hit; x++) {
        for (let y = 0; y < slotsB.length && !hit; y++) {
          if (slotsOverlap(slotsA[x], slotsB[y])) {
            hit = { slotA: slotsA[x], slotB: slotsB[y] };
          }
        }
      }
      if (hit) {
        conflicts.push({ a, b, slotA: hit.slotA, slotB: hit.slotB });
      }
    }
  }
  return conflicts;
}

module.exports = {
  toMinutes,
  normaliseSlot,
  slotsFromNote,
  setNoteSlotsEnabled,
  courseSlots,
  slotsOverlap,
  findPlanConflicts,
};
