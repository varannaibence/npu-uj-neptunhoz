// Breaks the header's "Felvett kredit" total down by subject type, inside the app's
// own card. The values are read from the response, so the breakdown can be checked
// against the native total without embedding account-specific figures.
//
// ScheduledSubjectsWithScheduledCourses returns the term's registered AND merely
// planned subjects, so only isRegistered rows are counted - the planned ones are what
// make its raw total disagree with the header.
const interceptor = require("../interceptor");
const router = require("../router");
const registrationData = require("../registrationData");
const tokens = require("../neptunTokens");

const API_BASE = "/hallgato_ng/api/";
const ROUTE = "/hallgato_ng/subjects/registration";
const ENDPOINT = "SubjectApplication/ScheduledSubjectsWithScheduledCourses";
const SUBJECTS_ENDPOINT = "SubjectApplication/SchedulableSubjects";
// The INNER div, not the <neptun-credit-counter> host: the div carries the
// background, radius and padding; the host is transparent. Appending to the host put
// the breakdown outside the card instead of extending it.
const CARD_SELECTOR = "neptun-credit-counter div.credit-counter";
const LABEL_CLASS = "credit-counter__text";
const LIST_ID = "npu-credit-breakdown";
// Subjects outside the curriculum come back with NO type at all, and still count
// toward the header's total, so they cannot be dropped. Folding them into "Szabadon
// választható" is OUR inference, not something the server says - hence the tooltip.
const UNTYPED = "Szabadon választható";
const UNTYPED_NOTE =
  "A Neptun ezekre nem ad tárgytípust (mintatanterven kívüli tárgyak) - a kreditjük itt a szabadon választhatóhoz számít.";

// Shown in the settings panel; `id` is also the key the switch is stored under.
const meta = {
  id: "creditBreakdown",
  group: "comfort",
  name: "Kreditbontás a fejlécben",
  where: "Tárgyak › Tárgyfelvétel: a fejléc „Felvett kredit” kártyája",
  description: "A felvett kreditet tárgytípusonként bontja a Neptun saját kártyáján.",
  // This module issues the ScheduledSubjectsWithScheduledCourses GET that two other
  // modules only listen to. Switching it off silently takes their data with it, so
  // the panel warns rather than letting the user find out by the feature vanishing.
  provides: ["scheduledSubjects"],
};

function shouldActivate() {
  return true;
}

function resetState(state, termId) {
  const nextTermId = termId || null;
  if (state.termId === nextTermId && nextTermId !== null) {
    return false;
  }
  state.termId = nextTermId;
  state.totals = new Map();
  state.asked = false;
  return true;
}

function termIdFromUrl(url) {
  const match = /(?:\?|&)request\.termId=(\d+)(?:&|$)/.exec(url || "");
  return match ? match[1] : null;
}

// Credits per subject type, counting only what is actually registered.
function breakdown(json) {
  const rows = (json && json.data) || [];
  const totals = new Map();
  rows.forEach(row => {
    if (!row || !(row.isRegistered === true || row.isRegistered === "true")) {
      return;
    }
    const type = (row.type && String(row.type).trim()) || UNTYPED;
    totals.set(type, (totals.get(type) || 0) + (Number(row.credit) || 0));
  });
  return totals;
}

// Reuses the card's own label class, so font and colour come from their stylesheet.
function paint(card, totals) {
  let list = card.querySelector(`#${LIST_ID}`);
  const text = Array.from(totals)
    .map(([type, credit]) => `${type} ${credit}`)
    .join("\n");
  if (totals.size === 0) {
    if (list) {
      list.remove();
    }
    return;
  }
  if (!list) {
    list = document.createElement("div");
    list.id = LIST_ID;
    // The card is already flex and centred; this only adds the divider and stacking.
    list.style.cssText =
      "display:flex;flex-direction:column;justify-content:center;gap:1px;" +
      "padding-left:12px;border-left:1px solid rgba(33,48,85,.1);" +
      `border-left:1px solid color-mix(in srgb, ${tokens.text} 10%, transparent);white-space:nowrap`;
    card.appendChild(list);
  }
  // Only rebuild when the numbers change: an unconditional rewrite is a mutation the
  // observer that drives this would see, and it would repaint forever.
  if (list.getAttribute("data-npu-state") === text) {
    return;
  }
  list.setAttribute("data-npu-state", text);
  list.textContent = "";
  totals.forEach((credit, type) => {
    const line = document.createElement("span");
    line.className = LABEL_CLASS;
    line.style.cssText = "font-size:11px;line-height:1.25";
    line.textContent = `${type}: `;
    const value = document.createElement("b");
    value.textContent = String(credit);
    line.appendChild(value);
    if (type === UNTYPED) {
      line.title = UNTYPED_NOTE;
    }
    list.appendChild(line);
  });
}

function initialize() {
  const state = { totals: new Map(), termId: null, asked: false };

  function clearPainted() {
    const card = document.querySelector(CARD_SELECTOR);
    if (card) {
      paint(card, new Map());
    }
  }

  function reset(termId) {
    if (resetState(state, termId)) {
      clearPainted();
    }
  }

  // Taken from a request the app makes itself. This endpoint wants the NUMERIC term
  // id from the query string, not the GUID that appears in response bodies.
  interceptor.onRequest(SUBJECTS_ENDPOINT, url => {
    if (router.getPath() !== ROUTE) {
      return;
    }
    const nextTermId = termIdFromUrl(url);
    if (nextTermId && nextTermId !== state.termId) {
      reset(nextTermId);
      // Deferred, because this handler runs inside the app's own XMLHttpRequest.open():
      // opening a second XHR right there nests our request in Angular's call stack for
      // no reason at all - the term id is already captured, and nothing downstream
      // needs the GET to have started before open() returns.
      setTimeout(fetchOnce, 0);
    }
  });

  interceptor.onResponse(ENDPOINT, (json, info) => {
    const responseTermId = termIdFromUrl(info && info.url);
    if (
      router.getPath() !== ROUTE ||
      !registrationData.isSuccessfulCollection(json, info && info.status) ||
      !responseTermId ||
      responseTermId !== state.termId
    ) {
      return;
    }
    state.totals = breakdown(json);
    tick();
  });

  // One extra GET per page load, only after the app has shown us a term.
  function fetchOnce() {
    if (state.asked || !state.termId || router.getPath() !== ROUTE) {
      return;
    }
    const auth = interceptor.getAuthHeader();
    if (!auth) {
      return;
    }
    state.asked = true;
    const xhr = new XMLHttpRequest();
    // Ours, not the page's: Neptun's logout countdown does not see it.
    xhr.__npuOwn = true;
    xhr.open("GET", `${API_BASE}${ENDPOINT}?request.termId=${state.termId}&request.withRegisteredSubjects=true`);
    xhr.setRequestHeader("Authorization", auth);
    xhr.timeout = 30000;
    xhr.send();
  }

  function tick() {
    if (router.getPath() !== ROUTE) {
      return;
    }
    const card = document.querySelector(CARD_SELECTOR);
    if (card) {
      paint(card, state.totals);
    }
  }

  router.onChange(path => {
    if (path !== ROUTE) {
      reset(null);
    }
  });

  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) {
      return;
    }
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      fetchOnce();
      tick();
    }, 0);
  }).observe(document.documentElement, { childList: true, subtree: true });
}

module.exports = {
  meta,
  shouldActivate,
  initialize,
  breakdown,
  resetState,
  termIdFromUrl,
};
