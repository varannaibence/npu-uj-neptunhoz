// Remembers the last route visited and offers to return to it once login completes.
//
// The dashboard and the login page are skipped: "go back to where you were" is
// meaningless for the page you would land on anyway.
const interceptor = require("../interceptor");
const router = require("../router");
const storage = require("../storage");
const utils = require("../utils");
const modal = require("../modal");
const tokens = require("../neptunTokens");

// Same test as index.js's logout detection, trailing slash included.
const LOGIN_ROUTE = /\/login\/?$/;
const SKIP_ROUTES = ["/hallgato_ng/dashboard"];
// Per Neptun domain: a path from one institution means nothing on another's. A new
// key, since the old global "lastPage" holds a string this one could not nest under.
const STORAGE_KEY = "lastPageByDomain";

// Shown in the settings panel; `id` is also the key the switch is stored under.
const meta = {
  id: "backToLastPage",
  group: "comfort",
  name: "Vissza a legutóbbi oldalra",
  where: "Bejelentkezés után, felugró értesítésben",
  description: "Bejelentkezés után felajánlja, hogy visszavigyen oda, ahol jártál.",
};

function shouldActivate() {
  return true;
}

// Pure, so it is checkable without a router.
function isRememberable(path) {
  return typeof path === "string" && path.length > 0 && !SKIP_ROUTES.includes(path) && !LOGIN_ROUTE.test(path);
}

// Drawn as a real Neptun dialog rather than a native confirm(), which reads as "a
// script is doing something to my Neptun". Declining is the easy path - Escape, the
// X, the backdrop or "Maradok".
function offerReturn(lastPage) {
  modal.open({
    title: "Vissza a legutóbbi oldalra?",
    build(content) {
      const intro = document.createElement("p");
      intro.style.margin = "0 0 8px";
      intro.textContent = "Kilépés előtt ezen az oldalon jártál:";
      const path = document.createElement("p");
      path.style.cssText = `margin:0;font-weight:700;color:${tokens.primary};word-break:break-all`;
      path.textContent = lastPage;
      content.appendChild(intro);
      content.appendChild(path);
    },
    actions: [
      { label: "Maradok" },
      {
        label: "Vigyél oda",
        primary: true,
        onClick() {
          location.assign(lastPage);
        },
      },
    ],
  });
}

// Not the per-user variants: this can run before the Neptun code has been captured
// at all, and "what page was open" is not per-user data. Per domain, though.
function initialize() {
  function remember(path) {
    if (isRememberable(path)) {
      storage.set(STORAGE_KEY, utils.getDomain(), path);
    }
  }

  router.onChange(remember);
  // router.install() runs before any module subscribes, so the route the user landed
  // on never fires a change. Without this, a session that dies without a single
  // in-app navigation has nothing to offer afterwards.
  remember(router.getPath());

  // Authenticate answers twice: the first (202) is only the password check ahead of
  // 2FA. Only the second (200, isTwoFactorRequired:false) completes a login.
  interceptor.onResponse("Account/Authenticate", json => {
    const data = json && json.data;
    if (!data || data.isTwoFactorRequired !== false) {
      return;
    }
    const lastPage = storage.get(STORAGE_KEY, utils.getDomain());
    storage.set(STORAGE_KEY, utils.getDomain(), null);
    if (lastPage) {
      offerReturn(lastPage);
    }
  });
}

module.exports = {
  meta,
  shouldActivate,
  initialize,
  isRememberable,
  offerReturn,
};
