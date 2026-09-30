// The plan's data: what a subject and a course look like, what the plan holds, and
// every pure transformation of it. DOM-free and network-free, so selfcheck.js drives
// all of it directly.
const storage = require("../../storage");
const utils = require("../../utils");
const timetable = require("../../timetable");
const { PLANS_KEY, WAITLIST_MODES, DEFAULT_WAITLIST_MODE } = require("./constants");

const { toMinutes, normaliseSlot, courseSlots, slotsOverlap, findPlanConflicts } = timetable;

// The subject's four ids (Neptun's register button is named after them), straight off
// the row. Accumulates into `into`, so subjects seen across separate page loads or
// filters are not lost.
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

// The header's own breakdown, so the forecast and the header can never disagree:
// registered rows only, and its label for a subject with no `type` at all.
const { breakdown: registeredCredits, UNTYPED: UNTYPED_CREDIT_TYPE } = require("../creditBreakdown");

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
// language-neutral group identity. `id` is the course's own id.
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

function emptyPlan(termId) {
  return {
    termId: termId || null,
    waitlistMode: DEFAULT_WAITLIST_MODE,
    subjects: [],
  };
}

function loadPlan(termId) {
  if (!utils.getNeptunCode()) {
    return emptyPlan(termId);
  }
  const stored = storage.getForUser(PLANS_KEY, termId);
  if (!stored || stored.termId !== termId || !Array.isArray(stored.subjects)) {
    return emptyPlan(termId);
  }
  const subjects = stored.subjects
    .filter(subject => subject && typeof subject.subjectId === "string" && subject.subjectId)
    .map(subject => ({
      ...subject,
      courses: storedCourses(subject.courses),
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
    waitlistMode: WAITLIST_MODES.includes(stored.waitlistMode) ? stored.waitlistMode : DEFAULT_WAITLIST_MODE,
    subjects,
  };
}

// What the plan keeps of each ranked course: its code and times, so the dialog can
// name it and check clashes without a request of its own. Seats are never stored;
// they come from the list Neptun shows at the click.
function courseNote(course) {
  return {
    code: typeof course.code === "string" ? course.code : "",
    slots: Array.isArray(course.slots) ? course.slots : [],
  };
}

function storedCourses(courses) {
  const kept = {};
  if (courses && typeof courses === "object") {
    Object.keys(courses).forEach(id => {
      if (courses[id] && typeof courses[id] === "object") {
        kept[id] = courseNote(courses[id]);
      }
    });
  }
  return kept;
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
  const entry = Object.assign({}, subjectRecord, { groups: [], courses: {} });
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
  const subject = existing || Object.assign({}, subjectRecord, { groups: [], courses: {} });
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

  const courses = Object.assign({}, subject.courses);
  if (selected) {
    delete courses[course.id];
  } else {
    courses[course.id] = courseNote(course);
  }
  const nextSubject = Object.assign({}, subject, { groups, courses });
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
  registeredCredits,
  plannedCredits,
  mergeCredits,
  totalCredits,
  toMinutes,
  normaliseSlot,
  slotsOverlap,
  findPlanConflicts,
  emptyPlan,
  loadPlan,
  courseNote,
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
