const assert = require("assert");
const view = require("../src/modules/subjectRegistrationView");

function slot(day, start, end, rooms, dayLabel) {
  return { day, start, end, rooms: rooms || "", dayLabel: dayLabel || "" };
}

// --- uniformField: the common value across courses, or null -----------------------
assert.strictEqual(view.uniformField([{ type: "Labor" }, { type: "Labor" }], "type"), "Labor", "every course agrees");
assert.strictEqual(
  view.uniformField([{ type: "Labor" }, { type: "Elmélet" }], "type"),
  null,
  "a disagreement is null, not a guess"
);
assert.strictEqual(view.uniformField([{ type: "" }, { type: null }], "type"), null, "no real value anywhere is null");
assert.strictEqual(view.uniformField([], "type"), null, "an empty list has no common value");
assert.strictEqual(view.uniformField([{ type: "Labor" }], "type"), "Labor", "a single course is its own common value");
// Blank/missing entries are skipped rather than treated as a third, disagreeing value -
// this is what lets the function still find a common tutor once registrationData
// carries one, even if a row or two came back without it.
assert.strictEqual(view.uniformField([{ tutor: "Dr. X" }, { tutor: "" }, { tutor: "Dr. X" }], "tutor"), "Dr. X");

// --- groupByType: keyed by the language-NEUTRAL comparationTypeId, not `type` -----
// The display `type` label is not a stable identity key. comparationTypeId is the
// measured grouping key; `type` remains display-only.
const grouped = view.groupByType([
  { id: "c1", type: "Elmélet", comparationTypeId: "ct-elm" },
  { id: "c2", type: "Labor", comparationTypeId: "ct-lab" },
  { id: "c3", type: "Elmélet", comparationTypeId: "ct-elm" },
  { id: "c4", type: "", comparationTypeId: null },
]);
assert.strictEqual(grouped.size, 3, "one group per distinct comparationTypeId, plus the fallback group");
assert.strictEqual(grouped.get("ct-elm").length, 2, "both Elmélet courses share their real comparationTypeId");
assert.strictEqual(grouped.get("ct-lab").length, 1);

// two courses with the SAME display `type` text but a DIFFERENT comparationTypeId
// must not be merged - grouping is no longer keyed on that text at all.
const distinctGuids = view.groupByType([
  { id: "a", type: "Labor", comparationTypeId: "guid-1" },
  { id: "b", type: "Labor", comparationTypeId: "guid-2" },
]);
assert.strictEqual(distinctGuids.size, 2, "identical type text with different comparationTypeId stays split");

// courses with different display labels are still grouped correctly because
// comparationTypeId, not `type`, is the key.
const mixedLanguageLabels = view.groupByType([
  { id: "hu-row", type: "Labor", comparationTypeId: "same-guid" },
  { id: "en-row", type: "Laboratory", comparationTypeId: "same-guid" },
]);
assert.strictEqual(mixedLanguageLabels.size, 1, "same comparationTypeId groups together regardless of display text");

// comparationTypeId missing: falls back to a type-derived key, kept distinguishable
// from a real guid by its own prefix so it can never collide with one.
const fallbackGrouped = view.groupByType([
  { id: "x1", type: "Elmélet", comparationTypeId: null },
  { id: "x2", type: "Labor", comparationTypeId: null },
]);
assert.strictEqual(fallbackGrouped.size, 2, "the fallback still separates distinct type text");
assert.ok(!fallbackGrouped.has("Elmélet"), "the fallback key is not the bare type text");

// --- sectionTypeLabel: the section HEADING text, independent of the grouping key ---
assert.strictEqual(
  view.sectionTypeLabel([
    { type: "Labor", comparationTypeId: "g" },
    { type: "Labor", comparationTypeId: "g" },
  ]),
  "Labor"
);
assert.strictEqual(
  view.sectionTypeLabel([{ type: "Labor" }, { type: "Laboratory" }]),
  "Labor",
  "a disagreement (should not happen within one real group) falls back to the first course's own text"
);
assert.strictEqual(view.sectionTypeLabel([{ type: "" }]), "", "no label available is an empty string, not a guess");

// --- differsFromUniform: the rule behind "csak akkor marad a soron, ha eltér" -----
assert.strictEqual(view.differsFromUniform("Dr. X", "Dr. X"), false, "matches the common value - stays off the row");
assert.strictEqual(view.differsFromUniform("Dr. Y", "Dr. X"), true, "differs from the common value - shown");
assert.strictEqual(view.differsFromUniform(null, "Dr. X"), false, "nothing to show is never shown");
assert.strictEqual(
  view.differsFromUniform("Dr. Y", null),
  true,
  "no common value at all - every course's own value is worth showing"
);
assert.strictEqual(view.differsFromUniform(null, null), false, "still nothing to show without a value");

// --- conflictVerdict: three states, never collapsed to two -------------------------
const candidate = { id: "cand", slots: [slot(1, 600, 720)] };
const clashingEntry = {
  course: { id: "other", slots: [slot(1, 660, 780)] },
  subject: { title: "Minta tárgy" },
};
const clearEntry = { course: { id: "clear", slots: [slot(2, 600, 720)] }, subject: { title: "Másik tárgy" } };

// 1) a course with no timetable of its own: explicitly not comparable, whatever the baseline says
assert.strictEqual(view.conflictVerdict({ id: "x", slots: [] }, [clashingEntry], true).state, "no-schedule");
assert.strictEqual(
  view.conflictVerdict({ id: "x" }, [clashingEntry], true).state,
  "no-schedule",
  "a missing slots array is also explicitly not comparable"
);
assert.strictEqual(
  view.conflictVerdict({ id: "signed", isSigned: true, slots: [slot(1, 600, 720)] }, [clashingEntry], false).state,
  "enrolled",
  "an enrolled course does not need a redundant clash verdict"
);

// 2) a genuine clash is reported by name, whatever baselineComplete says
const conflictVerdictHu = view.conflictVerdict(candidate, [clashingEntry], false);
assert.strictEqual(conflictVerdictHu.state, "conflict");
assert.ok(conflictVerdictHu.title.includes("Minta tárgy"), "the clashing subject is named, not just flagged");
assert.deepStrictEqual(conflictVerdictHu.names, ["Minta tárgy"]);
const internalOnlyVerdict = view.conflictVerdict(
  candidate,
  [{ course: { id: "internal-course-id", slots: [slot(1, 660, 780)] }, subject: {} }],
  true
);
assert.ok(internalOnlyVerdict.title.includes("Ismeretlen tárgy"), "missing labels get a human fallback");
assert.ok(!internalOnlyVerdict.title.includes("internal-course-id"), "internal IDs never reach the UI");
// the short label stays stable in a narrow table cell while the full reason remains
// available in the title
const longName = "Egy nagyon hosszú tárgynév, ami biztosan nem fér ki a jelvényre";
const longEntry = { course: { id: "long", slots: [slot(1, 660, 780)] }, subject: { title: longName } };
const longVerdict = view.conflictVerdict(candidate, [longEntry], true);
assert.strictEqual(longVerdict.label, "Ütközik", "the badge label stays compact");
assert.ok(longVerdict.title.includes(longName), "the full name survives in the tooltip");

// more than one clash: the label counts the rest instead of listing every name
const twoClashes = view.conflictVerdict(candidate, [clashingEntry, longEntry], true);
assert.strictEqual(twoClashes.names.length, 2);
assert.ok(twoClashes.label.includes("+1"), "a second clash is a count, not a second name crammed in");

// 3) no clash found, but the baseline is not complete: unknown, never a silent "ok"
assert.strictEqual(
  view.conflictVerdict(candidate, [clearEntry], false).state,
  "unknown",
  "an incomplete baseline must never be read as a clean verdict"
);

// 4) no clash, complete baseline: the only path that may say "ok"
const okVerdict = view.conflictVerdict(candidate, [clearEntry], true);
assert.strictEqual(okVerdict.state, "ok");
assert.strictEqual(okVerdict.label, "Nincs ütközés");

// a course never conflicts with an entry that IS itself
const selfEntry = { course: { id: "cand", slots: [slot(1, 600, 720)] }, subject: {} };
assert.strictEqual(
  view.conflictVerdict(candidate, [selfEntry], true).state,
  "ok",
  "a course cannot clash with its own baseline entry"
);

// --- sectionSummary -----------------------------------------------------------------
assert.strictEqual(view.sectionSummary("Labor", 4, 2), "Labor — 4 kurzus, 2 felvehető ütközés nélkül");
assert.strictEqual(
  view.sectionSummary("Elmélet", 1, 0, 1),
  "Elmélet — 1 kurzus, 1 felvett",
  "a registered course is described as enrolled, not available"
);
assert.strictEqual(
  view.sectionSummary("", 2, 0),
  "Kurzusok — 2 kurzus, 0 felvehető ütközés nélkül",
  "a blank type still gets a label"
);

// --- comparators: pure, so a stable sort is checkable without a DOM ----------------
function row(code, day, start, freeSeat) {
  return { course: { code, slots: typeof day === "number" ? [slot(day, start, start + 60)] : [] }, freeSeat };
}

const byTime = [row("B-02", 2, 480), row("A-01", 1, 600), row("C-03", 1, 480), row("D-04")].sort(view.compareByTime);
assert.deepStrictEqual(
  byTime.map(r => r.course.code),
  ["C-03", "A-01", "B-02", "D-04"],
  "earlier day/time first; a course with no schedule sorts last"
);

const byCode = [row("B-02"), row("A-01"), row("C-03")].sort(view.compareByCode);
assert.deepStrictEqual(
  byCode.map(r => r.course.code),
  ["A-01", "B-02", "C-03"]
);

const bySeats = [row("A-01", 1, 1, false), row("B-02", 1, 1, true), row("C-03", 1, 1, null)].sort(
  view.compareByFreeSeats
);
assert.deepStrictEqual(
  bySeats.map(r => r.course.code),
  ["B-02", "C-03", "A-01"],
  "free first, then unknown, then full/waitlisted last - unknown must not sink with full"
);

assert.deepStrictEqual(
  view.sortRows([row("B-02"), row("A-01")], "code").map(r => r.course.code),
  ["A-01", "B-02"]
);
assert.deepStrictEqual(
  view.sortRows([row("B-02"), row("A-01")], "bogus-mode").map(r => r.course.code),
  view.sortRows([row("B-02"), row("A-01")], "time").map(r => r.course.code),
  "an unrecognised sort mode falls back to the default, day/time"
);

// --- filter predicates --------------------------------------------------------------
const conflictRow = { verdict: { state: "conflict" }, freeSeat: true };
const okRow = { verdict: { state: "ok" }, freeSeat: true };
const unknownVerdictRow = { verdict: { state: "unknown" }, freeSeat: true };
assert.strictEqual(view.isConflictFree(conflictRow), false);
assert.strictEqual(view.isConflictFree(okRow), true);
assert.strictEqual(view.isConflictFree(unknownVerdictRow), true, "an unclear verdict is not treated as a known clash");

const fullRow = { verdict: { state: "ok" }, freeSeat: false };
const unknownSeatRow = { verdict: { state: "ok" }, freeSeat: null };
assert.strictEqual(view.hasFreeSeat(okRow), true);
assert.strictEqual(view.hasFreeSeat(fullRow), false);
assert.strictEqual(view.hasFreeSeat(unknownSeatRow), false, "an unknown seat count is not claimed as a free seat");

assert.deepStrictEqual(
  view.filterRows([conflictRow, okRow, unknownVerdictRow], { conflictFree: true, freeSeat: false }),
  [okRow, unknownVerdictRow],
  "conflictFree hides only a KNOWN clash"
);
assert.deepStrictEqual(view.filterRows([okRow, fullRow], { conflictFree: false, freeSeat: true }), [okRow]);
assert.deepStrictEqual(
  view.filterRows([okRow, fullRow], {}),
  [okRow, fullRow],
  "no filters active means nothing is hidden"
);

// --- seatCountText: "—" only for a real null, never for a measured 0 --------------
assert.strictEqual(view.seatCountText({ registeredStudentsCount: 7, maxLimit: 10 }), "7 / 10");
assert.strictEqual(
  view.seatCountText({ registeredStudentsCount: 0, maxLimit: 30 }),
  "0 / 30",
  "a measured 0 prints as 0, not as unknown"
);
assert.strictEqual(
  view.seatCountText({ registeredStudentsCount: null, maxLimit: 10 }),
  "—",
  "a field the server never sent is unknown, not zero"
);
assert.strictEqual(view.seatCountText({ registeredStudentsCount: 7, maxLimit: null }), "—");
assert.strictEqual(view.seatCountText({}), "—");
assert.strictEqual(view.seatCountText(undefined), "—", "a missing course must not throw");

// --- seatState: from isFull/willBeOnWaitingList alone, never isOnWaitingList and ---
// --- never count arithmetic. isOnWaitingList is a PERSONAL fact (am I already ------
// --- queued on a course I already applied to) - useless for a course being browsed;
// --- willBeOnWaitingList is the seat FORECAST (would a new application queue), which
// --- is what this column needs. occupancy.js's own seatState reads the same pair.
// AGENTS.md invariant 5: isFull is not the same claim as registered >= max.
assert.strictEqual(
  view.seatState({ isFull: null, registeredStudentsCount: 10, maxLimit: 10 }),
  null,
  "isFull missing is unknown, even though the counts alone would suggest full"
);
assert.strictEqual(view.seatState({ isFull: true }), "full", "isFull decides on its own, whatever the counts say");
assert.strictEqual(
  view.seatState({ isFull: true, registeredStudentsCount: 5, maxLimit: 30 }),
  "full",
  "isFull wins even when the counts look nowhere near full"
);
assert.strictEqual(
  view.seatState({ isFull: true, willBeOnWaitingList: false }),
  "full",
  "isFull wins over willBeOnWaitingList too - isFull alone decides fullness"
);
// AGENTS.md invariant 9: a waiting-list course must never read as a free seat.
assert.strictEqual(view.seatState({ isFull: false, willBeOnWaitingList: true }), "waitlist");
assert.strictEqual(view.seatState({ isFull: false, willBeOnWaitingList: false }), "free");
// The bug this replaces: isOnWaitingList is not read here at all - a course the
// student has not applied to would ordinarily have it false or missing, and reading
// it as the seat forecast silently defaulted every unmeasured/false case to "free".
assert.strictEqual(
  view.seatState({ isFull: false, willBeOnWaitingList: false, isOnWaitingList: true }),
  "free",
  "isOnWaitingList must not leak into the seat forecast, whatever it says"
);
// willBeOnWaitingList missing: must not be guessed as free OR waitlist - AGENTS.md
// invariant 5 forbids exactly this kind of silent promotion of "not full" to "free".
assert.strictEqual(
  view.seatState({ isFull: false, willBeOnWaitingList: null }),
  null,
  "not full is known, but the waiting-list forecast itself is not - stays unknown"
);
assert.strictEqual(
  view.seatState({ isFull: false }),
  null,
  "a missing willBeOnWaitingList field reads the same as an explicit null"
);
assert.strictEqual(view.seatState(null), null);

assert.strictEqual(view.freeSeatFromCourse({ isFull: false, willBeOnWaitingList: false }), true);
assert.strictEqual(view.freeSeatFromCourse({ isFull: true }), false);
assert.strictEqual(
  view.freeSeatFromCourse({ isFull: false, willBeOnWaitingList: true }),
  false,
  "waitlisted is not a free seat"
);
assert.strictEqual(view.freeSeatFromCourse({ isFull: null }), null, "unknown fullness is not a free seat either");
assert.strictEqual(
  view.freeSeatFromCourse({ isFull: false, willBeOnWaitingList: null }),
  null,
  "an unresolved waiting-list forecast must not read as a free seat, nor as a full one"
);

assert.strictEqual(view.seatVariant("full"), "full");
assert.strictEqual(view.seatVariant("waitlist"), "partial");
assert.strictEqual(view.seatVariant("free"), "free");
assert.strictEqual(view.seatVariant(null), "neutral");

// --- hasFreeSeat: the "Csak szabad hely" filter must exclude a waitlisted course --
// AGENTS.md invariant 9: the waiting list is never shown as a free seat.
assert.strictEqual(
  view.hasFreeSeat({ freeSeat: view.freeSeatFromCourse({ isFull: false, willBeOnWaitingList: true }) }),
  false,
  "a waitlisted course fails the free-seat filter"
);

// --- formatSlotTime: what Neptun does not already print for a further session -----
assert.strictEqual(view.formatSlotTime(slot(1, 600, 720, "", "Hétfő")), "Hétfő 10:00–12:00");
assert.strictEqual(view.formatSlotTime(slot(1, 600, 720)), "10:00–12:00", "no day label, just the time");
assert.strictEqual(view.formatSlotTime(null), "", "a missing slot must not throw");

// --- buildRowModel: the "oszlopmodell" the DOM layer renders from, nothing else ----
const course = {
  id: "m1",
  code: "TEST0313L-01",
  slots: [slot(1, 600, 720, "Room 201", "Hétfő")],
  isFull: false,
  willBeOnWaitingList: false,
};
const model = view.buildRowModel(course, [clearEntry], true);
assert.strictEqual(model.code, "TEST0313L-01");
assert.strictEqual(model.slots.length, 1);
assert.strictEqual(model.verdict.state, "ok");
assert.strictEqual(
  model.freeSeat,
  true,
  "derived from the course's own isFull/willBeOnWaitingList, not a passed-in guess"
);

const modelUnknownSeat = view.buildRowModel({ id: "m2", slots: [] }, [], true);
assert.strictEqual(modelUnknownSeat.freeSeat, null, "isFull not measured on the course means an unknown seat state");

const modelFull = view.buildRowModel({ id: "m3", slots: [], isFull: true }, [], true);
assert.strictEqual(modelFull.freeSeat, false);

const modelNoCourse = view.buildRowModel(undefined, [], true);
assert.strictEqual(modelNoCourse.code, "", "a missing course must not throw, and yields empty/unknown fields");
assert.strictEqual(modelNoCourse.verdict.state, "no-schedule");
assert.strictEqual(modelNoCourse.freeSeat, null);

// --- applyFiltersAndSort: a settled table is left alone ----------------------------
// With a filter hiding a row that sits before the visible ones, every repaint used to
// re-append the visible rows. That moved the real (Angular) controls inside them on
// each observer tick, and the keyboard focus with them.
{
  let moves = 0;
  const tbody = {
    children: [],
    get lastElementChild() {
      return this.children[this.children.length - 1] || null;
    },
    appendChild(node) {
      const index = this.children.indexOf(node);
      if (index !== -1) {
        this.children.splice(index, 1);
      }
      this.children.push(node);
      moves++;
      return node;
    },
    ownerDocument: {
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
    },
  };
  const entry = (id, freeSeat) => {
    const tr = { id, style: { display: "" } };
    tbody.appendChild(tr);
    return { course: { id, code: id, slots: [] }, tr, extraRows: [], verdict: { state: "ok" }, freeSeat };
  };
  const section = { tbody, rows: new Map(), emptyRow: null, emptyText: "" };
  ["A", "B", "C"].forEach((id, i) => section.rows.set(id, entry(id, i > 0)));
  const state = { filters: { conflictFree: false, freeSeat: true }, sort: "code" };

  view.applyFiltersAndSort(section, state);
  assert.strictEqual(section.rows.get("A").tr.style.display, "none", "the full course is filtered out");
  moves = 0;
  view.applyFiltersAndSort(section, state);
  view.applyFiltersAndSort(section, state);
  assert.strictEqual(moves, 0, "an unchanged, filtered table is not touched again");
  assert.strictEqual(tbody.lastElementChild, section.emptyRow, "the empty-state row stays last");
}
