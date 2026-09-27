const assert = require("assert");
const infiniteSession = require("../src/modules/infiniteSession");
const { fakeRow } = require("./helpers");

// --- footerBranding: the name and a bug link, beside Neptun's own footer logo ---
const footerBranding = require("../src/modules/footerBranding");
assert.strictEqual(
  footerBranding.brandText("3.0.0"),
  "Neptun PowerUp! v3.0.0",
  "the version is what a bug report needs"
);

// the issues link is a clone of Neptun's own footer link, so it inherits the real
// colour and scoping hash - but not the negative margin that only fits where it sat
const footerReport = {
  attrs: { id: "x", href: "mailto:test@example.invalid" },
  style: { marginLeft: "-12px", cssText: "" },
  cloneNode() {
    return Object.assign({}, footerReport, {
      style: { marginLeft: "-12px", cssText: "" },
      removeAttribute(name) {
        delete this.attrs[name];
      },
    });
  },
};
const issues = footerBranding.buildIssuesLink(null, footerReport);
assert.strictEqual(
  issues.href,
  "https://github.com/varannaibence/npu-uj-neptunhoz/issues",
  "ours goes to the tracker, not to the university"
);
assert.strictEqual(issues.rel, "noopener noreferrer", "target=_blank without this leaks window.opener");
assert.strictEqual(issues.style.marginLeft, "0", "the clone's own offset would misplace it here");
assert.strictEqual(issues.attrs.id, undefined, "a duplicated id would be the second bug of the day");

// --- loginBanner: a quiet line with an accountable link, not a button ---
const loginBanner = require("../src/modules/loginBanner");
assert.strictEqual(loginBanner.bannerText("2.5.0"), "Neptun PowerUp! v2.5.0");

// a fake submit button, enough to prove what the banner is made of
function fakeEl(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    style: { cssText: "" },
    children: [],
    classList: { remove() {} },
    attrs: {},
    removeAttribute(name) {
      delete el.attrs[name];
    },
    setAttribute(name, value) {
      el.attrs[name] = value;
    },
    cloneNode: () => fakeEl(tag),
    appendChild(child) {
      el.children.push(child);
    },
  };
  return el;
}
const fakeSubmit = fakeEl("button");
fakeSubmit.ownerDocument = { createElement: fakeEl, createElementNS: (ns, tag) => fakeEl(tag) };
const banner = loginBanner.buildBanner(fakeSubmit, "Neptun PowerUp! v2.5.0");

assert.strictEqual(banner.tagName, "A", "the name has to be reachable, not just readable");
assert.strictEqual(
  banner.href,
  "https://github.com/varannaibence/npu-uj-neptunhoz",
  "points at the fork, not upstream"
);
assert.strictEqual(banner.rel, "noopener noreferrer", "target=_blank without this leaks window.opener");
// the visible label is a clone of the page's own button, so it inherits the real
// styling - no colour of ours anywhere
const label = banner.children[0];
assert.strictEqual(label.tagName, "SPAN");
assert.strictEqual(label.children[0].tagName, "SVG", "the NPU icon leads the label");
assert.strictEqual(label.children[1].textContent, "Neptun PowerUp! v2.5.0");
assert.strictEqual(label.style.pointerEvents, "none", "the anchor must take the click, not the clone");
assert.ok(!/#[0-9a-f]{3}|rgb\(/i.test(banner.style.cssText + JSON.stringify(label.style)), "no hardcoded colours");

// --- courseAutoList: press only fires on arrival at the registration route ---
const courseAutoList = require("../src/modules/courseAutoList");
let pressCount = 0;
const press = () => pressCount++;
courseAutoList.handleNavigation("/hallgato_ng/dashboard", press);
assert.strictEqual(pressCount, 0, "must not press on an unrelated route");
courseAutoList.handleNavigation("/hallgato_ng/subjects/registration", press);
assert.strictEqual(pressCount, 1, "must press on the registration route");

// The filter button is rendered after the route arrives, and Angular can leave
// it disabled for a few render/request turns. We must wait for both conditions,
// then press it once - not once per poll.
assert.strictEqual(courseAutoList.isButtonEnabled(null), false, "a missing button is not ready");
assert.strictEqual(courseAutoList.isButtonEnabled({ disabled: true }), false, "a disabled property is not ready");
assert.strictEqual(
  courseAutoList.isButtonEnabled({ disabled: false, hasAttribute: name => name === "disabled" }),
  false,
  "a disabled attribute is not ready"
);
assert.strictEqual(
  courseAutoList.isButtonEnabled({ disabled: false, hasAttribute: () => false }),
  true,
  "an existing enabled button is ready"
);

function timerHarness() {
  const pending = [];
  const cancelled = new Set();
  return {
    pending,
    schedule(callback, delay) {
      const timer = { callback, delay };
      pending.push(timer);
      return timer;
    },
    cancel(timer) {
      cancelled.add(timer);
    },
    runNext() {
      while (pending.length) {
        const timer = pending.shift();
        if (!cancelled.has(timer)) {
          timer.callback();
          return;
        }
      }
    },
  };
}

// Direct-load path: an initially disabled button is not clicked, then is clicked
// exactly once when the next poll sees it enabled.
{
  const timers = timerHarness();
  let button = null;
  let clicks = 0;
  const controller = courseAutoList.createArrivalController({
    getPath: () => "/hallgato_ng/subjects/registration",
    getButton: () => button,
    schedule: timers.schedule,
    cancel: timers.cancel,
    click: () => clicks++,
    maxAttempts: 3,
    retryDelay: 10,
  });
  controller.arrive();
  assert.strictEqual(clicks, 0, "direct load must wait for a rendered enabled button");
  assert.strictEqual(timers.pending.length, 1, "a missing readiness condition schedules a retry");
  button = { disabled: true };
  timers.runNext();
  assert.strictEqual(clicks, 0, "a rendered but disabled button is still not ready");
  button.disabled = false;
  timers.runNext();
  assert.strictEqual(clicks, 1, "the first enabled poll clicks the button");
  timers.runNext();
  assert.strictEqual(clicks, 1, "one arrival must never click again on later polls");
}

// SPA arrival path: leaving the route invalidates the old wait. If the old timer
// later runs anyway, it must not click the button that belongs to a new page.
{
  const timers = timerHarness();
  let path = "/hallgato_ng/subjects/registration";
  const button = { disabled: true };
  let clicks = 0;
  const controller = courseAutoList.createArrivalController({
    getPath: () => path,
    getButton: () => button,
    schedule: timers.schedule,
    cancel: timers.cancel,
    click: () => clicks++,
    maxAttempts: 3,
  });
  courseAutoList.handleNavigation(path, controller.arrive, controller.leave);
  assert.strictEqual(timers.pending.length, 1, "SPA arrival waits for the rendered button");
  path = "/hallgato_ng/dashboard";
  courseAutoList.handleNavigation(path, controller.arrive, controller.leave);
  button.disabled = false;
  timers.runNext();
  assert.strictEqual(clicks, 0, "a stale timer must not click after leaving the route");

  path = "/hallgato_ng/subjects/registration";
  courseAutoList.handleNavigation(path, controller.arrive, controller.leave);
  assert.strictEqual(clicks, 1, "returning to the route creates one fresh arrival");
}

// A permanently absent/disabled button is bounded: the controller gives up after
// the configured attempts instead of leaving a timer alive forever.
{
  const timers = timerHarness();
  let clicks = 0;
  const controller = courseAutoList.createArrivalController({
    getPath: () => "/hallgato_ng/subjects/registration",
    getButton: () => ({ disabled: true }),
    schedule: timers.schedule,
    cancel: timers.cancel,
    click: () => clicks++,
    maxAttempts: 3,
  });
  controller.arrive();
  timers.runNext();
  timers.runNext();
  assert.strictEqual(clicks, 0, "a button that never enables must not be clicked");
  assert.strictEqual(timers.pending.length, 0, "the readiness wait is bounded");
}

// --- backToLastPage: which routes are worth remembering ---
const backToLastPage = require("../src/modules/backToLastPage");
assert.ok(backToLastPage.isRememberable("/hallgato_ng/subjects/registration"));
assert.ok(backToLastPage.isRememberable("/hallgato_ng/calendar"));
assert.ok(!backToLastPage.isRememberable("/hallgato_ng/login"), "login itself isn't a page to return to");
assert.ok(!backToLastPage.isRememberable("/hallgato_ng/dashboard"), "you land here after login anyway");
assert.ok(!backToLastPage.isRememberable(null));
assert.ok(!backToLastPage.isRememberable(""));

// --- occupancy: the dim decision, the code harvest and the code-to-row walk ---
const occupancy = require("../src/modules/occupancy");

// fullness is read off the API's isFull, never off the rendered "Betelt" badge -
// course codes are the stable lookup key
const courses = {
  data: [
    { code: "TEST0315L-01-KIE", isFull: true, registeredStudentsCount: 30, maxLimit: 30 },
    { code: "test0315g", isFull: false, registeredStudentsCount: 4, maxLimit: 30 },
    { code: "TEST0315L-02", isFull: true, registeredStudentsCount: 12, maxLimit: 12 },
    { isFull: true },
  ],
};
const states = occupancy.collectCourseStates(courses);
assert.strictEqual(states.get("TEST0315L-01-KIE").isFull, true);
assert.deepStrictEqual(
  states.get("TEST0315G"),
  { isFull: false, willBeOnWaitingList: null, registered: 4, limit: 30 },
  "codes are case-normalised, and the headcount is recorded alongside the verdict"
);
assert.strictEqual(states.size, 3, "a row without a code is skipped");
// courses arrive one subject at a time, so the map has to accumulate across responses
occupancy.collectCourseStates({ data: [{ code: "test0208e", isFull: true }] }, states);
assert.strictEqual(states.get("TEST0208E").isFull, true, "later responses add to the map");
// a response missing the counts must not invent them
assert.deepStrictEqual(states.get("TEST0208E"), {
  isFull: true,
  willBeOnWaitingList: null,
  registered: null,
  limit: null,
});
assert.strictEqual(occupancy.collectCourseStates({}).size, 0, "an empty body must not throw");

// courses with room float up, full ones sink, each keeping their relative order
const a = { row: "a", isFull: false };
const b = { row: "b", isFull: true };
const c = { row: "c", isFull: false };
const d = { row: "d", isFull: true };
assert.deepStrictEqual(
  occupancy.sortCourses([b, a, d, c], true).map(e => e.row),
  ["a", "c", "b", "d"]
);
// already sorted -> the SAME array back, so the caller skips the DOM entirely.
// This is what stops the MutationObserver from retriggering itself forever.
const sorted = [a, c, b, d];
assert.strictEqual(occupancy.sortCourses(sorted, true), sorted, "no-op must be identity, not a copy");
// toggle off -> untouched
const mixed = [b, a];
assert.strictEqual(occupancy.sortCourses(mixed, false), mixed);
// what the badge says. Dimming is gone: it only ever spoke when something was full,
// which outside a registration period is never, so the feature looked broken.
assert.strictEqual(
  occupancy.occupancyLabel({ isFull: false, registered: 4, limit: 30 }),
  "4 / 30",
  "the ordinary case says how many of how many"
);
// a full course shows numbers too, never the word "Betelt": Neptun already renders its
// own "Betelt" badge in the same row, and two labels for one fact is noise. The colour
// carries "full" instead.
assert.strictEqual(
  occupancy.occupancyLabel({ isFull: true, registered: 7, limit: 7 }),
  "7 / 7",
  "the word Betelt would collide with the app's own badge"
);
// the waiting-list trap. `isFull` does NOT mean
// "no room" - it means "you cannot apply". A course at its limit with a waiting list comes
// back isFull:false, and calling that free is exactly the bug this replaced.
const measuredWaitlisted = { isFull: false, willBeOnWaitingList: true, registered: 3, limit: 3 };
assert.strictEqual(occupancy.seatState(measuredWaitlisted), "waitlist");
assert.strictEqual(occupancy.seatsGone(measuredWaitlisted), true, "a queue place is not a seat");
assert.strictEqual(occupancy.courseVariant(measuredWaitlisted), "partial", "amber: neither go nor give up");
// a genuinely free course
assert.strictEqual(occupancy.seatState({ isFull: false, willBeOnWaitingList: false }), "free");
assert.strictEqual(occupancy.seatsGone({ isFull: false, willBeOnWaitingList: false }), false);
// isFull wins over the waiting flag: you cannot apply at all
assert.strictEqual(occupancy.seatState({ isFull: true, willBeOnWaitingList: true }), "full");
assert.strictEqual(occupancy.seatState(undefined), null);

const unknownSubject = occupancy.summarizeCourses({
  data: [{ subjectId: "unknown", code: "U-01", isFull: null, willBeOnWaitingList: null }],
});
assert.strictEqual(occupancy.subjectLabel(unknownSubject.get("unknown")), null, "unknown seats must not look free");
assert.strictEqual(occupancy.subjectVariant(unknownSubject.get("unknown")), null);
assert.strictEqual(occupancy.isSubjectFull(unknownSubject.get("unknown")), false);

// the subject badge counts waiting-list courses as gone, so a subject whose only
// course is waitlisted reads "Betelt" rather than "0 / 1 betelt"
const waitlistSubject = occupancy.summarizeCourses({
  data: [{ subjectId: "s1", code: "TEST9949L-01", isFull: false, willBeOnWaitingList: true }],
});
assert.deepStrictEqual(waitlistSubject.get("s1"), { total: 1, full: 1 });
assert.strictEqual(occupancy.subjectLabel(waitlistSubject.get("s1")), "Betelt");

assert.strictEqual(occupancy.courseVariant({ isFull: true }), "full");
assert.strictEqual(occupancy.courseVariant({ isFull: false }), "neutral");
// nothing trustworthy to say -> no badge at all, rather than an invented one
assert.strictEqual(occupancy.occupancyLabel({ isFull: false, registered: null, limit: null }), null);
assert.strictEqual(occupancy.occupancyLabel(undefined), null);

// the subject badge: how many of a subject's courses are full. SchedulableSubjects
// carries no course data at all, so this is summed from the per-subject course bodies.
const twoSubjects = {
  data: [
    { subjectId: "s1", code: "A-01", isFull: true },
    { subjectId: "s1", code: "A-02", isFull: false, willBeOnWaitingList: false },
    { subjectId: "s1", code: "A-03", isFull: true },
    { subjectId: "s2", code: "B-01", isFull: true },
  ],
};
const summaries = occupancy.summarizeCourses(twoSubjects);
assert.deepStrictEqual(summaries.get("s1"), { total: 3, full: 2 }, "counted per subject, not per body");
assert.deepStrictEqual(summaries.get("s2"), { total: 1, full: 1 });
assert.strictEqual(occupancy.subjectLabel(summaries.get("s1")), "2 / 3 betelt");
assert.strictEqual(occupancy.subjectLabel(summaries.get("s2")), "Betelt", "all full reads as Betelt");
// a subject with no courses says nothing - outside a registration period that is most
// of them, and "0 / 0 betelt" would be noise on every row
assert.strictEqual(occupancy.subjectLabel({ total: 0, full: 0 }), null);
assert.strictEqual(occupancy.subjectLabel(undefined), null);
// the sort key: only a subject with courses, all of them full, sinks
assert.strictEqual(occupancy.isSubjectFull({ total: 3, full: 3 }), true);
assert.strictEqual(occupancy.isSubjectFull({ total: 3, full: 2 }), false);
assert.strictEqual(occupancy.isSubjectFull({ total: 0, full: 0 }), false, "no courses is not 'full'");

// the traffic light on the subject badge
assert.strictEqual(occupancy.subjectVariant({ total: 5, full: 0 }), "free", "nothing gone yet - green");
assert.strictEqual(occupancy.subjectVariant({ total: 5, full: 3 }), "partial", "going - amber");
assert.strictEqual(occupancy.subjectVariant({ total: 5, full: 5 }), "full", "gone - red");
assert.strictEqual(occupancy.subjectVariant({ total: 0, full: 0 }), null, "no courses, no badge");
assert.strictEqual(occupancy.subjectVariant(undefined), null);

// the subject identifiers used to match a native course response to its row
const subjectRecords = occupancy.collectSubjects({
  data: [
    { id: "s1", termId: "t", curriculumTemplateId: "c", curriculumTemplateLineId: "l", code: "test0418-21" },
    { termId: "t" },
  ],
});
assert.strictEqual(subjectRecords.size, 1, "a row without an id is skipped");
assert.strictEqual(subjectRecords.get("s1").code, "TEST0418-21", "codes are normalised for DOM matching");
assert.strictEqual(subjectRecords.get("s1").curriculumTemplateLineId, "l");

// The three occupancy maps belong to one registration-term snapshot. A new term,
// and the route reset represented by null, must drop every old-term entry together.
const occupancyCache = {
  termId: "term-a",
  courseState: new Map([["A-01", { isFull: true }]]),
  subjectCatalog: new Map([["subject-a", { code: "A" }]]),
  subjectSummary: new Map([["subject-a", { total: 1, full: 1 }]]),
};
assert.strictEqual(occupancy.resetCache(occupancyCache, "term-b"), true);
assert.strictEqual(occupancyCache.courseState.size, 0, "term changes clear course state");
assert.strictEqual(occupancyCache.subjectCatalog.size, 0, "term changes clear subject state");
assert.strictEqual(occupancyCache.subjectSummary.size, 0, "term changes clear subject summaries");
occupancyCache.courseState.set("B-01", { isFull: false });
assert.strictEqual(occupancy.resetCache(occupancyCache, "term-b"), false, "same-term responses keep accumulated state");
assert.strictEqual(occupancyCache.courseState.size, 1);
assert.strictEqual(occupancy.resetCache(occupancyCache, null), true, "leaving the route clears the active term");
assert.strictEqual(occupancyCache.courseState.size, 0);

// finding the course code inside a measured row. The old version of this climbed from
// the code up to "the nearest ancestor with a checkbox", which landed on the <article>
// inside the row - an only child, so sorting could never move anything.
const knownCodes = new Map([
  ["TEST0418V", true],
  ["TEST0418-21-01", false],
]);
assert.strictEqual(
  occupancy.courseCodeIn(fakeRow(["Kurzuskód:", " test0418v ", "Dr. Teszt Elek"]), knownCodes),
  "TEST0418V",
  "matched case-insensitively and trimmed, the way the live DOM renders it"
);
assert.strictEqual(
  occupancy.courseCodeIn(fakeRow(["Kurzuskód:", "TEST9999X"]), knownCodes),
  null,
  "a code we have no fullness for is skipped, never guessed at"
);
assert.strictEqual(occupancy.courseCodeIn(fakeRow([]), knownCodes), null, "an empty row stays quiet");

// Putting a list back the way it was. The snapshot is taken while Angular is still
// streaming rows in, so it is routinely a prefix of what is on screen by the time the
// toggle goes off - and handing that prefix straight to reorder() moved a stale subset
// as a block and left the rest scrambled.
const rowA = "a";
const rowB = "b";
const rowC = "c";
assert.deepStrictEqual(
  occupancy.restoreOrder([rowB, rowA], [rowA, rowB]),
  [rowB, rowA],
  "the remembered order wins over the current one"
);
assert.deepStrictEqual(
  occupancy.restoreOrder([rowB, rowA], [rowA, rowB, rowC]),
  [rowB, rowA, rowC],
  "a row that arrived after the snapshot keeps its place at the end rather than being dropped"
);
assert.deepStrictEqual(
  occupancy.restoreOrder([rowB, rowC, rowA], [rowA, rowB]),
  [rowB, rowA],
  "a row that has since been removed drops out instead of being re-inserted"
);
assert.deepStrictEqual(occupancy.restoreOrder([], [rowA, rowB]), [rowA, rowB], "an empty snapshot changes nothing");

// --- infiniteSession: Neptun renews, never the NPU ---
// Its own GetNewTokens left Neptun's countdown running and raced the page's renewal
// into a 401 (measured), so the module has no request of its own any more. It presses
// search only when Neptun is about to log out, so a reader's view is left alone.
assert.strictEqual(infiniteSession.refresh, undefined, "no GetNewTokens of our own");
{
  const minute = 60 * 1000;
  const now = 100 * minute;
  assert.strictEqual(infiniteSession.keepAliveDue(now, now - 10 * minute, null), false, "someone reading: leave it");
  assert.strictEqual(infiniteSession.keepAliveDue(now, now - 13 * minute, null), true, "logout is near: press");
  assert.strictEqual(infiniteSession.keepAliveDue(now, now - 13 * minute, now - 30000), false, "not twice at once");
  assert.strictEqual(infiniteSession.keepAliveDue(now, null, null), false, "no page request seen yet");
  // The cookie lasts 15 minutes from the last RENEWAL, which can predate the last
  // request: an old, expired token presses even while the page is only 6 minutes quiet.
  const old = { issuedAtMs: now - 11 * minute, expiresAtMs: now - 6 * minute };
  assert.strictEqual(infiniteSession.keepAliveDue(now, now - 6 * minute, null, old), true, "renewal is 11 minutes old");
  assert.strictEqual(
    infiniteSession.keepAliveDue(now, now - 6 * minute, null, {
      issuedAtMs: now - 4 * minute,
      expiresAtMs: now + minute,
    }),
    false,
    "a live token cannot be renewed by a press"
  );
  assert.strictEqual(infiniteSession.keepAliveDue(now, now - 6 * minute, now - 30000, old), false, "not twice at once");
}

// --- paginationFixes: the row window is moved, not just capped ---
const pagination = require("../src/modules/paginationFixes");
const listUrl = "/hallgato_ng/api/SubjectApplication/SchedulableSubjects?sortAndPage.firstRow=0&sortAndPage.lastRow=50";
assert.ok(pagination.widen(listUrl).endsWith("sortAndPage.firstRow=0&sortAndPage.lastRow=500"));
// on a later page the window moves with firstRow rather than collapsing behind it
assert.ok(
  pagination
    .widen("/hallgato_ng/api/SubjectApplication/SchedulableSubjects?sortAndPage.firstRow=50&sortAndPage.lastRow=100")
    .endsWith("sortAndPage.lastRow=550"),
  "lastRow must stay ahead of firstRow"
);
// requests that don't paginate are left completely alone
assert.strictEqual(pagination.widen("/hallgato_ng/api/SubjectApplication/Terms"), undefined);
assert.strictEqual(
  pagination.widen("/hallgato_ng/api/SubjectApplication/Terms?sortAndPage.firstRow=0&sortAndPage.lastRow=50"),
  undefined,
  "unmeasured paginated endpoints keep their native window"
);

// --- creditBreakdown: only registered subjects count toward the header's total ---
const creditBreakdown = require("../src/modules/creditBreakdown");
// representative fixture: registered rows are counted, the planned row is ignored
const kredits = creditBreakdown.breakdown({
  data: [
    { isRegistered: true, type: "Kötelező", credit: 4 },
    { isRegistered: true, type: "Kötelezően választott", credit: 3 },
    { isRegistered: true, type: "", credit: 2 },
    // an explicitly typed free elective merges into the same bucket as the untyped ones
    { isRegistered: true, type: "Szabadon választható", credit: 1 },
    // planned but not registered - this is what makes the raw total disagree
    { isRegistered: false, type: "Kötelező", credit: 6 },
  ],
});
assert.strictEqual(kredits.get("Kötelező"), 4, "a merely planned subject must not be counted");
assert.strictEqual(kredits.get("Kötelezően választott"), 3);
assert.strictEqual(
  kredits.get("Szabadon választható"),
  3,
  "untyped subjects still count, folded into the free-elective bucket"
);
assert.strictEqual(
  [...kredits.values()].reduce((sum, value) => sum + value, 0),
  10,
  "must add up to the header number"
);
assert.strictEqual(creditBreakdown.breakdown({}).size, 0, "an empty body must not throw");
const creditState = {
  termId: "42",
  asked: true,
  totals: new Map([["Kötelező", 5]]),
};
assert.strictEqual(creditBreakdown.resetState(creditState, "43"), true, "a new numeric term resets credit state");
assert.strictEqual(creditState.asked, false, "a new term permits one fresh credit request");
assert.strictEqual(creditState.totals.size, 0, "a new term cannot display old credit totals");
assert.strictEqual(
  creditBreakdown.resetState(creditState, "43"),
  false,
  "same-term responses do not reset credit state"
);
assert.strictEqual(creditBreakdown.resetState(creditState, null), true, "leaving the route clears the credit term");
assert.strictEqual(creditState.totals.size, 0);

// --- settings: which modules are switched on, decided before anything initializes ---
const settings = require("../src/settings");

const registry = [
  { meta: { id: "alpha", name: "Alpha" } },
  { meta: { id: "beta", name: "Beta" } },
  { meta: { id: "footer", name: "Footer", required: true } },
  { shouldActivate: () => true },
  { meta: { id: "compact", name: "Compact", defaultEnabled: false } },
];

assert.strictEqual(settings.isEnabled(registry[0], {}), true, "no opinion stored means on");
assert.strictEqual(settings.isEnabled(registry[0], { alpha: false }), false, "an off switch is honoured");
assert.strictEqual(settings.isEnabled(registry[2], { footer: false }), true, "a required module cannot be turned off");
assert.strictEqual(settings.isEnabled(registry[3], { alpha: false }), true, "a module without meta stays on");
assert.strictEqual(settings.isEnabled(null, {}), true, "a missing module must not throw");
assert.strictEqual(settings.isEnabled(registry[4], {}), false, "an explicit opt-in module starts off");
assert.strictEqual(settings.isEnabled(registry[4], { compact: true }), true, "an opt-in switch is honoured");

// Only the off switches are stored, so a module added in a later version starts on
// rather than arriving missing, and a removed one cannot leave a dead entry behind.
assert.deepStrictEqual(
  settings.pruneFlags({ alpha: false, gone: false, beta: true, compact: true }, registry),
  { alpha: false, compact: true },
  "unknown ids and choices equal to the module default are dropped"
);
assert.deepStrictEqual(settings.pruneFlags(null, registry), {}, "a missing flag set must not throw");

// A bare Node process has neither a userscript store nor the synchronous cache.
assert.strictEqual(settings.hasSyncStore(), false, "node has no GM_getValue");
assert.strictEqual(settings.hasAsyncStore(), false, "node has no GM.getValue");
assert.strictEqual(settings.canPersist(), false, "node cannot persist module flags");
assert.deepStrictEqual(settings.readFlags(), {}, "no store means no off switches");
