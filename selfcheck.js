// Self-check for the browser wrappers and the pure module decisions.
// Run with `node selfcheck.js`, or `npm test`.
//
// No framework and no fixtures: each *.test.js file under test/ runs its assertions
// the moment it is required, and exports `run()` for whatever has to be awaited.
const fs = require("fs");
const path = require("path");
const assert = require("assert");

// Before anything else pulls it in: the keep-alive module must not load the dialog.
// Its refresh is silent; the other modules stay free to use dialogs of their own.
require("./src/modules/infiniteSession");
assert.strictEqual(
  require.cache[require.resolve("./src/modal")],
  undefined,
  "infiniteSession must not load the NPU dialog"
);

const testDirectory = path.join(__dirname, "test");
const testFiles = fs
  .readdirSync(testDirectory, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith(".test.js"))
  .map(entry => entry.name)
  .sort()
  .map(name => path.join(testDirectory, name));
const tests = testFiles.map(file => ({ file, testModule: require(file) }));
const runnableTests = tests.filter(({ testModule }) => typeof testModule.run === "function");
const lastRunnableTests = runnableTests.filter(({ file }) => file === path.join(testDirectory, "rajtolo.test.js"));
const otherRunnableTests = runnableTests.filter(({ file }) => file !== path.join(testDirectory, "rajtolo.test.js"));

// Keep the engine checks last, as their fakes are async. All other .test.js files
// are loaded and run in deterministic filename order, so a new test cannot vanish
// just because this file was not updated.
const allRunnableTests = [...otherRunnableTests, ...lastRunnableTests];

// A rejection must exit non-zero, or a broken check would still look like a pass. So
// must a check that never settles: Node exits quietly with code 0 once nothing is
// left to run, which made a hung await look like a pass.
let finished = false;
process.on("exit", code => {
  if (!finished && code === 0) {
    console.error("selfcheck: an async check never finished");
    process.exitCode = 1;
  }
});
allRunnableTests
  .reduce((promise, { testModule }) => promise.then(() => testModule.run()), Promise.resolve())
  .then(
    () => {
      finished = true;
      console.log("selfcheck: OK");
    },
    error => {
      console.error(error);
      process.exit(1);
    }
  );
