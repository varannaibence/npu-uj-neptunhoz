const assert = require("assert");
const { normaliseSlot } = require("../src/timetable");
const solver = require("../src/timetableSolver");

const slot = (day, from, to, extra) =>
  normaliseSlot(Object.assign({ dayOfWeek: day, startTime: from, endTime: to }, extra));
const course = (id, slots, extra) => Object.assign({ id, label: id, slots }, extra);
const group = (key, options, extra) => Object.assign({ key, label: key, options }, extra);
const picksOf = variant => variant.picks.map(pick => pick.courseId);

// --- the week's shape ---
assert.deepStrictEqual(solver.weekMetrics([slot(1, "08:00", "10:00"), slot(1, "12:00", "14:00")]), {
  busyDays: 1,
  gapMinutes: 120,
  spanMinutes: 360,
});
assert.strictEqual(
  solver.weekMetrics([slot(1, "08:00", "09:50"), slot(1, "10:00", "12:00")]).gapMinutes,
  0,
  "a ten-minute break is walking time, not a gap"
);
assert.strictEqual(
  solver.weekMetrics([slot(1, "08:00", "12:00"), slot(1, "09:00", "10:00"), slot(1, "13:00", "14:00")]).gapMinutes,
  60,
  "a class inside a longer one does not open a gap"
);
assert.deepStrictEqual(solver.weekMetrics([]), { busyDays: 0, gapMinutes: 0, spanMinutes: 0 });

// --- a held class blocks a course, and the blocked course says why ---
{
  const result = solver.suggestSchedules({
    fixed: [{ label: "Felvett labor", slots: [slot(2, "08:00", "10:00")] }],
    groups: [group("A", [course("a1", [slot(2, "09:00", "11:00")]), course("a2", [slot(3, "10:00", "12:00")])])],
  });
  assert.strictEqual(result.exhaustive, true);
  assert.strictEqual(result.variants.length, 1, "every strategy agrees, so one variant");
  const [variant] = result.variants;
  assert.deepStrictEqual(variant.strategies, ["gaps", "freeDays", "closest"]);
  assert.strictEqual(variant.complete, true);
  assert.deepStrictEqual(picksOf(variant), ["a2"]);
  assert.deepStrictEqual(variant.picks[0].alternatives, [
    { courseId: "a1", fits: false, clashesWith: ["Felvett labor"] },
  ]);
  assert.deepStrictEqual(variant.picks[0].rankings.gaps, ["a2"], "a course that clashes is never a fallback");
}

// --- the three strategies pull apart ---
{
  const result = solver.suggestSchedules({
    fixed: [{ label: "F", slots: [slot(1, "08:00", "10:00"), slot(2, "08:00", "10:00")] }],
    groups: [
      group(
        "G",
        [
          course("newDay", [slot(3, "08:00", "10:00")]),
          course("gapMonday", [slot(1, "12:00", "14:00")]),
          course("current", [slot(2, "14:00", "16:00")]),
        ],
        { current: "current" }
      ),
    ],
  });
  const byStrategy = {};
  result.variants.forEach(variant => variant.strategies.forEach(s => (byStrategy[s] = picksOf(variant)[0])));
  assert.deepStrictEqual(byStrategy, { gaps: "newDay", freeDays: "gapMonday", closest: "current" });
  const gaps = result.variants.find(variant => variant.strategies.includes("gaps"));
  assert.strictEqual(gaps.picks[0].changed, true);
  assert.deepStrictEqual(
    gaps.picks[0].rankings.gaps,
    ["newDay", "gapMonday", "current"],
    "fallbacks ranked the way this strategy ranks whole weeks"
  );
}

// --- one variant, several strategies: each keeps its own fallback order ---
{
  const [variant] = solver.suggestSchedules({
    fixed: [{ label: "F", slots: [slot(1, "08:00", "10:00")] }],
    groups: [
      group("G", [
        course("P", [slot(1, "10:00", "12:00")]),
        course("A", [slot(2, "08:00", "10:00")]),
        course("B", [slot(1, "14:00", "16:00")]),
      ]),
    ],
  }).variants;
  assert.deepStrictEqual(variant.strategies, ["gaps", "freeDays", "closest"]);
  assert.deepStrictEqual(variant.picks[0].rankings.gaps, ["P", "A", "B"], "a gap-free new day first");
  assert.deepStrictEqual(variant.picks[0].rankings.freeDays, ["P", "B", "A"], "no new day first");
}

// --- nothing fits both: one group is left out, never a clash ---
{
  const result = solver.suggestSchedules({
    groups: [
      group("A", [course("a", [slot(1, "08:00", "10:00")])], { current: "a" }),
      group("B", [course("b", [slot(1, "09:00", "11:00")])], { current: "b" }),
    ],
  });
  const [variant] = result.variants;
  assert.strictEqual(variant.complete, false);
  assert.strictEqual(variant.metrics.unplaced, 1);
  assert.deepStrictEqual(picksOf(variant), ["a", null], "the first group wins a tie, deterministically");
  assert.strictEqual(variant.picks[1].changed, true, "leaving a planned course out is a change");
  assert.deepStrictEqual(variant.warnings, [{ groupKey: "B", courseId: null, kind: "unplaced" }]);
  assert.deepStrictEqual(variant.picks[1].alternatives, [{ courseId: "b", fits: false, clashesWith: ["A – a"] }]);
  assert.deepStrictEqual(variant.picks[1].rankings.gaps, []);
}

// --- a seat at risk only when nothing else fits; unknown times last ---
{
  const result = solver.suggestSchedules({
    groups: [
      group("A", [
        course("full", [slot(1, "08:00", "10:00")], { isFull: true }),
        course("willQueue", [slot(1, "10:00", "12:00")], { willBeOnWaitingList: true }),
        course("queued", [slot(1, "12:00", "14:00")], { isOnWaitingList: true }),
        course("open", [slot(5, "18:00", "20:00")]),
      ]),
      group("B", [course("noTime", []), course("timed", [slot(4, "08:00", "10:00")])]),
      group("C", [course("onlyFull", [slot(2, "08:00", "10:00")], { isFull: true, isRankingCourse: true })]),
      group("D", [course("held", [slot(3, "08:00", "10:00")], { isFull: true, isSigned: true })]),
    ],
  });
  result.variants.forEach(variant => {
    assert.deepStrictEqual(picksOf(variant), ["open", "timed", "onlyFull", "held"]);
    assert.deepStrictEqual(
      variant.warnings.map(w => `${w.courseId}:${w.kind}`),
      ["onlyFull:full", "onlyFull:ranking"],
      "a course already held is not at risk, full or not"
    );
    assert.strictEqual(variant.complete, false, "a full course placed is not a finished week");
  });
  const warned = solver.suggestSchedules({
    groups: [
      group("A", [course("w", [slot(1, "08:00", "10:00")], { willBeOnWaitingList: true })]),
      group("B", [course("q", [slot(2, "08:00", "10:00")], { isOnWaitingList: true })]),
    ],
  }).variants[0];
  assert.deepStrictEqual(
    warned.warnings.map(w => w.kind),
    ["waitlist", "queued"]
  );
  assert.strictEqual(warned.metrics.risky, 2, "a waiting list is not a seat");

  const unknown = solver.suggestSchedules({ groups: [group("B", [course("noTime", [])])] }).variants[0];
  assert.deepStrictEqual(unknown.warnings, [{ groupKey: "B", courseId: "noTime", kind: "unknownTime" }]);
  assert.strictEqual(unknown.complete, true, "no known clash is not a claim that there is none");
  const partly = solver.suggestSchedules({
    groups: [group("B", [course("half", [slot(1, "08:00", "10:00"), { day: 3, start: null, end: 60 }])])],
  }).variants[0];
  assert.deepStrictEqual(
    partly.warnings.map(w => w.kind),
    ["unknownTime"],
    "one unreadable slot is a time never checked"
  );
}

// --- a non-weekly slot is flagged and still checked every week ---
{
  const irregular = slot(1, "08:00", "10:00", { repetition: false });
  assert.strictEqual(irregular.irregular, true);
  assert.strictEqual(slot(1, "08:00", "10:00", { repetition: true }).irregular, undefined);
  const [variant] = solver.suggestSchedules({
    fixed: [{ label: "F", slots: [slot(1, "09:00", "11:00")] }],
    groups: [
      group("A", [course("odd", [irregular]), course("even", [slot(1, "12:00", "14:00", { repetition: false })])]),
    ],
  }).variants;
  assert.deepStrictEqual(picksOf(variant), ["even"]);
  assert.deepStrictEqual(variant.warnings, [{ groupKey: "A", courseId: "even", kind: "irregular" }]);
}

// --- garbage in, no crash and no invented picks ---
assert.deepStrictEqual(solver.suggestSchedules(null), { exhaustive: true, variants: [] });
{
  const [variant] = solver.suggestSchedules({
    fixed: [{ slots: [slot(4, "08:00", "10:00")] }],
    groups: [
      group("A", [course("a", [{ day: 1, start: 600, end: 500 }]), null, course("a", [slot(3, "08:00", "10:00")])], {
        current: "gone",
      }),
      group("A", [course("dup", [])]),
      group("E", []),
      group("X", [course("a", []), course("x", [slot(4, "09:00", "10:00")])]),
    ],
  }).variants;
  assert.deepStrictEqual(picksOf(variant), ["a", null, null], "duplicate group and course dropped; empty left out");
  assert.strictEqual(variant.metrics.unknownTime, 1, "an unreadable slot is an unknown time, not midnight");
  assert.strictEqual(variant.metrics.changes, 0, "a current pick that is not offered is ignored");
  assert.deepStrictEqual(variant.picks[2].alternatives[0].clashesWith, ["Felvett kurzus"]);
}

// --- the search agrees with an independent brute force on random weeks ---
// Its own metrics (a minute-by-minute map of each day) and its own key order, so a
// bug in weekMetrics or KEYS cannot hide behind itself.
function prng(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}
const ORDER = {
  gaps: ["unplaced", "risky", "unknownTime", "gapMinutes", "busyDays", "changes", "spanMinutes"],
  freeDays: ["unplaced", "risky", "unknownTime", "busyDays", "gapMinutes", "changes", "spanMinutes"],
  closest: ["unplaced", "risky", "unknownTime", "changes", "gapMinutes", "busyDays", "spanMinutes"],
};
const overlap = (x, y) => x.day === y.day && x.start < y.end && y.start < x.end;
function independentMetrics(input, chosen) {
  const fixedSlots = input.fixed.flatMap(entry => entry.slots);
  const picked = [];
  const m = { unplaced: 0, risky: 0, unknownTime: 0, changes: 0 };
  for (let g = 0; g < chosen.length; g++) {
    const option = chosen[g];
    if (!option) {
      m.unplaced++;
      continue;
    }
    m.risky += !option.isSigned && (option.isFull || option.willBeOnWaitingList || option.isOnWaitingList) ? 1 : 0;
    m.unknownTime += option.slots.length ? 0 : 1;
    m.changes += input.groups[g].current && input.groups[g].current !== option.id ? 1 : 0;
    for (const s of option.slots) {
      if (fixedSlots.some(f => overlap(f, s)) || picked.some(p => p.g !== g && overlap(p.s, s))) {
        return null;
      }
    }
    option.slots.forEach(s => picked.push({ g, s }));
  }
  const days = {};
  fixedSlots.concat(picked.map(p => p.s)).forEach(s => (days[s.day] = days[s.day] || []).push(s));
  m.busyDays = 0;
  m.gapMinutes = 0;
  m.spanMinutes = 0;
  Object.values(days).forEach(list => {
    m.busyDays++;
    const busy = new Uint8Array(24 * 60);
    const lo = Math.min(...list.map(s => s.start));
    const hi = Math.max(...list.map(s => s.end));
    list.forEach(s => busy.fill(1, s.start, s.end));
    m.spanMinutes += hi - lo;
    let run = 0;
    for (let minute = lo; minute < hi; minute++) {
      if (busy[minute]) {
        m.gapMinutes += run > solver.PASSING_MINUTES ? run : 0;
        run = 0;
      } else {
        run++;
      }
    }
  });
  return m;
}
const less = (a, b) => {
  const k = a.findIndex((v, j) => v !== b[j]);
  return k !== -1 && a[k] < b[k];
};
function bruteBest(input, strategy) {
  let best = null;
  (function walk(i, chosen) {
    if (i === input.groups.length) {
      const m = independentMetrics(input, chosen);
      const key = m && ORDER[strategy].map(name => m[name]);
      if (key && (!best || less(key, best))) {
        best = key;
      }
      return;
    }
    input.groups[i].options.concat(null).forEach(option => walk(i + 1, chosen.concat([option])));
  })(0, []);
  return best;
}
{
  const random = prng(7919);
  const pickSlot = () => {
    const start = (8 + Math.floor(random() * 11)) * 60 + [0, 10, 15, 16, 30, 45][Math.floor(random() * 6)];
    return { day: 1 + Math.floor(random() * 5), start, end: start + [30, 45, 60, 90, 120][Math.floor(random() * 5)] };
  };
  for (let round = 0; round < 400; round++) {
    const fixed = [{ label: "F1", slots: Array.from({ length: Math.floor(random() * 4) }, pickSlot) }];
    const groups = [];
    const groupCount = 1 + Math.floor(random() * 5);
    for (let g = 0; g < groupCount; g++) {
      const options = [];
      const optionCount = Math.floor(random() * 4);
      for (let o = 0; o < optionCount; o++) {
        const slots = random() < 0.1 ? [] : Array.from({ length: 1 + Math.floor(random() * 2) }, pickSlot);
        options.push(
          course(`g${g}o${o}`, slots, {
            isFull: random() < 0.15,
            willBeOnWaitingList: random() < 0.1,
            isOnWaitingList: random() < 0.05,
            isSigned: random() < 0.05,
          })
        );
      }
      groups.push(group(`g${g}`, options, { current: options.length && random() < 0.5 ? options[0].id : undefined }));
    }
    const input = { fixed, groups };
    const result = solver.suggestSchedules(input);
    assert.strictEqual(result.exhaustive, true);
    solver.STRATEGIES.forEach(strategy => {
      const variant = result.variants.find(v => v.strategies.includes(strategy));
      const chosen = variant.picks.map(
        (pick, g) => pick.courseId && groups[g].options.find(o => o.id === pick.courseId)
      );
      const m = independentMetrics(input, chosen);
      assert.ok(m, `round ${round}, ${strategy}: the picks clash`);
      const key = ORDER[strategy].map(name => m[name]);
      assert.deepStrictEqual(key, bruteBest(input, strategy), `round ${round}, ${strategy}: not the optimum`);
      assert.deepStrictEqual(
        ORDER[strategy].map(name => variant.metrics[name]),
        key,
        `round ${round}: reported metrics`
      );
    });
  }
}

// --- a large week stops at the budget, still deterministic and still clash-free ---
{
  const random = prng(1);
  const fixed = [
    { label: "F", slots: Array.from({ length: 8 }, () => slot(1 + Math.floor(random() * 5), "08:00", "09:30")) },
  ];
  const groups = [];
  for (let g = 0; g < 14; g++) {
    const options = [];
    for (let o = 0; o < 12; o++) {
      const at = () => {
        const hour = 8 + Math.floor(random() * 10);
        return slot(1 + Math.floor(random() * 5), `${hour}:00`, `${hour + 1}:30`);
      };
      options.push(course(`g${g}o${o}`, [at(), at()]));
    }
    groups.push(group(`g${g}`, options));
  }
  const input = { fixed, groups };
  const started = Date.now();
  const first = solver.suggestSchedules(input);
  const elapsed = Date.now() - started;
  assert.strictEqual(first.exhaustive, false, "this week is past the budget");
  assert.deepStrictEqual(first, solver.suggestSchedules(input), "same input, same answer");
  // Wall-clock only as a sanity bound: a stalled machine must not flake the suite.
  assert.ok(elapsed < 60000, `bounded search took ${elapsed} ms`);
  const unplaced = new Set(first.variants.map(variant => variant.metrics.unplaced));
  assert.strictEqual(unplaced.size, 1, "no strategy leaves out more than another one placed");
  first.variants.forEach(variant => {
    const chosen = variant.picks.map((pick, g) => pick.courseId && groups[g].options.find(o => o.id === pick.courseId));
    assert.ok(independentMetrics(input, chosen), "a cut-short search still never returns a clash");
  });
}
