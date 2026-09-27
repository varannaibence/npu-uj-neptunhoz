// What the Rajtoló adds to the page itself: a switch on every course row and a count
// badge on every subject row.
const { toggleCourseInPlan, isCourseInPlan, savePlan } = require("./plan");
const { showToast } = require("../../toast");
const { render } = require("./ui");
const utils = require("../../utils");
const badge = require("../../badge");

// Records a subject from a GetSubjectsCourses request URL. That URL carries exactly
// the four ids SubjectSignin needs, so the row switch works without waiting for the
// subject to turn up in a SchedulableSubjects page.
function rememberSubjectFromUrl(state, url) {
  if (!url) {
    return;
  }
  let params;
  try {
    params = new URL(url, location.origin).searchParams;
  } catch (e) {
    return;
  }
  const subjectId = params.get("subjectId");
  if (!subjectId) {
    return;
  }
  const known = state.subjectCatalog.get(subjectId);
  if (known) {
    // A SchedulableSubjects row can arrive without some of the ids (seen on other
    // universities' Neptun). Without termId the plan cannot be saved and the switch
    // only ever shows an error, so fill the gaps from the request the app just made.
    ["termId", "curriculumTemplateId", "curriculumTemplateLineId"].forEach(key => {
      if (!known[key] && params.get(key)) {
        known[key] = params.get(key);
      }
    });
    return;
  }
  state.subjectCatalog.set(subjectId, {
    subjectId,
    termId: params.get("termId"),
    curriculumTemplateId: params.get("curriculumTemplateId"),
    curriculumTemplateLineId: params.get("curriculumTemplateLineId"),
    title: "Ismeretlen tárgy",
    code: "",
  });
}

const ROW_SELECTOR = "neptun-course-list-item";
const SLIDER_SELECTOR = "neptun-switch-slider";
const ROW_FLAG = "data-npu-rajtolo";
const TABLE_ROW_SELECTOR = "[data-npu-course-row]";
const TABLE_CODE_SELECTOR = "[data-npu-code-line]";
const TABLE_ACTIONS_SELECTOR = "[data-npu-actions]";

function persistPlan(state) {
  savePlan(state.plan).then(saved => {
    if (!saved) {
      showToast("A Rajtoló terve nem menthető. Jelentkezz be újra.", "error");
    }
  });
}

function normaliseCode(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

// subjectRegistrationView may move the native switch before Rajtoló gets its first
// course response. In that case the hidden native row no longer has a slider to clone;
// the table row is the new, still-native control host.
function findCustomCourseRow(code) {
  const wanted = normaliseCode(code);
  if (!wanted) {
    return null;
  }
  return (
    Array.from(document.querySelectorAll(TABLE_ROW_SELECTOR)).find(row => {
      const codeNode = row.querySelector(TABLE_CODE_SELECTOR);
      return codeNode && normaliseCode(codeNode.textContent) === wanted;
    }) || null
  );
}

// Puts a "Rajtolóhoz" switch on every course row, next to the native "Tervezőhöz
// adás" one: the user picks a lab while looking at its timetable slot, not from a
// dropdown elsewhere. Rows are found by their course code, never by the native
// switch's own label, which is controlled by the page.
function decorateCourseRows(state) {
  const byCode = new Map();
  const ambiguous = new Set();
  state.courseCatalog.forEach((courses, subjectId) => {
    courses.forEach(course => {
      if (course.code) {
        const code = String(course.code).trim().toUpperCase();
        if (byCode.has(code)) {
          byCode.delete(code);
          ambiguous.add(code);
        } else if (!ambiguous.has(code)) {
          byCode.set(code, { course, subjectId });
        }
      }
    });
  });
  if (byCode.size === 0) {
    return;
  }

  Array.from(document.querySelectorAll(ROW_SELECTOR)).forEach(row => {
    const codeNode = Array.from(row.querySelectorAll("*")).find(
      el => el.children.length === 0 && byCode.has(el.textContent.trim().toUpperCase())
    );
    if (!codeNode) {
      return;
    }
    const hit = byCode.get(codeNode.textContent.trim().toUpperCase());
    const customRow = findCustomCourseRow(hit.course.code);
    const customActions = customRow && customRow.querySelector(TABLE_ACTIONS_SELECTOR);
    let toggle = row.querySelector(`[${ROW_FLAG}]`) || (customRow && customRow.querySelector(`[${ROW_FLAG}]`));
    if (!toggle) {
      const sourceRow = customRow || row;
      const slider = sourceRow.querySelector(SLIDER_SELECTOR) || row.querySelector(SLIDER_SELECTOR);
      const wrapper = slider && slider.parentElement;
      if (!wrapper) {
        return;
      }
      toggle = buildRowToggle(wrapper);
      toggle.setAttribute(ROW_FLAG, hit.course.id);
      toggle.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        const record = state.subjectCatalog.get(hit.subjectId);
        if (!record) {
          return;
        }
        if (!utils.getNeptunCode()) {
          showToast("A felhasználó azonosítása még nem készült el. Próbáld újra egy pillanat múlva.", "error");
          return;
        }
        state.plan = toggleCourseInPlan(state.plan, record, hit.course);
        persistPlan(state);
        const wanted = isCourseInPlan(state.plan, hit.subjectId, hit.course.id);
        paintRowToggle(toggle, wanted);
        decorateSubjectRows(state);
        showToast(
          wanted
            ? `${hit.course.code || "A kurzus"} hozzáadva a Rajtolóhoz`
            : `${hit.course.code || "A kurzus"} törölve a Rajtolóból`,
          "ok"
        );
        render(state);
      });
      const host = customActions || wrapper.parentElement;
      if (host) {
        host.appendChild(toggle);
      }
    } else if (customActions && toggle.parentElement !== customActions) {
      customActions.appendChild(toggle);
    }
    paintRowToggle(toggle, isCourseInPlan(state.plan, hit.subjectId, hit.course.id));
  });
}

// A neutral count badge on the collapsed subject row, beside the app's own status icons.
// It reuses the page's own badge component so the add-on does not introduce another
// visual language or compete with the registration-status colours.
const SUBJECT_ROW_SELECTOR = "neptun-subject-list-item";
const STATUS_SELECTOR = ".status";
const BADGE_FLAG = "data-npu-count";

// Matched against the codes we actually hold, never a regexp guess at what a code
// looks like: the guess this replaced was one faculty's prefix, so every subject
// outside it got no badge. Matching a leaf rather than the row's whole text also
// stops an expanded row's own course codes being taken for the subject's.
function subjectCodeIn(row, codes) {
  const leaf = Array.from(row.querySelectorAll("*")).find(
    el => el.children.length === 0 && codes.has(el.textContent.trim().toUpperCase())
  );
  return leaf ? leaf.textContent.trim().toUpperCase() : null;
}

function plannedCount(plan, subjectId) {
  const subject = plan.subjects.find(s => s.subjectId === subjectId);
  return subject ? subject.groups.reduce((sum, g) => sum + g.ranking.length, 0) : 0;
}

function decorateSubjectRows(state) {
  const byCode = new Map();
  state.subjectCatalog.forEach((record, subjectId) => {
    if (record.code) {
      byCode.set(String(record.code).trim().toUpperCase(), subjectId);
    }
  });
  if (byCode.size === 0) {
    return;
  }

  Array.from(document.querySelectorAll(SUBJECT_ROW_SELECTOR)).forEach(row => {
    const code = subjectCodeIn(row, byCode);
    const subjectId = code && byCode.get(code);
    if (!subjectId) {
      return;
    }
    const status = row.querySelector(STATUS_SELECTOR);
    if (!status) {
      return;
    }
    const count = plannedCount(state.plan, subjectId);
    const text = `Rajtoló ${count}`;
    badge.paint(
      status,
      status,
      BADGE_FLAG,
      count > 0 ? text : null,
      count > 0 ? "neutral" : null,
      count > 0 ? `Rajtolóhoz adva: ${count} kurzus` : null
    );
  });
}

// Deep-clones the page's own "Tervezőhöz adás" control, label and slider together, so
// ours is the same thing rather than something bolted beside it. The clone carries the
// scoping attributes; ids are stripped or they would be duplicated across rows.
function buildRowToggle(wrapper) {
  const clone = wrapper.cloneNode(true);
  clone.removeAttribute("id");
  Array.from(clone.querySelectorAll("[id]")).forEach(el => el.removeAttribute("id"));
  Array.from(clone.querySelectorAll("[aria-labelledby]")).forEach(el => el.removeAttribute("aria-labelledby"));
  relabelTextNode(clone, "Rajtolóhoz");
  const control = clone.querySelector(".switch") || clone;
  if (!control.getAttribute("role")) {
    control.setAttribute("role", "switch");
  }
  control.setAttribute("aria-label", "Rajtolóhoz adás");
  if (!control.hasAttribute("tabindex")) {
    control.tabIndex = 0;
  }
  control.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      clone.click();
    }
  });
  clone.style.marginLeft = "16px";
  utils.markNpu(clone, "Rajtolóhoz adás");
  return clone;
}

// Replaces the clone's caption, wherever inside it that text lives.
function relabelTextNode(root, text) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeValue && node.nodeValue.trim()) {
      node.nodeValue = text;
      return;
    }
    node = walker.nextNode();
  }
  root.appendChild(document.createTextNode(text));
}

// Reflects the picked state the same way the native control does - but ONLY when it
// actually changes. Writing unconditionally is itself a DOM mutation, which the
// MutationObserver that calls this sees, which calls this again: an infinite repaint
// loop that shows up as the row visibly jittering.
function paintRowToggle(toggle, selected) {
  const sw = toggle.querySelector(".switch");
  if (!sw || sw.getAttribute("aria-checked") === String(selected)) {
    return false;
  }
  sw.setAttribute("aria-checked", String(selected));
  sw.classList.toggle("switch--on", selected);
  const circle = toggle.querySelector(".switch__circle");
  if (circle) {
    circle.classList.toggle("switch__circle--on", selected);
  }
  const icon = toggle.querySelector(".switch__icon");
  if (icon) {
    icon.style.display = selected ? "" : "none";
  }
  toggle.setAttribute("title", `${selected ? "Rajtolóhoz adva" : "Rajtolóhoz adás"} – NPU-funkció`);
  return true;
}

module.exports = {
  decorateCourseRows,
  decorateSubjectRows,
  rememberSubjectFromUrl,
  subjectCodeIn,
  plannedCount,
};
