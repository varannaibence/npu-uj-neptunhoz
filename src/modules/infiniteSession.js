// Keeps the session alive, idle tab included, by making Neptun renew it itself.
//
// Measured on unideb (docs/API.md, GetNewTokens): Neptun logs out 15 minutes after
// the page's last own API request, and only such a request resets that countdown. So
// this never calls Account/GetNewTokens itself: that renewed the cookie but left the
// countdown running, and racing the page's own renewal got a 401 after which the
// session most likely was revoked. Instead, shortly before the logout would come, it
// presses the page's "Tárgy keresése" button; the page renews if needed, then searches.
// That reloads the subject list and saves the filter fields as they stand. Someone
// clicking around sends requests and is left alone; someone only reading for 5-10
// minutes can see the list reload - the price of not being logged out, since the
// session cookie runs out 15 minutes after the last renewal, reading or not.
//
// ponytail: only the course registration page has a measured, harmless trigger;
// synthetic mouse and key events do not wake Neptun's own renewal. Elsewhere an idle
// session still expires.
const interceptor = require("../interceptor");
const router = require("../router");
const { ROUTE, KEEPALIVE_AGE_MS } = require("./rajtolo/constants");
const { freshenAuth } = require("./rajtolo/net");

// A hidden tab runs this once a minute, so this lands 12.5-13.5 minutes into the
// quiet: before Neptun's 15-minute logout, and past its own 2-minute warning only
// when the tab is throttled.
const CHECK_INTERVAL_MS = 30 * 1000;
const QUIET_BEFORE_PRESS_MS = 12.5 * 60 * 1000;
const RETRY_MS = 60 * 1000;

// Shown in the settings panel; `id` is also the key the switch is stored under.
const meta = {
  id: "infiniteSession",
  group: "comfort",
  name: "Munkamenet életben tartása",
  where: "Tárgyak › Tárgyfelvétel, a háttérben (nincs saját gombja)",
  description:
    "A tárgyfelvételi oldalon tétlen fülnél is megakadályozza a kiléptetést: mielőtt a munkamenet lejárna (12,5 perc tétlenség, vagy 10 perce nem frissült token után), megnyomja a Neptun saját Tárgy keresése gombját. Más oldalon a munkamenet lejárhat.",
  defaultEnabled: false,
};

// Pure. Press when Neptun is about to log out: the page has been quiet for 12.5
// minutes, or the last renewal is 10 minutes old and the token has run out - the
// session cookie lasts 15 minutes from a RENEWAL, which may predate the last request
// (constants.js), so quiet time alone presses too late about half the time. Not
// again right after a press that brought nothing.
function keepAliveDue(nowMs, lastPageRequestAt, lastAttemptAt, timing) {
  if (typeof lastAttemptAt === "number" && nowMs - lastAttemptAt < RETRY_MS) {
    return false;
  }
  const quiet = typeof lastPageRequestAt === "number" && nowMs - lastPageRequestAt >= QUIET_BEFORE_PRESS_MS;
  const stale =
    Boolean(timing) &&
    typeof timing.issuedAtMs === "number" &&
    typeof timing.expiresAtMs === "number" &&
    timing.expiresAtMs <= nowMs &&
    nowMs - timing.issuedAtMs >= KEEPALIVE_AGE_MS;
  return quiet || stale;
}

function shouldActivate() {
  return true;
}

function initialize() {
  let lastAttemptAt = null;
  setInterval(() => {
    const now = Date.now();
    if (
      router.getPath() !== ROUTE ||
      !keepAliveDue(now, interceptor.getLastPageRequestAt(), lastAttemptAt, interceptor.getAuthTiming())
    ) {
      return;
    }
    lastAttemptAt = now;
    freshenAuth();
  }, CHECK_INTERVAL_MS);
}

module.exports = { meta, shouldActivate, initialize, keepAliveDue };
