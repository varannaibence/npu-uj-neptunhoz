// The developer log: a ring buffer of what the NPU saw and did - API traffic, auth
// changes, routes, swallowed errors, Rajtoló steps. A no-op until the developer module
// turns it on, and then memory-only: a reload empties it, and nothing is written to
// storage or sent anywhere. Callers pass only what may go into a bug report: endpoint
// names, statuses, durations - never a query string, a token or personal data.
//
// No requires: interceptor, router and utils log into it, so it cannot depend on them.
const MAX_ENTRIES = 1000;

let enabled = false;
let entries = [];
let serverOffset = () => 0;
const listeners = new Set();

// `offset` returns the server clock's offset, so entries carry server time: the
// Rajtoló's opening is a server-clock instant.
function enable(offset) {
  enabled = true;
  if (typeof offset === "function") {
    serverOffset = offset;
  }
}

function isEnabled() {
  return enabled;
}

function notify() {
  listeners.forEach(listener => {
    try {
      listener();
    } catch (e) {
      // A viewer must not break logging.
    }
  });
}

function log(kind, message, fields) {
  if (!enabled) {
    return;
  }
  // The log must never break what it logs.
  try {
    const at = Date.now();
    entries.push({ at, serverAt: at + (Number(serverOffset()) || 0), kind, message: String(message), fields });
    if (entries.length > MAX_ENTRIES) {
      entries.splice(0, entries.length - MAX_ENTRIES);
    }
    notify();
  } catch (e) {
    // Nowhere left to report it.
  }
}

// For the catch blocks that keep one observer's failure from breaking the page:
// silent in normal use, visible here.
function error(where, err) {
  const message = err && err.message ? err.message : String(err);
  const frames = err && typeof err.stack === "string" ? err.stack.split("\n") : [];
  // V8 repeats "Error: <message>" as the stack's first line; the entry says it already.
  if (frames.length > 0 && frames[0].includes(message)) {
    frames.shift();
  }
  const stack = frames.slice(0, 3).join("\n");
  log("error", `${where}: ${message}`, stack ? { stack } : undefined);
}

// Masks what could identify someone in a text meant for the log or a bug report:
// GUIDs, the Neptun code, e-mail addresses and runs of 3+ digits. Pure.
const GUID_ANY = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
function maskText(text, neptunCode) {
  let masked = String(text).replace(GUID_ANY, "<guid>");
  // Before the digit runs: a code like ABC123 would otherwise survive as ABC<n>.
  const code = String(neptunCode || "").replace(/[^A-Za-z0-9]/g, "");
  if (code) {
    masked = masked.replace(new RegExp(code, "gi"), "<neptun-code>");
  }
  return masked.replace(/[^\s@()<>,;]+@[^\s@()<>,;]+\.[A-Za-z]{2,}/g, "<email>").replace(/\d{3,}/g, "<n>");
}

function getEntries() {
  return entries.slice();
}

function clear() {
  entries = [];
  notify();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

module.exports = { MAX_ENTRIES, enable, isEnabled, log, error, maskText, getEntries, clear, subscribe };
