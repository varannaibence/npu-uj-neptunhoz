// The plan's data: what a subject and a course look like, what the plan holds, and
// every pure transformation of it. DOM-free and network-free, so selfcheck.js drives
// all of it directly.
const storage = require("../../storage");
const utils = require("../../utils");
const timetable = require("../../timetable");
const { PLANS_KEY, DEFAULT_DELAY_SECONDS, STATUS_KEY } = require("./constants");

const { toMinutes, normaliseSlot, courseSlots, slotsOverlap, findPlanConflicts } = timetable;

// Every field SubjectSignin needs, straight off the row. Accumulates into `into`, so
// subjects seen across separate page loads or filters are not lost.
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
        title: row.title,
        code: row.code,
        // Kept here so a plan subject's credit is never a second lookup away. 0 for a
        // missing or unparseable credit, never a guess.
        credit: Number(row.credit) || 0,
        type: (row.type && String(row.type).trim()) || "",
        // So plannedCredits can skip an already-registered subject, whose credit is
        // in registeredCredits already.
        isRegistered: row.isRegistered === true || row.isRegistered === "true",
      });
    }
  });
  return map;
}

// The label creditBreakdown.UNTYPED uses for a subject with no `type` at all. Kept as
// our own constant rather than importing that module, so the two must be changed
// together by hand.
const UNTYPED_CREDIT_TYPE = "Szabadon választható";

// Counts only `isRegistered` rows: the same response also carries merely-planned
// subjects, which would inflate this above what the header shows.
function registeredCredits(json) {
  const rows = (json && json.data) || [];
  const totals = new Map();
  rows.forEach(row => {
    if (!row || !(row.isRegistered === true || row.isRegistered === "true")) {
      return;
    }
    const type = (row.type && String(row.type).trim()) || UNTYPED_CREDIT_TYPE;
    totals.set(type, (totals.get(type) || 0) + (Number(row.credit) || 0));
  });
  return totals;
}

// Looked up through the live catalog rather than trusting the plan entry: a plan
// persisted before this feature existed carries no credit at all. A subject missing
// from the catalog contributes nothing; an already-registered one is skipped, since
// registeredCredits counts it.
function plannedCredits(plan, subjectCatalog) {
  const totals = new Map();
  const subjects = (plan && plan.subjects) || [];
  subjects.forEach(subject => {
    const record = subjectCatalog && subjectCatalog.get(subject.subjectId);
    if (!record || record.isRegistered) {
      return;
    }
    const type = record.type || UNTYPED_CREDIT_TYPE;
    totals.set(type, (totals.get(type) || 0) + (Number(record.credit) || 0));
  });
  return totals;
}

// Projected per-type total if the whole plan succeeded. A type on only one side still
// gets an entry, carrying just that side's number.
function mergeCredits(current, planned) {
  const merged = new Map(current);
  planned.forEach((credit, type) => {
    merged.set(type, (merged.get(type) || 0) + credit);
  });
  return merged;
}

// Sums a credits-by-type Map for the header line.
function totalCredits(totals) {
  let sum = 0;
  totals.forEach(credit => {
    sum += credit;
  });
  return sum;
}

// subjectId -> courseId -> {id, code, type, typeId, isFull, isSigned, isOnWaitingList,
// isRankingCourse, slots}. `type` is the group label; `typeId` is the measured,
// language-neutral group identity. `id` goes into SubjectSignin's courseIds[].
function collectCourses(json, into) {
  const map = into || new Map();
  const rows = (json && json.data) || [];
  rows.forEach(row => {
    if (!row || !row.id || !row.subjectId) {
      return;
    }
    const bySubject = map.get(row.subjectId) || new Map();
    bySubject.set(row.id, {
      id: row.id,
      code: row.code,
      type: row.type || "Egyéb",
      typeId:
        typeof row.comparationTypeId === "string" && row.comparationTypeId.trim() ? row.comparationTypeId.trim() : null,
      isFull: typeof row.isFull === "boolean" ? row.isFull : null,
      isSigned: typeof row.isSigned === "boolean" ? row.isSigned : null,
      isOnWaitingList: typeof row.isOnWaitingList === "boolean" ? row.isOnWaitingList : null,
      // A forecast for a new application, never the student's own status (invariant 5).
      willBeOnWaitingList: typeof row.willBeOnWaitingList === "boolean" ? row.willBeOnWaitingList : null,
      isRankingCourse: typeof row.isRankingCourse === "boolean" ? row.isRankingCourse : null,
      slots: courseSlots(row),
    });
    map.set(row.subjectId, bySubject);
  });
  return map;
}

// The shape <input type="datetime-local"> accepts. String-based, never a round-trip
// through `new Date()`: these dates arrive with no timezone suffix because they are
// already local wall-clock time, so parsing one would pass it through this machine's
// timezone and corrupt a value that never had one.
const DATETIME_LOCAL_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/;
function toDateTimeLocal(isoish) {
  const match = typeof isoish === "string" && DATETIME_LOCAL_RE.exec(isoish);
  return match ? match[1] : null;
}

// periodType and periodName are display text: shown for the human to read, never
// matched on to decide which period is "the" registration one. Listing every period
// and letting the user pick is independent of the label, and less code than
// guessing. Rows without a usable fromDate cannot be scheduled against anyway.
function collectPeriods(json) {
  const rows = (json && json.data) || [];
  return rows
    .map(row => {
      const fromDate = row && toDateTimeLocal(row.fromDate);
      if (!row || !row.periodId || !fromDate) {
        return null;
      }
      return {
        periodId: row.periodId,
        label: [row.periodType, row.periodName].filter(Boolean).join(" — ") || "Ismeretlen tárgyfelvételi időszak",
        fromDate,
        toDate: toDateTimeLocal(row.toDate),
      };
    })
    .filter(Boolean);
}

function periodLoadResult(json) {
  const status = Number(json && json[STATUS_KEY]);
  if (status === 401) {
    return {
      periods: [],
      reason: "auth-required",
      message: "A munkamenet lejárt. Jelentkezz be újra, majd töltsd újra az időszakokat.",
    };
  }
  const notifications = json && Array.isArray(json.notification) ? json.notification : null;
  const data = json && Array.isArray(json.data) ? json.data : null;
  const notificationText =
    notifications &&
    notifications
      .map(item => (item && typeof item.description === "string" ? item.description : ""))
      .filter(Boolean)
      .join(" ");
  if (notificationText && /bejelentkezés|munkamenet|session|unauthori[sz]ed|401/i.test(notificationText)) {
    return {
      periods: [],
      reason: "auth-required",
      message: "A munkamenet lejárt. Jelentkezz be újra, majd töltsd újra az időszakokat.",
    };
  }
  if (typeof status === "number" && !Number.isNaN(status) && status !== 0 && (status < 200 || status > 299)) {
    return {
      periods: [],
      reason: "api-error",
      message: "A Neptun nem tudta betölteni a tárgyfelvételi időszakokat.",
    };
  }
  if (!notifications || !data || notifications.length > 0) {
    return {
      periods: [],
      reason: "api-error",
      message: "Érvénytelen válasz érkezett a tárgyfelvételi időszakokról.",
    };
  }
  const periods = collectPeriods({ data });
  if (periods.length > 0) {
    return { periods, reason: null, message: null };
  }
  return {
    periods: [],
    reason: status >= 400 ? "api-error" : "empty",
    message:
      status >= 400
        ? "A Neptun nem tudta betölteni a tárgyfelvételi időszakokat."
        : "Ehhez a félévhez nem érkezett használható tárgyfelvételi időszak.",
  };
}

function emptyPlan(termId) {
  return { termId: termId || null, startAt: null, delaySeconds: DEFAULT_DELAY_SECONDS, subjects: [] };
}

function loadPlan(termId) {
  if (!utils.getNeptunCode()) {
    return emptyPlan(termId);
  }
  const stored = storage.getForUser(PLANS_KEY, termId);
  if (!stored || stored.termId !== termId || !Array.isArray(stored.subjects)) {
    return emptyPlan(termId);
  }
  const delay = Number(stored.delaySeconds);
  const subjects = stored.subjects
    .filter(subject => subject && typeof subject.subjectId === "string" && subject.subjectId)
    .map(subject => ({
      ...subject,
      groups: Array.isArray(subject.groups)
        ? subject.groups
            .filter(group => group && Array.isArray(group.ranking))
            .map(group => ({
              type: typeof group.type === "string" ? group.type : "",
              typeId: typeof group.typeId === "string" && group.typeId ? group.typeId : null,
              ranking: group.ranking.filter(id => typeof id === "string" && id),
            }))
            .filter(group => group.ranking.length > 0)
        : [],
    }));
  return {
    termId,
    startAt: typeof stored.startAt === "string" ? stored.startAt : null,
    delaySeconds: Number.isFinite(delay) && delay >= 1 ? delay : DEFAULT_DELAY_SECONDS,
    subjects,
  };
}

function savePlan(plan) {
  if (!plan || !plan.termId || !utils.getNeptunCode()) {
    return Promise.resolve(false);
  }
  try {
    return Promise.resolve(storage.setForUser(PLANS_KEY, plan.termId, plan))
      .then(Boolean)
      .catch(() => false);
  } catch (e) {
    return Promise.resolve(false);
  }
}

// Appended, so lowest priority. Immutable, like the rest of this section.
function addSubject(plan, subjectRecord) {
  if (plan.termId && subjectRecord.termId && plan.termId !== subjectRecord.termId) {
    return plan;
  }
  if (plan.subjects.some(s => s.subjectId === subjectRecord.subjectId)) {
    return plan;
  }
  const entry = Object.assign({}, subjectRecord, { groups: [] });
  return Object.assign({}, plan, { subjects: plan.subjects.concat(entry) });
}

function removeSubject(plan, subjectId) {
  return Object.assign({}, plan, { subjects: plan.subjects.filter(s => s.subjectId !== subjectId) });
}

// Prunes rankings against the courses that still exist and drops empty groups. Never
// ADDS a course: auto-ranking would put labs nobody wants to attend into the plan.
function pruneGroups(existingGroups, courses) {
  const live = new Map(courses.map(course => [course.id, course]));
  return (existingGroups || [])
    .map(group => {
      const ranking = (group.ranking || []).filter(id => live.has(id));
      const typeIds = new Set(ranking.map(id => live.get(id).typeId).filter(Boolean));
      const firstCourse = ranking.length > 0 ? live.get(ranking[0]) : null;
      return {
        type: group.type || (firstCourse && firstCourse.type) || "Egyéb",
        typeId: typeIds.size === 1 ? typeIds.values().next().value : group.typeId || null,
        ranking,
      };
    })
    .filter(group => group.ranking.length > 0);
}

function sameCourseGroup(group, course) {
  return course.typeId
    ? group.typeId === course.typeId || (!group.typeId && group.type === course.type)
    : !group.typeId && group.type === course.type;
}

// Creates the subject entry and its group on demand, cleaning up what is left empty.
// Immutable, so render() always sees a fresh object.
function toggleCourseInPlan(plan, subjectRecord, course) {
  // The plan starts without a termId, and has to adopt one here - otherwise save and
  // load use different keys and the plan reverts to empty on the next reload.
  if (plan.termId && subjectRecord.termId && plan.termId !== subjectRecord.termId) {
    return plan;
  }
  const base = plan.termId ? plan : Object.assign({}, plan, { termId: subjectRecord.termId || null });
  const existing = base.subjects.find(s => s.subjectId === subjectRecord.subjectId);
  const subject = existing || Object.assign({}, subjectRecord, { groups: [] });
  const group = subject.groups.find(g => sameCourseGroup(g, course)) || {
    type: course.type,
    typeId: course.typeId || null,
    ranking: [],
  };
  const selected = group.ranking.includes(course.id);

  const ranking = selected ? group.ranking.filter(id => id !== course.id) : group.ranking.concat(course.id);
  const groups = subject.groups
    .filter(g => g !== group)
    .concat(ranking.length > 0 ? [{ type: course.type, typeId: course.typeId || group.typeId || null, ranking }] : []);

  const nextSubject = Object.assign({}, subject, { groups });
  const others = base.subjects.filter(s => s.subjectId !== subjectRecord.subjectId);
  // A subject with nothing ranked would only resolve to "unconfigured" at run time.
  const subjects =
    groups.length === 0
      ? others
      : existing
        ? base.subjects.map(s => (s === existing ? nextSubject : s))
        : others.concat(nextSubject);
  return Object.assign({}, base, { subjects });
}

function isCourseInPlan(plan, subjectId, courseId) {
  const subject = plan.subjects.find(s => s.subjectId === subjectId);
  return Boolean(subject && subject.groups.some(g => g.ranking.includes(courseId)));
}

// Behind every up/down button. Icon buttons rather than drag-and-drop, because the
// CDK's drag-drop cannot be cloned the way a button can.
function moveUp(list, index) {
  if (index <= 0 || index >= list.length) {
    return list;
  }
  const copy = list.slice();
  const tmp = copy[index - 1];
  copy[index - 1] = copy[index];
  copy[index] = tmp;
  return copy;
}

function moveDown(list, index) {
  return moveUp(list, index + 1);
}

// Swaps two courses inside the group that ranks both. By id, not by index: the dialog
// lists a pruned copy of each ranking (courses that no longer exist are left out), so
// a position on screen is not a position in the stored ranking. Reordering that copy
// changed nothing that was saved.
function swapCourses(plan, subjectId, courseId, otherId) {
  if (!courseId || !otherId || courseId === otherId) {
    return plan;
  }
  let changed = false;
  const subjects = plan.subjects.map(subject => {
    if (subject.subjectId !== subjectId) {
      return subject;
    }
    const groups = subject.groups.map(group => {
      const a = group.ranking.indexOf(courseId);
      const b = group.ranking.indexOf(otherId);
      if (a === -1 || b === -1) {
        return group;
      }
      const ranking = group.ranking.slice();
      ranking[a] = otherId;
      ranking[b] = courseId;
      changed = true;
      return Object.assign({}, group, { ranking });
    });
    return Object.assign({}, subject, { groups });
  });
  return changed ? Object.assign({}, plan, { subjects }) : plan;
}

module.exports = {
  collectSubjects,
  collectCourses,
  collectPeriods,
  periodLoadResult,
  registeredCredits,
  plannedCredits,
  mergeCredits,
  totalCredits,
  toMinutes,
  normaliseSlot,
  slotsOverlap,
  findPlanConflicts,
  toDateTimeLocal,
  emptyPlan,
  loadPlan,
  savePlan,
  addSubject,
  removeSubject,
  pruneGroups,
  toggleCourseInPlan,
  sameCourseGroup,
  isCourseInPlan,
  moveUp,
  moveDown,
  swapCourses,
  UNTYPED_CREDIT_TYPE,
};
