const assert = require("assert");
const conflictHints = require("../src/modules/courseConflictHints");
const compact = require("../src/modules/compactSubjectRegistration");

// The data-fetch/merge logic (collectScheduleSubjects, collectCourses,
// collectPlannerCourses, buildBaseline) moved to
// src/registrationData.js and is tested there (test/registrationData.test.js) - not
// duplicated here. What is left in this module, and tested here, is the DOM-painting
// prep: findCourseConflicts, the three-state verdict (hintForCourse), and
// scheduleLines.

const session = (day, start, end, rooms) => ({
  day,
  dayLabel: ["", "Hétfő", "Kedd", "Szerda", "Csütörtök"][day],
  start,
  end,
  rooms: rooms || "",
});

function course(id, subjectId, code, slots, isSigned) {
  return { id, subjectId, code, type: "", isSigned: Boolean(isSigned), slots };
}

// --- findCourseConflicts: candidate vs. an already-built baseline ------------------
const subjectPlanned = { title: "Tervezett tárgy", code: "SUB-1" };
const subjectRegistered = { title: "Felvett tárgy", code: "SUB-2" };

const coursePlanned = course("c-planned", "s-planned", "PLAN-01", [session(1, 600, 720, "")]);
const courseRegistered = course("c-registered", "s-registered", "REG-01", [session(1, 690, 780, "")], true);
const candidate = course("candidate", "s-candidate", "NEW-01", [session(1, 660, 750, "")]);
const touching = course("touching", "s-candidate", "NEW-02", [session(1, 780, 840, "")]);
const noSchedule = course("no-schedule", "s-candidate", "NEW-03", []);

const baseline = [
  { course: coursePlanned, subject: subjectPlanned, source: "planned" },
  { course: courseRegistered, subject: subjectRegistered, source: "registered" },
];

assert.strictEqual(
  conflictHints.findCourseConflicts(candidate, baseline).length,
  2,
  "a candidate reports every conflicting planned/registered course"
);
assert.strictEqual(
  conflictHints.findCourseConflicts(coursePlanned, baseline).some(hit => hit.other.course.id === coursePlanned.id),
  false,
  "a course never conflicts with itself"
);
assert.strictEqual(
  conflictHints.findCourseConflicts(touching, baseline).length,
  0,
  "back-to-back times do not overlap"
);

// --- hintForCourse: the three-state verdict -----------------------------------------
// This is the core fix. The old version only ever said {tone:"warning"} or
// {tone:"ok"}, and painted nothing for "ok" - so a working "no clash" and a broken
// "never checked" looked identical on screen. The three states below must stay
// distinguishable, and an incomplete baseline must never be allowed to claim "no
// clash".

// 1) a genuine clash is reported by name, with a count, and survives a warning
// regardless of baselineComplete - a course the student already holds is real
// evidence on its own, even while other parts of the baseline are still loading.
const warningHu = conflictHints.hintForCourse(candidate, baseline, true);
assert.strictEqual(warningHu.tone, "warning");
assert.strictEqual(warningHu.count, 2);
assert.strictEqual(warningHu.count, warningHu.lines.length, "the count matches the number of reported clashes");
assert.strictEqual(warningHu.label, "Ütközik (+1)", "the label stays compact while the title names the clash");
assert.ok(
  warningHu.lines.some(line => line.includes("Felvett tárgy")) &&
    warningHu.lines.some(line => line.includes("Tervezett tárgy")),
  "the full per-conflict list stays in the lines/title"
);
const internalOnlyConflict = conflictHints.hintForCourse(
  candidate,
  [{ course: course("internal-course-id", "internal-subject-id", "", [session(1, 660, 780, "")]), subject: {} }],
  true
);
assert.ok(internalOnlyConflict.lines[0].includes("Ismeretlen tárgy"), "missing labels get a human fallback");
assert.ok(!internalOnlyConflict.lines[0].includes("internal-course-id"), "internal IDs never reach the UI");
assert.strictEqual(
  conflictHints.hintForCourse(candidate, baseline, false).tone,
  "warning",
  "a real clash is never suppressed just because the baseline is still incomplete"
);

// 2) no clash, and the baseline is known to be complete: a visible, confirmatory
// verdict - not silence.
const confirmedHu = conflictHints.hintForCourse(touching, baseline, true);
assert.strictEqual(confirmedHu.tone, "ok");
assert.strictEqual(confirmedHu.count, 0);
assert.strictEqual(confirmedHu.label, "Nincs ütközés", "the clear verdict is shown, not silence");
const withUntimed = conflictHints.hintForCourse(
  touching,
  baseline.concat([{ course: { id: "untimed", code: "SZD-01", slots: [] }, subject: { title: "Szakdolgozat" } }]),
  true
);
assert.strictEqual(withUntimed.label, "Nincs ismert ütközés", "a held course without a time was never checked");
assert.ok(withUntimed.title.includes("Szakdolgozat"), "and it is named");

// 2b) a course already enrolled in is left to Neptun's native "Kurzus felvéve" state.
// Even a registered row with a timetable conflict must not get our extra badge.
const enrolledCourse = course("enrolled", "s-enrolled", "ENROLLED-01", [session(1, 660, 750, "")], true);
assert.strictEqual(
  conflictHints.hintForCourse(enrolledCourse, baseline, false),
  null,
  "a registered course gets no redundant NPU conflict badge"
);

// 3a) no clash, but the baseline is NOT known to be complete: this must never read as
// "no clash" - that would be exactly the silent false negative being fixed.
const uncertainHu = conflictHints.hintForCourse(touching, baseline, false);
assert.strictEqual(uncertainHu.tone, "unknown", 'an incomplete baseline is never reported as a clear "no clash"');
assert.notStrictEqual(uncertainHu.label, "Nincs ütközés");
assert.ok(uncertainHu.title, "the title explains why no verdict could be given");

// 3b) a course with no timetable of its own gets an explicit neutral label,
// whatever baselineComplete says - there is nothing here to compare against either way.
const noScheduleHint = conflictHints.hintForCourse(noSchedule, baseline, true);
assert.strictEqual(noScheduleHint.tone, "unknown");
assert.strictEqual(noScheduleHint.label, "Nincs órarend");
assert.strictEqual(
  conflictHints.hintForCourse(touching, baseline, false).label,
  "Nem ellenőrizhető",
  "an incomplete baseline gets an explicit explanation instead of a question mark"
);

// no known course at all: nothing to say, so no verdict object either.
assert.strictEqual(conflictHints.hintForCourse(null, baseline, true), null);

// --- uniqueCoursesByCode: ambiguous codes fail closed -------------------------------
const codeMap = new Map([
  ["candidate", candidate],
  ["duplicate", Object.assign({}, candidate, { id: "duplicate" })],
]);
assert.ok(!conflictHints.uniqueCoursesByCode(codeMap).has("NEW-01"), "ambiguous course codes fail closed");

// Compact mode is route-gated even after it has been enabled in settings.
const attrs = new Set();
const fakeRoot = {
  toggleAttribute(name, on) {
    if (on) attrs.add(name);
    else attrs.delete(name);
  },
};
compact.setRouteState("/hallgato_ng/subjects/registration", fakeRoot);
assert.ok(attrs.has(compact.ROOT_ATTRIBUTE));
compact.setRouteState("/hallgato_ng/dashboard", fakeRoot);
assert.ok(!attrs.has(compact.ROOT_ATTRIBUTE));

// --- the room and the extra sessions: measured data Neptun does not put on the row ---
// `rooms` came back on every measured classInstanceInfos entry and was collected but
// never displayed. The rule for showing it: only add a line when it carries something
// the row does not already say, or it is pure duplication.
assert.strictEqual(
  conflictHints.scheduleLines({ slots: [session(2, 720, 840, "")] }),
  null,
  "one session with no room is exactly what Neptun already shows"
);
// Neptun prints the first session's day and time itself. Repeating it put the same
// line on screen twice, which is what made the list unreadable - so only the room.
assert.deepStrictEqual(
  conflictHints.scheduleLines({ slots: [session(2, 720, 840, "Room 201")] }),
  ["Room 201"],
  "for the first session only the room is ours to add"
);
assert.deepStrictEqual(
  conflictHints.scheduleLines({ slots: [session(2, 720, 840, "Room 201"), session(4, 480, 600, "")] }),
  ["Room 201", "Csütörtök 08:00–10:00"],
  "a further session is absent from the row, so it is printed in full"
);
assert.deepStrictEqual(
  conflictHints.scheduleLines({ slots: [Object.assign(session(1, 840, 900, "A1/216"), { fromNote: true })] }),
  ["Hétfő 14:00–15:00 · A1/216"],
  "a slot read from the note is not on the row, so it is printed in full"
);
assert.strictEqual(conflictHints.scheduleLines({ slots: [] }), null, "no timetable, no line");
assert.strictEqual(conflictHints.scheduleLines(null), null, "a missing course must not throw");
