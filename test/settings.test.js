const assert = require("assert");
const settings = require("../src/settings");

function restoreGlobal(name, value) {
  if (value === undefined) {
    delete global[name];
  } else {
    global[name] = value;
  }
}

async function run() {
  const previous = {
    GM: global.GM,
    GM_getValue: global.GM_getValue,
    GM_setValue: global.GM_setValue,
    localStorage: global.localStorage,
  };
  const cache = new Map();
  const durable = new Map([[settings.KEY, JSON.stringify({ alpha: false })]]);

  try {
    delete global.GM_getValue;
    delete global.GM_setValue;
    global.localStorage = {
      getItem(key) {
        return cache.has(key) ? cache.get(key) : null;
      },
      setItem(key, value) {
        cache.set(key, value);
      },
    };
    global.GM = {
      async getValue(key, fallback) {
        return durable.has(key) ? durable.get(key) : fallback;
      },
      async setValue(key, value) {
        durable.set(key, value);
      },
    };

    assert.strictEqual(settings.hasSyncStore(), false, "the async manager has no legacy API");
    assert.strictEqual(settings.hasAsyncStore(), true, "the Promise API is detected");
    assert.strictEqual(settings.canPersist(), true, "Promise GM plus cache can persist settings");
    assert.deepStrictEqual(settings.readFlags(), {}, "startup does not wait for an uncached GM value");
    assert.deepStrictEqual(await settings.loadFlags(), { alpha: false }, "the panel loads the durable flags");
    assert.deepStrictEqual(settings.readFlags(), { alpha: false }, "loading warms the startup cache");

    assert.strictEqual(
      await settings.writeFlags({ beta: false, compact: true }),
      true,
      "an async-only manager can save"
    );
    assert.strictEqual(
      durable.get(settings.KEY),
      JSON.stringify({ beta: false, compact: true }),
      "GM is the durable copy"
    );
    assert.strictEqual(
      cache.get(settings.CACHE_KEY),
      JSON.stringify({ beta: false, compact: true }),
      "the next document-start has a synchronous copy"
    );

    const priorCache = cache.get(settings.CACHE_KEY);
    global.GM.setValue = async () => {
      throw new Error("write denied");
    };
    assert.strictEqual(await settings.writeFlags({ alpha: false }), false, "a rejected GM write is reported");
    assert.strictEqual(cache.get(settings.CACHE_KEY), priorCache, "a failed durable write is not published");

    let syncValue = JSON.stringify({ alpha: false });
    global.GM_getValue = () => syncValue;
    global.GM_setValue = (_key, value) => {
      syncValue = value;
    };
    assert.deepStrictEqual(settings.readFlags(), { alpha: false }, "the synchronous GM value wins when available");
    assert.strictEqual(await settings.writeFlags({ beta: false }), true, "the legacy API remains supported");
    assert.strictEqual(syncValue, JSON.stringify({ beta: false }), "the legacy API receives the new flags");

    // Sub-option tests: isOptionEnabled with flat key storage
    const moduleWithOptions = {
      meta: {
        id: "testModule",
        name: "Test",
        description: "Test module",
        options: [
          { id: "option1", name: "Option 1", defaultEnabled: true },
          { id: "option2", name: "Option 2", defaultEnabled: false },
        ],
      },
    };

    // Sub-option defaults: option1 defaults to true, option2 defaults to false.
    assert.strictEqual(
      settings.isOptionEnabled(moduleWithOptions, moduleWithOptions.meta.options[0], {}),
      true,
      "sub-option with defaultEnabled:true is enabled by default"
    );
    assert.strictEqual(
      settings.isOptionEnabled(moduleWithOptions, moduleWithOptions.meta.options[1], {}),
      false,
      "sub-option with defaultEnabled:false is disabled by default"
    );

    // Sub-option explicit toggle: stored as "moduleId.optionId"
    const flagsWithOption = { "testModule.option1": false, "testModule.option2": true };
    assert.strictEqual(
      settings.isOptionEnabled(moduleWithOptions, moduleWithOptions.meta.options[0], flagsWithOption),
      false,
      "explicit false overrides defaultEnabled:true"
    );
    assert.strictEqual(
      settings.isOptionEnabled(moduleWithOptions, moduleWithOptions.meta.options[1], flagsWithOption),
      true,
      "explicit true overrides defaultEnabled:false"
    );

    // Sub-option depends on parent module state: if parent is disabled, option is not active.
    const flagsParentDisabled = { testModule: false };
    assert.strictEqual(
      settings.isOptionEnabled(moduleWithOptions, moduleWithOptions.meta.options[0], flagsParentDisabled),
      false,
      "sub-option is inactive when parent module is disabled"
    );

    // Flat key format does not clash with same-named module: "test.module" option key
    // is distinct from "test" module with id "module" (both would need different ids
    // in practice, but the key format is unambiguous).
    const moduleA = {
      meta: {
        id: "test",
        name: "Test",
        description: "Test",
      },
    };
    const moduleB = {
      meta: {
        id: "test.module",
        name: "Test.Module",
        description: "Test.Module",
      },
    };
    const flagsClash = { test: false, "test.module": true };
    assert.strictEqual(settings.isEnabled(moduleA, flagsClash), false, "module 'test' flag is stored under 'test' key");
    assert.strictEqual(
      settings.isEnabled(moduleB, flagsClash),
      true,
      "module 'test.module' flag is stored under 'test.module' key"
    );

    // Regression tests for pruneFlags with sub-options: ensure options survive pruning
    const moduleWithOpts = {
      meta: {
        id: "subjectRegistration",
        name: "Tárgyfelvétel",
        description: "Test",
        options: [
          { id: "sortFilter", name: "Sort", defaultEnabled: true },
          { id: "compactView", name: "Compact", defaultEnabled: false },
        ],
      },
    };

    // Sub-option differing from default survives pruneFlags.
    const flagsOverridden = {
      subjectRegistration: true,
      "subjectRegistration.sortFilter": false, // Differs from defaultEnabled:true
      "subjectRegistration.compactView": true, // Differs from defaultEnabled:false
    };
    const prunedOverridden = settings.pruneFlags(flagsOverridden, [moduleWithOpts]);
    assert.strictEqual(
      prunedOverridden["subjectRegistration.sortFilter"],
      false,
      "sub-option overriding defaultEnabled:true survives pruneFlags"
    );
    assert.strictEqual(
      prunedOverridden["subjectRegistration.compactView"],
      true,
      "sub-option overriding defaultEnabled:false survives pruneFlags"
    );

    // Sub-option matching default is dropped by pruneFlags.
    const flagsDefaults = {
      subjectRegistration: true,
      "subjectRegistration.sortFilter": true, // Matches defaultEnabled:true
      "subjectRegistration.compactView": false, // Matches defaultEnabled:false
    };
    const prunedDefaults = settings.pruneFlags(flagsDefaults, [moduleWithOpts]);
    assert.strictEqual(
      prunedDefaults["subjectRegistration.sortFilter"],
      undefined,
      "sub-option matching defaultEnabled:true is dropped by pruneFlags"
    );
    assert.strictEqual(
      prunedDefaults["subjectRegistration.compactView"],
      undefined,
      "sub-option matching defaultEnabled:false is dropped by pruneFlags"
    );

    // Orphaned option key (module no longer exists) is dropped by pruneFlags.
    const flagsOrphaned = {
      "deletedModule.someOption": true,
      "subjectRegistration.sortFilter": false,
    };
    const prunedOrphaned = settings.pruneFlags(flagsOrphaned, [moduleWithOpts]);
    assert.strictEqual(
      prunedOrphaned["deletedModule.someOption"],
      undefined,
      "orphaned option key for non-existent module is dropped by pruneFlags"
    );
    assert.strictEqual(
      prunedOrphaned["subjectRegistration.sortFilter"],
      false,
      "valid sub-option key survives pruneFlags alongside orphaned keys"
    );
  } finally {
    Object.entries(previous).forEach(([name, value]) => restoreGlobal(name, value));
  }
}

// A colour is only CSS and is already on screen, so saving just a colour (or a
// switch flipped and flipped back) must not reload the page the user has open.
{
  const modules = [
    { meta: { id: "alpha" } },
    { meta: { id: "beta", defaultEnabled: false, options: [{ id: "opt" }] } },
    { meta: { id: "footer", required: true } },
  ];
  const saved = { alpha: false };
  assert.strictEqual(settings.needsReload(saved, { alpha: false }, modules), false, "nothing changed");
  assert.strictEqual(
    settings.needsReload(saved, { alpha: false, [settings.THEME_COLOR_KEY]: "#0f7a55" }, modules),
    false,
    "a colour-only change applies live"
  );
  assert.strictEqual(settings.needsReload(saved, { alpha: true }, modules), true, "a module switched back on");
  assert.strictEqual(settings.needsReload(saved, { alpha: false, beta: true }, modules), true, "an opt-in switched on");
  assert.strictEqual(settings.needsReload(saved, { alpha: false, "beta.opt": false }, modules), true, "an option");
  assert.strictEqual(settings.needsReload(saved, { alpha: false, footer: false }, modules), false, "required: no-op");
  assert.strictEqual(settings.needsReload({}, { alpha: true }, modules), false, "setting the default is not a change");
}

module.exports = { run };

// --- the panel's sections: fixed order, every real module in a known one ---
{
  const fs = require("fs");
  const path = require("path");
  const { groupModules, GROUPS } = require("../src/settingsPanel");
  const fake = (id, group) => ({ meta: { id, group } });
  assert.deepStrictEqual(
    groupModules([fake("a", "comfort"), fake("b", "registration"), fake("c", "nope"), fake("d", "registration")]).map(
      section => [section.name, section.modules.map(m => m.meta.id)]
    ),
    [
      ["Tárgyfelvétel", ["b", "d"]],
      ["Megjelenés és kényelem", ["a"]],
      ["Egyéb", ["c"]],
    ],
    "sections keep the README's order, not the registry's; an unknown group is still shown"
  );
  const known = new Set(GROUPS.map(group => group.id));
  const indexSource = fs.readFileSync(path.join(__dirname, "../src/index.js"), "utf8");
  const modulePaths = Array.from(indexSource.matchAll(/require\("\.\/(modules\/[^"]+)"\)/g), m => m[1]);
  assert.ok(modulePaths.length > 10, "the registry was read");
  modulePaths.forEach(modulePath => {
    const { meta } = require(path.join(__dirname, "../src", modulePath));
    assert.ok(known.has(meta.group), `${meta.id} belongs to a panel section`);
    // The panel tells where each feature shows up; a new one must say it too.
    [meta].concat(meta.options || []).forEach(entry => {
      assert.ok(typeof entry.where === "string" && entry.where.trim(), `${meta.id}.${entry.id} says where it is`);
    });
  });
}
