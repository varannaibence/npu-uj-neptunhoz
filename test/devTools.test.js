const assert = require("assert");
const devlog = require("../src/devlog");
const interceptor = require("../src/interceptor");
const samples = require("../src/modules/devTools/samples");
const panel = require("../src/modules/devTools/panel");
const devTools = require("../src/modules/devTools");

// --- devlog: the developer log's ring buffer ---
assert.strictEqual(devlog.isEnabled(), false, "off until the developer module turns it on");
devlog.log("api", "not recorded");
assert.deepStrictEqual(devlog.getEntries(), [], "a no-op while off: the core may log unconditionally");

devlog.enable(() => 1500);
let notified = 0;
const unsubscribe = devlog.subscribe(() => {
  notified += 1;
});
devlog.log("api", "GET X → HTTP 200");
{
  const [entry] = devlog.getEntries();
  assert.strictEqual(entry.kind, "api");
  assert.strictEqual(entry.serverAt - entry.at, 1500, "entries carry server time");
  assert.strictEqual(notified, 1, "a viewer hears about new entries");
}
devlog.error("onResponse X", new Error("boom"));
{
  const entry = devlog.getEntries().pop();
  assert.strictEqual(entry.kind, "error");
  assert.strictEqual(entry.message, "onResponse X: boom");
  assert.ok(entry.fields.stack.split("\n").length <= 4, "a short stack, not the whole trace");
}
for (let i = 0; i < devlog.MAX_ENTRIES + 20; i++) {
  devlog.log("route", `/p${i}`);
}
assert.strictEqual(devlog.getEntries().length, devlog.MAX_ENTRIES, "the ring buffer is capped");
assert.strictEqual(devlog.getEntries().pop().message, `/p${devlog.MAX_ENTRIES + 19}`, "and keeps the newest");
devlog.clear();
assert.deepStrictEqual(devlog.getEntries(), []);
unsubscribe();
devlog.subscribe(() => {
  throw new Error("a broken viewer");
});
assert.doesNotThrow(() => devlog.log("api", "still fine"), "a broken viewer cannot break logging");
devlog.clear();

assert.strictEqual(
  devlog.maskText("A 3f2a9c10-1111-4aaa-8bbb-0123456789ab kurzus (abc123, 20261234 sor, x.y@example.com).", "ABC123"),
  "A <guid> kurzus (<neptun-code>, <n> sor, <email>)."
);
assert.strictEqual(devlog.maskText("ABC123", ""), "ABC<n>", "an empty code masks nothing extra");

// --- interceptor.onTraffic: every finished API call, JSON or not, without its URL ---
{
  class TrafficXHR {
    constructor() {
      this.listeners = {};
      this.status = 0;
    }

    addEventListener(type, fn) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
    }

    open(method, url) {
      this.url = url;
    }

    setRequestHeader() {}
    getResponseHeader() {
      return null;
    }

    send() {
      const outcome = this.failWith || "load";
      if (outcome === "load") {
        this.status = 201;
        this.responseText = "not json";
      }
      (this.listeners[outcome] || []).forEach(fn => fn());
    }
  }
  const seen = [];
  interceptor.onTraffic(traffic => seen.push(traffic));
  interceptor.install({ XMLHttpRequest: TrafficXHR });
  const signin = new TrafficXHR();
  signin.open("post", "/hallgato_ng/api/SubjectApplication/SubjectSignin");
  signin.__npuOwn = true;
  signin.send();
  const timedOut = new TrafficXHR();
  timedOut.failWith = "timeout";
  timedOut.open("GET", "/hallgato_ng/api/SubjectApplication/GetSubjectsCourses?subjectId=secret");
  timedOut.send();
  const asset = new TrafficXHR();
  asset.open("GET", "/hallgato_ng/main.js");
  asset.send();
  assert.ok(
    seen.every(traffic => typeof traffic.durationMs === "number"),
    "each call carries its duration"
  );
  assert.deepStrictEqual(
    seen.map(traffic => {
      const copy = Object.assign({}, traffic);
      delete copy.durationMs;
      return copy;
    }),
    [
      { endpoint: "SubjectApplication/SubjectSignin", method: "POST", status: 201, own: true, outcome: "load" },
      { endpoint: "SubjectApplication/GetSubjectsCourses", method: "GET", status: 0, own: false, outcome: "timeout" },
    ],
    "a non-JSON answer and a timeout are traffic too; the query and non-API files are not"
  );
  assert.ok(!JSON.stringify(seen).includes("secret"));
}

// --- the log lines the module writes ---
assert.strictEqual(
  devTools.trafficMessage({
    endpoint: "SubjectApplication/SubjectSignin",
    method: "POST",
    status: 200,
    durationMs: 312,
    own: true,
    outcome: "load",
  }),
  "POST SubjectApplication/SubjectSignin → HTTP 200 (312 ms) · NPU"
);
assert.strictEqual(
  devTools.trafficMessage({
    endpoint: "X/Y",
    method: "GET",
    status: 0,
    durationMs: 180000,
    own: false,
    outcome: "timeout",
  }),
  "GET X/Y → időtúllépés (180000 ms)"
);
assert.strictEqual(
  devTools.authMessage("Bearer secret", { source: "xhr-header", userBoundary: true }),
  "új vagy megújult fejléc (xhr-header), munkamenet-határ",
  "which way and why, never the value"
);
assert.strictEqual(devTools.authMessage(null, { source: "http-401" }), "a fejléc megszűnt (http-401)");
assert.strictEqual(devTools.meta.defaultEnabled, false, "opt-in");
assert.strictEqual(devTools.meta.group, "developer");
assert.strictEqual(devTools.meta.options[0].id, "samples");
assert.strictEqual(devTools.meta.options[0].defaultEnabled, true, "the Mérőmód comes with developer mode");

// --- the panel's pure parts ---
{
  const line = panel.formatEntry({
    serverAt: Date.now(),
    kind: "error",
    message: "x: boom",
    fields: { stack: "a\nb" },
  });
  assert.ok(/^\d{2}:\d{2}:\d{2}\.\d{3} {2}Hiba {8}x: boom\n {4}a\n {4}b$/.test(line), line);
  assert.strictEqual(panel.durationText(312), "312 ms");
  assert.strictEqual(panel.durationText(-45000), "45 mp");
  assert.strictEqual(panel.durationText(600000), "10 perc");

  const now = 1800000000000;
  const snapshot = {
    now,
    version: "3.2.0",
    host: "neptun.example.hu",
    path: "/hallgato_ng/subjects/registration",
    hasAuth: true,
    authTiming: { issuedAtMs: now - 60000, expiresAtMs: now + 240000 },
    lastPageRequestAt: now - 5000,
    serverOffsetMs: -840,
    hasCode: true,
    store: "GM_getValue (szinkron)",
    modules: [
      { id: "devTools", on: true },
      { id: "rajtolo", on: true },
      { id: "courseAutoList", on: false },
    ],
    logCount: 12,
    samplesOn: true,
    sampleCount: 2,
  };
  const rows = Object.fromEntries(panel.stateRows(snapshot));
  assert.strictEqual(rows.Token, "lejár 4 perc múlva, 60 mp ezelőtt kiadva");
  assert.strictEqual(rows["Szerveróra-eltérés"], "−840 ms");
  assert.strictEqual(rows["Neptun-kód"], "rögzítve (itt nem látszik)", "whether there is one, never which");
  assert.strictEqual(rows["Bekapcsolt modulok"], "devTools, rajtolo");
  assert.strictEqual(rows["Mérőmód"], "be, 2 minta");
  assert.strictEqual(
    Object.fromEntries(panel.stateRows({ now, authTiming: { expiresAtMs: now - 1000 } })).Token,
    "lejárt 1 mp ezelőtt"
  );

  const exported = JSON.parse(
    panel.exportText({
      snapshot,
      entries: [{ at: now, serverAt: now - 840, kind: "api", message: "GET X → HTTP 200" }],
      sampleList: [{ endpoint: "SubjectApplication/SystemParameters" }],
    })
  );
  assert.strictEqual(exported.npu, "3.2.0");
  assert.strictEqual(exported.state.Token, rows.Token);
  assert.deepStrictEqual(exported.log, [
    { serverTime: new Date(now - 840).toISOString(), kind: "api", message: "GET X → HTTP 200" },
  ]);
  assert.deepStrictEqual(exported.samples, [{ endpoint: "SubjectApplication/SystemParameters" }]);
}

// --- samples ("Mérőmód"): masked samples of the answers not measured yet ---
const GUID_A = "3f2a9c10-1111-4aaa-8bbb-0123456789ab";
const GUID_B = "3f2a9c10-2222-4aaa-8bbb-0123456789ab";
const GUID_C = "3f2a9c10-3333-4aaa-8bbb-0123456789ab";
const GUID_D = "3f2a9c10-4444-4aaa-8bbb-0123456789ab";

["SubjectSignin", "SubjectSignout", "CourseChange", "SystemParameters"].forEach(action => {
  assert.ok(samples.ENDPOINTS.test(`SubjectApplication/${action}`), `${action} is recorded`);
});
["Account/Authenticate", "Account/GetNewTokens", "UserInfo", "SubjectApplication/GetSubjectsCourses"].forEach(
  endpoint => assert.ok(!samples.ENDPOINTS.test(endpoint), `${endpoint} is never recorded`)
);
assert.ok(!samples.ENDPOINTS.test("SubjectApplication/SubjectSigninX"), "the match is exact");

// The success shape the native client reads (docs/API.md), with personal values in it.
const course = { isSigned: true, registeredStudentsCount: 12, code: "IN-01", title: "Programozás" };
const signin = samples.maskValue(
  {
    data: {
      indexLineId: GUID_A,
      isWaiting: false,
      signedCourses: { [GUID_A]: course, [GUID_B]: course, [GUID_C]: course, [GUID_D]: course },
      registeredAt: "2026-09-29T10:00:03.123",
    },
    notification: [],
  },
  "ABC123"
);
assert.strictEqual(signin.data.isWaiting, false, "flags are the meaning and stay");
assert.strictEqual(signin.data.indexLineId, "<guid>", "an id is masked");
assert.strictEqual(signin.data.registeredAt, "<date>");
assert.deepStrictEqual(
  Object.keys(signin.data.signedCourses),
  ["<guid-1>", "<guid-2>", "<guid-3>", "<+1>"],
  "a course map keeps its shape, not its ids, and is capped"
);
assert.deepStrictEqual(
  signin.data.signedCourses["<guid-1>"],
  { isSigned: true, registeredStudentsCount: 12, code: "<string>", title: "<string>" },
  "counts stay; course codes and names inside the data do not"
);
assert.deepStrictEqual(signin.notification, []);

// The rejection text is the unknown this exists for: kept, with what identifies masked.
const rejected = samples.maskValue(
  {
    data: null,
    notification: [
      { description: `A ${GUID_B} kurzus betelt (abc123, 20261234 sor, x.y@example.com).`, type: 3, code: 4711 },
    ],
  },
  "ABC123"
);
assert.deepStrictEqual(rejected.notification, [
  { description: "A <guid> kurzus betelt (<neptun-code>, <n> sor, <email>).", type: 3, code: 4711 },
]);
assert.strictEqual(rejected.data, null);

// An ASP.NET error body keeps its own message fields at the top level only.
assert.deepStrictEqual(
  samples.maskValue({ title: "Validation failed", status: 400, errors: { courseIds: ["Kötelező."] } }),
  { title: "Validation failed", status: 400, errors: { courseIds: ["Kötelező."] } }
);
assert.deepStrictEqual(
  samples.maskValue({ data: { title: "Programozás", detail: "x" } }),
  { data: { title: "<string>", detail: "<string>" } },
  "the same key names deeper in the data are data, not messages"
);

assert.deepStrictEqual(samples.maskValue([1, 2, 3, 4, 5]), [1, 2, 3, "<+2>"], "arrays are capped");
assert.strictEqual(samples.maskValue(987654), "<number>", "a large number is more likely an id");
assert.strictEqual(samples.maskValue(""), "");

// Only the endpoint and the status come off the interceptor metadata: never the header.
{
  const sample = samples.sampleFor(
    { data: { token: "eyJhbGciOiJIUzI1NiJ9.secret-payload" }, notification: [] },
    { endpoint: "SubjectApplication/SubjectSignin", status: 200, authHeader: "Bearer secret-token", url: "/x" },
    "ABC123",
    "neptun.example.hu",
    "2026-09-29"
  );
  assert.ok(!JSON.stringify(sample).includes("secret"), "no header and no token-like value survives");
  assert.deepStrictEqual(sample, {
    host: "neptun.example.hu",
    endpoint: "SubjectApplication/SubjectSignin",
    status: 200,
    firstSeen: "2026-09-29",
    count: 1,
    body: { data: { token: "<string>" }, notification: [] },
  });
}

// The same answer only counts; a different one is kept; the oldest go past the cap.
{
  const make = status => ({ host: "h", endpoint: "SubjectApplication/SubjectSignin", status, count: 1, body: {} });
  let result = samples.addSample(undefined, make(200));
  assert.strictEqual(result.isNew, true);
  result = samples.addSample(result.samples, make(200));
  assert.strictEqual(result.isNew, false, "a repeat is not news");
  assert.strictEqual(result.samples.length, 1);
  assert.strictEqual(result.samples[0].count, 2);
  result = samples.addSample(result.samples, make(400));
  assert.strictEqual(result.isNew, true, "another status is another outcome");
  let many = [];
  for (let status = 0; status < samples.MAX_SAMPLES + 10; status++) {
    many = samples.addSample(many, make(status)).samples;
  }
  assert.strictEqual(many.length, samples.MAX_SAMPLES);
  assert.strictEqual(many[0].status, 10, "the oldest samples give way");
  assert.strictEqual(samples.addSample(["junk", null], make(1)).samples.length, 1, "unreadable stored data");
}

// --- "Beküldés GitHubon": the measurement form and a title in the URL, never the data ---
{
  const url = new URL(panel.issueUrl("www-h-ng.neptun.example.hu"));
  assert.strictEqual(`${url.origin}${url.pathname}`, "https://github.com/varannaibence/npu-uj-neptunhoz/issues/new");
  assert.strictEqual(url.searchParams.get("title"), "Mérés: www-h-ng.neptun.example.hu");
  assert.deepStrictEqual(Array.from(url.searchParams.keys()), ["template", "title"], "nothing else rides in the URL");
  const fs = require("fs");
  const path = require("path");
  assert.ok(
    fs.existsSync(path.join(__dirname, "../.github/ISSUE_TEMPLATE", url.searchParams.get("template"))),
    "the form the button opens exists"
  );
  assert.strictEqual(new URL(panel.issueUrl("")).searchParams.get("title"), "Mérés: ismeretlen intézmény");
}
