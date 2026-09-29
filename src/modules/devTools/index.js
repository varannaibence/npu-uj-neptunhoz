// "Fejlesztői mód": a log of what the NPU sees and does, the state behind it, and the
// Mérőmód, for whoever debugs the NPU or measures what Neptun answers. Opt-in, and
// read-only toward Neptun: it only listens, and makes no request of its own.
//
// It is first in the registry, so the log sees the other modules start. What it
// logs is masked where it is recorded: endpoint names, statuses and durations, never
// a query string, a header, a token or the Neptun code itself.
const devlog = require("../../devlog");
const interceptor = require("../../interceptor");
const router = require("../../router");
const utils = require("../../utils");
const settings = require("../../settings");
const settingsPanel = require("../../settingsPanel");
const samples = require("./samples");
const panel = require("./panel");

const MENU_LABEL = "NPU fejlesztői eszközök";
// Every response nudges the offset by tens of ms; only a real shift is news.
const CLOCK_STEP_MS = 500;
const OUTCOME_LABELS = { error: "hálózati hiba", timeout: "időtúllépés", abort: "megszakítva" };

const meta = {
  id: "devTools",
  group: "developer",
  name: "Fejlesztői mód",
  where: "A háttérben; a napló a Tampermonkey menüjéből („NPU fejlesztői eszközök”)",
  description:
    "Naplózza, mit lát és mit tesz az NPU: API-hívások időtartammal, munkamenet-váltások, útvonalak, " +
    "szerveróra, a Rajtoló lépései és az elnyelt hibák. Csak memóriában tartja; magától semmit nem küld el.",
  defaultEnabled: false,
  options: [
    {
      id: "samples",
      name: "Mérőmód: válaszminták",
      where: "Tárgyak › Tárgyfelvétel, a háttérben",
      description:
        "Maszkolva elmenti a Neptun még nem mért tárgyfelvételi válaszait (pl. sikeres jelentkezés, betelt " +
        "kurzus elutasítása), hogy elküldhesd a fejlesztőknek.",
      defaultEnabled: true,
    },
  ],
};

function shouldActivate() {
  return true;
}

// Pure: one traffic event as a log line.
function trafficMessage(traffic) {
  const result = traffic.outcome === "load" ? `HTTP ${traffic.status}` : OUTCOME_LABELS[traffic.outcome];
  const duration = typeof traffic.durationMs === "number" ? ` (${traffic.durationMs} ms)` : "";
  return `${traffic.method} ${traffic.endpoint} → ${result || traffic.outcome}${duration}${traffic.own ? " · NPU" : ""}`;
}

// Pure: an auth change as a log line - which way, what caused it, never the value.
function authMessage(auth, info) {
  const source = info && info.source ? ` (${info.source})` : "";
  const boundary = info && info.userBoundary ? ", munkamenet-határ" : "";
  return `${auth ? "új vagy megújult fejléc" : "a fejléc megszűnt"}${source}${boundary}`;
}

function samplesEnabled() {
  return settings.isOptionEnabled({ meta }, meta.options[0], settings.readFlags());
}

function snapshot() {
  const flags = settings.readFlags();
  return {
    now: Date.now(),
    version: (typeof GM !== "undefined" && GM && GM.info && GM.info.script && GM.info.script.version) || null,
    host: location.host,
    path: devlog.maskText(location.pathname),
    hasAuth: Boolean(interceptor.getAuthHeader()),
    authTiming: interceptor.getAuthTiming(),
    lastPageRequestAt: interceptor.getLastPageRequestAt(),
    serverOffsetMs: interceptor.getServerOffsetMs(),
    hasCode: Boolean(utils.getNeptunCode()),
    store: settings.hasSyncStore()
      ? "GM_getValue (szinkron)"
      : settings.hasAsyncStore()
        ? "GM.getValue (aszinkron)"
        : "nincs",
    modules: settingsPanel.getRegistry().map(module => ({ id: module.meta.id, on: settings.isEnabled(module, flags) })),
    logCount: devlog.getEntries().length,
    samplesOn: samplesEnabled(),
    sampleCount: samples.stored().length,
  };
}

function initialize() {
  devlog.enable(() => interceptor.getServerOffsetMs());
  devlog.log("route", devlog.maskText(location.pathname));

  let loggedOffset = null;
  interceptor.onTraffic(traffic => {
    devlog.log(traffic.outcome === "load" && traffic.status < 400 ? "api" : "error", trafficMessage(traffic));
    const offset = interceptor.getServerOffsetMs();
    if (typeof offset === "number" && (loggedOffset === null || Math.abs(offset - loggedOffset) >= CLOCK_STEP_MS)) {
      loggedOffset = offset;
      devlog.log("clock", `eltérés: ${offset >= 0 ? "+" : "−"}${Math.abs(offset)} ms`);
    }
  });
  interceptor.onAuthChange((auth, info) => devlog.log("auth", authMessage(auth, info)));
  utils.onNeptunCodeChange(code => devlog.log("auth", code ? "Neptun-kód rögzítve" : "Neptun-kód törölve"));
  router.onChange(path => devlog.log("route", devlog.maskText(path)));

  if (samplesEnabled()) {
    samples.install(MENU_LABEL);
  }
  if (typeof GM_registerMenuCommand === "function") {
    try {
      GM_registerMenuCommand(MENU_LABEL, () => panel.open(snapshot));
    } catch (e) {
      devlog.error("menü", e);
    }
  }
}

module.exports = { meta, shouldActivate, initialize, trafficMessage, authMessage, MENU_LABEL };
