// Shows the NPU name + version on the login page.
//
// Establishes the pattern every later module reuses: never hardcode a colour or an
// Angular `_ngcontent-*`/`_nghost-*` hash - clone an existing element instead, which
// drags its real classes and scoping hash along for free.
const utils = require("../utils");
const npuLogo = require("../logo");

const ROUTE = "/hallgato_ng/login";
// A real class, not a hashed one.
const SUBMIT_SELECTOR = "button.login-right__submit, form button[type=submit]";
const PROJECT_URL = "https://github.com/varannaibence/npu-uj-neptunhoz";

// Shown in the settings panel; `id` is also the key the switch is stored under.
const meta = {
  id: "loginBanner",
  group: "comfort",
  name: "Jelzés a bejelentkező oldalon",
  where: "A bejelentkező oldalon, a belépés alatt",
  description: "Kiírja az NPU nevét és verzióját a bejelentkező oldalon.",
};

function shouldActivate() {
  return location.pathname === ROUTE;
}

// Split out so it is checkable without a DOM.
function bannerText(version) {
  return `Neptun PowerUp! v${version}`;
}

// The clone is wrapped in a link rather than made clickable: an anchor gets
// middle-click, "open in new tab" and screen readers right where a click handler
// would not. The clone is inert so the anchor takes the click.
function buildBanner(submitButton, text) {
  const doc = submitButton.ownerDocument;
  const reference = utils.cloneButton(submitButton);
  const label = doc.createElement("span");
  label.className = reference.className;
  Array.from(reference.attributes || []).forEach(attribute => {
    if (attribute.name !== "id" && attribute.name !== "type") {
      label.setAttribute(attribute.name, attribute.value);
    }
  });
  label.classList.remove("primary");
  label.style.cssText = reference.style.cssText;
  label.style.pointerEvents = "none";
  label.style.display = "block";
  label.style.width = "100%";
  label.style.textAlign = "center";
  // Only the text is dimmed; a faded logo looks broken.
  const caption = doc.createElement("span");
  caption.textContent = text;
  caption.style.opacity = "0.6";
  label.textContent = "";
  label.appendChild(npuLogo.icon(doc, 18));
  label.appendChild(caption);

  const link = doc.createElement("a");
  link.href = PROJECT_URL;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.style.cssText = "display:block;margin-top:8px;text-decoration:none";
  link.appendChild(label);
  return link;
}

// Only the submit button's own parent is touched, and every step is guarded: a
// layout mismatch means no banner, never a throw during Angular's boot.
function mount() {
  const submit = document.querySelector(SUBMIT_SELECTOR);
  if (!submit || !submit.parentElement || document.getElementById("npu-login-banner")) {
    return false;
  }
  try {
    const banner = buildBanner(submit, bannerText(GM.info.script.version));
    banner.id = "npu-login-banner";
    submit.parentElement.insertBefore(banner, submit.nextSibling);
    // Only a real insert counts as mounted. Reporting success from outside the try
    // meant a swallowed error still told initialize() to disconnect its observer,
    // and the banner then never appeared at all.
    return true;
  } catch (e) {
    return false;
  }
}

function initialize() {
  if (mount()) {
    return;
  }
  // Nothing is painted at document-start, so wait for it.
  const observer = new MutationObserver(() => {
    if (mount()) {
      observer.disconnect();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

module.exports = {
  meta,
  shouldActivate,
  initialize,
  bannerText,
  buildBanner,
};
