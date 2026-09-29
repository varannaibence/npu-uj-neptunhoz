// "Mérőmód": masked samples of the Neptun answers nobody has measured yet - a
// successful SubjectSignin, a real "full" rejection, SubjectSignout, CourseChange and
// SystemParameters. Only listens: the page's own requests and the Rajtoló's both pass
// through the interceptor, so a registration made by hand is recorded just the same.
// Kept in the NPU's own store, so a reload after the registration does not lose it;
// nothing leaves the browser unless the student copies it out of the panel.
//
// Masking keeps the SHAPE and drops the values: keys, booleans, null and small numbers
// stay; GUIDs, dates, other strings and large numbers become placeholders. The one
// exception is the server's message text (notification[], and a top-level error's
// title/detail), which is the very unknown this exists for: kept, through
// devlog.maskText. The Authorization header in the interceptor's metadata is never
// read.
const interceptor = require("../../interceptor");
const storage = require("../../storage");
const utils = require("../../utils");
const devlog = require("../../devlog");
const { showToast } = require("../../toast");

const ENDPOINTS = /^SubjectApplication\/(SubjectSignin|SubjectSignout|CourseChange|SystemParameters)$/;
const STORE_KEY = "apiSamples";
const MAX_SAMPLES = 30;
// Enough of an array or a course map to show its element shape.
const MAX_ITEMS = 3;
const MAX_DEPTH = 8;
// Counts, limits and notification types carry the meaning; a number this large is
// more likely an id.
const MAX_PLAIN_NUMBER = 1000;
const GUID_ONLY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+)?(?:Z|[+-]\d{2}:?\d{2})?$/;
// Where the server puts its message text: notification[] anywhere, or an ASP.NET
// error body's own fields at the top level.
const NOTIFICATION_KEY = /^notifications?$/i;
const TOP_MESSAGE_KEY = /^(?:message|title|detail|errors)$/i;

// Pure. `inMessage` marks a subtree whose strings are the server's own text.
function maskValue(value, neptunCode, inMessage = false, depth = 0) {
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return inMessage || Math.abs(value) < MAX_PLAIN_NUMBER ? value : "<number>";
  }
  if (typeof value === "string") {
    if (inMessage) {
      return devlog.maskText(value, neptunCode);
    }
    if (value === "") {
      return "";
    }
    if (GUID_ONLY.test(value)) {
      return "<guid>";
    }
    return ISO_DATE.test(value) ? "<date>" : "<string>";
  }
  if (depth >= MAX_DEPTH || !value || typeof value !== "object") {
    return "<…>";
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map(item => maskValue(item, neptunCode, inMessage, depth + 1));
    if (value.length > MAX_ITEMS) {
      items.push(`<+${value.length - MAX_ITEMS}>`);
    }
    return items;
  }
  const masked = {};
  // A map keyed by course id (signedCourses) keeps its shape, not the ids.
  let guidKeys = 0;
  Object.keys(value).forEach(key => {
    let name;
    if (GUID_ONLY.test(key)) {
      guidKeys += 1;
      if (guidKeys > MAX_ITEMS) {
        return;
      }
      name = `<guid-${guidKeys}>`;
    } else {
      name = devlog.maskText(key, neptunCode);
    }
    const message = inMessage || NOTIFICATION_KEY.test(key) || (depth === 0 && TOP_MESSAGE_KEY.test(key));
    masked[name] = maskValue(value[key], neptunCode, message, depth + 1);
  });
  if (guidKeys > MAX_ITEMS) {
    masked[`<+${guidKeys - MAX_ITEMS}>`] = "<…>";
  }
  return masked;
}

// Reads only the endpoint and the status off the interceptor's metadata.
function sampleFor(json, info, neptunCode, host, today) {
  return {
    host: host || null,
    endpoint: info.endpoint,
    status: typeof info.status === "number" ? info.status : null,
    firstSeen: today,
    count: 1,
    body: maskValue(json, neptunCode),
  };
}

function signature(sample) {
  return JSON.stringify([sample.host, sample.endpoint, sample.status, sample.body]);
}

// Pure. The same masked answer again only counts; a new one is kept, the oldest
// dropped past MAX_SAMPLES.
function addSample(samples, sample) {
  const list = Array.isArray(samples) ? samples.filter(item => item && typeof item === "object") : [];
  const index = list.findIndex(item => signature(item) === signature(sample));
  if (index !== -1) {
    const next = list.slice();
    next[index] = Object.assign({}, list[index], { count: (Number(list[index].count) || 1) + 1 });
    return { samples: next, isNew: false };
  }
  return { samples: list.concat(sample).slice(-MAX_SAMPLES), isNew: true };
}

// Read once the store is ready.
function stored() {
  const samples = storage.get(STORE_KEY);
  return Array.isArray(samples) ? samples : [];
}

function clear() {
  return storage.set(STORE_KEY, null);
}

function record(json, info, menuLabel) {
  const sample = sampleFor(
    json,
    info,
    utils.getNeptunCode(),
    typeof location !== "undefined" ? location.host : null,
    new Date().toISOString().slice(0, 10)
  );
  return storage
    .whenReady()
    .then(() => {
      const result = addSample(stored(), sample);
      storage.set(STORE_KEY, result.samples);
      devlog.log("sample", `${sample.endpoint} HTTP ${sample.status}: ${result.isNew ? "új minta" : "ismétlődő"}`);
      if (result.isNew) {
        showToast(
          `Mérőmód: új minta (${sample.endpoint.split("/")[1]}, HTTP ${sample.status}). ` +
            `Megtekintés: Tampermonkey menü › „${menuLabel}”.`,
          "ok"
        );
      }
    })
    .catch(error => devlog.error("Mérőmód", error));
}

// Synchronous, like every interceptor handler: SystemParameters is among the first
// requests the registration page makes.
function install(menuLabel) {
  interceptor.onResponse(ENDPOINTS, (json, info) => record(json, info || {}, menuLabel));
}

module.exports = { ENDPOINTS, MAX_SAMPLES, maskValue, sampleFor, addSample, stored, clear, install };
