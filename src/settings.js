// Which modules are switched on, and the persistence bridge used by the panel.
//
// The flags have to be readable synchronously at document-start: a module that
// registers an interceptor handler must do so before Angular's first request. Some
// userscript managers expose only the Promise-based GM.getValue/GM.setValue API,
// though. For those managers a non-sensitive localStorage cache is the startup
// source, while the GM store remains the durable source of truth.
//
// Only module ids with boolean values, plus the chosen theme colour, live in the
// cache. No account data, token or Rajtoló plan ever belongs here. Most modules default on and therefore store only
// `false`; explicitly opt-in modules store `true`.
//
// Sub-option flags use a flat string key: "modulId.optionId", e.g.
// "subjectRegistration.sortFilter". This avoids schema migration at startup: adding
// an option to an existing module requires no async read or data transformation,
// since only the new flat keys are stored, and new options default to their
// defaultEnabled value until explicitly toggled. No nested object lives in storage.
const KEY = "npu.modules";
// The one non-boolean entry: "#rrggbb", or absent for Neptun's own colours.
const THEME_COLOR_KEY = "theme.color";
const HEX_COLOR = /^#[0-9a-f]{6}$/;

function themeColor(flags) {
  const value = flags && flags[THEME_COLOR_KEY];
  return typeof value === "string" && HEX_COLOR.test(value.toLowerCase()) ? value.toLowerCase() : null;
}
const CACHE_KEY = "npu.modules.cache.v1";

function hasSyncStore() {
  return typeof GM_getValue === "function" && typeof GM_setValue === "function";
}

function hasAsyncStore() {
  return (
    typeof GM === "object" && GM !== null && typeof GM.getValue === "function" && typeof GM.setValue === "function"
  );
}

function hasCacheStore() {
  try {
    return (
      typeof localStorage !== "undefined" &&
      localStorage !== null &&
      typeof localStorage.getItem === "function" &&
      typeof localStorage.setItem === "function"
    );
  } catch (e) {
    return false;
  }
}

// Async-only managers need the synchronous cache as well: saving solely to GM
// would work, but the result would still arrive too late to gate startup modules.
function canPersist() {
  return hasSyncStore() || (hasAsyncStore() && hasCacheStore());
}

function parseFlags(raw) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return {};
  }
}

function readCache() {
  if (!hasCacheStore()) {
    return {};
  }
  try {
    return parseFlags(localStorage.getItem(CACHE_KEY));
  } catch (e) {
    return {};
  }
}

function writeCache(flags) {
  if (!hasCacheStore()) {
    return false;
  }
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(flags));
    return true;
  } catch (e) {
    return false;
  }
}

// id -> boolean only when the choice differs from that module's default.
function readFlags() {
  if (hasSyncStore()) {
    try {
      return parseFlags(GM_getValue(KEY, "{}"));
    } catch (e) {
      return {};
    }
  }
  return readCache();
}

// The panel may wait for the durable store. Startup deliberately does not call this:
// it must use readFlags() without yielding before modules register their handlers.
async function loadFlags() {
  if (hasSyncStore()) {
    return readFlags();
  }
  if (!hasAsyncStore()) {
    return readCache();
  }
  try {
    const flags = parseFlags(await GM.getValue(KEY, "{}"));
    writeCache(flags);
    return flags;
  } catch (e) {
    return readCache();
  }
}

async function writeFlags(flags) {
  const serialized = JSON.stringify(flags);
  if (hasSyncStore()) {
    try {
      GM_setValue(KEY, serialized);
      // Keep the fallback warm in case the user later moves to an async-only
      // manager. A blocked localStorage does not invalidate the synchronous store.
      writeCache(flags);
      return true;
    } catch (e) {
      return false;
    }
  }
  if (!hasAsyncStore() || !hasCacheStore()) {
    return false;
  }
  try {
    // Finish the durable write before publishing the startup cache and reloading.
    await GM.setValue(KEY, serialized);
    return writeCache(flags);
  } catch (e) {
    return false;
  }
}

function defaultEnabled(module) {
  const meta = module && module.meta;
  return !meta || meta.defaultEnabled !== false;
}

// A module with no meta, or one marked required, can never be switched off. Pure, so
// the decision is checkable without a browser.
function isEnabled(module, flags) {
  const meta = module && module.meta;
  if (!meta || !meta.id || meta.required) {
    return true;
  }
  if (flags && Object.prototype.hasOwnProperty.call(flags, meta.id) && typeof flags[meta.id] === "boolean") {
    return flags[meta.id];
  }
  return defaultEnabled(module);
}

// Check if a sub-option of a module is enabled. The option is only active if the
// parent module is also active. Semantics match isEnabled: defaultEnabled provides
// the base, and storage only records deviation.
function isOptionEnabled(module, option, flags) {
  const meta = module && module.meta;
  // An option requires both valid module and valid option metadata.
  if (!meta || !meta.id || !option || !option.id) {
    return true;
  }
  // If the parent module is not enabled, the option is not active.
  if (!isEnabled(module, flags)) {
    return false;
  }
  // Check the flat key: "moduleId.optionId"
  const optionKey = `${meta.id}.${option.id}`;
  if (flags && Object.prototype.hasOwnProperty.call(flags, optionKey) && typeof flags[optionKey] === "boolean") {
    return flags[optionKey];
  }
  // Use the option's defaultEnabled, or true if not specified.
  return option.defaultEnabled !== false;
}

// Keep only choices that differ from the module default. Unknown, required and
// malformed entries are dropped, so old settings cannot accumulate forever.
// Sub-option keys ("moduleId.optionId") are included with their option defaults.
function pruneFlags(flags, modules) {
  const known = new Map();

  // Add module-level keys: only for non-required modules.
  modules.forEach(module => {
    const meta = module && module.meta;
    if (meta && meta.id && !meta.required) {
      known.set(meta.id, defaultEnabled(module));
    }
  });

  // Add sub-option keys: only if parent module is not required.
  modules.forEach(module => {
    const meta = module && module.meta;
    if (meta && meta.id && !meta.required && meta.options && Array.isArray(meta.options)) {
      meta.options.forEach(option => {
        if (option && option.id) {
          const optionKey = `${meta.id}.${option.id}`;
          const optionDefault = option.defaultEnabled !== false;
          known.set(optionKey, optionDefault);
        }
      });
    }
  });

  const next = {};
  if (themeColor(flags)) {
    next[THEME_COLOR_KEY] = themeColor(flags);
  }
  Object.keys(flags || {}).forEach(id => {
    if (known.has(id) && typeof flags[id] === "boolean" && flags[id] !== known.get(id)) {
      next[id] = flags[id];
    }
  });
  return next;
}

// Whether saving `next` over `previous` flips a module or option switch. The theme
// colour is only CSS and already applied live, so a colour-only change (or a switch
// flipped and flipped back) needs no page reload.
function needsReload(previous, next, modules) {
  const before = pruneFlags(previous, modules);
  const after = pruneFlags(next, modules);
  return Array.from(new Set(Object.keys(before).concat(Object.keys(after)))).some(
    key => key !== THEME_COLOR_KEY && before[key] !== after[key]
  );
}

// Which enabled modules would lose something if `flags` were applied. A module
// declares what it `provides` and what it `needs`; nothing is inferred here, so a
// dependency only surfaces once someone writes it down.
function brokenDependencies(modules, flags) {
  const live = modules.filter(module => isEnabled(module, flags));
  const provided = new Set();
  live.forEach(module => ((module.meta && module.meta.provides) || []).forEach(name => provided.add(name)));

  const warnings = [];
  live.forEach(module => {
    ((module.meta && module.meta.needs) || []).forEach(need => {
      if (!provided.has(need.capability)) {
        warnings.push({ id: module.meta.id, name: module.meta.name, to: need.to });
      }
    });
  });
  return warnings;
}

module.exports = {
  brokenDependencies,
  KEY,
  CACHE_KEY,
  hasSyncStore,
  hasAsyncStore,
  canPersist,
  readFlags,
  loadFlags,
  writeFlags,
  defaultEnabled,
  isEnabled,
  isOptionEnabled,
  pruneFlags,
  needsReload,
  THEME_COLOR_KEY,
  themeColor,
};
