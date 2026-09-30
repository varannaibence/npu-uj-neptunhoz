// One click, one subject: a fresh course list, the plan's pick in each group, one
// SubjectSignin - the same two requests a registration by hand makes. If the course
// just sent turns out full, the next-ranked one goes, within MAX_ATTEMPTS. Every
// request is injected (`deps.get`, `deps.post`), so each path is testable with fakes.
const { collectCourses } = require("./plan");
const { preselection, listProblem, signinOutcome, submissionOutcome } = require("./protocol");
const { MAX_ATTEMPTS, STATUS_KEY } = require("./constants");
const { isHalted } = require("./net");

function coursesOf(list, subject) {
  return collectCourses(list).get(subject.subjectId) || new Map();
}

// Any course of the subject taken or queued on: a registration would be a second one.
function holdsAnyCourse(courseIndex) {
  return Array.from(courseIndex.values()).some(course => course.isSigned === true || course.isOnWaitingList === true);
}

// `deps`: get(subject), post(subject, courseIds), report(text) for the live step, and
// stopped() - the route or the user changed - which ends the click before any request.
async function registerSubject(subject, state, deps) {
  const record = state.subjectCatalog.get(subject.subjectId);
  if (record && record.isRegistered) {
    return { kind: "held" };
  }
  deps.report("Friss kurzuslista…");
  let list = await deps.get(subject);
  // Courses that filled while this click ran: never sent again, the next one goes.
  const filled = new Set();
  const filledCodes = [];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (deps.stopped() || isHalted(list)) {
      return { kind: "stopped" };
    }
    const problem = listProblem(list);
    if (problem) {
      return { kind: "failed", message: problem };
    }
    const courseIndex = coursesOf(list, subject);
    if (holdsAnyCourse(courseIndex)) {
      return { kind: "held" };
    }
    const choice = preselection(subject.groups, courseIndex, state.plan.waitlistMode, filled);
    if (choice.kind === "held" || choice.kind === "unconfigured") {
      return { kind: choice.kind };
    }
    const empty = choice.picks.filter(pick => !pick.courseId).map(pick => pick.group.type || "Egyéb");
    if (empty.length > 0) {
      return { kind: "incomplete", empty, filled: filledCodes };
    }
    const courseIds = choice.picks.map(pick => pick.courseId);
    const codes = courseIds.map(id => courseIndex.get(id).code || "Ismeretlen kurzus");
    deps.report(
      `${filledCodes.length > 0 ? `${filledCodes.join(", ")} betelt, jöhet ` : "Felvétel: "}${codes.join(", ")}…`
    );
    const answer = await deps.post(subject, courseIds);
    if (isHalted(answer)) {
      return { kind: "stopped" };
    }
    const outcome = Object.assign({ codes }, signinOutcome(answer, answer && answer[STATUS_KEY], courseIds));
    if (outcome.kind === "registered" || outcome.kind === "waitlisted") {
      return outcome;
    }
    // Unclear or refused: one read of the list, where only measured fields decide.
    list = await deps.get(subject);
    const after = listProblem(list) || isHalted(list) ? null : coursesOf(list, subject);
    const confirmed = after && submissionOutcome(after, courseIds);
    if (confirmed) {
      return Object.assign(outcome, { kind: confirmed, message: "" });
    }
    // Only a refusal whose course the list now shows full moves on. A timeout never
    // does: that registration may still go through.
    const nowFull =
      outcome.kind === "rejected" && after
        ? courseIds.filter(id => after.get(id) && after.get(id).isFull === true)
        : [];
    if (nowFull.length === 0) {
      return outcome;
    }
    nowFull.forEach(id => {
      filled.add(id);
      filledCodes.push(after.get(id).code || "Ismeretlen kurzus");
    });
  }
  return {
    kind: "failed",
    message: `${MAX_ATTEMPTS} kurzus is betelt közben (${filledCodes.join(", ")}). Válassz kézzel a Neptunban.`,
  };
}

module.exports = { registerSubject };
