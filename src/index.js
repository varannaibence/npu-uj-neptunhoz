const utils = require("./utils");
const storage = require("./storage");
const interceptor = require("./interceptor");
const router = require("./router");
const settings = require("./settings");
const settingsPanel = require("./settingsPanel");

// Feature modules, each exporting { shouldActivate, initialize }
const modules = [
  require("./modules/paginationFixes"),
  require("./modules/loginBanner"),
  require("./modules/courseAutoList"),
  require("./modules/backToLastPage"),
  require("./modules/occupancy"),
  require("./modules/courseConflictHints"),
  require("./modules/compactSubjectRegistration"),
  require("./modules/subjectRegistrationView"),
  require("./modules/infiniteSession"),
  require("./modules/rajtolo"),
  require("./modules/creditBreakdown"),
  require("./modules/dailyOverview"),
  require("./modules/gradeCalculator"),
  require("./modules/footerBranding"),
  require("./modules/updateNotice"),
];

// Before anything else: Angular fires its first API call almost immediately.
interceptor.install();
router.install();

// UserInfo runs on every page load, Authenticate only on a fresh login.
// Subscribing to both covers the reload case too.
interceptor.onResponse(/^(UserInfo|Account\/Authenticate)$/, json => {
  const code = utils.findProp(json, "neptunCode");
  if (code) {
    utils.setNeptunCode(code);
  }
});

// Logout lands on the login page before any header-less Account/* call shows it.
router.onChange(path => {
  if (/\/login\/?$/.test(path || "")) {
    interceptor.clearAuthHeader();
  }
});

// Logout or another login is a user-state boundary: do not let a later account reuse
// the previous one's in-memory plan or registration baseline. A token renewed within
// the same session is not one; it happens every five minutes. Only a boundary AWAY
// from a known session clears the code: after a logout (already cleared) the next
// login's first request is a boundary too, and clearing there wiped the code the
// login response had just set.
interceptor.onAuthChange((auth, info) => {
  if (info && info.userBoundary && info.previousSessionId) {
    utils.setNeptunCode(null);
  }
});

// Synchronous on purpose: a module registering an interceptor handler must do so
// before the app's first request, and awaiting anything here would lose that race.
// Modules read stored data when they act, not while initializing.
const ready = storage.initialize();

// The switches are read synchronously, before anything initializes: a module that
// registers an interceptor handler must do so before Angular's first request, so
// there is no room to await storage here. An unreadable store means everything stays
// on, which is how the script behaved before the switches existed.
settingsPanel.setRegistry(modules);
// A second way in, independent of the page's own footer.
settingsPanel.registerMenuCommand();
const enabledFlags = settings.readFlags();
// Before first paint, so Neptun's blue never flashes.
require("./theme").apply(settings.themeColor(enabledFlags));

modules.forEach(module => {
  if (settings.isEnabled(module, enabledFlags) && module.shouldActivate()) {
    module.initialize();
  }
});

module.exports = { ready };
