const assert = require("assert");
const storage = require("../src/storage");
const utils = require("../src/utils");
const occupancy = require("../src/modules/occupancy");

// --- storage migration: legacy credentials stay in their old GM key, while
// non-credential course selections remain available to the new data schema ---
const legacySources = {
  users: [{ username: "TEST01", userName: "TEST01", password: "not-a-real-password" }],
  courses: {
    TEST01: { TEST0001: ["TEST0001L-01"] },
  },
};
const migratedStorage = storage.migrateLegacyData(
  {
    version: 0,
    users: {
      "example.neptun": {
        TEST01: { data: { plans: { "2026-autumn": { subjectIds: ["s1"] } } } },
      },
    },
  },
  legacySources,
  "example.neptun"
);
const migratedUser = migratedStorage.users["example.neptun"].TEST01;
assert.strictEqual(migratedStorage.version, 1, "legacy data is marked migrated even when credentials are skipped");
assert.deepStrictEqual(
  migratedUser.data.plans,
  { "2026-autumn": { subjectIds: ["s1"] } },
  "existing non-credential user data remains intact"
);
assert.deepStrictEqual(
  migratedUser.data.courses._legacy,
  { TEST0001: ["TEST0001L-01"] },
  "legacy course choices remain available under the new user-data path"
);
assert.strictEqual(migratedUser.password, undefined, "legacy password is never copied");
assert.strictEqual(migratedUser.userName, undefined, "legacy userName is never copied");
assert.strictEqual(migratedUser.username, undefined, "legacy username is never copied as a field");
assert.ok(!JSON.stringify(migratedStorage).includes("not-a-real-password"), "legacy password value is not reachable");
assert.deepStrictEqual(
  legacySources.users[0],
  { username: "TEST01", userName: "TEST01", password: "not-a-real-password" },
  "the legacy source remains untouched"
);

const unsafeLegacyCourseValues = storage.migrateLegacyData(
  { version: 0 },
  {
    courses: {
      TEST01: {
        valid: ["TEST0001L-01"],
        nestedToken: [{ accessToken: "old-token" }],
        objectValue: { courseCode: "TEST0002L-01" },
      },
    },
  },
  "example.neptun"
);
assert.deepStrictEqual(
  unsafeLegacyCourseValues.users["example.neptun"].TEST01.data.courses._legacy,
  { valid: ["TEST0001L-01"] },
  "only string course-code lists migrate from the legacy course store"
);

// Legacy domain, user and subject names are all data, never property paths that
// may mutate a prototype. Reject the three special names at every such boundary.
const maliciousLegacyCourses = JSON.parse(
  '{"__proto__":{"polluted":"yes"},"constructor":{"polluted":"yes"},"prototype":{"polluted":"yes"},"TEST01":{"__proto__":{"polluted":"yes"},"constructor":{"polluted":"yes"},"prototype":{"polluted":"yes"},"TEST0002":["TEST0002L-01"]}}'
);
const pollutionTarget = { version: 0 };
storage.migrateLegacyData(pollutionTarget, { courses: maliciousLegacyCourses }, "example.neptun");
assert.strictEqual(Object.prototype.polluted, undefined, "legacy keys must not pollute Object.prototype");
assert.deepStrictEqual(
  pollutionTarget.users["example.neptun"].TEST01.data.courses._legacy,
  { TEST0002: ["TEST0002L-01"] },
  "safe legacy keys still migrate"
);
assert.deepStrictEqual(
  Object.keys(pollutionTarget.users["example.neptun"]),
  ["TEST01"],
  "unsafe legacy user keys are ignored"
);
["__proto__", "constructor", "prototype"].forEach(domain => {
  const target = { version: 0 };
  storage.migrateLegacyData(target, { courses: { TEST01: { TEST0003: ["safe"] } } }, domain);
  assert.strictEqual(Object.prototype.polluted, undefined, `unsafe domain ${domain} must be ignored safely`);
});

// The same property-path invariant applies to the public deep setter, not only
// to legacy migration's hand-built records. Validation must happen before any
// safe prefix is created.
const directSetterTarget = {};
assert.strictEqual(
  utils.deepSetProp(directSetterTarget, ["safe", "__proto__", "polluted"], true),
  false,
  "deepSetProp rejects a forbidden segment anywhere in the path"
);
assert.deepStrictEqual(directSetterTarget, {}, "a rejected path does not leave a partial prefix");
assert.strictEqual(Object.prototype.polluted, undefined, "deepSetProp leaves Object.prototype untouched");

// Exercise the public storage setter boundary too: every dynamic path segment is
// fail-closed, while a normal setting remains awaitable and persistent.
async function runStoragePathSafetyCheck() {
  const previousGM = global.GM;
  const previousLocation = global.location;
  const writes = [];
  let activeWrites = 0;
  let maxActiveWrites = 0;

  global.GM = {
    async getValue(key) {
      return key === "data" ? JSON.stringify({ version: 1, users: {} }) : undefined;
    },
    async setValue(key, value) {
      activeWrites++;
      maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
      writes.push({ key, value });
      await Promise.resolve();
      activeWrites--;
    },
  };
  global.location = { host: "example.com" };

  try {
    await storage.initialize();
    const unsafePaths = [
      ["users", "__proto__", "polluted"],
      ["users", "constructor", "prototype", "pollutedConstructor"],
      ["users", "safe", "prototype", "pollutedPrototype"],
    ];
    const writesBeforeRejectedPaths = writes.length;
    for (const path of unsafePaths) {
      assert.strictEqual(await storage.set(...path, true), false, `storage rejects ${path.join(".")}`);
    }
    assert.strictEqual(writes.length, writesBeforeRejectedPaths, "rejected paths never reach persistent storage");
    assert.strictEqual(Object.prototype.polluted, undefined, "storage never pollutes Object.prototype");
    assert.strictEqual(Object.prototype.pollutedConstructor, undefined);
    assert.strictEqual(Object.prototype.pollutedPrototype, undefined);

    const normalWrite = storage.set("settings", "density", "comfortable");
    assert.ok(normalWrite && typeof normalWrite.then === "function", "normal storage.set is awaitable");
    const secondNormalWrite = storage.set("settings", "compact", true);
    await Promise.all([normalWrite, secondNormalWrite]);
    assert.strictEqual(maxActiveWrites, 1, "persistent storage writes are serialized");
    assert.strictEqual(storage.get("settings", "density"), "comfortable", "normal storage data remains usable");
    assert.strictEqual(storage.get("settings", "compact"), true, "queued storage data remains usable");
  } finally {
    if (typeof previousGM === "undefined") {
      delete global.GM;
    } else {
      global.GM = previousGM;
    }
    if (typeof previousLocation === "undefined") {
      delete global.location;
    } else {
      global.location = previousLocation;
    }
  }
}

// A write made while the initial data read is stalled must survive replacing the
// in-memory snapshot. Both the root setter and the user-scoped setter share this
// stale-read boundary.
async function runStorageInitializationWriteRaceCheck() {
  const previousGM = global.GM;
  const previousLocation = global.location;
  const writes = [];
  let releaseRead;
  const readGate = new Promise(resolve => {
    releaseRead = resolve;
  });
  const initialData = JSON.stringify({ version: 1, users: {} });
  const values = { data: initialData };
  let initialization;

  global.GM = {
    async getValue(key) {
      const snapshot = values[key];
      if (key === "data") {
        await readGate;
      }
      return snapshot;
    },
    async setValue(key, value) {
      writes.push({ key, value });
      values[key] = value;
    },
  };
  global.location = { host: "example.com" };

  try {
    initialization = storage.initialize();
    const earlyRootWrite = storage.set("preInit", "kept");
    const earlyUserWrite = storage.setForUser("preferences", "density", "comfortable");
    releaseRead();
    await Promise.all([initialization, earlyRootWrite, earlyUserWrite]);

    const saved = JSON.parse(writes[writes.length - 1].value);
    assert.strictEqual(saved.preInit, "kept", "a root write during initialization survives the stale read");
    assert.strictEqual(
      saved.users["example.com"].TEST01.data.preferences.density,
      "comfortable",
      "a user-scoped write during initialization survives the stale read"
    );
    assert.strictEqual(storage.get("preInit"), "kept", "the in-memory root value remains available");
  } finally {
    releaseRead();
    if (initialization) {
      await initialization.catch(() => {});
    }
    if (typeof previousGM === "undefined") {
      delete global.GM;
    } else {
      global.GM = previousGM;
    }
    if (typeof previousLocation === "undefined") {
      delete global.location;
    } else {
      global.location = previousLocation;
    }
  }
}

// Exercise the real initialization boundary too: v3 reads legacy courses, never
// even requests the old credential key, and leaves that source untouched.
async function runStorageInitializationCheck() {
  const previousGM = global.GM;
  const previousLocation = global.location;
  const reads = [];
  const writes = [];
  const values = {
    data: JSON.stringify({ version: 0 }),
    "neptun.users": JSON.stringify([{ username: "TEST01", userName: "TEST01", password: "not-a-real-password" }]),
    "neptun.courses": JSON.stringify({ TEST01: { TEST0001: ["TEST0001L-01"] } }),
  };

  global.GM = {
    async getValue(key) {
      reads.push(key);
      return values[key];
    },
    async setValue(key, value) {
      writes.push({ key, value });
    },
  };
  global.location = { host: "example.com" };

  try {
    await storage.initialize();
    assert.deepStrictEqual(reads, ["data", "neptun.courses"], "credential legacy storage is not read at all");
    const saved = JSON.parse(writes[writes.length - 1].value);
    assert.deepStrictEqual(
      saved.users["example.com"].TEST01.data.courses._legacy,
      { TEST0001: ["TEST0001L-01"] },
      "the non-credential legacy selection survives initialization"
    );
    assert.strictEqual(saved.users["example.com"].TEST01.password, undefined);
    assert.strictEqual(saved.users["example.com"].TEST01.userName, undefined);
    assert.strictEqual(saved.users["example.com"].TEST01.username, undefined);
    assert.ok(!JSON.stringify(saved).includes("not-a-real-password"), "no legacy credential value is written");
  } finally {
    if (typeof previousGM === "undefined") {
      delete global.GM;
    } else {
      global.GM = previousGM;
    }
    if (typeof previousLocation === "undefined") {
      delete global.location;
    } else {
      global.location = previousLocation;
    }
  }
}

// Data that was already upgraded by the old v1 code still needs cleanup on
// every initialization. Non-sensitive account data and plans survive, while
// credential variants and prototype-shaped keys do not.
async function runStorageCredentialCleanupCheck() {
  const previousGM = global.GM;
  const previousLocation = global.location;
  const reads = [];
  const writes = [];
  const values = {
    data: JSON.stringify({
      version: 1,
      users: {
        "example.com": {
          TEST01: {
            displayName: "Keep this profile label",
            password: "old-password",
            username: "old-username",
            userName: "old-user-name",
            user_password: "old-user-password",
            userPassword: "old-user-password-2",
            password_hash: "old-password-hash",
            passwordSalt: "old-password-salt",
            passwd: "old-passwd",
            passphrase: "old-passphrase",
            token: "old-token",
            accessToken: "old-access-token",
            authToken: "old-auth-token",
            refresh_token: "old-refresh-token",
            authorization: "Bearer old-authorization",
            authorization_header: "Bearer old-authorization-header",
            sessionId: "old-session-id",
            session_secret: "old-session-secret",
            apiKey: "old-api-key",
            client_secret: "old-client-secret",
            credentials: { accessToken: "old-nested-token" },
            data: {
              plans: { "2026-autumn": { subjectIds: ["s1"] } },
              preferences: { density: "comfortable" },
            },
            __proto__: { polluted: "yes" },
            constructor: { prototype: { polluted: "yes" } },
            prototype: { polluted: "yes" },
          },
        },
      },
    }),
    "neptun.users": "must not be read",
    "neptun.courses": "must not be read for v1 data",
  };

  global.GM = {
    async getValue(key) {
      reads.push(key);
      return values[key];
    },
    async setValue(key, value) {
      writes.push({ key, value });
    },
  };
  global.location = { host: "example.com" };

  try {
    await storage.initialize();
    assert.deepStrictEqual(reads, ["data"], "v1 cleanup must not read legacy credential or course keys");
    const saved = JSON.parse(writes[writes.length - 1].value);
    const savedUser = saved.users["example.com"].TEST01;
    assert.strictEqual(saved.version, 1, "cleanup keeps the v1 schema marker");
    assert.strictEqual(savedUser.displayName, "Keep this profile label", "non-sensitive user data survives cleanup");
    assert.deepStrictEqual(
      savedUser.data,
      {
        plans: { "2026-autumn": { subjectIds: ["s1"] } },
        preferences: { density: "comfortable" },
      },
      "plans and other non-sensitive user data survive cleanup"
    );
    [
      "password",
      "username",
      "userName",
      "user_password",
      "userPassword",
      "password_hash",
      "passwordSalt",
      "passwd",
      "passphrase",
      "token",
      "accessToken",
      "authToken",
      "refresh_token",
      "authorization",
      "authorization_header",
      "sessionId",
      "session_secret",
      "apiKey",
      "client_secret",
      "credentials",
      "__proto__",
      "constructor",
      "prototype",
    ].forEach(key => {
      assert.strictEqual(
        Object.prototype.hasOwnProperty.call(savedUser, key),
        false,
        `v1 cleanup removes ${key} from the new schema`
      );
    });
    assert.ok(!JSON.stringify(saved).includes("old-password"), "old credential values are not persisted");
    assert.strictEqual(Object.prototype.polluted, undefined, "v1 cleanup leaves Object.prototype untouched");
  } finally {
    if (typeof previousGM === "undefined") {
      delete global.GM;
    } else {
      global.GM = previousGM;
    }
    if (typeof previousLocation === "undefined") {
      delete global.location;
    } else {
      global.location = previousLocation;
    }
  }
}

// initialize() must not resolve before the cleaned data has been durably handed
// to GM.setValue. A delayed stub catches accidental fire-and-forget saves.
async function runStorageSaveAwaitCheck() {
  const previousGM = global.GM;
  const previousLocation = global.location;
  const writes = [];
  let releaseSave;
  const saveGate = new Promise(resolve => {
    releaseSave = resolve;
  });
  let saveStarted = false;
  let initialization;

  global.GM = {
    async getValue(key) {
      assert.strictEqual(key, "data");
      return JSON.stringify({ version: 1, users: {} });
    },
    async setValue(key, value) {
      saveStarted = true;
      writes.push({ key, value });
      await saveGate;
    },
  };
  global.location = { host: "example.com" };

  try {
    initialization = storage.initialize();
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(saveStarted, true, "initialization reaches the async save");

    let initializationFinished = false;
    initialization.then(() => {
      initializationFinished = true;
    });
    await Promise.resolve();
    assert.strictEqual(initializationFinished, false, "initialization waits for GM.setValue to finish");

    releaseSave();
    await initialization;
    assert.strictEqual(writes.length, 1, "the awaited initialization persists once");
  } finally {
    releaseSave();
    if (initialization) {
      await initialization.catch(() => {});
    }
    if (typeof previousGM === "undefined") {
      delete global.GM;
    } else {
      global.GM = previousGM;
    }
    if (typeof previousLocation === "undefined") {
      delete global.location;
    } else {
      global.location = previousLocation;
    }
  }
}

// The "Betelt kurzusok hátra" toggle reads its saved state straight out of storage on
// every use. It used to snapshot it into a local at initialize() time - which runs at
// document-start, long before GM.getValue answers - so the flag was always read as
// undefined and the toggle came up OFF however the user had left it.
async function runToggleStatePersistenceCheck() {
  const previousGM = global.GM;
  const previousLocation = global.location;
  global.GM = {
    async getValue(key) {
      return key === "data" ? JSON.stringify({ version: 1, occupancyEnabled: true }) : undefined;
    },
    async setValue() {},
  };
  global.location = { host: "example.com" };

  try {
    const ready = storage.initialize();
    assert.strictEqual(occupancy.isEnabled(), false, "before the load lands there is genuinely nothing to know yet");
    await ready;
    assert.strictEqual(occupancy.isEnabled(), true, "the saved toggle state is picked up once storage loads");
    // GM.setValue resolves undefined, as Tampermonkey's does. A successful write must
    // still read as success, or the Rajtoló reports "nem menthető" on every toggle.
    assert.strictEqual(await storage.set("occupancyEnabled", false), true, "a landed write reports true");
    assert.strictEqual(occupancy.isEnabled(), false, "and it keeps tracking storage rather than a stale copy");
  } finally {
    if (typeof previousGM === "undefined") {
      delete global.GM;
    } else {
      global.GM = previousGM;
    }
    if (typeof previousLocation === "undefined") {
      delete global.location;
    } else {
      global.location = previousLocation;
    }
  }
}

// The engine checks are async (runSubject/runPlan await their injected deps), so they
// run last and the success line waits for them. A rejection must exit non-zero -

// The async checks run in this order on purpose: each leaves storage in a known
// state for the next.
async function run() {
  await runStoragePathSafetyCheck();
  await runStorageInitializationWriteRaceCheck();
  await runStorageInitializationCheck();
  await runStorageCredentialCleanupCheck();
  await runStorageSaveAwaitCheck();
  await runToggleStatePersistenceCheck();
}

module.exports = { run };
