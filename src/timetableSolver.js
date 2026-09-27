// Pure timetable suggestions. Given the classes a student already holds (fixed) and,
// for every course group still to fill, the courses that could fill it, finds picks
// with no known clash under three strategies. Knows nothing about the DOM, storage or
// network; slots are timetable.normaliseSlot's { day, start, end } shape.
//
// "No known clash" is all it can promise: a course without a time cannot be checked,
// and a non-weekly slot (repetition === false, never measured) is treated as if it
// ran every week, so it may report a clash that is not there, never the other way.

const { slotsOverlap } = require("./timetable");

// A break this short is walking time between rooms, not a gap in the day.
const PASSING_MINUTES = 15;
// Search nodes per strategy. Deterministic: the same input always stops at the same
// place, and the result says whether the search was complete.
// ponytail: plain depth-first, so a cut-short search on a big week can miss the
// optimum (a group left out, a full course kept); limited-discrepancy search if real
// plans hit the budget.
const NODE_BUDGET = 20000;

const STRATEGIES = ["gaps", "freeDays", "closest"];

// Lower is better, compared left to right. The first three components rank what a
// strategy must never trade away: a group left out, a course that is full or
// waitlisted, a course whose time is unknown.
const KEYS = {
  gaps: m => [m.unplaced, m.risky, m.unknownTime, m.gapMinutes, m.busyDays, m.changes, m.spanMinutes],
  freeDays: m => [m.unplaced, m.risky, m.unknownTime, m.busyDays, m.gapMinutes, m.changes, m.spanMinutes],
  closest: m => [m.unplaced, m.risky, m.unknownTime, m.changes, m.gapMinutes, m.busyDays, m.spanMinutes],
};
// How many leading key components can only grow as picks are added. Gap minutes can
// shrink (a class may fill a gap), so the bound stops before them.
const MONOTONIC_PREFIX = { gaps: 3, freeDays: 4, closest: 4 };

function compareKeys(a, b, length) {
  const n = length === undefined ? a.length : length;
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1;
    }
  }
  return 0;
}

function validSlot(slot) {
  return (
    slot &&
    typeof slot.day === "number" &&
    typeof slot.start === "number" &&
    typeof slot.end === "number" &&
    slot.start < slot.end
  );
}

// Busy days, gap minutes and the summed first-to-last span of a week of slots.
function weekMetrics(slots) {
  const byDay = new Map();
  slots.forEach(slot => {
    const list = byDay.get(slot.day) || [];
    list.push(slot);
    byDay.set(slot.day, list);
  });
  let gapMinutes = 0;
  let spanMinutes = 0;
  byDay.forEach(list => {
    list.sort((a, b) => a.start - b.start || a.end - b.end);
    let reach = list[0].end;
    list.forEach(slot => {
      const gap = slot.start - reach;
      if (gap > PASSING_MINUTES) {
        gapMinutes += gap;
      }
      reach = Math.max(reach, slot.end);
    });
    spanMinutes += reach - list[0].start;
  });
  return { busyDays: byDay.size, gapMinutes, spanMinutes };
}

function prepare(input) {
  const fixed = [];
  ((input && input.fixed) || []).forEach(entry => {
    ((entry && entry.slots) || []).filter(validSlot).forEach(slot => {
      fixed.push({ slot, owner: (entry && entry.label) || "Felvett kurzus" });
    });
  });
  const seen = new Set();
  // A course belongs to one group; offered twice, only the first offer counts, or a
  // course without a time could be picked for both.
  const taken = new Set();
  const groups = [];
  ((input && input.groups) || []).forEach(group => {
    if (!group || !group.key || seen.has(group.key)) {
      return;
    }
    seen.add(group.key);
    const ids = new Set();
    const options = [];
    (group.options || []).forEach(option => {
      if (!option || !option.id || taken.has(option.id)) {
        return;
      }
      taken.add(option.id);
      ids.add(option.id);
      const raw = Array.isArray(option.slots) ? option.slots : [];
      const slots = raw.filter(validSlot);
      // Held already, the seat is not at risk whatever the counts say. Otherwise a
      // full course cannot be applied for, `willBeOnWaitingList` means applying now
      // only queues, and `isOnWaitingList` means the student is queued already
      // (AGENTS.md invariant 5: a waiting list is not a seat).
      const held = option.isSigned === true;
      const full = !held && option.isFull === true;
      const waitlist = !held && option.willBeOnWaitingList === true;
      const queued = !held && option.isOnWaitingList === true;
      options.push({
        id: option.id,
        rank: options.length,
        owner: [group.label, option.label].filter(Boolean).join(" – "),
        slots,
        full,
        waitlist,
        queued,
        risky: full || waitlist || queued,
        ranking: option.isRankingCourse === true,
        // One unreadable slot is a class time never checked, as much as no slot at all.
        unknownTime: slots.length === 0 || slots.length < raw.length,
        irregular: slots.some(slot => slot.irregular === true),
      });
    });
    groups.push({
      key: group.key,
      subjectId: group.subjectId || null,
      current: typeof group.current === "string" && ids.has(group.current) ? group.current : null,
      options,
    });
  });
  return { fixed, groups };
}

// `assign[i]` is undefined (not decided yet), null (left out) or an option.
function measure(ctx, assign) {
  const slots = ctx.fixed.map(entry => entry.slot);
  let unplaced = 0;
  let risky = 0;
  let unknownTime = 0;
  let changes = 0;
  ctx.groups.forEach((group, i) => {
    const option = assign[i];
    if (option === undefined) {
      return;
    }
    if (option === null) {
      unplaced++;
      return;
    }
    if (option.risky) {
      risky++;
    }
    if (option.unknownTime) {
      unknownTime++;
    }
    if (group.current && group.current !== option.id) {
      changes++;
    }
    option.slots.forEach(slot => slots.push(slot));
  });
  return Object.assign({ unplaced, risky, unknownTime, changes }, weekMetrics(slots));
}

function clashes(option, occupied) {
  const owners = [];
  option.slots.forEach(slot => {
    occupied.forEach(entry => {
      if (slotsOverlap(slot, entry.slot) && !owners.includes(entry.owner)) {
        owners.push(entry.owner);
      }
    });
  });
  return owners;
}

function fits(option, occupied) {
  return option.slots.every(slot => occupied.every(entry => !slotsOverlap(slot, entry.slot)));
}

function occupiedBy(ctx, assign, skipIndex) {
  const occupied = ctx.fixed.slice();
  assign.forEach((option, i) => {
    if (i !== skipIndex && option) {
      option.slots.forEach(slot => occupied.push({ slot, owner: option.owner }));
    }
  });
  return occupied;
}

// Depth-first branch and bound: the group with the fewest fitting courses next, its
// courses in the order this strategy likes them, leaving the group out last. `seeds`
// are the other strategies' answers: the best of them is the bound to beat, so a
// search cut short by the budget never leaves out more than another one already
// placed.
function search(ctx, strategy, seeds) {
  const keyOf = KEYS[strategy];
  const prefix = MONOTONIC_PREFIX[strategy];
  const assign = new Array(ctx.groups.length).fill(undefined);
  const occupied = ctx.fixed.slice();
  let best = null;
  let bestKey = null;
  // Null only when a search ran out before reaching any complete week.
  seeds.filter(Boolean).forEach(seed => {
    const seedKey = keyOf(measure(ctx, seed));
    if (!bestKey || compareKeys(seedKey, bestKey) < 0) {
      best = seed;
      bestKey = seedKey;
    }
  });
  let nodes = 0;
  let exhaustive = true;

  function visit() {
    if (nodes >= NODE_BUDGET) {
      exhaustive = false;
      return;
    }
    nodes++;
    const key = keyOf(measure(ctx, assign));
    if (bestKey && compareKeys(key, bestKey, prefix) > 0) {
      return;
    }
    let next = -1;
    let candidates = null;
    ctx.groups.forEach((group, i) => {
      if (assign[i] !== undefined) {
        return;
      }
      const fitting = group.options.filter(option => fits(option, occupied));
      if (next === -1 || fitting.length < candidates.length) {
        next = i;
        candidates = fitting;
      }
    });
    if (next === -1) {
      if (!bestKey || compareKeys(key, bestKey) < 0) {
        best = assign.slice();
        bestKey = key;
      }
      return;
    }
    const ordered = candidates
      .map(option => {
        assign[next] = option;
        const optionKey = keyOf(measure(ctx, assign));
        return { option, optionKey };
      })
      .sort((a, b) => compareKeys(a.optionKey, b.optionKey) || a.option.rank - b.option.rank);
    for (const { option } of ordered) {
      assign[next] = option;
      option.slots.forEach(slot => occupied.push({ slot, owner: option.owner }));
      visit();
      occupied.length -= option.slots.length;
      if (!exhaustive) {
        assign[next] = undefined;
        return;
      }
    }
    assign[next] = null;
    visit();
    assign[next] = undefined;
  }

  visit();
  return { assign: best, key: bestKey, exhaustive };
}

function warningsFor(ctx, assign) {
  const warnings = [];
  ctx.groups.forEach((group, i) => {
    const option = assign[i];
    if (!option) {
      warnings.push({ groupKey: group.key, courseId: null, kind: "unplaced" });
      return;
    }
    const kinds = [
      option.full && "full",
      option.waitlist && "waitlist",
      option.queued && "queued",
      option.ranking && "ranking",
      option.unknownTime && "unknownTime",
      option.irregular && "irregular",
    ].filter(Boolean);
    kinds.forEach(kind => warnings.push({ groupKey: group.key, courseId: option.id, kind }));
  });
  return warnings;
}

// Every other course of a group, measured against the rest of this variant, in the
// group's own order: whether it fits, and if not, what it clashes with.
function alternativesFor(ctx, assign, i) {
  const occupied = occupiedBy(ctx, assign, i);
  return ctx.groups[i].options
    .filter(option => option !== assign[i])
    .map(option => {
      const clashesWith = clashes(option, occupied);
      return { courseId: option.id, fits: clashesWith.length === 0, clashesWith };
    });
}

// The fallback order after the pick, for one strategy: only the courses that fit the
// rest of this variant, ranked the way that strategy ranks whole weeks. A course that
// clashes is never in it, so nothing following this order can queue a clash.
function rankingFor(ctx, assign, i, alternatives, strategy) {
  const keyOf = KEYS[strategy];
  const trial = assign.slice();
  const byId = new Map(ctx.groups[i].options.map(option => [option.id, option]));
  const fitting = alternatives
    .filter(alternative => alternative.fits)
    .map(alternative => {
      trial[i] = byId.get(alternative.courseId);
      return { option: trial[i], key: keyOf(measure(ctx, trial)) };
    })
    .sort((a, b) => compareKeys(a.key, b.key) || a.option.rank - b.option.rank);
  return (assign[i] ? [assign[i].id] : []).concat(fitting.map(entry => entry.option.id));
}

// { exhaustive, variants: [...] }. A variant found by more than one strategy is
// listed once, naming every strategy that chose it; its fallback rankings stay per
// strategy, since each strategy orders the same alternatives differently.
//
// `complete` means every group got a course with no known clash that is not full or
// queued. Unknown times, ranking courses and non-weekly slots are only warnings.
function suggestSchedules(input) {
  const ctx = prepare(input);
  if (ctx.groups.length === 0) {
    return { exhaustive: true, variants: [] };
  }
  const found = [];
  let exhaustive = true;
  STRATEGIES.forEach(strategy => {
    const result = search(ctx, strategy, found);
    found.push(result.assign);
    exhaustive = exhaustive && result.exhaustive;
  });
  const variants = [];
  STRATEGIES.forEach((strategy, s) => {
    // A search cut short may lose to a later strategy's answer on its own terms;
    // then that answer is this strategy's too. An exhaustive search never loses.
    const keyOf = KEYS[strategy];
    let assign = found[s];
    let key = keyOf(measure(ctx, assign));
    found.filter(Boolean).forEach(other => {
      const otherKey = keyOf(measure(ctx, other));
      if (compareKeys(otherKey, key) < 0) {
        assign = other;
        key = otherKey;
      }
    });
    const result = { assign };
    const signature = JSON.stringify(result.assign.map(option => (option ? option.id : null)));
    let variant = variants.find(candidate => candidate.signature === signature);
    if (!variant) {
      const metrics = measure(ctx, result.assign);
      variant = {
        signature,
        strategies: [],
        complete: metrics.unplaced === 0 && metrics.risky === 0,
        metrics,
        picks: ctx.groups.map((group, i) => {
          const option = result.assign[i];
          return {
            groupKey: group.key,
            subjectId: group.subjectId,
            courseId: option ? option.id : null,
            // Leaving out a group that had a course is a change too.
            changed: Boolean(group.current && (!option || option.id !== group.current)),
            alternatives: alternativesFor(ctx, result.assign, i),
            rankings: {},
          };
        }),
        warnings: warningsFor(ctx, result.assign),
        assign: result.assign,
      };
      variants.push(variant);
    }
    variant.strategies.push(strategy);
    variant.picks.forEach((pick, i) => {
      pick.rankings[strategy] = rankingFor(ctx, variant.assign, i, pick.alternatives, strategy);
    });
  });
  variants.forEach(variant => delete variant.assign);
  return { exhaustive, variants };
}

module.exports = { suggestSchedules, weekMetrics, STRATEGIES, KEYS, PASSING_MINUTES, NODE_BUDGET };
