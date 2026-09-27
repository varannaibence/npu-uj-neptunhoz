const utils = require("./utils");

// Stored data
let data = {};
let initialized = false;
let initializationPromise = null;
let pendingMutations = [];
let writeQueue = Promise.resolve();

function gmGet(key) {
  if (typeof GM === "object" && GM && typeof GM.getValue === "function") {
    return Promise.resolve(GM.getValue(key));
  }
  if (typeof GM_getValue === "function") {
    return Promise.resolve(GM_getValue(key));
  }
  return Promise.reject(new Error("GreaseMonkey storage API unavailable"));
}

function gmSet(key, value) {
  if (typeof GM === "object" && GM && typeof GM.setValue === "function") {
    return Promise.resolve(GM.setValue(key, value));
  }
  if (typeof GM_setValue === "function") {
    return Promise.resolve(GM_setValue(key, value));
  }
  return Promise.reject(new Error("GreaseMonkey storage API unavailable"));
}

// Load all data from local storage
function replayPendingMutations() {
  const mutations = pendingMutations;
  pendingMutations = [];
  mutations.forEach(({ keys, value }) => {
    utils.deepSetProp(data, keys, value);
  });
  return mutations.length > 0;
}

async function initialize() {
  if (initializationPromise) {
    return initializationPromise;
  }

  initialized = false;
  const priorWrites = writeQueue;
  const run = (async () => {
    // A caller can write before startup invokes initialize(). Finish those writes
    // before taking the load snapshot, otherwise a stale GM.getValue result could
    // overwrite them before they are replayed.
    await priorWrites.catch(() => {});
    try {
      const loaded = JSON.parse(await gmGet("data"));
      data = loaded && typeof loaded === "object" ? loaded : {};
    } catch (e) {
      data = {};
    }

    // Apply writes made before the load completed before schema cleanup runs.
    replayPendingMutations();
    await upgradeSchema();

    // A set can arrive while upgradeSchema is awaiting a legacy read or its
    // durable save. Replay and persist until the initialization window is quiet.
    while (replayPendingMutations()) {
      stripLegacyCredentials(ownRecord(data, "users"));
      await saveNow();
    }
    initialized = true;
  })();
  initializationPromise = run;
  run.then(
    () => {
      if (initializationPromise === run) {
        initializationPromise = null;
      }
    },
    () => {
      if (initializationPromise === run) {
        initializationPromise = null;
      }
    }
  );
  return run;
}

// Save all data to local storage
function saveNow() {
  return gmSet("data", JSON.stringify(data));
}

// Serialize every post-initialization save. A rejected write must not poison the
// queue forever, while the returned Promise still reports that individual error.
function queueSave() {
  const waitForInitialization = initializationPromise;
  const operation = writeQueue
    .catch(() => {})
    .then(() => waitForInitialization || undefined)
    .then(() => saveNow());
  operation.catch(() => {});
  writeQueue = operation;
  return operation;
}

// Gets the value at the specified key path
function get(...keys) {
  return utils.deepGetProp(data, keys);
}

// Sets the value at the specified key path
function set(...keysAndValue) {
  const value = keysAndValue.pop();
  const keys = keysAndValue;
  if (!utils.deepSetProp(data, keys, value)) {
    return Promise.resolve(false);
  }
  if (!initialized) {
    pendingMutations.push({ keys: keys.slice(), value });
  }
  // During initialization the initialization save replays and persists the
  // pending mutation itself; returning that Promise keeps callers awaitable
  // without creating a queue cycle. Resolves true once written: GM.setValue itself
  // resolves undefined, which read as a failed save ("nem menthető") every time.
  return (initializationPromise || queueSave()).then(() => true);
}

// Gets the specified property or all data of the current user
function getForUser(...keys) {
  return get("users", utils.getDomain(), utils.getNeptunCode(), "data", ...keys);
}

// Sets the specified property of the current user
function setForUser(...keysAndValue) {
  return set("users", utils.getDomain(), utils.getNeptunCode(), "data", ...keysAndValue);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const FORBIDDEN_DYNAMIC_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// These are credential-bearing names from the old storage shape. Normalize only
// separators and case so ordinary user data such as `userId` remains intact.
// Suffix checks below cover the usual access/auth/refresh/session token and
// secret spellings without inspecting values for token-like strings.
const CREDENTIAL_FIELD_NAMES = new Set([
  "password",
  "passwordhash",
  "passwordsalt",
  "passwd",
  "passphrase",
  "username",
  "userpassword",
  "token",
  "tokenvalue",
  "authorization",
  "authorizationheader",
  "auth",
  "authheader",
  "authentication",
  "session",
  "sessiondata",
  "sessionid",
  "sessionkey",
  "sessionsecret",
  "sessioncookie",
  "secret",
  "secretkey",
  "apikey",
  "accesskey",
  "privatekey",
  "jwt",
  "cookie",
  "authcookie",
  "credential",
  "credentials",
  "logincredential",
]);

function isSafeDynamicKey(key) {
  return typeof key === "string" && !FORBIDDEN_DYNAMIC_KEYS.has(key);
}

function hasOwn(parent, key) {
  return Object.prototype.hasOwnProperty.call(parent, key);
}

function ensureRecord(parent, key) {
  if (!isRecord(parent) || !isSafeDynamicKey(key)) {
    return null;
  }
  if (!hasOwn(parent, key) || !isRecord(parent[key])) {
    parent[key] = {};
  }
  return parent[key];
}

function ownRecord(parent, key) {
  return isRecord(parent) && isSafeDynamicKey(key) && hasOwn(parent, key) && isRecord(parent[key]) ? parent[key] : null;
}

function isCredentialField(key) {
  if (typeof key !== "string") {
    return false;
  }
  const normalized = key.replace(/[-_]/g, "").toLowerCase();
  return (
    CREDENTIAL_FIELD_NAMES.has(normalized) ||
    normalized.endsWith("token") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("credential") ||
    normalized.endsWith("credentials") ||
    normalized.endsWith("authorization") ||
    normalized.endsWith("cookie")
  );
}

function isLegacyCourseChoices(value) {
  return Array.isArray(value) && value.every(choice => typeof choice === "string");
}

// Remove credentials that an older v1 migration may already have written into
// data.users. This deliberately walks all user-owned values so variants nested
// inside an old account record cannot survive, while unrelated plans and data do.
function stripLegacyCredentials(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach(entry => stripLegacyCredentials(entry, seen));
    return;
  }

  Object.keys(value).forEach(key => {
    if (FORBIDDEN_DYNAMIC_KEYS.has(key) || isCredentialField(key)) {
      delete value[key];
      return;
    }
    stripLegacyCredentials(value[key], seen);
  });
}

// Migrate only the non-credential course choices from the old schema. The old
// `neptun.users` value is a list of username/password tuples; v3 has no login
// module, so it is deliberately not read or copied. The legacy GM key remains
// untouched for users who still run an older script.
function migrateLegacyData(target, legacySources, domain) {
  if (!isRecord(target)) {
    return target;
  }

  const legacyCourses = ownRecord(legacySources, "courses");
  const domainUsers = legacyCourses && domain ? ensureRecord(ensureRecord(target, "users"), domain) : null;
  if (domainUsers) {
    Object.keys(legacyCourses).forEach(user => {
      const subjects = ownRecord(legacyCourses, user);
      if (!subjects) {
        return;
      }
      const userData = ensureRecord(domainUsers, user);
      const legacyCourseData = userData && ensureRecord(ensureRecord(userData, "data"), "courses");
      const legacyCourseChoices = legacyCourseData && ensureRecord(legacyCourseData, "_legacy");
      if (!legacyCourseChoices) {
        return;
      }
      Object.keys(subjects).forEach(subject => {
        if (isSafeDynamicKey(subject) && isLegacyCourseChoices(subjects[subject])) {
          legacyCourseChoices[subject] = subjects[subject].slice();
        }
      });
    });
  }
  target.version = 1;
  return target;
}

// Upgrade the data schema to the latest version
async function upgradeSchema() {
  const ver = typeof data.version !== "undefined" ? data.version : 0;

  // < 1.3
  if (ver < 1) {
    let legacyCourses;
    try {
      legacyCourses = JSON.parse(await gmGet("neptun.courses"));
    } catch (e) {}
    migrateLegacyData(data, { courses: legacyCourses }, utils.getDomain());
  }

  stripLegacyCredentials(ownRecord(data, "users"));
  await saveNow();
}

module.exports = {
  initialize,
  get,
  set,
  getForUser,
  setForUser,
  migrateLegacyData,
};
