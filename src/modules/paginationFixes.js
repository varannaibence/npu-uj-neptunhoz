const interceptor = require("../interceptor");

// How many rows to ask for instead of the default page size
const PAGE_SIZE = 500;
const TARGET_ENDPOINT = "SubjectApplication/SchedulableSubjects";
const TARGET_PATH = `/hallgato_ng/api/${TARGET_ENDPOINT}`;

// The API pages with absolute row indices, so the window is moved rather than
// capped - that keeps the offset meaningful on pages after the first.
function widen(url, endpoint) {
  if (endpoint ? endpoint !== TARGET_ENDPOINT : typeof url !== "string" || url.indexOf(TARGET_PATH) === -1) {
    return;
  }
  if (url.indexOf("sortAndPage.lastRow=") === -1) {
    return;
  }
  const firstRow = parseInt((/sortAndPage\.firstRow=(\d+)/.exec(url) || [])[1] || "0", 10);
  return url.replace(/sortAndPage\.lastRow=\d+/, `sortAndPage.lastRow=${firstRow + PAGE_SIZE}`);
}

// Shown in the settings panel; `id` is also the key the switch is stored under.
const meta = {
  id: "pagination",
  group: "registration",
  name: "Hosszabb listák",
  where: "Tárgyak › Tárgyfelvétel: a tárgylista",
  description: "Egy lapon jóval több sort tölt be, így kevesebbet kell lapozni.",
};

module.exports = {
  meta,
  shouldActivate: () => true,
  initialize: () => {
    // Only the measured subject catalogue is widened. Unknown paginated endpoints
    // keep Neptun's own page size and response contract.
    interceptor.onRequest(TARGET_ENDPOINT, widen);
  },
  widen,
};
