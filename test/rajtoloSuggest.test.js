const assert = require("assert");
const suggest = require("../src/modules/rajtolo/suggest");
const { normaliseSlot } = require("../src/timetable");
const { suggestSchedules } = require("../src/timetableSolver");

const slot = (day, from, to) => normaliseSlot({ dayOfWeek: day, startTime: from, endTime: to });
const ids = { termId: "t", curriculumTemplateId: "c", curriculumTemplateLineId: "l" };
const course = (id, subjectId, typeId, type, slots, extra) =>
  Object.assign({ id, subjectId, code: id.toUpperCase(), type, typeId, comparationTypeId: typeId, slots }, extra);

// Held: S1's lecture. Planned in the Rajtoló: S1 lecture + practice, S2 practice.
// Planned only in Neptun's planner: S3 lab (with ids) and S4 (without ids).
const baseline = [
  {
    source: "registered",
    course: course("s1lec", "S1", "LEC", "Elmélet", [slot(1, "08:00", "10:00")]),
    subject: { title: "Egy" },
  },
  {
    source: "planned",
    origin: "planner",
    course: course("s3lab", "S3", "LAB", "Labor", [slot(3, "08:00", "10:00")]),
    subject: Object.assign({ title: "Három" }, ids),
  },
  { source: "planned", origin: "planner", course: course("s4x", "S4", "LAB", "Labor", []), subject: { title: "Négy" } },
  {
    source: "planned",
    origin: "planner",
    course: course("s2y", "S2", "GYAK", "Gyakorlat", []),
    subject: Object.assign({ title: "Kettő" }, ids),
  },
];
const rajtoloPlan = {
  termId: "t",
  subjects: [
    Object.assign({ subjectId: "S1", title: "Egy", code: "E1" }, ids, {
      groups: [
        { type: "Elmélet", typeId: "LEC", ranking: ["s1lec"] },
        { type: "Gyakorlat", typeId: "GYAK", ranking: ["s1g2", "s1g1"] },
      ],
    }),
    Object.assign({ subjectId: "S2", title: "Kettő", code: "K2" }, ids, {
      groups: [{ type: "Gyakorlat", typeId: "GYAK", ranking: ["s2a"] }],
    }),
  ],
};

const targets = suggest.planTargets(rajtoloPlan, baseline);
assert.deepStrictEqual(
  targets.map(t => [t.record.subjectId, t.groups.map(g => `${g.typeId}:${g.ranking.join(",")}`)]),
  [
    ["S1", ["GYAK:s1g2,s1g1"]],
    ["S2", ["GYAK:s2a"]],
    ["S3", ["LAB:s3lab"]],
  ],
  "a held type drops out; the Rajtoló wins over the planner; no ids, no lookup"
);

const catalog = new Map([
  [
    "S1",
    new Map(
      [
        course("s1g1", "S1", "GYAK", "Gyakorlat", [slot(1, "08:00", "10:00")]),
        course("s1g2", "S1", "GYAK", "Gyakorlat", [slot(2, "12:00", "14:00")]),
        course("s1g3", "S1", "GYAK", "Gyakorlat", [slot(1, "10:00", "12:00")], { willBeOnWaitingList: false }),
        course("s1lec", "S1", "LEC", "Elmélet", [slot(1, "08:00", "10:00")], { isSigned: true }),
      ].map(c => [c.id, c])
    ),
  ],
  ["S2", new Map([course("s2a", "S2", "GYAK", "Gyakorlat", [slot(1, "10:00", "12:00")])].map(c => [c.id, c]))],
  [
    "S3",
    new Map(
      [
        course("s3lab", "S3", "LAB", "Labor", [slot(3, "08:00", "10:00")]),
        course("s3b", "S3", "LAB", "Labor", [slot(1, "12:00", "14:00")]),
      ].map(c => [c.id, c])
    ),
  ],
]);
const { input, info } = suggest.solverInput(targets, catalog, baseline);
assert.deepStrictEqual(input.fixed, [{ label: "Egy – Elmélet", slots: [slot(1, "08:00", "10:00")] }]);
assert.deepStrictEqual(
  input.groups.map(g => [g.key, g.current, g.options.map(o => o.id)]),
  [
    ["S1|GYAK", "s1g2", ["s1g2", "s1g1", "s1g3"]],
    ["S2|GYAK", "s2a", ["s2a"]],
    ["S3|LAB", "s3lab", ["s3lab", "s3b"]],
  ],
  "the student's ranking first, every other course of the type after it"
);
assert.strictEqual(input.groups[0].label, "Egy – Gyakorlat");

// Applied: an existing group keeps all it had with the pick on top; a group the plan
// lacks gets the pick alone.
const result = suggestSchedules(input);
const closest = result.variants.find(v => v.strategies.includes("closest"));
const variant = {
  picks: [
    { groupKey: "S1|GYAK", courseId: "s1g1", rankings: { gaps: ["s1g1", "s1g3", "s1g2"] } },
    { groupKey: "S2|GYAK", courseId: null, rankings: { gaps: [] } },
    { groupKey: "S3|LAB", courseId: "s3b", rankings: { gaps: ["s3b", "s3lab"] } },
  ],
};
const applied = suggest.applyVariant(rajtoloPlan, variant, "gaps", info);
assert.deepStrictEqual(applied.subjects[0].groups[1].ranking, ["s1g1", "s1g2"], "no course the student never ranked");
assert.deepStrictEqual(applied.subjects[0].groups[0], rajtoloPlan.subjects[0].groups[0], "other groups untouched");
assert.strictEqual(applied.subjects[1], rajtoloPlan.subjects[1], "a group left out stays as it was");
assert.strictEqual(applied.subjects.length, 2, "a planner-only subject is never put up for automatic registration");
assert.deepStrictEqual(rajtoloPlan.subjects[0].groups[1].ranking, ["s1g2", "s1g1"], "immutable");
assert.ok(closest, "the solver ran on this input");
assert.strictEqual(
  suggest.applyVariant(Object.assign({}, rajtoloPlan, { termId: "other" }), variant, "gaps", info).subjects.length,
  2,
  "another term's plan never adopts a subject"
);

// Ghost geometry: 45 px per half hour from 08:00, as measured.
const lanes = [];
for (let at = 480; at < 1260; at += 30) {
  lanes.push({ at, top: ((at - 480) / 30) * 45, height: 45, minutes: 30 });
}
const columns = [
  { day: 1, left: 37, width: 293 },
  { day: 2, left: 330, width: 293 },
];
assert.deepStrictEqual(suggest.ghostBox(slot(1, "10:00", "12:00"), columns, lanes), {
  left: 37,
  width: 293,
  top: 180,
  height: 180,
  clipped: false,
});
assert.strictEqual(suggest.ghostBox(slot(5, "10:00", "12:00"), columns, lanes), null, "a day not on screen");
assert.deepStrictEqual(
  suggest.ghostBox(slot(2, "07:00", "09:00"), columns, lanes),
  { left: 330, width: 293, top: 0, height: 90, clipped: true },
  "clipped to the drawn hours"
);
assert.strictEqual(suggest.ghostBox(slot(2, "06:00", "07:30"), columns, lanes), null);
assert.strictEqual(suggest.weekdayOf("2026-09-07"), 1);
assert.strictEqual(suggest.weekdayOf("2026-09-13"), 0);
assert.strictEqual(suggest.weekdayOf("nope"), null);

assert.strictEqual(
  suggest.summaryText({ busyDays: 3, gapMinutes: 100, changes: 2 }),
  "3 nap órákkal · 1,5 óra lyuk · 2 csere"
);
assert.strictEqual(
  suggest.summaryText({ busyDays: 2, gapMinutes: 0, changes: 0 }),
  "2 nap órákkal · lyukas óra nélkül · csere nélkül"
);
assert.strictEqual(
  suggest.verdictText({ complete: true, metrics: { unplaced: 0 } }, false),
  "Nincs ismert ütközés. Túl sok a lehetőség: ez a legjobb talált, nem biztosan a legjobb."
);

// A planner course of a type already held is a swap: the held course leaves the fixed
// week and becomes an option, keeping it is a valid answer, and applying never
// touches it - the Rajtoló only applies for new courses.
{
  const heldLab = course("labA", "S5", "LAB", "Labor", [slot(2, "08:00", "10:00")], { isSigned: true });
  const plannedLab = course("labB", "S5", "LAB", "Labor", [slot(2, "12:00", "14:00")]);
  const swapBaseline = [
    { source: "registered", course: heldLab, subject: Object.assign({ title: "Öt" }, ids) },
    { source: "planned", origin: "planner", course: plannedLab, subject: Object.assign({ title: "Öt" }, ids) },
  ];
  const swapTargets = suggest.planTargets({ termId: "t", subjects: [] }, swapBaseline);
  assert.deepStrictEqual(
    swapTargets.map(t => t.groups.map(g => [g.typeId, g.ranking, g.swap])),
    [[["LAB", ["labB"], "labA"]]]
  );
  const swapCatalog = new Map([["S5", new Map([heldLab, plannedLab].map(c => [c.id, c]))]]);
  const swapped = suggest.solverInput(swapTargets, swapCatalog, swapBaseline);
  assert.deepStrictEqual(swapped.input.fixed, [], "the held lab is not fixed while it is weighed");
  assert.deepStrictEqual(
    swapped.input.groups[0].options.map(o => o.id),
    ["labB", "labA"]
  );
  const meta = swapped.info.get("S5|LAB");
  assert.deepStrictEqual(suggest.pickStatus({ courseId: "labA", changed: true }, meta), {
    kind: "keep",
    text: "Maradjon a felvett kurzus",
  });
  assert.deepStrictEqual(
    suggest.pickStatus({ courseId: "labB", changed: false }, meta),
    { kind: "same", text: "A terved szerint: csere a felvett LABA helyett" },
    "the student's own planned swap is their plan, not a change"
  );
  const untouched = { termId: "t", subjects: [] };
  assert.strictEqual(
    suggest.applyVariant(
      untouched,
      { picks: [{ groupKey: "S5|LAB", courseId: "labB", rankings: {} }] },
      "gaps",
      swapped.info
    ),
    untouched,
    "a swap is made in Neptun, never queued in the Rajtoló"
  );
}
assert.deepStrictEqual(suggest.pickStatus({ courseId: null }, null).kind, "unplaced");
assert.deepStrictEqual(suggest.pickStatus({ courseId: "s2a", changed: true }, info.get("S2|GYAK")), {
  kind: "changed",
  text: "Más, mint a terved",
});

// Nothing to change is said as such, and never offered as an edit.
{
  const placed = { metrics: { unplaced: 0 }, complete: true, picks: [{ changed: false }, { changed: false }] };
  assert.strictEqual(suggest.isOptimal(placed), true);
  assert.strictEqual(suggest.headline(placed, true), "A terved már optimális.");
  const changed = Object.assign({}, placed, { picks: [{ changed: true }, { changed: false }] });
  assert.strictEqual(suggest.isOptimal(changed), false);
  assert.strictEqual(suggest.headline(changed, true), "1 módosítás javasolt. Nincs ismert ütközés.");
  assert.strictEqual(suggest.isOptimal(Object.assign({}, placed, { metrics: { unplaced: 1 } })), false);
  assert.strictEqual(
    suggest.headline(Object.assign({}, placed, { complete: false }), true),
    "A terved már a legjobb, de van benne kockázat."
  );
}

// Neptun's planner follows the suggestion: per group with a course there, the planned
// course the pick replaces goes, the pick comes; nothing else is touched.
{
  const record = Object.assign({ subjectId: "S9", title: "Kilenc" }, ids);
  const plannerInfo = new Map([
    ["S9|GYAK", { record, planned: ["old"], swap: null, courses: new Map() }],
    ["S9|LAB", { record, planned: ["mine"], swap: "held", courses: new Map() }],
    ["S8|GYAK", { record, planned: [], swap: null, courses: new Map() }],
    ["S7|GYAK", { record, planned: ["same"], swap: null, courses: new Map() }],
  ]);
  const ops = suggest.plannerOps(
    {
      picks: [
        { groupKey: "S9|GYAK", courseId: "new" },
        { groupKey: "S9|LAB", courseId: "held" },
        { groupKey: "S8|GYAK", courseId: "x" },
        { groupKey: "S7|GYAK", courseId: "same" },
      ],
    },
    plannerInfo
  );
  assert.deepStrictEqual(
    ops.map(op => [op.groupKey, op.remove, op.add]),
    [
      ["S9|GYAK", ["old"], "new"],
      ["S9|LAB", ["mine"], null],
    ],
    "a Rajtoló-only group and an unchanged one never reach the planner; keeping the held course drops the planned swap"
  );
  assert.deepStrictEqual(
    suggest.plannerOps({ picks: [{ groupKey: "S9|GYAK", courseId: null }] }, plannerInfo),
    [],
    "a group left out keeps what is planned"
  );
  const steps = suggest.plannerSteps(ops);
  assert.deepStrictEqual(
    steps.map(step => `${step.kind}:${step.courseId}`),
    ["remove:old", "add:new", "remove:mine"],
    "removal first, so a group never holds two of a type"
  );
  assert.deepStrictEqual(
    suggest.inverseSteps(steps.slice(0, 2)).map(step => `${step.kind}:${step.courseId}`),
    ["remove:new", "add:old"],
    "undone newest first"
  );
}
assert.deepStrictEqual(suggest.plannerAnswer({ s: 200, notification: [], data: null }, "s"), { ok: true, message: "" });
assert.deepStrictEqual(
  suggest.plannerAnswer({ s: 200, notification: [{ description: "Nem tervezhető." }] }, "s"),
  { ok: false, message: "Nem tervezhető." },
  "a 200 with a notification is a refusal until measured otherwise"
);
assert.deepStrictEqual(suggest.plannerAnswer({ s: 401, message: "x" }, "s"), { ok: false, message: "HTTP 401" });
assert.deepStrictEqual(suggest.plannerAnswer(null, "s"), { ok: false, message: "ismeretlen válasz" });

// planTargets remembers what sits in the planner, per group, also for a Rajtoló subject.
{
  const lab = course("pl", "S1", "GYAK", "Gyakorlat", []);
  const withPlanner = suggest.planTargets(rajtoloPlan, [
    { source: "planned", origin: "planner", course: lab, subject: Object.assign({ title: "Egy" }, ids) },
  ]);
  assert.deepStrictEqual(withPlanner[0].groups[1].planned, ["pl"]);
  assert.deepStrictEqual(withPlanner[0].groups[1].ranking, ["s1g2", "s1g1"], "the Rajtoló ranking stays its own");
}

// Regression (branch review): the per-subject list is not re-read after a planner
// write, so a removed course may linger there. Only the planner endpoint's own rows
// count as planned, and the lingering one never reaches the next Apply.
{
  global.location = global.location || { origin: "https://neptun.example", pathname: "/" };
  const registrationData = require("../src/registrationData");
  const staleSubjects = registrationData.collectScheduleSubjects({
    data: [Object.assign({ id: "SX", title: "Tárgy", isRegistered: false, scheduledCourseIds: ["gone"] }, ids)],
  });
  const staleCourses = registrationData.collectCourses({
    data: [
      { id: "gone", subjectId: "SX", code: "GONE", type: "Gyak", comparationTypeId: "G", isSigned: false },
      { id: "kept", subjectId: "SX", code: "KEPT", type: "Gyak", comparationTypeId: "G", isSigned: false },
    ],
  });
  const reread = registrationData.collectPlannerCourses({
    data: [
      Object.assign(
        {
          id: "kept",
          subjectId: "SX",
          title: "Tárgy",
          code: "KEPT",
          type: "Gyak",
          comparationTypeId: "G",
          classInstanceInfos: [],
          isRegistered: false,
          isSigned: false,
          isOnWaitingList: false,
        },
        ids
      ),
    ],
  });
  const staleBaseline = registrationData.buildBaseline(staleSubjects, staleCourses, reread.entries);
  assert.deepStrictEqual(
    staleBaseline.filter(item => item.source === "planned").map(item => `${item.course.id}:${item.origin}`),
    ["kept:planner", "gone:subject"]
  );
  const staleTargets = suggest.planTargets({ termId: "t", subjects: [] }, staleBaseline);
  assert.deepStrictEqual(staleTargets[0].groups[0].planned, ["kept"], "a lingering course is not planned");
}

// Regression (branch review): without a type id, a held lecture is not "the held one"
// of a planned lab - the lab is no swap, and the lecture stays fixed in the week.
{
  const lecture = course("lec", "SL", null, "Előadás", [slot(1, "08:00", "10:00")], { isSigned: true });
  const lab = course("labA", "SL", null, "Labor", [slot(1, "08:00", "10:00")]);
  const noIdBaseline = [
    { source: "registered", course: lecture, subject: { title: "Tárgy" } },
    { source: "planned", origin: "planner", course: lab, subject: Object.assign({ title: "Tárgy" }, ids) },
  ];
  const noIdTargets = suggest.planTargets({ termId: "t", subjects: [] }, noIdBaseline);
  assert.strictEqual(noIdTargets[0].groups[0].swap, null, "a held lecture is not a held lab");
  const noIdCatalog = new Map([
    ["SL", new Map([lecture, lab].map(c => [c.id, Object.assign({}, c, { typeId: null })]))],
  ]);
  const noId = suggest.solverInput(noIdTargets, noIdCatalog, noIdBaseline);
  assert.strictEqual(noId.input.fixed.length, 1, "the held lecture stays in the week");
  const [noIdVariant] = suggestSchedules(noId.input).variants;
  assert.strictEqual(noIdVariant.complete, false, "the clashing lab is never called clash-free");
  const rajtoloNoId = suggest.planTargets(
    {
      termId: "t",
      subjects: [
        Object.assign(
          { subjectId: "SL", title: "Tárgy", groups: [{ type: "Labor", typeId: null, ranking: ["labA"] }] },
          ids
        ),
      ],
    },
    [noIdBaseline[0]]
  );
  assert.strictEqual(rajtoloNoId.length, 1, "a Rajtoló lab group is not dropped for a held lecture");
}
