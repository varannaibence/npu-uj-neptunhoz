// A one-time notice after Tampermonkey has updated the script: which version is now
// running, and a link to what changed. Nothing is fetched - the manager does the
// updating, this only compares the running version with the last one seen here.
const storage = require("../storage");
const { showToast } = require("../toast");

const LAST_SEEN_KEY = "lastSeenScriptVersion";
// Every change of a version is written up in the changelog, under a heading the
// release workflow anchors as `v<version>`; the GitHub release page only lists PRs.
const CHANGELOG_URL = "https://github.com/varannaibence/npu-uj-neptunhoz/blob/master/docs/CHANGELOG.md";
// Long enough to notice on a page that is still loading; closable any time.
const NOTICE_MS = 15000;

// Shown in the settings panel; `id` is also the key the switch is stored under.
const meta = {
  id: "updateNotice",
  group: "comfort",
  name: "Frissítés jelzése",
  where: "Frissítés utáni első betöltéskor, felugró értesítésben",
  description: "Frissítés után egyszer jelzi az új verziót, a változásnapló linkjével.",
};

function shouldActivate() {
  return true;
}

// "3.0.10" -> [3, 0, 10]. Null for anything that is not plain x.y.z.
function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(typeof value === "string" ? value.trim() : "");
  return match ? match.slice(1).map(Number) : null;
}

function isNewer(current, previous) {
  const a = parseVersion(current);
  const b = parseVersion(previous);
  if (!a || !b) {
    return false;
  }
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i] > b[i];
    }
  }
  return false;
}

// Only an actual upgrade is announced: a first install has nothing to compare with,
// and a downgrade or reinstall of the same version is not news.
function shouldAnnounce(lastSeen, current) {
  return isNewer(current, lastSeen);
}

function noticeText(version) {
  return `Neptun PowerUp! frissült: v${version}.`;
}

// Without the anchor (an older heading) the changelog still opens, newest first.
function changelogUrl(version) {
  return `${CHANGELOG_URL}#v${encodeURIComponent(version)}`;
}

function whenBodyReady(fn) {
  if (document.body) {
    fn();
    return;
  }
  document.addEventListener("DOMContentLoaded", fn, { once: true });
}

function initialize() {
  const current = GM.info && GM.info.script && GM.info.script.version;
  if (!parseVersion(current)) {
    return;
  }
  storage
    .initialize()
    .then(() => {
      const lastSeen = storage.get(LAST_SEEN_KEY);
      if (lastSeen === current) {
        return;
      }
      storage.set(LAST_SEEN_KEY, current);
      if (shouldAnnounce(lastSeen, current)) {
        whenBodyReady(() =>
          showToast(noticeText(current), "ok", {
            link: { href: changelogUrl(current), label: "Újdonságok" },
            durationMs: NOTICE_MS,
          })
        );
      }
    })
    .catch(() => {
      // No notice is better than one shown on every load.
    });
}

module.exports = {
  meta,
  shouldActivate,
  initialize,
  parseVersion,
  isNewer,
  shouldAnnounce,
  noticeText,
  changelogUrl,
};
