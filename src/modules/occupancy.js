// Course and subject occupancy on the subject-registration page.
//
// Named for what it does now. It began as "hideFullCourses" and hid them; hiding
// turned out to be exactly wrong during a registration rush, so nothing is hidden
// any more - the badges and the sort carry the same information without it. Two things from
// one source: a badge per course row, a badge per subject row, and a toggle
// that sorts loaded course rows with room first.
//
// Full courses are never hidden. During registration a place can free up in seconds,
// so hiding a full course hides exactly what the user is watching for.
const interceptor = require("../interceptor");
const router = require("../router");
const storage = require("../storage");
const utils = require("../utils");
const badge = require("../badge");
const registrationData = require("../registrationData");

const ROUTE = "/hallgato_ng/subjects/registration";
const STORAGE_KEY = "occupancyEnabled";
const TOGGLE_ID = "npu-hide-full-toggle";
const TOGGLE_LABEL = "Betelt kurzusok hátra";
// Measured, stable: <button id="filter-table" class="filter-button flat primary ...">
const FILTER_BUTTON_ID = "filter-table";

// The course row - the same element the Rajtoló decorates. An earlier version
// climbed to "the nearest ancestor with a checkbox", which landed on the <article>
// inside the row. That is its row's only child, so every sort group had one member
// and nothing could ever move.
const ROW_SELECTOR = "neptun-course-list-item";
const CODE_BLOCK_SELECTOR = ".code-with-time__code";
const BADGE_FLAG = "data-npu-occupancy";

// The same pair the Rajtoló hangs its count on, so the two badges line up.
const SUBJECT_ROW_SELECTOR = "neptun-subject-list-item";
const SUBJECT_STATUS_SELECTOR = ".status";
const SUBJECT_BADGE_FLAG = "data-npu-subject-occupancy";
const SUBJECT_BADGE_HOST_FLAG = "data-npu-subject-occupancy-host";

// code -> { isFull, registered, limit }. Taken from GetSubjectsCourses, never from
// the rendered text: native labels are page-controlled, so reading them would silently
// couple the data path to the page copy. Codes and integers are language-neutral.
const cache = {
  termId: null,
  courseState: new Map(),
  // subjectId -> { subjectId, termId, curriculumTemplateId, curriculumTemplateLineId, code }
  subjectCatalog: new Map(),
  // subjectId -> { total, full }
  subjectSummary: new Map(),
};
const courseState = cache.courseState;
const subjectCatalog = cache.subjectCatalog;
const subjectSummary = cache.subjectSummary;

// The order rows were in before we touched them, so the toggle can be turned off
// without a reload. Keyed by container.
const naturalOrder = new WeakMap();

// Shown in the settings panel; `id` is also the key the switch is stored under.
const meta = {
  id: "occupancy",
  group: "registration",
  name: "Férőhely és betelt állapot",
  where: "Tárgyak › Tárgyfelvétel: a lenyitott tárgy kurzusainál, és a „Betelt kurzusok hátra” gomb a szűrők mellett",
  description:
    "Férőhelyet és betelt/várólista állapotot ír a betöltött kurzusokra, és előre rendezi azokat, amikre még lehet jelentkezni.",
};

function shouldActivate() {
  return true;
}

function resetCache(state, termId) {
  const nextTermId = termId || null;
  if (state.termId === nextTermId && nextTermId !== null) {
    return false;
  }
  state.termId = nextTermId;
  state.courseState.clear();
  state.subjectCatalog.clear();
  state.subjectSummary.clear();
  return true;
}

function responseTermId(json, info) {
  const rows = (json && json.data) || [];
  const row = rows.find(item => item && item.termId);
  if (row) {
    return String(row.termId);
  }
  const match = /(?:\?|&)termId=([^&]+)/.exec((info && info.url) || "");
  return match ? decodeURIComponent(match[1]) : null;
}

function acceptsResponse(json, info) {
  const termId = responseTermId(json, info);
  if (!termId) {
    return true;
  }
  const activeTermId = registrationData.getSnapshot().termId;
  return !activeTermId || activeTermId === termId;
}

// Field names measured off a live response. Course codes repeat across subjects
// ("01"), so a code two subjects share maps to null: no badge beats another
// subject's headcount.
function collectCourseStates(json, into) {
  const states = into || new Map();
  const rows = (json && json.data) || [];
  rows.forEach(row => {
    if (row && row.code) {
      const code = String(row.code).trim().toUpperCase();
      const subjectId = row.subjectId || null;
      const existing = states.get(code);
      if (existing === null || (existing && existing.subjectId !== subjectId)) {
        states.set(code, null);
        return;
      }
      states.set(code, {
        subjectId,
        isFull: typeof row.isFull === "boolean" ? row.isFull : null,
        willBeOnWaitingList: typeof row.willBeOnWaitingList === "boolean" ? row.willBeOnWaitingList : null,
        registered: typeof row.registeredStudentsCount === "number" ? row.registeredStudentsCount : null,
        limit: typeof row.maxLimit === "number" ? row.maxLimit : null,
      });
    }
  });
  return states;
}

// The four ids a GetSubjectsCourses request needs; every SchedulableSubjects row
// carries all four.
function collectSubjects(json, into) {
  const map = into || new Map();
  const rows = (json && json.data) || [];
  rows.forEach(row => {
    if (row && row.id) {
      map.set(row.id, {
        subjectId: row.id,
        termId: row.termId,
        curriculumTemplateId: row.curriculumTemplateId,
        curriculumTemplateLineId: row.curriculumTemplateLineId,
        code: row.code ? String(row.code).trim().toUpperCase() : "",
      });
    }
  });
  return map;
}

// subjectId comes off the rows, not the request URL, so this works for the native
// response that arrives when the user expands a subject.
function summarizeCourses(json) {
  const rows = (json && json.data) || [];
  const perSubject = new Map();
  rows.forEach(row => {
    if (!row || !row.subjectId) {
      return;
    }
    const entry = perSubject.get(row.subjectId) || { total: 0, full: 0 };
    entry.total += 1;
    // Waiting-list-only counts as gone: no seat left either way.
    const state = { isFull: row.isFull, willBeOnWaitingList: row.willBeOnWaitingList };
    const seat = seatState(state);
    if (seat === null) {
      entry.unknown = (entry.unknown || 0) + 1;
    } else {
      entry.full += seatsGone(state) ? 1 : 0;
    }
    perSubject.set(row.subjectId, entry);
  });
  return perSubject;
}

// The headcount and only the headcount - saying "Betelt" collided with Neptun's own
// badge in the same row. The colour carries "full", and the numbers say it anyway.
// Null when there is no headcount, rather than inventing one.
function occupancyLabel(state) {
  if (!state || typeof state.registered !== "number" || typeof state.limit !== "number") {
    return null;
  }
  return `${state.registered} / ${state.limit}`;
}

// NOT what the field name suggests: `isFull` alone once called a full course free.
// One shared reading, so the badge, the table and the Rajtoló never disagree.
const { seatState } = registrationData;

// A queue place is not a seat. The sort key, and what the subject badge counts.
function seatsGone(state) {
  const seat = seatState(state);
  return seat === "full" || seat === "waitlist";
}

// Amber for the waiting list: neither "go ahead" nor "give up".
function courseVariant(state) {
  const seat = seatState(state);
  if (seat === "full") {
    return "full";
  }
  return seat === "waitlist" ? "partial" : "neutral";
}

// A subject with no courses gets nothing: "0 / 0 betelt" would be noise, and outside
// a registration period that is most of them.
function subjectLabel(summary) {
  if (!summary || !summary.total || summary.unknown > 0) {
    return null;
  }
  if (summary.full >= summary.total) {
    return "Betelt";
  }
  return `${summary.full} / ${summary.total} betelt`;
}

// The sort key for the subject list.
function isSubjectFull(summary) {
  return Boolean(summary && !summary.unknown && summary.total > 0 && summary.full >= summary.total);
}

// Nothing taken green, some taken amber, all taken red. Null when there is no badge.
function subjectVariant(summary) {
  if (!summary || !summary.total || summary.unknown > 0) {
    return null;
  }
  if (summary.full >= summary.total) {
    return "full";
  }
  return summary.full > 0 ? "partial" : "free";
}

// The first leaf whose text is a code we hold data for. An exact match rather than a
// regexp guess: course and subject codes differ per institution.
function codeIn(row, codes) {
  const leaf = Array.from(row.querySelectorAll("*")).find(
    el => el.children.length === 0 && codes.has(el.textContent.trim().toUpperCase())
  );
  return leaf ? leaf.textContent.trim().toUpperCase() : null;
}

function courseCodeIn(row, states) {
  return codeIn(row, states);
}

// Rows with room first, each keeping its relative order. Returns the same array when
// nothing moves, so callers can skip the DOM - which stops the observer retriggering.
function sortCourses(entries, enabled) {
  if (!enabled) {
    return entries;
  }
  const open = entries.filter(entry => !entry.isFull);
  const full = entries.filter(entry => entry.isFull);
  const sorted = open.concat(full);
  const unchanged = sorted.every((entry, i) => entry === entries[i]);
  return unchanged ? entries : sorted;
}

// The anchor must be the sibling after whichever row is currently LAST in the DOM,
// not after the last row of the NEW order: that one is itself about to move, and
// `insertBefore(node, node)` silently no-ops, which stranded a row at the end.
function reorder(parent, rows) {
  const lastInDom = rows.reduce((latest, row) =>
    latest.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING ? row : latest
  );
  const anchor = lastInDom.nextSibling;
  rows.forEach(row => parent.insertBefore(row, anchor));
}

// Not the snapshot itself: Angular streams rows in, so a snapshot can be a prefix of
// what is on screen, and reordering that stale subset scrambled the rest. Removed
// rows drop out; rows added since keep their current order at the end.
function restoreOrder(snapshot, current) {
  const live = new Set(current);
  const known = new Set(snapshot);
  return snapshot.filter(row => live.has(row)).concat(current.filter(row => !known.has(row)));
}

// A container we never touched needs no restoring, and its DOM order still IS the
// natural one - so its snapshot can be refreshed as rows arrive, never going stale.
const sortedParents = new WeakSet();

// Remembers the order before we first touched it, so the toggle can undo itself.
function applyOrder(groups, enabled) {
  groups.forEach((entries, parent) => {
    const current = entries.map(entry => entry.row);
    if (!enabled && !sortedParents.has(parent)) {
      naturalOrder.set(parent, current);
      return;
    }
    if (!naturalOrder.has(parent)) {
      naturalOrder.set(parent, current);
    }
    const target = enabled
      ? sortCourses(entries, true).map(entry => entry.row)
      : restoreOrder(naturalOrder.get(parent), current);
    if (enabled) {
      sortedParents.add(parent);
    } else {
      sortedParents.delete(parent);
    }
    if (target.length === current.length && target.every((row, i) => row === current[i])) {
      return;
    }
    reorder(parent, target);
  });
}

// "betelt" and "várólistás" are different enough to be worth saying in words.
function courseTitle(state) {
  const seat = seatState(state);
  if (seat === "full") {
    return "A kurzus betelt, nem lehet rá jelentkezni";
  }
  if (seat === "waitlist") {
    return `Nincs szabad hely - jelentkezni lehet, de várólistára kerülsz (${state.registered}/${state.limit})`;
  }
  return `Jelentkezett: ${state.registered}, férőhely: ${state.limit}`;
}

function applyCourses(root, enabled) {
  // Per group - the blocks sit in separate parents - so sorting never moves a course
  // out of its own group.
  const groups = new Map();
  Array.from(root.querySelectorAll(ROW_SELECTOR)).forEach(row => {
    const code = courseCodeIn(row, courseState);
    if (code === null || !row.parentElement) {
      return;
    }
    const state = courseState.get(code);
    badge.paint(
      row,
      row.querySelector(CODE_BLOCK_SELECTOR),
      BADGE_FLAG,
      occupancyLabel(state),
      courseVariant(state),
      state && courseTitle(state)
    );
    const list = groups.get(row.parentElement) || [];
    list.push({ row, isFull: seatsGone(state) });
    groups.set(row.parentElement, list);
  });
  applyOrder(groups, enabled);
}

function applySubjects(root) {
  if (subjectSummary.size === 0) {
    return;
  }
  const codeToId = new Map();
  subjectCatalog.forEach((record, subjectId) => {
    if (record.code && subjectSummary.has(subjectId)) {
      codeToId.set(record.code, subjectId);
    }
  });
  if (codeToId.size === 0) {
    return;
  }

  Array.from(root.querySelectorAll(SUBJECT_ROW_SELECTOR)).forEach(row => {
    const code = codeIn(row, codeToId);
    if (code === null) {
      return;
    }
    const summary = subjectSummary.get(codeToId.get(code));
    const full = isSubjectFull(summary);
    const status = row.querySelector(SUBJECT_STATUS_SELECTOR);
    if (!status) {
      return;
    }
    let host = status.querySelector(`[${SUBJECT_BADGE_HOST_FLAG}]`);
    if (!host) {
      host = status.ownerDocument.createElement("span");
      host.setAttribute(SUBJECT_BADGE_HOST_FLAG, "");
      host.style.display = "inline-flex";
      host.style.minWidth = "max-content";
      host.style.whiteSpace = "nowrap";
      status.appendChild(host);
    }
    badge.paint(
      row,
      host,
      SUBJECT_BADGE_FLAG,
      subjectLabel(summary),
      subjectVariant(summary),
      full ? "Minden kurzusa betelt" : `${summary.full} betelt kurzus ${summary.total} közül`
    );
  });
}

function apply(root, enabled) {
  applyCourses(root, enabled);
  applySubjects(root);
}

// Read fresh every time, never snapshotted into a local: storage.js loads
// asynchronously while initialize() runs at document-start, so a snapshot always read
// `undefined` and the toggle came up OFF whatever the user had left it on.
function isEnabled() {
  return Boolean(storage.get(STORAGE_KEY));
}

// Cloned for its real classes and scoping hash; reusing the existing "primary" class
// as the on/off indicator avoids inventing a colour.
function buildToggle(referenceButton, enabled) {
  const toggle = utils.cloneButton(referenceButton);
  toggle.id = TOGGLE_ID;
  utils.setButtonLabel(toggle, TOGGLE_LABEL);
  utils.markNpu(toggle, "A betelt kurzusok a lista végére kerülnek");
  paintToggle(toggle, enabled);
  return toggle;
}

// Safe from the observer's tick: attribute/class writes only, and the observer
// watches childList, so these cannot feed it.
function paintToggle(toggle, enabled) {
  toggle.classList.toggle("primary", enabled);
  toggle.classList.toggle("lightgrey", !enabled);
  toggle.setAttribute("aria-pressed", String(enabled));
}

// Only the button's id/class is measured, not the panel around it, so every DOM
// touch is guarded: a mismatch means no toggle, not a throw.
function initialize() {
  registrationData.install();
  registrationData.subscribe(snapshot => resetCache(cache, snapshot.termId));

  interceptor.onResponse("SubjectApplication/SchedulableSubjects", (json, info) => {
    if (
      router.getPath() !== ROUTE ||
      !registrationData.isSuccessfulCollection(json, info && info.status) ||
      !acceptsResponse(json, info)
    ) {
      return;
    }
    const termId = responseTermId(json, info);
    if (termId) {
      resetCache(cache, termId);
    }
    collectSubjects(json, subjectCatalog);
    apply(document, isEnabled());
  });

  // Courses arrive one subject at a time, so the maps accumulate.
  interceptor.onResponse("SubjectApplication/GetSubjectsCourses", (json, info) => {
    if (
      router.getPath() !== ROUTE ||
      !registrationData.isSuccessfulCollection(json, info && info.status) ||
      !acceptsResponse(json, info)
    ) {
      return;
    }
    const termId = responseTermId(json, info);
    if (termId) {
      resetCache(cache, termId);
    }
    collectCourseStates(json, courseState);
    summarizeCourses(json).forEach((summary, subjectId) => subjectSummary.set(subjectId, summary));
    apply(document, isEnabled());
  });

  router.onChange(path => {
    if (path !== ROUTE) {
      resetCache(cache, null);
    }
  });

  function mount() {
    const filterButton = document.getElementById(FILTER_BUTTON_ID);
    if (!filterButton || !filterButton.parentElement) {
      return;
    }
    try {
      const toggle = buildToggle(filterButton, isEnabled());
      toggle.addEventListener("click", () => {
        const enabled = !isEnabled();
        storage.set(STORAGE_KEY, enabled);
        paintToggle(toggle, enabled);
        apply(document, enabled);
        utils.setButtonLabel(toggle, TOGGLE_LABEL);
      });
      // The search button is the native primary action; placing this before it keeps
      // the optional control in the same responsive action group.
      filterButton.parentElement.insertBefore(toggle, filterButton);
    } catch (e) {
      // fail quietly
    }
  }

  // One throttled observer rather than router.onChange: the toggle and the rows both
  // come and go with Angular's rendering. apply() is a no-op once the badges and the
  // order are right, which keeps this from retriggering itself.
  let scheduled = false;
  function tick() {
    scheduled = false;
    if (location.pathname !== ROUTE) {
      return;
    }
    const toggle = document.getElementById(TOGGLE_ID);
    if (!toggle) {
      mount();
    } else {
      // The button may have been built before storage.js finished loading.
      paintToggle(toggle, isEnabled());
    }
    apply(document, isEnabled());
  }
  function scheduleTick() {
    if (scheduled) {
      return;
    }
    scheduled = true;
    setTimeout(tick, 0);
  }

  new MutationObserver(scheduleTick).observe(document.documentElement, { childList: true, subtree: true });
}

module.exports = {
  meta,
  shouldActivate,
  initialize,
  isEnabled,
  occupancyLabel,
  seatState,
  seatsGone,
  courseVariant,
  subjectLabel,
  subjectVariant,
  isSubjectFull,
  summarizeCourses,
  collectSubjects,
  sortCourses,
  restoreOrder,
  collectCourseStates,
  courseCodeIn,
  resetCache,
};
