const fs = require("fs");
const path = require("path");

const START = "<!-- releases:start -->";
const END = "<!-- releases:end -->";
const README_PATH = path.join(__dirname, "..", "README.md");
const CHANGELOG_PATH = path.join(__dirname, "..", "docs", "CHANGELOG.md");

function stableReleases(releases) {
  if (!Array.isArray(releases)) {
    throw new Error("The release input must be a JSON array.");
  }
  return releases
    .filter(release => release && release.draft !== true && release.prerelease !== true && release.tag_name)
    .slice(0, 3);
}

function inlineText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function encodeSegment(value) {
  return encodeURIComponent(String(value));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function publishedDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("hu-HU", {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "Europe/Budapest",
      }).format(date);
}

function changelogNotes(changelog, tagName) {
  const version = String(tagName).replace(/^v/i, "");
  const heading = new RegExp(`^##\\s+v?${escapeRegExp(version)}(?:\\s|$)[^\\n]*$`, "im");
  const match = heading.exec(changelog);
  if (!match) {
    return "";
  }
  const section = changelog.slice(match.index + match[0].length);
  const nextHeading = section.search(/^##\s+/m);
  return section.slice(0, nextHeading < 0 ? section.length : nextHeading).trim();
}

const NEXT_HEADING = /^##\s+Következő kiadás[^\n]*$/im;

// The changelog is written under "## Következő kiadás" between releases. At release
// time that section becomes the version's own, with a fresh empty one above it, so
// changelogNotes finds it. The heading carries a `v<version>` anchor (GitHub's
// documented custom anchor), which the update notice links to. Unchanged when the
// version already has a section or there is nothing waiting to be released.
function promoteNextRelease(changelog, version, date) {
  const plain = String(version).replace(/^v/i, "");
  const existing = new RegExp(`^##\\s+v?${escapeRegExp(plain)}(?:\\s|$)`, "im");
  const match = NEXT_HEADING.exec(changelog);
  if (!match || existing.test(changelog)) {
    return changelog;
  }
  const bodyStart = match.index + match[0].length;
  const rest = changelog.slice(bodyStart);
  const nextHeading = rest.search(/^##\s+/m);
  const bodyEnd = nextHeading < 0 ? changelog.length : bodyStart + nextHeading;
  const notes = changelog.slice(bodyStart, bodyEnd).trim();
  if (!notes) {
    return changelog;
  }
  const promoted = `${match[0]}\n\n## ${plain} — ${date} <a name="v${plain}"></a>\n\n${notes}\n\n`;
  return `${changelog.slice(0, match.index)}${promoted}${changelog.slice(bodyEnd)}`;
}

function rewriteChangelogLinks(notes) {
  return notes.replace(/\]\(([^)\s]+)([^)]*)\)/g, (match, target, suffix) => {
    if (/^(?:[a-z][a-z\d+.-]*:|[/#])/i.test(target)) {
      return match;
    }
    const anchorIndex = target.search(/[?#]/);
    const pathname = anchorIndex < 0 ? target : target.slice(0, anchorIndex);
    const anchor = anchorIndex < 0 ? "" : target.slice(anchorIndex);
    return `](${path.posix.normalize(path.posix.join("docs", pathname))}${anchor}${suffix})`;
  });
}

function releaseNotes(release, changelog) {
  const changelogRelease = changelogNotes(changelog, release.tag_name);
  const notes = changelogRelease ? rewriteChangelogLinks(changelogRelease) : String(release.body || "").trim();
  return (notes || "Nincs külön kiadási megjegyzés.")
    .replace(/<!--\s*releases:(?:start|end)\s*-->/gi, "")
    .replace(/<\/details>/gi, "");
}

function renderReleaseBlock(releases, repository, changelog = "") {
  const cards = stableReleases(releases).map((release, index) => {
    const tag = inlineText(release.tag_name);
    const releaseUrl =
      release.html_url || `https://github.com/${repository}/releases/tag/${encodeSegment(release.tag_name)}`;
    const installUrl = `https://github.com/${repository}/releases/download/${encodeSegment(release.tag_name)}/npu.user.js`;
    return [
      `<details${index === 0 ? " open" : ""}>`,
      `<summary><strong>${tag}</strong> · ${publishedDate(release.published_at)}</summary>`,
      "",
      releaseNotes(release, changelog),
      "",
      `[Release megnyitása](${releaseUrl}) · [Telepítés](${installUrl})`,
      "",
      "</details>",
    ].join("\n");
  });

  const body = cards.length ? cards : ["Még nincs publikált stabil kiadás."];
  return [
    START,
    "## Legfrissebb kiadások",
    "",
    "A legutóbbi három stabil kiadás. A **Telepítés** link Tampermonkey mellett",
    "közvetlenül telepíthető.",
    "",
    ...body,
    "",
    `[Összes kiadás megtekintése](https://github.com/${repository}/releases)`,
    END,
  ].join("\n");
}

function replaceReleaseBlock(source, replacement) {
  const start = source.indexOf(START);
  const end = source.indexOf(END, start + START.length);
  if (start < 0 || end < 0) {
    throw new Error("README.md is missing the release sync markers.");
  }
  return `${source.slice(0, start)}${replacement}${source.slice(end + END.length)}`;
}

function syncReadme(releases, repository, readmePath, changelog = "") {
  const source = fs.readFileSync(readmePath, "utf8");
  const next = replaceReleaseBlock(source, renderReleaseBlock(releases, repository, changelog));
  if (next !== source) {
    fs.writeFileSync(readmePath, next);
    return true;
  }
  return false;
}

if (require.main === module && process.argv[2] === "--promote") {
  // Run by the release workflow before the README sync: node tools/sync-releases.js --promote 3.0.3
  try {
    const changelog = fs.readFileSync(CHANGELOG_PATH, "utf8");
    const next = promoteNextRelease(changelog, process.argv[3], publishedDate(new Date()));
    if (next !== changelog) {
      fs.writeFileSync(CHANGELOG_PATH, next);
    }
    console.log(next !== changelog ? "CHANGELOG release section created." : "CHANGELOG already current.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
} else if (require.main === module) {
  try {
    const repository = process.env.GITHUB_REPOSITORY || "varannaibence/npu-uj-neptunhoz";
    const releases = JSON.parse(fs.readFileSync(0, "utf8"));
    const changelog = fs.readFileSync(CHANGELOG_PATH, "utf8");
    const changed = syncReadme(releases, repository, README_PATH, changelog);
    console.log(changed ? "README release list updated." : "README release list already current.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  END,
  START,
  changelogNotes,
  promoteNextRelease,
  publishedDate,
  renderReleaseBlock,
  replaceReleaseBlock,
  stableReleases,
};
