// NPU's name and a bug-report link in the site footer, next to Neptun's own logo.
// Neptun's "Hiba- és igénybejelentés" mails the university, which is the wrong
// address for a userscript bug, so ours sits beside it and goes to the issue tracker.
//
// The footer is a grid auto-placing children into "logo | informations | page control",
// so a fourth child would break the row. Ours shares the logo's
// cell: the logo moves into a flex row inserted as the FIRST child.
const settingsPanel = require("../settingsPanel");
const npuLogo = require("../logo");

const CONTENT_SELECTOR = ".footer__content";
const LOGO_SELECTOR = ".footer__logo";
// Cloned, so ours inherits the real colour, focus ring and scoping hash.
const REPORT_SELECTOR = "a.footer__report";
const ROW_ID = "npu-footer-brand";
const ISSUES_URL = "https://github.com/varannaibence/npu-uj-neptunhoz/issues";
const PROJECT_URL = "https://github.com/varannaibence/npu-uj-neptunhoz";

// Shown in the settings panel; `id` is also the key the switch is stored under.
const meta = {
  id: "footerBranding",
  group: "comfort",
  name: "Lábléc és beállítások",
  where: "Minden oldal alján, a láblécben",
  description: "Az NPU neve, a hibabejelentő és a beállítások a lap alján. Ezen keresztül éred el ezt a panelt.",
  required: true,
};

function shouldActivate() {
  return true;
}

// Carries the version: the first thing a bug report needs, the last thing anyone
// remembers to include.
function brandText(version) {
  return `Neptun PowerUp! v${version}`;
}

function buildBrand(doc, version) {
  const link = doc.createElement("a");
  link.href = PROJECT_URL;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  const text = doc.createElement("span");
  text.textContent = brandText(version);
  text.style.opacity = ".75";
  link.appendChild(npuLogo.icon(doc, 16));
  link.appendChild(text);
  // The footer's own type scale; opacity rather than a second colour keeps the
  // text quieter than Neptun's links without inventing one. The icon stays solid.
  link.style.cssText = "color:inherit;font-size:13px;text-decoration:none;white-space:nowrap";
  return link;
}

// That link is rendered conditionally, so fall back to a plain anchor.
function buildIssuesLink(doc, reference) {
  const link = reference ? reference.cloneNode(true) : doc.createElement("a");
  link.removeAttribute("id");
  link.href = ISSUES_URL;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "NPU hibabejelentés";
  if (!reference) {
    link.style.cssText = "color:inherit;font-size:13px";
  }
  // The clone carries a negative left margin that only made sense where it sat.
  link.style.marginLeft = "0";
  link.style.whiteSpace = "nowrap";
  return link;
}

// The way in to the module switches. Cloned from the issues link so it still looks
// like the footer, but it opens a dialog rather than going anywhere.
function buildSettingsLink(doc, reference) {
  const link = buildIssuesLink(doc, reference);
  link.removeAttribute("href");
  link.removeAttribute("target");
  link.removeAttribute("rel");
  link.setAttribute("role", "button");
  link.setAttribute("tabindex", "0");
  link.style.cursor = "pointer";
  link.textContent = "NPU beállítások";
  link.addEventListener("click", event => {
    event.preventDefault();
    settingsPanel.open();
  });
  link.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      settingsPanel.open();
    }
  });
  return link;
}

// Measured on one institution's build; every step is guarded, so a different layout
// means no branding rather than a throw or a mangled footer.
function mount() {
  const content = document.querySelector(CONTENT_SELECTOR);
  if (!content || document.getElementById(ROW_ID)) {
    return Boolean(content && document.getElementById(ROW_ID));
  }
  const logo = content.querySelector(LOGO_SELECTOR);
  if (!logo) {
    return false;
  }
  try {
    const doc = content.ownerDocument;
    const row = doc.createElement("div");
    row.id = ROW_ID;
    row.style.cssText = "display:flex;align-items:center;gap:16px;flex-wrap:wrap";
    // First child, so grid auto-placement gives it the cell the logo used to hold.
    content.insertBefore(row, content.firstChild);
    row.appendChild(logo);
    row.appendChild(buildBrand(doc, GM.info.script.version));
    const reportLink = content.querySelector(REPORT_SELECTOR);
    row.appendChild(buildIssuesLink(doc, reportLink));
    row.appendChild(buildSettingsLink(doc, reportLink));
    return true;
  } catch (e) {
    return false;
  }
}

function initialize() {
  // The footer is absent at document-start and can be torn down and rebuilt. A
  // throttled observer covers both; mount() is a no-op once ours is in place, which
  // is what keeps this from retriggering itself.
  let scheduled = false;
  function scheduleTick() {
    if (scheduled) {
      return;
    }
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      mount();
    }, 0);
  }
  mount();
  new MutationObserver(scheduleTick).observe(document.documentElement, { childList: true, subtree: true });
}

module.exports = {
  meta,
  shouldActivate,
  initialize,
  brandText,
  buildBrand,
  buildIssuesLink,
  buildSettingsLink,
};
