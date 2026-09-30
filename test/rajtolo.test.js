const assert = require("assert");
const interceptor = require("../src/interceptor");
const { fakeRow, FakeXHR } = require("./helpers");
require("./interceptor.test");

// --- rajtolo: the ranked plan, and one click per subject on Neptun's own page ---
const rajtolo = require("../src/modules/rajtolo");

// The same treatment for the Rajtolo's subject badge, which used to find its code with
// /IN[A-Z]{2,5}[0-9].../ - one faculty's prefix, so every subject outside it silently
// got no badge. Matching known codes instead is institution-neutral, and it also stops
// an expanded row's own course codes being picked up as if they were the subject's.
const knownSubjects = new Map([
  ["MTB1X03", "s-mtb"],
  ["TEST0418-21", "s-test"],
]);
assert.strictEqual(
  rajtolo.subjectCodeIn(fakeRow(["Tárgykód:", " mtb1x03 ", "6 kredit"]), knownSubjects),
  "MTB1X03",
  "a subject code that is not one faculty's prefix still matches"
);
assert.strictEqual(
  rajtolo.subjectCodeIn(fakeRow(["TEST0418-21"]), knownSubjects),
  "TEST0418-21",
  "the codes the old regexp did handle keep working"
);
assert.strictEqual(
  rajtolo.subjectCodeIn(fakeRow(["TEST0418-21-01", "TEST0418-21"]), knownSubjects),
  "TEST0418-21",
  "an expanded row's course code is skipped for the subject code it is not"
);
assert.strictEqual(
  rajtolo.subjectCodeIn(fakeRow(["Tárgykód:", "XYZ999"]), knownSubjects),
  null,
  "a subject we hold nothing for is skipped, never guessed at"
);

// server-clock offset: sampled off whichever response's Date header, exactly like
// getAuthHeader captures Authorization off whichever request carried one
assert.strictEqual(interceptor.getServerOffsetMs(), null, "no response has told us yet");
class DatedFakeXHR extends FakeXHR {
  getResponseHeader(name) {
    return name === "Date" ? this._dateHeader : null;
  }
}
const datedWindow = { XMLHttpRequest: DatedFakeXHR };
interceptor.install(datedWindow);
const serverNow = Date.now() + 90000; // server clock 90s ahead of this machine
const datedXhr = new datedWindow.XMLHttpRequest();
datedXhr._dateHeader = new Date(serverNow).toUTCString();
datedXhr.open("GET", "/hallgato_ng/api/SubjectApplication/SchedulableSubjects");
datedXhr.send();
const offset = interceptor.getServerOffsetMs();
assert.ok(offset > 85000 && offset < 95000, `offset should track the Date header, got ${offset}`);
// a response with no Date header at all must not clobber a previously-sampled offset
const noDateXhr = new datedWindow.XMLHttpRequest();
noDateXhr.open("GET", "/hallgato_ng/api/UserInfo");
noDateXhr.send();
assert.strictEqual(interceptor.getServerOffsetMs(), offset, "a missing header must not reset the offset");
// a non-API response (a cached asset, another host) is not Neptun's clock now
const staleXhr = new datedWindow.XMLHttpRequest();
staleXhr._dateHeader = new Date(Date.now() - 86400000).toUTCString();
staleXhr.open("GET", "/hallgato_ng/assets/i18n/hu.json");
staleXhr.send();
assert.strictEqual(interceptor.getServerOffsetMs(), offset, "only API answers move the offset");
// Date has whole seconds: a sample that looks further behind does not pull the
// estimate back, the closest recent one wins
const behindXhr = new datedWindow.XMLHttpRequest();
behindXhr._dateHeader = new Date(Date.now() + 89000).toUTCString();
behindXhr.open("GET", "/hallgato_ng/api/UserInfo");
behindXhr.send();
assert.strictEqual(interceptor.getServerOffsetMs(), offset, "the largest recent sample is kept");

// Neptun's times are Hungarian wall-clock time whatever zone the browser is in
// (dailyOverview reads its dates through this).
assert.strictEqual(rajtolo.wallClockToEpoch("2026-02-02T10:00"), Date.UTC(2026, 1, 2, 9, 0), "winter: UTC+1");
assert.strictEqual(rajtolo.wallClockToEpoch("2026-07-15T10:00:30"), Date.UTC(2026, 6, 15, 8, 0, 30), "summer: UTC+2");
assert.strictEqual(
  rajtolo.wallClockToEpoch("2026-10-25T01:30"),
  Date.UTC(2026, 9, 24, 23, 30),
  "just before the autumn switch still reads as summer time"
);
assert.ok(Number.isNaN(rajtolo.wallClockToEpoch("")), "an empty field is no time at all");
assert.ok(Number.isNaN(rajtolo.wallClockToEpoch(null)));
assert.ok(Number.isNaN(rajtolo.wallClockToEpoch("holnap reggel")));

// What gets ticked: one course per group, only from the user's own ranking, never a
// full one. A group with nothing left gets none, the others are still ticked.
const courseIndex = new Map([
  ["c1", { id: "c1", isFull: true }],
  ["c2", { id: "c2", isFull: false }],
  ["c3", { id: "c3", isFull: false }],
]);
assert.strictEqual(
  rajtolo.pickCourse({ ranking: ["c1", "c2"] }, courseIndex),
  "c2",
  "skips the full top pick, takes the next-ranked one"
);
{
  const both = rajtolo.preselection(
    [
      { type: "Elmélet", ranking: ["c2"] },
      { type: "Labor", ranking: ["c3"] },
    ],
    courseIndex
  );
  assert.strictEqual(both.kind, "pick");
  assert.deepStrictEqual(
    both.picks.map(pick => pick.courseId),
    ["c2", "c3"],
    "one pick per group"
  );
  const half = rajtolo.preselection(
    [
      { type: "Elmélet", ranking: ["c2"] },
      { type: "Labor", ranking: ["c1"] },
    ],
    courseIndex
  );
  assert.strictEqual(half.kind, "partial", "a full group does not stop the others being ticked");
  assert.deepStrictEqual(
    half.picks.map(pick => pick.courseId),
    ["c2", null]
  );
  assert.strictEqual(rajtolo.preselection([{ type: "Labor", ranking: ["c1"] }], courseIndex).kind, "exhausted");
  assert.strictEqual(
    rajtolo.preselection([{ type: "Labor", ranking: ["gone"] }], courseIndex).kind,
    "unconfigured",
    "a ranking whose courses are all gone ticks nothing"
  );
  assert.strictEqual(rajtolo.preselection([], courseIndex).kind, "unconfigured");
}
{
  const held = new Map([
    ["L1", { id: "L1", isFull: false, isSigned: true }],
    ["L2", { id: "L2", isFull: false }],
    ["G1", { id: "G1", isFull: false }],
  ]);
  const heldChoice = rajtolo.preselection([{ ranking: ["L1", "L2"] }, { ranking: ["G1"] }], held);
  assert.strictEqual(heldChoice.kind, "held", "a held ranked course is never swapped for the next-ranked one");
  assert.deepStrictEqual(heldChoice.picks, [], "nothing is ticked on a held subject");
  const queue = new Map([
    ["G1", { id: "G1", isFull: false, willBeOnWaitingList: true }],
    ["G2", { id: "G2", isFull: false, willBeOnWaitingList: false }],
  ]);
  assert.strictEqual(rajtolo.pickCourse({ ranking: ["G1", "G2"] }, queue), "G2", "a seat beats a higher-ranked queue");
  assert.strictEqual(rajtolo.pickCourse({ ranking: ["G1"] }, queue), "G1", "with no seat anywhere, the queue");
  // the switch: never outside the user's ranking, only how seat and queue compare
  assert.strictEqual(
    rajtolo.pickCourse({ ranking: ["G1", "G2"] }, queue, "order"),
    "G1",
    "order: the user's first non-full course, even when it only queues"
  );
  assert.strictEqual(
    rajtolo.pickCourse({ ranking: ["G1", "G2"] }, queue, "never"),
    "G2",
    "never: the first course with a known seat"
  );
  assert.strictEqual(rajtolo.pickCourse({ ranking: ["G1"] }, queue, "never"), null, "never: a queue is not a seat");
  const unknownForecast = new Map([["U1", { id: "U1", isFull: false, willBeOnWaitingList: null }]]);
  assert.strictEqual(
    rajtolo.pickCourse({ ranking: ["U1"] }, unknownForecast, "never"),
    null,
    "never: an unknown forecast is not taken for a seat"
  );
}

// the reorder primitive behind every up/down button (buttons, not drag-drop)
assert.deepStrictEqual(rajtolo.moveUp(["a", "b", "c"], 1), ["b", "a", "c"]);
assert.deepStrictEqual(rajtolo.moveUp(["a", "b", "c"], 0), ["a", "b", "c"], "already first -> unchanged");
assert.deepStrictEqual(rajtolo.moveDown(["a", "b", "c"], 1), ["a", "c", "b"]);
assert.deepStrictEqual(rajtolo.moveDown(["a", "b", "c"], 2), ["a", "b", "c"], "already last -> unchanged");

// ranking courses: the editor must say the order doesn't matter there
assert.strictEqual(rajtolo.courseLabel({ code: "TEST01L", isRankingCourse: false }), "TEST01L");
assert.strictEqual(
  rajtolo.courseLabel({ id: "11111111-1111-4111-8111-111111111111", isRankingCourse: false }),
  "Ismeretlen kurzus",
  "the dialog never shows an internal course UUID"
);
assert.ok(
  rajtolo.courseLabel({ code: "TEST01L", isRankingCourse: true }).indexOf("rangsoros") !== -1,
  "a ranking course's label must say submission order has no effect"
);

// harvesting: subjects and courses accumulate across responses, same pattern as
// occupancy.collectCourseStates
const subjects = rajtolo.collectSubjects({
  data: [
    {
      id: "s1",
      termId: "t1",
      curriculumTemplateId: "ct1",
      curriculumTemplateLineId: "ctl1",
      title: "Tárgy 1",
      credit: 5,
      type: "Kötelező",
      isRegistered: true,
    },
    { id: "s2", termId: "t1", title: "Tárgy 2" }, // no credit/type/isRegistered at all
  ],
});
assert.strictEqual(subjects.get("s1").title, "Tárgy 1");
assert.strictEqual(subjects.get("s1").credit, 5, "credit is kept, needed for the planner's credit forecast");
assert.strictEqual(subjects.get("s1").type, "Kötelező");
assert.strictEqual(
  subjects.get("s1").isRegistered,
  true,
  "kept so plannedCredits can skip an already-registered subject"
);
assert.strictEqual(subjects.get("s2").credit, 0, "missing credit defaults to 0, never a guessed number");
assert.strictEqual(subjects.get("s2").type, "", "missing type is empty, not a guessed label");
assert.strictEqual(subjects.get("s2").isRegistered, false, "missing isRegistered defaults to false");
assert.strictEqual(rajtolo.collectSubjects({}).size, 0, "an empty body must not throw");

// --- rajtolo credit forecast (task feature): current + planned credits, by type ---
// This rides ScheduledSubjectsWithScheduledCourses independently of creditBreakdown (task
// brief: no cross-module import), reusing the exact same untyped-label convention so the
// two displays can never disagree with each other.
const registered = rajtolo.registeredCredits({
  data: [
    { isRegistered: true, type: "Kötelező", credit: 4 },
    { isRegistered: true, type: "", credit: 2 }, // untyped row takes the fallback label
    { isRegistered: false, type: "Kötelező", credit: 6 }, // merely planned, not registered
  ],
});
assert.strictEqual(registered.get("Kötelező"), 4, "a non-registered row must not be counted");
assert.strictEqual(
  registered.get("Szabadon választható"),
  2,
  "an untyped row falls back to the same label creditBreakdown uses"
);
assert.strictEqual(rajtolo.registeredCredits({}).size, 0, "an empty body must not throw");

// plannedCredits: only subjects the live catalog actually knows about, and never a
// subject that is already registered - that credit is already in `registered` above, so
// counting it again here would double it once merged.
const creditCatalog = new Map([
  ["s1", { subjectId: "s1", credit: 3, type: "Kötelező", isRegistered: false }],
  ["s2", { subjectId: "s2", credit: 1, type: "", isRegistered: false }],
  ["s3", { subjectId: "s3", credit: 2, type: "Kötelező", isRegistered: true }],
  // "s4" deliberately absent from the catalog
]);
const creditPlan = { subjects: [{ subjectId: "s1" }, { subjectId: "s2" }, { subjectId: "s3" }, { subjectId: "s4" }] };
const planned = rajtolo.plannedCredits(creditPlan, creditCatalog);
assert.strictEqual(planned.get("Kötelező"), 3, "s3 is already registered - its 2 credits must not be added again");
assert.strictEqual(planned.get("Szabadon választható"), 1, "s2's untyped credit still counts, same fallback label");
assert.strictEqual(
  [...planned.values()].reduce((a, b) => a + b, 0),
  4,
  "s4 has no catalog record - it must contribute nothing, never a guessed credit"
);

// mergeCredits/totalCredits: registered plus planned credit totals
const mergedCredits = rajtolo.mergeCredits(registered, planned);
assert.strictEqual(mergedCredits.get("Kötelező"), 7, "4 registered + 3 planned");
assert.strictEqual(
  mergedCredits.get("Szabadon választható"),
  3,
  "2 registered + 1 planned, both folded into the same untyped bucket"
);
assert.strictEqual(rajtolo.totalCredits(registered), 6, "4 + 2");
assert.strictEqual(rajtolo.totalCredits(planned), 4, "3 + 1");
assert.strictEqual(rajtolo.totalCredits(mergedCredits), 10, "current total plus planned total, unconditionally");

const rajtoloCourses = rajtolo.collectCourses({
  data: [{ id: "c1", subjectId: "s1", type: "Elmélet", isFull: false, isRankingCourse: false }],
});
assert.strictEqual(rajtoloCourses.get("s1").get("c1").type, "Elmélet");
assert.strictEqual(rajtolo.collectCourses({ data: [{ id: "c2" }] }).size, 0, "a course without a subjectId is skipped");

// plan mutation: add/remove are immutable and idempotent
let plan = rajtolo.emptyPlan("t1");
plan = rajtolo.addSubject(plan, { subjectId: "s1", termId: "t1" });
assert.strictEqual(plan.subjects.length, 1);
const samePlan = rajtolo.addSubject(plan, { subjectId: "s1", termId: "t1" });
assert.strictEqual(samePlan, plan, "adding an already-listed subject is a no-op, not a duplicate");
plan = rajtolo.removeSubject(plan, "s1");
assert.strictEqual(plan.subjects.length, 0);

// --- Neptun's answer to its own registration: only explicit fields decide ---
{
  const signed = { data: { isWaiting: false, signedCourses: { c1: { isSigned: true } } }, notification: [] };
  assert.strictEqual(rajtolo.signinOutcome(signed, 200, ["c1"]).kind, "registered");
  assert.strictEqual(
    rajtolo.signinOutcome(signed, 200, ["c1", "c2"]).kind,
    "submitted",
    "a course missing from signedCourses is not claimed as taken"
  );
  assert.strictEqual(
    rajtolo.signinOutcome({ data: { isWaiting: true, signedCourses: {} }, notification: [] }, 200, ["c1"]).kind,
    "waitlisted"
  );
  const rejected = rajtolo.signinOutcome(
    { data: null, notification: [{ description: "Végső tárgykövetelmény nem teljesült", type: 3 }] },
    500,
    ["c1"]
  );
  assert.deepStrictEqual(rejected, { kind: "rejected", message: "Végső tárgykövetelmény nem teljesült" });
  assert.strictEqual(rajtolo.signinOutcome({ data: null, notification: [] }, 500, ["c1"]).kind, "unknown");
  assert.strictEqual(
    rajtolo.signinOutcome({ data: {}, notification: [{ description: "info", type: 1 }] }, 200, ["c1"]).kind,
    "unknown",
    "an unmeasured notification is not a success"
  );
  assert.strictEqual(rajtolo.signinOutcome(null, 0, ["c1"]).kind, "unknown");
  assert.strictEqual(
    rajtolo.signinOutcome({ notification: [{ description: "A szerver nem válaszolt időben.", type: 3 }] }, undefined, [
      "c1",
    ]).kind,
    "unknown",
    "an error without an HTTP status is our timeout, never a refusal"
  );
  assert.ok(
    rajtolo
      .outcomeText({ kind: "incomplete", ticked: ["E-01"], missed: [], empty: ["Labor"] })
      .includes("Labor: nincs szabad kurzus a sorrendedben"),
    "an incomplete click names the empty group"
  );
}

// --- one click: a fresh course list, one registration, and the next-ranked course
// only when the one just sent turned out full. Driven through fake requests. ---
async function runChecks() {
  const engine = require("../src/modules/rajtolo/engine");
  const { STATUS_KEY, MAX_ATTEMPTS } = require("../src/modules/rajtolo/constants");
  const subject = {
    subjectId: "s1",
    termId: "t1",
    curriculumTemplateId: "ct1",
    curriculumTemplateLineId: "ctl1",
    title: "Tárgy",
    code: "KOD1",
    groups: [
      { type: "Elmélet", ranking: ["E1"] },
      { type: "Labor", ranking: ["L1", "L2"] },
    ],
  };
  const row = (id, code, type, extra) =>
    Object.assign({ id, subjectId: "s1", code, type, isFull: false, willBeOnWaitingList: false }, extra);
  // A GetSubjectsCourses answer; `extra` overrides fields per course id.
  const list = (extra = {}) => ({
    data: [
      row("E1", "E-01", "Elmélet", extra.E1),
      row("L1", "L-01", "Labor", extra.L1),
      row("L2", "L-02", "Labor", extra.L2),
    ],
    notification: [],
    [STATUS_KEY]: 200,
  });
  const signed = ids => ({
    data: { isWaiting: false, signedCourses: Object.fromEntries(ids.map(id => [id, { isSigned: true }])) },
    notification: [],
    [STATUS_KEY]: 200,
  });
  // The real "full" refusal is not measured yet: its words decide nothing, the list does.
  const refused = text => ({ data: null, notification: [{ description: text, type: 3 }], [STATUS_KEY]: 500 });
  const timedOut = {
    notification: [{ description: "A szerver nem válaszolt időben, az eredmény bizonytalan.", type: 3 }],
  };
  function fake(lists, answers, stopped = () => false) {
    const calls = [];
    return {
      calls,
      deps: {
        get: async () => {
          calls.push("get");
          return lists.shift();
        },
        post: async (entry, courseIds) => {
          calls.push(`post ${courseIds.join("+")}`);
          return answers.shift();
        },
        report: () => {},
        stopped,
      },
    };
  }
  const state = () => ({ plan: { waitlistMode: "seatFirst", subjects: [subject] }, subjectCatalog: new Map() });
  const click = (lists, answers, stopped) => {
    const run = fake(lists, answers, stopped);
    return engine.registerSubject(subject, state(), run.deps).then(outcome => ({ outcome, calls: run.calls }));
  };

  // First choice open: one list, one registration.
  {
    const { outcome, calls } = await click([list()], [signed(["E1", "L1"])]);
    assert.strictEqual(outcome.kind, "registered");
    assert.deepStrictEqual(outcome.codes, ["E-01", "L-01"]);
    assert.deepStrictEqual(calls, ["get", "post E1+L1"]);
  }
  // Full in the fresh list already: the next-ranked one goes at once.
  {
    const { calls } = await click([list({ L1: { isFull: true } })], [signed(["E1", "L2"])]);
    assert.deepStrictEqual(calls, ["get", "post E1+L2"]);
  }
  // Filled between the list and the registration: refused, the list shows it full, the
  // next one goes - never the same course again.
  {
    const { outcome, calls } = await click(
      [list(), list({ L1: { isFull: true } })],
      [refused("A kurzus betelt."), signed(["E1", "L2"])]
    );
    assert.strictEqual(outcome.kind, "registered");
    assert.deepStrictEqual(calls, ["get", "post E1+L1", "get", "post E1+L2"]);
  }
  // A course that refused as full is not sent again in this click, even when the next
  // list shows it open again.
  {
    const { outcome, calls } = await click(
      [list(), list({ L1: { isFull: true } }), list({ L2: { isFull: true } })],
      [refused("A kurzus betelt."), refused("A kurzus betelt.")]
    );
    assert.deepStrictEqual(calls, ["get", "post E1+L1", "get", "post E1+L2", "get"]);
    assert.deepStrictEqual([outcome.kind, outcome.filled], ["incomplete", ["L-01", "L-02"]]);
  }
  // Refused for anything else (the course is still open): stop, with Neptun's words.
  {
    const { outcome, calls } = await click([list(), list()], [refused("Végső tárgykövetelmény nem teljesült")]);
    assert.deepStrictEqual([outcome.kind, outcome.message], ["rejected", "Végső tárgykövetelmény nem teljesült"]);
    assert.deepStrictEqual(calls, ["get", "post E1+L1", "get"]);
  }
  // A timeout may still go through: read once, never resent, even if the course filled.
  {
    const { outcome, calls } = await click([list(), list({ L1: { isFull: true } })], [timedOut]);
    assert.strictEqual(outcome.kind, "unknown");
    assert.deepStrictEqual(calls, ["get", "post E1+L1", "get"]);
  }
  // ...and when that read shows the courses taken, it says so.
  {
    const { outcome } = await click([list(), list({ E1: { isSigned: true }, L1: { isSigned: true } })], [timedOut]);
    assert.strictEqual(outcome.kind, "registered");
  }
  // Every ranked lab full: nothing is sent, and the group is named.
  {
    const { outcome, calls } = await click([list({ L1: { isFull: true }, L2: { isFull: true } })], []);
    assert.deepStrictEqual([outcome.kind, outcome.empty], ["incomplete", ["Labor"]]);
    assert.deepStrictEqual(calls, ["get"]);
  }
  // Already holding any course of the subject, even one outside the plan: a
  // registration would be a second one.
  {
    const withOther = list();
    withOther.data.push(row("L9", "L-09", "Labor", { isSigned: true }));
    const { outcome, calls } = await click([withOther], []);
    assert.strictEqual(outcome.kind, "held");
    assert.deepStrictEqual(calls, ["get"]);
  }
  // Neptun's list already shows the subject taken: not even a request.
  {
    const run = fake([], []);
    const taken = state();
    taken.subjectCatalog.set("s1", { subjectId: "s1", isRegistered: true });
    assert.strictEqual((await engine.registerSubject(subject, taken, run.deps)).kind, "held");
    assert.deepStrictEqual(run.calls, []);
  }
  // The route or the user changed: nothing is sent.
  {
    const { outcome, calls } = await click([list()], [], () => true);
    assert.strictEqual(outcome.kind, "stopped");
    assert.ok(!calls.some(call => call.startsWith("post")));
  }
  // Bounded: one click sends at most MAX_ATTEMPTS registrations, even if every one fills.
  {
    const labs = ["A", "B", "C", "D", "E", "F"];
    const many = Object.assign({}, subject, { groups: [{ type: "Labor", ranking: labs }] });
    const labList = fullOnes => ({
      data: labs.map(id => row(id, `L-${id}`, "Labor", { isFull: fullOnes.includes(id) })),
      notification: [],
      [STATUS_KEY]: 200,
    });
    const lists = [labList([])];
    labs.forEach((id, index) => lists.push(labList(labs.slice(0, index + 1))));
    const run = fake(
      lists,
      labs.map(() => refused("A kurzus betelt."))
    );
    const outcome = await engine.registerSubject(many, state(), run.deps);
    assert.strictEqual(outcome.kind, "failed");
    assert.strictEqual(run.calls.filter(call => call.startsWith("post")).length, MAX_ATTEMPTS);
  }

  // The click handler: one subject at a time, and a finished one is remembered.
  {
    const previousLocation = global.location;
    global.location = { pathname: "/hallgato_ng/subjects/registration" };
    try {
      const other = Object.assign({}, subject, { subjectId: "s2" });
      const clickState = {
        // Open, but with nothing to draw into: render() finds no body and returns.
        dialog: { content: { querySelector: () => null } },
        plan: { waitlistMode: "seatFirst", subjects: [subject, other] },
        subjectCatalog: new Map(),
        courseCatalog: new Map(),
        subjectStatus: new Map(),
        busySubjectId: null,
        flowToken: 0,
      };
      let release;
      const runs = [];
      const fakeRun = entry =>
        new Promise(resolve => {
          runs.push(entry.subjectId);
          release = () => resolve({ kind: "registered" });
        });
      const first = rajtolo.onRegister(clickState, "s1", fakeRun);
      await rajtolo.onRegister(clickState, "s2", fakeRun);
      assert.deepStrictEqual(runs, ["s1"], "a second click is refused while the first runs");
      release();
      await first;
      assert.strictEqual(clickState.subjectStatus.get("s1").kind, "registered");
      assert.strictEqual(clickState.busySubjectId, null);
      assert.strictEqual(clickState.nextFocus, "go-s2", "the next subject's button is ready for the next click");
    } finally {
      if (typeof previousLocation === "undefined") {
        delete global.location;
      } else {
        global.location = previousLocation;
      }
    }
  }
}

// --- rajtolo: courses enter the pickPlan only when explicitly picked ---
const aiSubject = { subjectId: "s1", termId: "t1", curriculumTemplateId: "c1", curriculumTemplateLineId: "l1" };
const lab1 = { id: "c-lab-1", code: "X-L1", type: "Labor" };
const lab2 = { id: "c-lab-2", code: "X-L2", type: "Labor" };
const lecture = { id: "c-lec", code: "X-E", type: "Elmélet" };

let pickPlan = rajtolo.emptyPlan("t1");
assert.ok(!rajtolo.isCourseInPlan(pickPlan, "s1", lab1.id), "nothing is in the pickPlan until it is picked");

pickPlan = rajtolo.toggleCourseInPlan(pickPlan, aiSubject, lab1);
assert.strictEqual(pickPlan.subjects.length, 1, "picking a course pulls its subject in with it");
assert.ok(rajtolo.isCourseInPlan(pickPlan, "s1", lab1.id));

// a second course of the same group is ranked after the first
pickPlan = rajtolo.toggleCourseInPlan(pickPlan, aiSubject, lab2);
assert.deepStrictEqual(pickPlan.subjects[0].groups.find(g => g.type === "Labor").ranking, [lab1.id, lab2.id]);

// The plan keeps each ranked course's code and times, so the dialog names it and checks
// clashes without a request of its own; seats are never kept. Unticking drops the note.
{
  const slot = { day: 1, start: 600, end: 690, dayLabel: "Hétfő" };
  const noted = rajtolo.toggleCourseInPlan(
    rajtolo.emptyPlan("t1"),
    aiSubject,
    Object.assign({ slots: [slot], isFull: false }, lab1)
  );
  assert.deepStrictEqual(noted.subjects[0].courses[lab1.id], { code: "X-L1", slots: [slot] });
  const both = rajtolo.toggleCourseInPlan(noted, aiSubject, lab2);
  const one = rajtolo.toggleCourseInPlan(both, aiSubject, lab2);
  assert.deepStrictEqual(Object.keys(one.subjects[0].courses), [lab1.id], "an unticked course is forgotten");
}

// The ▲/▼ buttons list a PRUNED copy of each ranking, so a swap has to go through the
// plan by course id. Reordering the copy by index used to change nothing that was saved.
{
  const stale = Object.assign({}, pickPlan, {
    subjects: [
      Object.assign({}, pickPlan.subjects[0], {
        groups: [{ type: "Labor", typeId: null, ranking: ["gone", lab1.id, lab2.id] }],
      }),
    ],
  });
  const visible = rajtolo.pruneGroups(stale.subjects[0].groups, [lab1, lab2])[0].ranking;
  assert.deepStrictEqual(visible, [lab1.id, lab2.id], "the dialog shows the ranking without the stale id");
  const swapped = rajtolo.swapCourses(stale, "s1", visible[1], visible[0]);
  assert.deepStrictEqual(
    swapped.subjects[0].groups[0].ranking,
    ["gone", lab2.id, lab1.id],
    "moving the second visible course up swaps it with its visible neighbour in the stored plan"
  );
  assert.deepStrictEqual(stale.subjects[0].groups[0].ranking, ["gone", lab1.id, lab2.id], "the input is untouched");
  assert.strictEqual(rajtolo.swapCourses(stale, "s1", lab1.id, undefined), stale, "no neighbour -> no change");
  assert.strictEqual(rajtolo.swapCourses(stale, "s1", lab1.id, lecture.id), stale, "another group -> no change");
  assert.strictEqual(rajtolo.swapCourses(stale, "other", lab1.id, lab2.id), stale, "another subject -> no change");
}

// a different group stays separate (one course per group, not per subject)
pickPlan = rajtolo.toggleCourseInPlan(pickPlan, aiSubject, lecture);
assert.deepStrictEqual(pickPlan.subjects[0].groups.map(g => g.type).sort(), ["Elmélet", "Labor"]);

// unpicking removes just that course, not its group-mate
pickPlan = rajtolo.toggleCourseInPlan(pickPlan, aiSubject, lab1);
assert.ok(!rajtolo.isCourseInPlan(pickPlan, "s1", lab1.id));
assert.ok(rajtolo.isCourseInPlan(pickPlan, "s1", lab2.id));

// unpicking the last course drops the subject entirely - an empty entry would only
// ever resolve to "unconfigured" at run time
pickPlan = rajtolo.toggleCourseInPlan(pickPlan, aiSubject, lab2);
pickPlan = rajtolo.toggleCourseInPlan(pickPlan, aiSubject, lecture);
assert.strictEqual(pickPlan.subjects.length, 0, "a subject with nothing ranked is not kept");

// the plan starts with no termId (it is built before any subject is known) and has to
// adopt one from the first picked subject - otherwise savePlan and loadPlan key on
// different things and the plan silently reverts to empty on the next refresh
const freshPlan = rajtolo.emptyPlan(null);
assert.strictEqual(freshPlan.termId, null);
const adopted = rajtolo.toggleCourseInPlan(freshPlan, aiSubject, lab1);
assert.strictEqual(adopted.termId, "t1", "the plan must take the subject's termId");
// an existing termId is never overwritten by a later pick
const kept = rajtolo.toggleCourseInPlan(adopted, { ...aiSubject, subjectId: "s2", termId: "OTHER" }, lecture);
assert.strictEqual(kept.termId, "t1");

// the subject-row badge counts every queued course across the subject's groups
const counted = rajtolo.toggleCourseInPlan(
  rajtolo.toggleCourseInPlan(rajtolo.toggleCourseInPlan(rajtolo.emptyPlan("t1"), aiSubject, lab1), aiSubject, lab2),
  aiSubject,
  lecture
);
assert.strictEqual(rajtolo.plannedCount(counted, "s1"), 3, "two labs plus a lecture");
assert.strictEqual(rajtolo.plannedCount(counted, "nincs-ilyen"), 0, "an unqueued subject shows nothing");

// pruning drops ids for courses that no longer exist, and the groups they emptied
const pruned = rajtolo.pruneGroups(
  [
    { type: "Labor", ranking: ["c-lab-1", "gone"] },
    { type: "Elmélet", ranking: ["vanished"] },
  ],
  [lab1]
);
assert.deepStrictEqual(pruned, [{ type: "Labor", typeId: null, ranking: ["c-lab-1"] }]);
// pruning must never ADD: auto-ranking every course would put labs in the pickPlan the
// user never chose
assert.deepStrictEqual(rajtolo.pruneGroups([], [lab1, lab2, lecture]), []);

// --- rajtolo: timetable clash detection (synthetic classInstanceInfos fixture) ---
assert.strictEqual(rajtolo.toMinutes("16:00"), 960, "16:00 must be 16*60 minutes since midnight");
assert.strictEqual(rajtolo.toMinutes("00:00"), 0);
assert.strictEqual(rajtolo.toMinutes("24:00"), null, "not a valid clock time - must fail closed, not wrap");
assert.strictEqual(rajtolo.toMinutes("16:60"), null, "not a valid clock time");
assert.strictEqual(rajtolo.toMinutes("16:0"), null, "not the measured HH:MM shape");
assert.strictEqual(rajtolo.toMinutes(""), null, "empty string");
assert.strictEqual(rajtolo.toMinutes(null), null, "a missing time must not throw");

const mon16to18 = { day: 1, start: 960, end: 1080 };
const mon17to19 = { day: 1, start: 1020, end: 1140 };
const mon18to20 = { day: 1, start: 1080, end: 1200 };
const tue16to18 = { day: 2, start: 960, end: 1080 };
assert.ok(rajtolo.slotsOverlap(mon16to18, mon17to19), "16-18 and 17-19 on the same day genuinely overlap");
assert.ok(
  !rajtolo.slotsOverlap(mon16to18, mon18to20),
  "one ending exactly when the other starts is the common back-to-back case, not a clash"
);
assert.ok(!rajtolo.slotsOverlap(mon16to18, tue16to18), "same time, different day - not a clash");
assert.ok(rajtolo.slotsOverlap(mon16to18, { day: 1, start: 960, end: 1080 }), "two identical slots do overlap");

// findPlanConflicts: which of the picks that would be ticked right now (built
// elsewhere via preselection) clash with each other
function rajtoloPick(subjectId, courseId, slots) {
  return { subjectId, subjectTitle: subjectId, groupType: "Elmélet", course: { id: courseId, code: courseId, slots } };
}
assert.deepStrictEqual(
  rajtolo.findPlanConflicts([rajtoloPick("s1", "c1", [mon16to18]), rajtoloPick("s2", "c2", [tue16to18])]),
  [],
  "no overlap -> no conflicts reported"
);
const onePairConflict = rajtolo.findPlanConflicts([
  rajtoloPick("s1", "c1", [mon16to18]),
  rajtoloPick("s2", "c2", [mon17to19]),
]);
assert.strictEqual(onePairConflict.length, 1, "one overlapping pair -> exactly one conflict");
assert.strictEqual(onePairConflict[0].a.subjectId, "s1");
assert.strictEqual(onePairConflict[0].b.subjectId, "s2");

// a pair must never be reported twice, even when both sides carry several slots that
// all overlap each other - one clash is already enough to warn about
const multiSlotConflict = rajtolo.findPlanConflicts([
  rajtoloPick("s1", "c1", [mon16to18, mon17to19]),
  rajtoloPick("s2", "c2", [mon16to18, mon17to19]),
]);
assert.strictEqual(multiSlotConflict.length, 1, "the same pair of picks must never be reported twice");

// a course must never be reported against itself
assert.deepStrictEqual(
  rajtolo.findPlanConflicts([rajtoloPick("s1", "c1", [mon16to18]), rajtoloPick("s1", "c1", [mon16to18])]),
  [],
  "a course must never be reported against itself"
);

// a course with zero timetable slots has nothing to compare - never a clash, never a throw
assert.deepStrictEqual(
  rajtolo.findPlanConflicts([rajtoloPick("s1", "c1", []), rajtoloPick("s2", "c2", [mon16to18])]),
  [],
  "a course with no timetable slots can never clash"
);

// collectCourses must normalise the measured classInstanceInfos shape exactly, keeping
// dayOfWeekText only as a display label (dayLabel) and never for matching
const measuredSlotCourse = rajtolo
  .collectCourses({
    data: [
      {
        id: "c1",
        subjectId: "s1",
        type: "Elmélet",
        classInstanceInfos: [
          {
            dayOfWeek: 1,
            dayOfWeekText: "Hétfő",
            startTime: "16:00",
            endTime: "18:00",
            rooms: "Terem 101",
            repetition: true,
          },
        ],
      },
    ],
  })
  .get("s1")
  .get("c1");
assert.deepStrictEqual(
  measuredSlotCourse.slots,
  [{ day: 1, start: 960, end: 1080, rooms: "Terem 101", dayLabel: "Hétfő" }],
  "the measured classInstanceInfos entry must normalise exactly like this"
);
assert.strictEqual(
  rajtolo
    .collectCourses({ data: [{ id: "c2", subjectId: "s2", type: "Elmélet" }] })
    .get("s2")
    .get("c2").slots.length,
  0,
  "a course with no classInstanceInfos at all must not throw and has nothing to compare"
);

// repetition is deliberately never read by normaliseSlot because the meaning of
// false is unmeasured: a repetition:false slot must still be kept and reported as a
// clash, since a missed clash is worse than a false one
const falseRepetitionCourse = rajtolo
  .collectCourses({
    data: [
      {
        id: "cX",
        subjectId: "sX",
        type: "Elmélet",
        classInstanceInfos: [
          {
            dayOfWeek: 1,
            dayOfWeekText: "Hétfő",
            startTime: "16:00",
            endTime: "18:00",
            rooms: "R1",
            repetition: false,
          },
        ],
      },
    ],
  })
  .get("sX")
  .get("cX");
assert.strictEqual(falseRepetitionCourse.slots.length, 1, "a repetition:false slot is still kept");
const falseRepetitionConflict = rajtolo.findPlanConflicts([
  { subjectId: "sX", subjectTitle: "X tárgy", groupType: "Elmélet", course: falseRepetitionCourse },
  rajtoloPick("s2", "c2", [mon17to19]),
]);
assert.strictEqual(falseRepetitionConflict.length, 1, "a repetition:false slot must still be reported as a clash");

module.exports = { run: runChecks };

// A SchedulableSubjects row without termId (issue #5, ME's Neptun) left the record
// unsaveable: every Rajtoló switch press ended in "A Rajtoló terve nem menthető".
// The GetSubjectsCourses request URL the app just sent fills the missing ids in.
{
  const rows = require("../src/modules/rajtolo/rows");
  const previousLocation = global.location;
  global.location = { origin: "https://neptun.test" };
  try {
    const state = {
      subjectCatalog: rajtolo.collectSubjects({ data: [{ id: "s-me", title: "Matek", code: "ME1" }] }),
    };
    rows.rememberSubjectFromUrl(
      state,
      "/hallgato_ng/api/SubjectApplication/GetSubjectsCourses?subjectId=s-me&termId=t-1&curriculumTemplateId=c-1&curriculumTemplateLineId=l-1"
    );
    const record = state.subjectCatalog.get("s-me");
    assert.strictEqual(record.termId, "t-1", "a missing termId is taken from the request URL");
    assert.strictEqual(record.curriculumTemplateLineId, "l-1", "so are the other ids SubjectSignin needs");
    assert.strictEqual(record.title, "Matek", "the rest of the known record is kept");
    const urlPlan = rajtolo.toggleCourseInPlan(rajtolo.emptyPlan(null), record, { id: "k-1", type: "Gyakorlat" });
    assert.strictEqual(urlPlan.termId, "t-1", "the plan now has a term to be saved under");

    rows.rememberSubjectFromUrl(state, "/x?subjectId=s-me&termId=t-other");
    assert.strictEqual(state.subjectCatalog.get("s-me").termId, "t-1", "a known termId is never overwritten");
  } finally {
    if (typeof previousLocation === "undefined") {
      delete global.location;
    } else {
      global.location = previousLocation;
    }
  }
}

// withRenewal: a refused token is renewed and the request sent once more; nothing
// else is ever resent.
{
  const { withRenewal, isHalted } = require("../src/modules/rajtolo/net");
  const { STATUS_KEY } = require("../src/modules/rajtolo/constants");
  const answers = (...list) => {
    const calls = [];
    const request = (...args) => {
      calls.push(args);
      return Promise.resolve(list.shift());
    };
    return { request, calls };
  };
  const session = (renewed, needs = false) => {
    const log = { renewals: 0 };
    return Object.assign(log, {
      needsRenewal: () => needs,
      renew: () => {
        log.renewals++;
        return Promise.resolve(renewed);
      },
    });
  };
  const check = async () => {
    const refused = answers({ [STATUS_KEY]: 401 }, { [STATUS_KEY]: 200, data: [] });
    const renewing = session(true);
    const ok = await withRenewal(refused.request, renewing)("s", ["c"]);
    assert.strictEqual(ok[STATUS_KEY], 200);
    assert.strictEqual(refused.calls.length, 2, "a 401 is resent once after a renewal");
    assert.deepStrictEqual(refused.calls[1], ["s", ["c"]]);

    const stillRefused = answers({ [STATUS_KEY]: 401 }, { [STATUS_KEY]: 200 });
    const out = await withRenewal(stillRefused.request, session(false))();
    assert.strictEqual(out[STATUS_KEY], 401, "no new token, no resend");
    assert.strictEqual(stillRefused.calls.length, 1);

    const timedOut = answers({ notification: [{ description: "A szerver nem válaszolt időben.", type: 3 }] });
    const quiet = session(true);
    await withRenewal(timedOut.request, quiet)();
    assert.strictEqual(timedOut.calls.length, 1, "a timeout may have been processed: never resent");
    assert.strictEqual(quiet.renewals, 0);

    // Stop pressed (or a user switch) while the renewal ran: nothing more is sent.
    let running = true;
    const stopping = answers({ [STATUS_KEY]: 401 }, { [STATUS_KEY]: 200 });
    const stopSession = Object.assign(session(true), {
      renew: () => {
        running = false;
        return Promise.resolve(true);
      },
      shouldContinue: () => running,
    });
    const halted = await withRenewal(stopping.request, stopSession)();
    assert.strictEqual(stopping.calls.length, 1, "no resend after Stop");
    assert.strictEqual(isHalted(halted), true);
    running = true;
    const beforeSend = answers({ [STATUS_KEY]: 200 });
    const stopFirst = Object.assign(session(true, true), {
      renew: () => {
        running = false;
        return Promise.resolve(true);
      },
      shouldContinue: () => running,
    });
    await withRenewal(beforeSend.request, stopFirst)();
    assert.strictEqual(beforeSend.calls.length, 0, "Stop during the pre-send renewal: never sent");

    const expired = answers({ [STATUS_KEY]: 200 });
    const before = session(true, true);
    await withRenewal(expired.request, before)();
    assert.strictEqual(before.renewals, 1, "an expired token is renewed before the request");
  };
  const previousRun = module.exports.run;
  module.exports.run = () => previousRun().then(check);
}
