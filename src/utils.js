// The Neptun code of the current user. The new UI hands it to us in the API
// response, so index.js feeds it in and storage.js reads it back out.
let neptunCode = null;
const neptunCodeListeners = new Set();

// Null before one has been captured.
function getNeptunCode() {
  return neptunCode;
}

function onNeptunCodeChange(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }
  neptunCodeListeners.add(listener);
  return () => neptunCodeListeners.delete(listener);
}

function setNeptunCode(code) {
  const next = code ? String(code).toUpperCase() : null;
  if (next === neptunCode) {
    return;
  }
  const previous = neptunCode;
  neptunCode = next;
  neptunCodeListeners.forEach(listener => {
    try {
      listener(next, previous);
    } catch (e) {
      // One observer must not break identity capture for the page or other modules.
    }
  });
}

// Finds a property by name anywhere in a nested response body. A recursive scan
// because only Account/Authenticate's shape is measured; pin it to an exact path
// once UserInfo's body is known too.
function findProp(value, name, depth = 0) {
  if (depth > 5 || !value || typeof value !== "object") {
    return undefined;
  }
  if (!Array.isArray(value) && typeof value[name] !== "undefined" && value[name] !== null) {
    return value[name];
  }
  for (const key of Object.keys(value)) {
    const found = findProp(value[key], name, depth + 1);
    if (typeof found !== "undefined") {
      return found;
    }
  }
}

function getDomain() {
  const host = location.host.split(".");
  const tlds = "at co com edu eu gov hu hr info int mil net org ro rs sk si ua uk".split(" ");
  let domain = "";
  for (let i = host.length - 1; i >= 0; i--) {
    domain = `${host[i]}.${domain}`;
    if (!tlds.includes(host[i])) {
      return domain.substr(0, domain.length - 1);
    }
  }
}

function runAsync(func) {
  window.setTimeout(func, 0);
}

const FORBIDDEN_PATH_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isSafePath(path) {
  return (
    Array.isArray(path) &&
    path.length > 0 &&
    path.every(key => {
      if (typeof key !== "string" && typeof key !== "number") {
        return false;
      }
      return !FORBIDDEN_PATH_KEYS.has(String(key));
    })
  );
}

function hasOwn(parent, key) {
  return Object.prototype.hasOwnProperty.call(parent, key);
}

// Own-property traversal is deliberate: inherited names are not stored data, and
// consulting them would make a polluted prototype observable through this helper.
function deepGetProp(o, s) {
  if (!isSafePath(s)) {
    return;
  }
  let c = o;
  for (const n of s) {
    if (!(c !== null && typeof c === "object" && hasOwn(c, n))) {
      return;
    }
    c = c[n];
  }
  return c;
}

// Validates the whole path before mutating anything, so a forbidden segment cannot
// leave a partially-created prefix behind. False on every unsafe path.
function deepSetProp(o, s, v) {
  if (!isSafePath(s)) {
    return false;
  }

  let c = o;
  for (let i = 0; i < s.length; i++) {
    const n = s[i];
    if (!(c !== null && typeof c === "object")) {
      return false;
    }
    if (i === s.length - 1) {
      if (v === null) {
        delete c[n];
      } else {
        c[n] = v;
      }
      return true;
    }
    if (!hasOwn(c, n)) {
      c[n] = {};
    } else if (c[n] === null || typeof c[n] !== "object") {
      return false;
    }
    c = c[n];
  }
  return false;
}

// Clones one of the page's own buttons so ours inherits the real styling and the
// Angular scoping hash. Strips transient state, not styling:
//   - id, which would end up duplicated
//   - type=submit, which would submit the original's form
//   - disabled: Angular disables buttons while a form is pristine or a request is in
//     flight, and a clone taken at that moment stays dead forever
//   - the `loading` class: `.flat.loading::before` swaps the caption for a spinner
//
// The last two shipped as bugs - an unclickable button, then a permanent spinner -
// so they are stripped here once, not at each call site.
function cloneButton(source) {
  // Deep, and this matters: the caption lives in a `.neptun-button__label` span, and
  // the host's own `color` equals its background. Clone shallowly, write text onto
  // the host, and you get an invisible caption. Always relabel via setButtonLabel().
  const clone = source.cloneNode(true);
  clone.removeAttribute("id");
  clone.removeAttribute("disabled");
  clone.disabled = false;
  clone.type = "button";
  if (clone.classList) {
    clone.classList.remove("loading");
    clone.classList.remove("disabled");
  }
  // A clone of one of our own marked buttons is not that feature: drop the mark.
  if (clone.hasAttribute && clone.hasAttribute("data-npu-feature")) {
    clone.removeAttribute("data-npu-feature");
    clone.removeAttribute("title");
  }
  Array.from((clone.querySelectorAll && clone.querySelectorAll("svg[data-npu-icon]")) || []).forEach(icon =>
    icon.remove()
  );
  return clone;
}

// Writing to the host instead would destroy the component's inner markup and leave
// the text in the host's own colour - the background colour. See cloneButton.
function setButtonLabel(button, text) {
  const label = button.querySelector && button.querySelector(".neptun-button__label");
  // A relabel keeps the NPU mark; writing textContent alone would wipe it.
  const mark = button.querySelector && button.querySelector("svg[data-npu-icon]");
  const host = label || button;
  host.textContent = text;
  if (mark) {
    host.insertBefore(mark, host.firstChild);
  }
}

// Every control the NPU adds to a Neptun page carries the same sign: the NPU icon
// before its caption and a tooltip saying so, so nobody takes it for Neptun's own -
// or reports its bugs to their university. Idempotent.
function markNpu(element, what) {
  if (!element || !element.setAttribute) {
    return element;
  }
  element.setAttribute("data-npu-feature", "");
  element.title = what ? `${what} – NPU-funkció` : "NPU-funkció";
  if (!element.querySelector("svg[data-npu-icon]")) {
    const icon = require("./logo").icon(element.ownerDocument || document, 16);
    icon.setAttribute("data-npu-icon", "");
    const label = element.querySelector(".neptun-button__label");
    const host = label || captionParent(element) || element;
    host.insertBefore(icon, host.firstChild);
  }
  return element;
}

// Where a caption's text sits when there is no `.neptun-button__label`: a cloned
// switch keeps it in a nested span.
function captionParent(root) {
  const walker = (root.ownerDocument || document).createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue && node.nodeValue.trim()) {
      return node.parentNode;
    }
  }
  return null;
}

function injectCss(css) {
  const style = document.createElement("style");
  style.textContent = css;
  // Userscripts run at document-start so Angular's first request can be intercepted;
  // at that point <html> exists but <head> is not guaranteed to. Styling must not
  // make early module initialization throw and prevent every later module loading.
  const host = document.head || document.documentElement;
  if (host) {
    host.appendChild(style);
  }
  return style;
}

// Parses a subject code in parentheses at the end of a string.
function parseSubjectCode(source) {
  const str = source.trim();
  if (str.charAt(str.length - 1) === ")") {
    let depth = 0;
    for (let i = str.length - 2; i >= 0; i--) {
      const c = str.charAt(i);
      if (depth === 0 && c === "(") {
        return str.substring(i + 1, str.length - 1);
      }
      depth = c === ")" ? depth + 1 : depth;
      depth = c === "(" && depth > 0 ? depth - 1 : depth;
    }
  }
  return null;
}

function isPassingGrade(str) {
  return [
    "jeles",
    "excellent",
    "jó",
    "good",
    "közepes",
    "satisfactory",
    "elégséges",
    "pass",
    "kiválóan megfelelt",
    "excellent",
    "megfelelt",
    "average",
  ].some(function (item) {
    return str.toLowerCase().indexOf(item) !== -1;
  });
}

function isFailingGrade(str) {
  return [
    "elégtelen",
    "fail",
    "nem felelt meg",
    "unsatisfactory",
    "nem jelent meg",
    "did not attend",
    "nem vizsgázott",
    "did not attend",
  ].some(function (item) {
    return str.toLowerCase().indexOf(item) !== -1;
  });
}

module.exports = {
  getNeptunCode,
  onNeptunCodeChange,
  setNeptunCode,
  findProp,
  deepGetProp,
  deepSetProp,
  injectCss,
  cloneButton,
  setButtonLabel,
  markNpu,
  runAsync,
  parseSubjectCode,
  isPassingGrade,
  isFailingGrade,
  getDomain,
};
