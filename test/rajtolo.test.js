const assert = require("assert");
const interceptor = require("../src/interceptor");
const { fakeRow, FakeXHR } = require("./helpers");
require("./interceptor.test");

// --- rajtolo: the flagship scheduled-registration feature ---
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

// the countdown itself: server-corrected, not local-clock-trusting
assert.strictEqual(rajtolo.msUntilTarget(100000, 20000, 50000), 30000, "target minus offset minus now");
assert.strictEqual(
  rajtolo.msUntilTarget(100000, null, 50000),
  50000,
  "no offset sampled yet -> falls back to trusting the local clock (offset 0)"
);
assert.strictEqual(rajtolo.formatCountdown(0), "indul…");
assert.strictEqual(rajtolo.formatCountdown(-5000), "indul…", "already past T-0 counts as starting");
assert.strictEqual(rajtolo.formatCountdown(65000), "1p 5mp");
assert.strictEqual(rajtolo.formatCountdown(3600000), "1ó 0p 0mp");
assert.strictEqual(
  rajtolo.formatCountdown((26 * 3600 + 5) * 1000),
  "1 nap 2ó 0p 5mp",
  "a day is not shown as 26 hours"
);

// The armed Rajtoló keeps its session by making the page renew the token. Pressing
// search renews only an EXPIRED token (measured), so right before the start it waits
// for expiry; the keep-alive asks once the token is old enough to be long expired.
{
  const { sessionChore, tokenExpired } = require("../src/modules/rajtolo/protocol");
  const now = 10 * 60 * 60 * 1000;
  const fresh = { issuedAtMs: now - 60000, expiresAtMs: now + 240000 };
  const expired = { issuedAtMs: now - 360000, expiresAtMs: now - 60000 };
  assert.strictEqual(sessionChore(now, 30000, fresh, null), false, "a live token cannot be renewed yet");
  assert.strictEqual(sessionChore(now, 30000, expired, null), true, "an expired token just before the start");
  assert.strictEqual(sessionChore(now, 5 * 60000, expired, null), false, "not yet: far from the start");
  assert.strictEqual(
    sessionChore(now, 60 * 60000, { issuedAtMs: now - 11 * 60000, expiresAtMs: now - 6 * 60000 }, null),
    true,
    "keep-alive while armed, before the 15-minute session runs out"
  );
  assert.strictEqual(sessionChore(now, 30000, expired, now - 20000), false, "a failed ask is not repeated at once");
  assert.strictEqual(sessionChore(now, 30000, { issuedAtMs: null, expiresAtMs: null }, null), true, "unknown");
  assert.strictEqual(tokenExpired(expired, now), true);
  assert.strictEqual(tokenExpired(fresh, now), false);
  assert.strictEqual(tokenExpired({ issuedAtMs: null, expiresAtMs: null }, now), false, "unknown: just send it");
}

assert.strictEqual(rajtolo.runTitle(65000, false, "Neptun Web"), "1p 5mp – Neptun Web", "countdown in the tab");
assert.strictEqual(rajtolo.runTitle(0, false, "Neptun Web"), "Rajtoló fut… – Neptun Web");
assert.strictEqual(rajtolo.runTitle(0, true, "Neptun Web"), "✔ Rajtoló kész – Neptun Web");

// Neptun's times are Hungarian wall-clock time whatever zone the browser is in, so a
// student registering from abroad still starts at the Hungarian opening.
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

// The period picker opens on the current or next period, not on whichever is first.
{
  const periods = [
    { periodId: "old", fromDate: "2026-01-20T08:00", toDate: "2026-01-30T23:59" },
    { periodId: "next", fromDate: "2026-09-10T08:00", toDate: "2026-09-20T23:59" },
    { periodId: "later", fromDate: "2026-09-25T08:00", toDate: "2026-10-05T23:59" },
  ];
  const at = text => rajtolo.wallClockToEpoch(text);
  assert.strictEqual(rajtolo.defaultPeriod(periods, at("2026-09-01T12:00")).periodId, "next");
  assert.strictEqual(rajtolo.defaultPeriod(periods, at("2026-09-15T12:00")).periodId, "next", "an open one counts");
  assert.strictEqual(rajtolo.defaultPeriod(periods, at("2026-09-22T12:00")).periodId, "later");
  assert.strictEqual(rajtolo.defaultPeriod(periods, at("2027-01-01T12:00")).periodId, "later", "all over -> latest");
  assert.strictEqual(
    rajtolo.defaultPeriod(periods.slice().reverse(), at("2026-09-01T12:00")).periodId,
    "next",
    "the server's order does not decide"
  );
  assert.strictEqual(rajtolo.defaultPeriod([], Date.now()), null);
}

// the response classifier: submitted / requirement / unknown
assert.strictEqual(rajtolo.classifyResponse({ data: {}, notification: [] }).kind, "submitted");
// measured live: what the server says outside a registration period. It used to fall
// through to "unknown", which was correct-but-unhelpful; it is now its own outcome.
assert.strictEqual(
  rajtolo.classifyResponse({
    data: null,
    notification: [{ description: "Jelenleg nincs tárgyjelentkezési időszak!", type: 3 }],
    __npuStatus: 500,
  }).kind,
  "notOpen"
);
// a 2xx with no error is the only thing allowed to read as success
assert.strictEqual(rajtolo.classifyResponse({ data: {}, notification: [], __npuStatus: 200 }).kind, "submitted");
// ...and a FAILING status with a body carrying no error we recognise must never be
// reported as success: that would tell the user they got a place they did not get.
// A rejection is HTTP 500 and we have exactly one measured example of its
// body, so the status is the corroboration the notification alone cannot give.
const silent500 = rajtolo.classifyResponse({ data: null, notification: [], __npuStatus: 500 });
assert.strictEqual(silent500.kind, "unknown", "a silent 500 must halt, not read as success");
assert.ok(silent500.message.includes("500"), "the user has to see which status it was");
assert.strictEqual(rajtolo.classifyResponse({ notification: [], __npuStatus: 403 }).kind, "unknown");
// status 0 is accepted only when the measured envelope is otherwise complete
assert.strictEqual(rajtolo.classifyResponse({ data: {}, notification: [], __npuStatus: 0 }).kind, "submitted");
assert.strictEqual(
  rajtolo.classifyResponse({ data: null, notification: undefined }).kind,
  "unknown",
  "missing data/notification is not a submission"
);
assert.strictEqual(
  rajtolo.classifyResponse({
    data: null,
    notification: [{ description: "Végső tárgykövetelmény nem teljesült", title: null, type: 3 }],
  }).kind,
  "requirement",
  "the one text the measured notes actually measured"
);
assert.strictEqual(
  rajtolo.classifyResponse({ data: null, notification: [{ description: "A kurzus betelt.", type: 3 }] }).kind,
  "unknown",
  "unmeasured vocabulary must not trigger another POST"
);
assert.strictEqual(
  rajtolo.classifyResponse({ data: null, notification: [{ description: "Valami teljesen más hiba.", type: 3 }] }).kind,
  "unknown",
  "safe default - never guess, never loop on text we don't recognise"
);
assert.strictEqual(
  rajtolo.classifyResponse({ data: null, notification: [{ description: "info only", type: 1 }] }).kind,
  "unknown",
  "an unmeasured notification must not be treated as a submission"
);

// the timeout message httpRequest synthesises must land in "unknown", so a request
// that hung is never retried - the server may have processed it and just not answered
assert.strictEqual(
  rajtolo.classifyResponse({
    notification: [{ description: "A szerver nem válaszolt időben. A jelentkezés állapota bizonytalan.", type: 3 }],
  }).kind,
  "unknown",
  "a timed-out request halts the run instead of re-posting a maybe-successful registration"
);
assert.strictEqual(
  rajtolo.classifyResponse({
    notification: [{ description: "A szerver nem válaszolt időben. A jelentkezés állapota bizonytalan.", type: 3 }],
  }).message,
  "A szerver nem válaszolt időben. A jelentkezés állapota bizonytalan.",
  "the timeout's own warning reaches the student, not a generic one"
);

// the toast tone: a submitted request is deliberately not presented as enrollment
assert.strictEqual(rajtolo.toastTone("submitted"), "warn");
assert.strictEqual(rajtolo.toastTone("full"), "error");
assert.strictEqual(rajtolo.statusLabel("submitted"), "Beküldve — ellenőrizd a Neptunban");
assert.strictEqual(rajtolo.toastTone("registered"), "ok", "only a confirmed registration is green");
assert.strictEqual(rajtolo.toastTone("waitlisted"), "warn");
assert.strictEqual(
  rajtolo.summarize([{ kind: "registered" }, { kind: "waitlisted" }, { kind: "submitted" }, { kind: "exhausted" }]),
  "Kész: 3/4 tárgy beküldve, ebből 1 felvéve, 1 várólistán; ellenőrizd a Neptunban."
);
assert.strictEqual(
  rajtolo.summarize([{ kind: "submitted" }, { kind: "unknown" }]),
  "Leállt ismeretlen hiba miatt (1/2 tárgy beküldve; ellenőrizd a Neptunban)."
);

// the next-combination chooser: highest-ranked non-full, non-excluded course per
// group; null means exhausted, not "submit an empty courseIds"
const courseIndex = new Map([
  ["c1", { id: "c1", isFull: true }],
  ["c2", { id: "c2", isFull: false }],
  ["c3", { id: "c3", isFull: false }],
]);
assert.deepStrictEqual(
  rajtolo.chooseCombination([{ type: "Elmélet", ranking: ["c1", "c2"] }], courseIndex, new Set()),
  ["c2"],
  "skips the full top pick, takes the next-ranked one"
);
assert.deepStrictEqual(
  rajtolo.chooseCombination(
    [
      { type: "Elmélet", ranking: ["c2"] },
      { type: "Labor", ranking: ["c3"] },
    ],
    courseIndex,
    new Set()
  ),
  ["c2", "c3"],
  "one pick per group"
);
assert.strictEqual(
  rajtolo.chooseCombination([{ type: "Elmélet", ranking: ["c1"] }], courseIndex, new Set()),
  null,
  "every ranked course full -> exhausted, not an empty combination"
);
assert.strictEqual(
  rajtolo.chooseCombination([{ type: "Elmélet", ranking: ["c2"] }], courseIndex, new Set(["c2"])),
  null,
  "already-excluded (a prior reject) counts the same as full"
);
assert.deepStrictEqual(rajtolo.chooseCombination([], courseIndex, new Set()), [], "no groups -> empty combination");

// the reorder primitive behind every up/down button (buttons, not drag-drop)
assert.deepStrictEqual(rajtolo.moveUp(["a", "b", "c"], 1), ["b", "a", "c"]);
assert.deepStrictEqual(rajtolo.moveUp(["a", "b", "c"], 0), ["a", "b", "c"], "already first -> unchanged");
assert.deepStrictEqual(rajtolo.moveDown(["a", "b", "c"], 1), ["a", "c", "b"]);
assert.deepStrictEqual(rajtolo.moveDown(["a", "b", "c"], 2), ["a", "b", "c"], "already last -> unchanged");

// ranking courses: the editor must say the order doesn't matter there
assert.strictEqual(rajtolo.courseLabel({ code: "TEST01L", isRankingCourse: false }), "TEST01L");
assert.strictEqual(
  rajtolo.courseLabel({ id: "11111111-1111-4111-8111-111111111111", isRankingCourse: false }),
  "Kurzusadat betöltése…",
  "a modal never exposes an internal course UUID while its label is loading"
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

// --- rajtolo.toDateTimeLocal: the Periods/GetPeriods picker's own timezone trap ---
// the measured shape: seconds cut, nothing else touched
assert.strictEqual(rajtolo.toDateTimeLocal("2035-01-15T10:00:00"), "2035-01-15T10:00");
// already the datetime-local shape (no seconds) -> passed through unchanged
assert.strictEqual(rajtolo.toDateTimeLocal("2035-01-15T10:00"), "2035-01-15T10:00");
// fractional seconds, in case a period ever carries them
assert.strictEqual(rajtolo.toDateTimeLocal("2035-01-15T10:00:00.123"), "2035-01-15T10:00");
// the timezone trap itself: this must be string slicing, not new Date().toISOString() or
// similar - a round-trip through Date would silently reinterpret this local wall-clock
// value in the machine's own timezone, which is exactly the bug the task brief warns
// about. Proven here by checking the hour survives untouched regardless of TZ.
assert.strictEqual(
  rajtolo.toDateTimeLocal("2035-01-15T10:00:00"),
  "2035-01-15T10:00",
  "must be string-based - a Date round-trip would drag in this machine's own timezone"
);
// malformed/missing dates must come back null, never a guess
assert.strictEqual(rajtolo.toDateTimeLocal(null), null, "missing date");
assert.strictEqual(rajtolo.toDateTimeLocal(undefined), null, "missing date");
assert.strictEqual(rajtolo.toDateTimeLocal(""), null, "empty string");
assert.strictEqual(rajtolo.toDateTimeLocal("not a date"), null, "malformed");
assert.strictEqual(rajtolo.toDateTimeLocal("2035-01-15"), null, "date only, no time - not the measured shape");

// --- rajtolo.collectPeriods: lists every period, never picks "the" one for the user ---
// synthetic Periods/GetPeriods fixture with one term
const periodsBody = {
  notification: [],
  data: [
    {
      periodId: "22222222-2222-4222-8222-222222222222",
      periodName: "Minta képzés tárgyjelentkezési időszaka (minta félév)",
      periodType: "Végleges tárgyjelentkezés",
      fromDate: "2035-01-15T10:00:00",
      toDate: "2035-01-31T23:59:59",
      termName: "minta-félév",
      administrationOrganizations: "",
    },
    // several periods can come back for one term - every one of them must
    // surface, not just whichever one matches a Hungarian label
    { periodId: "p2", periodName: "Bejelentkezési időszak", periodType: "", fromDate: "2035-01-01T00:00:00" },
    { periodId: "p3", periodName: "Kurzusjelentkezési időszak", periodType: "", fromDate: "2035-02-01T08:00:00" },
    // no usable fromDate -> skipped, not offered with a blank/guessed time
    { periodId: "p4", periodName: "Nincs kezdete", fromDate: null },
    { periodId: "p5", periodName: "Rossz formátum", fromDate: "not a date" },
    // no periodId -> nothing to key the <select> option on, so also skipped
    { periodName: "Névtelen", fromDate: "2035-01-15T10:00:00" },
  ],
};
const periods = rajtolo.collectPeriods(periodsBody);
assert.strictEqual(periods.length, 3, "three usable rows out of six - the rest are skipped, not guessed at");
assert.deepStrictEqual(periods[0], {
  periodId: "22222222-2222-4222-8222-222222222222",
  label: "Végleges tárgyjelentkezés — Minta képzés tárgyjelentkezési időszaka (minta félév)",
  fromDate: "2035-01-15T10:00",
  toDate: "2035-01-31T23:59",
});
// a row whose periodType is blank still gets a usable label, from periodName alone
assert.strictEqual(periods[1].label, "Bejelentkezési időszak");
// a row with no toDate at all must not invent one
assert.strictEqual(periods[1].toDate, null);
assert.strictEqual(rajtolo.collectPeriods({}).length, 0, "an empty body must not throw");
assert.strictEqual(rajtolo.collectPeriods({ data: [] }).length, 0);
assert.strictEqual(rajtolo.periodLoadResult(periodsBody).periods.length, 3);
assert.deepStrictEqual(rajtolo.periodLoadResult({ __npuStatus: 401 }), {
  periods: [],
  reason: "auth-required",
  message: "A munkamenet lejárt. Jelentkezz be újra, majd töltsd újra az időszakokat.",
});
assert.strictEqual(rajtolo.periodLoadResult({ __npuStatus: 500 }).reason, "api-error");
assert.strictEqual(rajtolo.periodLoadResult({ data: [], notification: [] }).reason, "empty");

// plan mutation: add/remove are immutable and idempotent
let plan = rajtolo.emptyPlan("t1");
plan = rajtolo.addSubject(plan, { subjectId: "s1", termId: "t1" });
assert.strictEqual(plan.subjects.length, 1);
const samePlan = rajtolo.addSubject(plan, { subjectId: "s1", termId: "t1" });
assert.strictEqual(samePlan, plan, "adding an already-listed subject is a no-op, not a duplicate");
plan = rajtolo.removeSubject(plan, "s1");
assert.strictEqual(plan.subjects.length, 0);

// --- the engine: success/requirement/full/unknown/exhausted/unconfigured, and the
// "Stop actually stops" path - all driven through injected fakes, no real
// network/timers involved. Wrapped in an async IIFE since this is a plain
// CommonJS script (no top-level await outside a module).
async function runEngineChecks() {
  function fakeController() {
    return { stopped: false, timers: [], stop() {} };
  }
  function subject(id, groups) {
    return { subjectId: id, termId: "t1", curriculumTemplateId: "ct1", curriculumTemplateLineId: "ctl1", groups };
  }
  const noDelay = () => Promise.resolve();

  // success on the first attempt
  {
    const deps = {
      get: () => Promise.resolve({ data: [{ id: "c1", subjectId: "s1", isFull: false }], notification: [] }),
      post: () => Promise.resolve({ data: {}, notification: [] }),
      delay: noDelay,
      controller: fakeController(),
    };
    const outcome = await rajtolo.runSubject(subject("s1", [{ type: "Elmélet", ranking: ["c1"] }]), deps);
    assert.strictEqual(outcome.kind, "submitted");
  }

  // A forecast field is not a measured submission outcome. The request is submitted,
  // but the user is sent back to Neptun to verify the actual result.
  {
    let posted = false;
    const deps = {
      get: () =>
        Promise.resolve({
          data: [{ id: "c1", subjectId: "s1", isFull: false, willBeOnWaitingList: true }],
          notification: [],
        }),
      post: () => {
        posted = true;
        return Promise.resolve({ data: {}, notification: [] });
      },
      delay: noDelay,
      controller: fakeController(),
    };
    const outcome = await rajtolo.runSubject(subject("s1", [{ type: "Elmélet", ranking: ["c1"] }]), deps);
    assert.ok(posted, "a waiting-list place is still worth taking - it must be submitted");
    assert.strictEqual(outcome.kind, "submitted", "the forecast is not presented as a confirmed placement");
  }

  // After an answered submission the same course list is read once more, and only the
  // student's own status fields turn "beküldve" into "felvéve" or "várólistán".
  {
    const verifyingDeps = (after, options = {}) => {
      const calls = [];
      let posted = false;
      const controller = fakeController();
      return {
        calls,
        controller,
        get: subj => {
          calls.push(posted ? "verify" : "get");
          if (posted && options.failVerify) {
            return Promise.resolve({ notification: [{ description: "Hálózati hiba.", type: 3 }] });
          }
          const rows = [
            { id: "c1", subjectId: subj.subjectId, isFull: false },
            { id: "c2", subjectId: subj.subjectId, isFull: false },
          ];
          return Promise.resolve({ data: posted ? after(rows) : rows, notification: [] });
        },
        post: () => {
          posted = true;
          if (options.stopOnPost) {
            controller.stopped = true;
          }
          return Promise.resolve({ data: {}, notification: [] });
        },
        delay: noDelay,
        onEvent: () => {},
      };
    };
    const twoGroups = subject("s1", [
      { type: "Elmélet", ranking: ["c1"] },
      { type: "Labor", ranking: ["c2"] },
    ]);
    const signed = rows => rows.map(row => Object.assign({}, row, { isSigned: true }));

    const confirmed = verifyingDeps(signed);
    assert.strictEqual((await rajtolo.runSubject(twoGroups, confirmed)).kind, "registered");
    assert.deepStrictEqual(confirmed.calls, ["get", "verify"], "exactly one extra read, after the POST");

    const queued = verifyingDeps(rows => [
      Object.assign({}, rows[0], { isSigned: true }),
      Object.assign({}, rows[1], { isOnWaitingList: true }),
    ]);
    assert.strictEqual(
      (await rajtolo.runSubject(twoGroups, queued)).kind,
      "waitlisted",
      "one queued course means the subject is not secured"
    );

    const half = verifyingDeps(rows => [Object.assign({}, rows[0], { isSigned: true }), rows[1]]);
    assert.strictEqual((await rajtolo.runSubject(twoGroups, half)).kind, "submitted", "half signed is not felvéve");

    const unread = verifyingDeps(signed, { failVerify: true });
    assert.strictEqual(
      (await rajtolo.runSubject(twoGroups, unread)).kind,
      "submitted",
      "a failed check is not an unknown error: the run must not halt over it"
    );

    const stopped = verifyingDeps(signed, { stopOnPost: true });
    assert.strictEqual((await rajtolo.runSubject(twoGroups, stopped)).kind, "submitted");
    assert.deepStrictEqual(stopped.calls, ["get"], "Stop means no further request, the check included");

    assert.strictEqual(rajtolo.submissionOutcome(new Map(), ["c1"]), null, "a course missing from the list");
    assert.strictEqual(rajtolo.submissionOutcome(new Map([["c1", { isSigned: true }]]), []), null);
    assert.strictEqual(
      rajtolo.submissionOutcome(new Map([["c1", { isSigned: false, willBeOnWaitingList: true }]]), ["c1"]),
      null,
      "a forecast is never read as the student's own status"
    );
  }

  // a subject with nothing ranked is never posted to at all (fail closed by design)
  {
    let posted = false;
    const deps = {
      get: () => Promise.resolve({ data: [], notification: [] }),
      post: () => {
        posted = true;
        return Promise.resolve({ notification: [] });
      },
      delay: noDelay,
      controller: fakeController(),
    };
    const outcome = await rajtolo.runSubject(subject("s1", []), deps);
    assert.strictEqual(outcome.kind, "unconfigured");
    assert.ok(!posted, "must never submit a subject with no ranked courses");
  }

  // requirement-not-met: one attempt, no retry, reported
  {
    let postCount = 0;
    const deps = {
      get: () => Promise.resolve({ data: [{ id: "c1", subjectId: "s1", isFull: false }], notification: [] }),
      post: () => {
        postCount++;
        return Promise.resolve({
          data: null,
          notification: [{ description: "Végső tárgykövetelmény nem teljesült", type: 3 }],
        });
      },
      delay: noDelay,
      controller: fakeController(),
    };
    const outcome = await rajtolo.runSubject(subject("s1", [{ type: "Elmélet", ranking: ["c1"] }]), deps);
    assert.strictEqual(outcome.kind, "requirement");
    assert.strictEqual(postCount, 1, "requirement-not-met must not retry");
  }

  // An unmeasured full/rejection message is unknown: no guessed vocabulary and no
  // second POST that could duplicate a server-side registration.
  {
    let postCount = 0;
    const ranking = ["c1", "c2", "c3", "c4"];
    const deps = {
      get: () =>
        Promise.resolve({
          data: ranking.map(id => ({ id, subjectId: "s1", isFull: false })),
          notification: [],
        }),
      post: () => {
        postCount++;
        return Promise.resolve({
          data: {},
          notification: [{ description: "A kurzus betelt.", type: 3 }],
        });
      },
      delay: noDelay,
      controller: fakeController(),
    };
    const outcome = await rajtolo.runSubject(subject("s1", [{ type: "Elmélet", ranking }]), deps);
    assert.strictEqual(outcome.kind, "unknown");
    assert.strictEqual(postCount, 1, "unknown response must not retry a possibly processed POST");
  }

  // exhausted: every ranked course full from the start -> never even posts
  {
    let posted = false;
    const deps = {
      get: () => Promise.resolve({ data: [{ id: "c1", subjectId: "s1", isFull: true }], notification: [] }),
      post: () => {
        posted = true;
        return Promise.resolve({ notification: [] });
      },
      delay: noDelay,
      controller: fakeController(),
    };
    const outcome = await rajtolo.runSubject(subject("s1", [{ type: "Elmélet", ranking: ["c1"] }]), deps);
    assert.strictEqual(outcome.kind, "exhausted");
    assert.ok(!posted, "nothing available to submit -> must not post at all");
  }

  // unknown halts the *whole run*, not just the offending subject - later subjects
  // must never even be attempted
  {
    const attempted = [];
    const deps = {
      get: subj => {
        attempted.push(subj.subjectId);
        return Promise.resolve({
          data: [{ id: "c1", subjectId: subj.subjectId, isFull: false }],
          notification: [],
        });
      },
      post: () => Promise.resolve({ notification: [{ description: "Teljesen ismeretlen hiba", type: 3 }] }),
      delay: noDelay,
      onEvent: () => {},
      controller: fakeController(),
    };
    const plan2 = {
      subjects: [
        subject("s1", [{ type: "Elmélet", ranking: ["c1"] }]),
        subject("s2", [{ type: "Elmélet", ranking: ["c1"] }]),
      ],
    };
    const outcomes = await rajtolo.runPlan(plan2, deps);
    assert.strictEqual(outcomes.length, 1, "must stop at the unrecognised error, not continue to s2");
    assert.strictEqual(outcomes[0].kind, "unknown");
    assert.deepStrictEqual(attempted, ["s1"], "s2 must never be touched once an unknown error halts the run");
  }

  // "Stop actually stops": once the controller is stopped mid-run, no further
  // subject is ever attempted, even though the plan has more queued
  {
    const attempted = [];
    const controller = { stopped: false, timers: [] };
    const deps = {
      get: subj => {
        attempted.push(subj.subjectId);
        controller.stopped = true; // simulate the user pressing Stop mid-attempt
        return Promise.resolve({
          data: [{ id: "c1", subjectId: subj.subjectId, isFull: false }],
          notification: [],
        });
      },
      post: () => Promise.resolve({ data: {}, notification: [] }),
      delay: noDelay,
      onEvent: () => {},
      controller,
    };
    const plan3 = {
      subjects: [
        subject("s1", [{ type: "Elmélet", ranking: ["c1"] }]),
        subject("s2", [{ type: "Elmélet", ranking: ["c1"] }]),
      ],
    };
    const outcomes = await rajtolo.runPlan(plan3, deps);
    assert.deepStrictEqual(attempted, ["s1"], "stop mid-attempt must prevent s2 from ever being reached");
    assert.strictEqual(outcomes[outcomes.length - 1].kind, "stopped");
  }

  // a controller stopped before the run even starts must produce zero attempts
  {
    const attempted = [];
    const deps = {
      get: subj => {
        attempted.push(subj.subjectId);
        return Promise.resolve({ data: [] });
      },
      post: () => Promise.resolve({ notification: [] }),
      delay: noDelay,
      onEvent: () => {},
      controller: { stopped: true, timers: [] },
    };
    const plan4 = { subjects: [subject("s1", [{ type: "Elmélet", ranking: ["c1"] }])] };
    const outcomes = await rajtolo.runPlan(plan4, deps);
    assert.deepStrictEqual(attempted, [], "pre-stopped controller must not run anything");
    assert.strictEqual(outcomes[0].kind, "stopped");
  }

  // The planner loads every planned subject's courses, one after the other. The pause
  // between two loads used to replace the load itself, so only the first subject ever
  // got its course labels and its conflict check.
  {
    const ui = require("../src/modules/rajtolo/ui");
    const fetched = [];
    const state = {
      dialog: null,
      plan: {
        termId: "t1",
        subjects: ["s1", "s2", "s3"].map(id => subject(id, [{ type: "Labor", ranking: [`${id}-c`] }])),
      },
      courseCatalog: new Map(),
      courseLoads: new Set(),
      courseLoadErrors: new Set(),
      courseLoadQueue: null,
      courseCatalogGeneration: 0,
    };
    await ui.loadPlannedCourses(state, false, entry => {
      fetched.push(entry.subjectId);
      return Promise.resolve({
        data: [{ id: `${entry.subjectId}-c`, subjectId: entry.subjectId, isFull: false }],
        notification: [],
      });
    });
    assert.deepStrictEqual(fetched, ["s1", "s2", "s3"], "every planned subject is fetched, in plan order");
    assert.ok(state.courseCatalog.get("s3").has("s3-c"), "the last subject's courses arrive too");
    assert.strictEqual(state.courseLoadErrors.size, 0);
    assert.strictEqual(state.courseLoadQueue, null, "the queue is released when it finishes");
  }
}

// The countdown keeps only its currently pending timer. Retaining every elapsed
// timeout made a long wait grow an unnecessary array until Stop was pressed.
{
  const originalClearTimeout = global.clearTimeout;
  let clearedTimer = null;
  global.clearTimeout = timer => {
    clearedTimer = timer;
  };
  try {
    const controller = rajtolo.createController();
    controller.timer = 123;
    controller.stop();
    assert.strictEqual(clearedTimer, 123, "Stop clears the pending countdown timer");
    assert.strictEqual(controller.timer, null, "a stopped controller releases its timer handle");
  } finally {
    global.clearTimeout = originalClearTimeout;
  }
}

// The start must be one timer armed from the click. Chrome runs a CHAINED timer in a
// tab hidden for 5+ minutes only once a minute, so a countdown chain could start the
// run up to a minute late. And Stop before the start has to report back: it clears
// the timers, so nothing else ever would.
{
  const engine = require("../src/modules/rajtolo/engine");
  assert.strictEqual(engine.startTimeout(-5), 0);
  assert.strictEqual(engine.startTimeout(3e9), 2147483647, "setTimeout cannot hold longer; it re-arms instead");
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const timers = [];
  global.setTimeout = (fn, ms) => timers.push({ fn, ms });
  global.clearTimeout = () => {};
  try {
    const controller = rajtolo.createController();
    let done = null;
    const target = Date.now() + (interceptor.getServerOffsetMs() || 0) + 600000;
    engine.scheduleRun(target, { subjects: [], delaySeconds: 1 }, controller, {
      onTick() {},
      onEvent() {},
      onDone: outcomes => {
        done = outcomes;
      },
    });
    assert.strictEqual(timers.length, 2, "one display tick and one start timer");
    assert.ok(timers[1].ms > 590000, "the start timer sleeps the whole wait at once");
    controller.stop();
    assert.deepStrictEqual(done, [], "Stop before the start reports back at once");
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
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

// findPlanConflicts: which of the picks that would actually be submitted right now
// (built elsewhere via chooseCombination) clash with each other
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

module.exports = { run: runEngineChecks };

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
  const { withRenewal } = require("../src/modules/rajtolo/engine");
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
    assert.strictEqual(require("../src/modules/rajtolo/engine").isHalted(halted), true);
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
