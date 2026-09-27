const assert = require("assert");
const daily = require("../src/modules/dailyOverview");
const { wallClockToEpoch } = require("../src/modules/rajtolo/protocol");

// Neptun writes Budapest wall-clock time without a zone, so "today" is Budapest's.
const now = wallClockToEpoch("2026-09-28T09:00");
assert.strictEqual(daily.dayKey(now), "2026-09-28");
assert.strictEqual(daily.dayKey(wallClockToEpoch("2026-09-28T23:30")), "2026-09-28", "late evening is still today");
assert.strictEqual(daily.daysUntil("2026-09-30T08:00:00", now), 2);
assert.strictEqual(daily.daysUntil("2026-09-28T23:00:00", now), 0);
assert.strictEqual(daily.daysUntil("2026-09-27T10:00:00", now), -1);
assert.ok(Number.isNaN(daily.daysUntil(null, now)), "no date is no answer, not day zero");
assert.strictEqual(daily.dayWord(0), "ma");
assert.strictEqual(daily.dayWord(1), "holnap");
assert.strictEqual(daily.dayWord(5), "5 nap múlva");
assert.strictEqual(daily.dayWord(-2), "2 napja");

// The calendar feed, as measured: classes carry classInstanceId, exams type 1,
// periods type 6 with intervalType, holidays type 8.
const lesson = (start, end, extra) =>
  Object.assign({ classInstanceId: "c", name: "Tárgy", rooms: "Terem", startDate: start, endDate: end }, extra);
const events = [
  lesson("2026-09-28T08:00:00", "2026-09-28T08:30:00"),
  lesson("2026-09-28T10:00:00", "2026-09-28T12:00:00"),
  { eventTypeId: 1, name: "Vizsga", startDate: "2026-09-29T09:00:00", endDate: "2026-09-29T11:00:00" },
  {
    eventTypeId: 6,
    intervalType: "Kurzusjelentkezési időszak",
    startDate: "2026-09-20T08:00:00",
    endDate: "2026-09-30T23:59:00",
  },
  {
    eventTypeId: 6,
    intervalType: "Vizsgajelentkezési időszak",
    startDate: "2026-10-08T08:00:00",
    endDate: "2026-10-20T23:59:00",
  },
  { eventTypeId: 6, intervalType: "Túl messze", startDate: "2026-12-20T08:00:00", endDate: "2026-12-30T23:59:00" },
  { eventTypeId: 6, intervalType: "Lezárult", startDate: "2026-09-01T08:00:00", endDate: "2026-09-10T23:59:00" },
  { eventTypeId: 8, name: "Szünnap", startDate: "2026-09-28T00:00:00", endDate: "2026-09-28T23:59:00" },
];
const day = daily.sortEvents(events, now);
assert.deepStrictEqual(
  day.today.map(e => e.startDate),
  ["2026-09-28T10:00:00"],
  "a class already over is gone; the rest of today stays"
);
assert.strictEqual(day.next, null, "no look-ahead while today still has something");
assert.strictEqual(day.holidayToday, true);
assert.deepStrictEqual(
  day.periods.map(p => [p.name, p.running, p.days]),
  [
    ["Kurzusjelentkezési időszak", true, 2],
    ["Vizsgajelentkezési időszak", false, 10],
  ],
  "a running period counts down to its close, a coming one to its opening; far and past ones drop"
);
const tomorrowOnly = daily.sortEvents([events[2]], now);
assert.deepStrictEqual(tomorrowOnly.today, []);
assert.strictEqual(tomorrowOnly.next.name, "Vizsga", "an empty today points at the next thing");
assert.deepStrictEqual(daily.sortEvents(null, now).today, [], "no feed, no crash");

const due = daily.dueItems(
  [
    { name: "Késő", value: 1000, currency: "HUF", latestExecutionDate: "2026-10-18T00:00:00" },
    { name: "Hamarosan", value: 2000, currency: "HUF", latestExecutionDate: "2026-09-30T00:00:00" },
    { name: "Lejárt", value: 3000, currency: "HUF", latestExecutionDate: "2026-09-27T00:00:00" },
    { name: "Dátum nélkül", value: 1, currency: "HUF" },
  ],
  now
);
assert.deepStrictEqual(
  due.map(d => [d.name, d.days]),
  [
    ["Lejárt", -1],
    ["Hamarosan", 2],
    ["Késő", 20],
  ],
  "sorted by deadline; an item without one is left out"
);

assert.deepStrictEqual(
  daily.alertsFor({ due, periods: day.periods }),
  [
    { text: "Lejárt befizetés: Lejárt (1 napja)", tone: "error" },
    { text: "Befizetési határidő 2 nap múlva: Hamarosan", tone: "warn" },
    { text: "Kurzusjelentkezési időszak: 2 nap múlva zárul", tone: "warn" },
  ],
  "only what is close enough to act on earns a toast"
);

// The panel's options pick the cards; "Ma" is the module itself and always shown.
assert.deepStrictEqual(
  daily.visibleCards({ due: false, periods: true }).map(c => c.key),
  ["today", "periods"]
);
assert.deepStrictEqual(
  daily.visibleCards({ due: true, periods: true }).map(c => c.key),
  ["today", "due", "periods"]
);

// A payments list that could not be read is null, never "nothing due".
assert.deepStrictEqual(
  daily.alertsFor({ due: null, periods: day.periods }).map(a => a.text),
  ["Kurzusjelentkezési időszak: 2 nap múlva zárul"]
);
// The reminder gives the day back when it could not say everything, so a passing
// network error does not silence it until tomorrow.
assert.deepStrictEqual(daily.reminderOutcome(null, true), { alerts: [], release: true });
assert.deepStrictEqual(daily.reminderOutcome({ due: null, periods: [] }, true), { alerts: [], release: true });
assert.deepStrictEqual(
  daily.reminderOutcome({ due: [], periods: [] }, true),
  { alerts: [], release: false },
  "a quiet day that was fully read is done for today"
);
assert.strictEqual(daily.reminderOutcome({ due, periods: day.periods }, true).alerts.length, 3);
