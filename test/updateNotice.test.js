const assert = require("assert");
const updateNotice = require("../src/modules/updateNotice");

// --- updateNotice: one notice after Tampermonkey updated the script ---
assert.deepStrictEqual(updateNotice.parseVersion("3.0.10"), [3, 0, 10]);
assert.deepStrictEqual(updateNotice.parseVersion("v3.1.0"), [3, 1, 0], "a tag-style v prefix is accepted");
assert.strictEqual(updateNotice.parseVersion("<version>"), null, "an unbuilt placeholder is not a version");
assert.strictEqual(updateNotice.parseVersion(undefined), null);

assert.strictEqual(updateNotice.isNewer("3.0.10", "3.0.9"), true, "compared as numbers, not as text");
assert.strictEqual(updateNotice.isNewer("3.1.0", "3.0.9"), true);
assert.strictEqual(updateNotice.isNewer("3.0.3", "3.0.3"), false);
assert.strictEqual(updateNotice.isNewer("3.0.2", "3.0.3"), false, "a downgrade is not an update");

assert.strictEqual(updateNotice.shouldAnnounce("3.0.2", "3.0.3"), true, "an actual update is announced");
assert.strictEqual(updateNotice.shouldAnnounce(undefined, "3.0.3"), false, "a first install is not announced");
assert.strictEqual(updateNotice.shouldAnnounce("3.0.3", "3.0.3"), false, "the same version never again");
assert.strictEqual(updateNotice.shouldAnnounce("garbage", "3.0.3"), false, "unreadable stored data stays quiet");

assert.strictEqual(updateNotice.noticeText("3.0.3"), "Neptun PowerUp! frissült: v3.0.3.");
assert.strictEqual(
  updateNotice.changelogUrl("3.0.3"),
  "https://github.com/varannaibence/npu-uj-neptunhoz/blob/master/docs/CHANGELOG.md#v3.0.3",
  "the link opens that version's section of the changelog"
);
{
  const { promoteNextRelease } = require("../tools/sync-releases");
  const anchor = updateNotice.changelogUrl("3.0.3").split("#")[1];
  assert.ok(
    promoteNextRelease("## Következő kiadás\n\n- x\n", "3.0.3", "ma").includes(`<a name="${anchor}"></a>`),
    "the release workflow writes exactly the anchor the notice links to"
  );
}
assert.strictEqual(updateNotice.meta.id, "updateNotice");
