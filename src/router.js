// Neptun NG is a real-path SPA: navigation does not reload the document.
//
// Routes are polled rather than found by patching history.pushState. Zone.js installs
// its own pushState as an OWN property on `history`, shadowing anything on
// History.prototype - so a patch survives only if we win a load-order race, on every
// Angular upgrade. A poll cannot lose it.
const devlog = require("./devlog");

const POLL_MS = 250;

const listeners = [];
let lastPath = null;

function getPath(target = typeof window !== "undefined" ? window : global) {
  return target.location.pathname;
}

function matches(path, target = typeof window !== "undefined" ? window : global) {
  return getPath(target) === path;
}

// Fires on every SPA navigation.
function onChange(fn) {
  listeners.push(fn);
}

// Exported so the self-check can drive it without a timer.
function check(target = typeof window !== "undefined" ? window : global) {
  const path = getPath(target);
  if (path === lastPath) {
    return false;
  }
  lastPath = path;
  listeners.forEach(fn => {
    try {
      fn(path);
    } catch (e) {
      // A route observer is advisory and must not interrupt the others.
      devlog.error("router.onChange", e);
    }
  });
  return true;
}

function install(target = typeof window !== "undefined" ? window : global) {
  lastPath = getPath(target);
  target.setInterval(() => check(target), POLL_MS);
}

module.exports = {
  getPath,
  matches,
  onChange,
  check,
  install,
};
