// "Mi lenne, ha…" grade calculator on the registered subjects page: pick the grade you
// expect for each subject and see the term's weighted average, credit index and
// adjusted credit index.
//
// Institutions compute these differently, so nothing is shown on trust. Before the
// first result, the formulas are checked against a closed term: its subjects and
// grades are re-computed and must give exactly what Neptun itself reports for that
// term. Any mismatch, or no closed term to check against, and the calculator says so
// instead of showing a number. Measured on unideb: docs/API.md#api-registry-sheet.
const interceptor = require("../interceptor");
const router = require("../router");
const utils = require("../utils");
const tokens = require("../neptunTokens");
const modal = require("../modal");
const { httpRequest } = require("./rajtolo/net");

const API_BASE = "/hallgato_ng/api/";
const ROUTE = "/hallgato_ng/subjects/registered-subjects";
const SUBJECTS_ENDPOINT = "TakenSubjects";
const FILTER_BUTTON_ID = "actions-filter-btn";
const LAUNCHER_ID = "npu-grade-calculator";
// A term's own grades, and "Teljesítette": completed without a grade, which unideb
// counts as a 5 (measured on two closed terms).
const GRADE_RE = /\((\d)\)\s*$/;
const COMPLETED_WITHOUT_GRADE = "Teljesítette";
const CHOICES = [
  ["", "–"],
  ["5", "Jeles (5)"],
  ["4", "Jó (4)"],
  ["3", "Közepes (3)"],
  ["2", "Elégséges (2)"],
  ["1", "Elégtelen (1)"],
];

const meta = {
  id: "gradeCalculator",
  group: "daily",
  name: "Átlagkalkulátor",
  where: "Tárgyak › Felvett tárgyak: „Átlagkalkulátor” gomb a szűrő mellett",
  description:
    "A Felvett tárgyak oldalon kiszámolja a várt jegyekből a súlyozott átlagot és a kreditindexeket. Előbb egy lezárt féléven ellenőrzi, hogy a képlet egyezik-e a Neptunéval.",
};

function shouldActivate() {
  return true;
}

// --- pure ---

// A number grade, 5 for "Teljesítette", null for no result.
function parseGrade(result) {
  if (typeof result !== "string") {
    return null;
  }
  if (result.trim() === COMPLETED_WITHOUT_GRADE) {
    return 5;
  }
  const match = GRADE_RE.exec(result);
  return match ? Number(match[1]) : null;
}

// rows: [{ credits, grade }], grade null when there is none (yet). A grade of 2 or
// better completes the subject; everything else counts only as taken.
function computeIndices(rows) {
  let taken = 0;
  let completed = 0;
  let weighted = 0;
  rows.forEach(row => {
    const credits = Number(row.credits) || 0;
    taken += credits;
    if (typeof row.grade === "number" && row.grade >= 2) {
      completed += credits;
      weighted += credits * row.grade;
    }
  });
  const creditIndex = weighted / 30;
  return {
    credit: completed,
    creditAll: taken,
    average: completed > 0 ? weighted / completed : null,
    creditIndex,
    adjustedCreditIndex: taken > 0 ? (creditIndex * completed) / taken : null,
  };
}

// Credits must match exactly. Averages and indices arrive rounded to two decimals,
// with JSON dropping trailing zeros (1.7 is 1.70, 3 is 3.00), so the tolerance is
// fixed at half a hundredth rather than read off the digits: an integral 3 must not
// let 3.49 through.
const ROUNDING = 0.005 + 1e-9;

function sameAsReported(computed, reported, exact) {
  if (typeof computed !== "number" || typeof reported !== "number") {
    return false;
  }
  return exact ? computed === reported : Math.abs(computed - reported) <= ROUNDING;
}

function reportedValue(termData, field) {
  const lists = ["averagesCreditIndicies", "furtherHalfYearAverages", "furtherCumulativeAverages"];
  for (const name of lists) {
    const hit = ((termData && termData[name]) || []).find(item => item && item.field === field);
    if (hit) {
      return hit.value;
    }
  }
  return undefined;
}

// Re-computes a closed term from its subjects and compares every figure the
// calculator will show. { ok, reason } - reason is shown when it is not ok.
function checkFormula(subjects, termData) {
  if (typeof reportedValue(termData, "KreditIndex") !== "number") {
    return { ok: false, reason: "noValues" };
  }
  const computed = computeIndices(
    (subjects || []).map(row => ({ credits: row.subjectCredits, grade: parseGrade(row.result) }))
  );
  // A term with nothing completed matches any formula (0 = 0) and proves nothing.
  if (computed.credit === 0) {
    return { ok: false, reason: "noValues" };
  }
  const pairs = [
    [computed.credit, "Credit", true],
    [computed.creditAll, "CreditAll", true],
    [computed.average, "Average", false],
    [computed.creditIndex, "KreditIndex", false],
    [computed.adjustedCreditIndex, "KorrigaltKreditIndex", false],
  ];
  const ok = pairs.every(([value, field, exact]) => sameAsReported(value, reportedValue(termData, field), exact));
  return ok ? { ok: true } : { ok: false, reason: "mismatch" };
}

// Closed terms, newest first: every term but the current one. The label only saves a
// request - it is localized, so verifyFormula still skips any term without values.
function closedTerms(terms) {
  return (Array.isArray(terms) ? terms : [])
    .filter(t => t && t.studentTrainingTermDataId && typeof t.term === "string")
    .filter(t => !((t.uiDisplayState && t.uiDisplayState.reasons) || []).includes("Aktuális félév"))
    .sort((a, b) => (a.term < b.term ? 1 : -1));
}

// --- network ---

function isOk(body) {
  return body && body.data && !(body.__npuStatus >= 400);
}

// Kept per Neptun code, so another login in the same tab is checked afresh.
let verdict = null;

function remember(code, value) {
  // Answered after an identity change: not this user's verdict, so not kept.
  if (code && utils.getNeptunCode() === code) {
    verdict = { code, value };
  }
  return value;
}

// Up to two closed terms are tried, since the latest may still be waiting for its
// averages. At most five GETs, once per page load, only when the dialog is opened.
async function verifyFormula() {
  const code = utils.getNeptunCode();
  if (verdict && verdict.code === code) {
    return verdict.value;
  }
  const terms = await httpRequest("GET", `${API_BASE}RegistrySheet/GetAdditionalStudentTrainingTermData`);
  if (!isOk(terms)) {
    return { ok: false, reason: "network" };
  }
  // Three, not two: if the label did not match, the current term takes one of them.
  for (const term of closedTerms(terms.data).slice(0, 3)) {
    const id = encodeURIComponent(term.studentTrainingTermDataId);
    const data = await httpRequest(
      "GET",
      `${API_BASE}RegistrySheet/GetStudentTrainingTermData?studentTrainingTermDataId=${id}`
    );
    if (!isOk(data) || typeof reportedValue(data.data, "KreditIndex") !== "number") {
      continue;
    }
    const subjects = await httpRequest(
      "GET",
      `${API_BASE}RegistrySheet/GetStudentTakenSubjectsByTerm?request.studentTrainingTermDataId=${id}&filter.firstRow=0&filter.lastRow=500`
    );
    if (!isOk(subjects) || !Array.isArray(subjects.data)) {
      return { ok: false, reason: "network" };
    }
    const result = checkFormula(subjects.data, data.data);
    if (result.reason === "noValues") {
      continue;
    }
    return remember(code, Object.assign(result, { term: term.term }));
  }
  return remember(code, { ok: false, reason: "noValues" });
}

// --- UI ---

const REASONS = {
  mismatch:
    "Ennél az intézménynél a Neptun máshogy számol, mint amit az NPU ismer, ezért a kalkulátor nem mutat eredményt.",
  noValues: "Nincs még lezárt félév átlaggal, amin az NPU ellenőrizni tudná a képletet.",
  network: "Nem sikerült betölteni az ellenőrzéshez szükséges adatokat. Próbáld újra később.",
};

function fixed(value) {
  return typeof value === "number" ? value.toFixed(2).replace(".", ",") : "–";
}

function buildCalculator(content, subjects, term) {
  const note = document.createElement("p");
  note.style.cssText = `margin:0 0 12px;font-size:13px;color:${tokens.text}`;
  note.textContent = `A képlet egyezik a Neptun ${term} félévre közölt értékeivel. Jegy nélkül a tárgy nem teljesítettnek számít.`;
  content.appendChild(note);

  // Above the list, so a change is visible without scrolling back down.
  const result = document.createElement("p");
  result.setAttribute("aria-live", "polite");
  result.style.cssText =
    `margin:0 0 12px;padding:10px 12px;border-radius:8px;font-size:14px;line-height:1.6;` +
    `background:${tokens.subtleSurface};color:${tokens.text};font-weight:600`;
  content.appendChild(result);

  const grades = new Map();
  const table = document.createElement("table");
  table.style.cssText = `width:100%;border-collapse:collapse;font-size:14px;color:${tokens.text}`;
  subjects.forEach(subject => {
    const row = table.insertRow();
    const name = row.insertCell();
    name.textContent = `${subject.subjectName} (${subject.subjectCredit} kr.)`;
    name.style.cssText = "padding:6px 8px 6px 0";
    const pick = row.insertCell();
    pick.style.cssText = "padding:6px 0;text-align:right";
    const select = document.createElement("select");
    select.setAttribute("aria-label", `${subject.subjectName} várt jegye`);
    CHOICES.forEach(([value, label]) => select.add(new Option(label, value)));
    select.addEventListener("change", () => {
      grades.set(subject, select.value ? Number(select.value) : null);
      update();
    });
    pick.appendChild(select);
  });
  content.appendChild(table);

  function update() {
    const figures = computeIndices(
      subjects.map(subject => ({
        credits: subject.subjectCredit,
        grade: grades.has(subject) ? grades.get(subject) : null,
      }))
    );
    result.textContent =
      `Súlyozott átlag: ${fixed(figures.average)} · Kreditindex: ${fixed(figures.creditIndex)} · ` +
      `Korrigált kreditindex: ${fixed(figures.adjustedCreditIndex)} · ` +
      `Teljesített / felvett kredit: ${figures.credit} / ${figures.creditAll}`;
  }
  update();
}

// getSubjects is read after the check, not at the click: the list may still have
// been on its way when the dialog opened.
function openCalculator(getSubjects) {
  modal.open({
    title: "Átlagkalkulátor",
    build(content) {
      const status = document.createElement("p");
      status.textContent = "A képlet ellenőrzése egy lezárt félévre…";
      status.style.cssText = `margin:0;font-size:14px;color:${tokens.text}`;
      content.appendChild(status);
      verifyFormula()
        .catch(() => ({ ok: false, reason: "network" }))
        .then(result => {
          if (!status.isConnected) {
            return;
          }
          if (!result.ok) {
            status.textContent = REASONS[result.reason] || REASONS.network;
            return;
          }
          const subjects = getSubjects();
          if (subjects.length === 0) {
            status.textContent = "A felvett tárgyak listája még nem töltődött be. Várd meg, és nyisd meg újra.";
            return;
          }
          status.remove();
          buildCalculator(content, subjects, result.term);
        });
    },
    actions: [{ label: "Bezár" }],
  });
}

function initialize() {
  let subjects = [];
  interceptor.onResponse(SUBJECTS_ENDPOINT, (json, info) => {
    if (router.getPath() === ROUTE && json && Array.isArray(json.data) && !(info && info.status >= 400)) {
      subjects = json.data.filter(row => row && row.subjectName && typeof row.subjectCredit === "number");
    }
  });
  // A new user must not see the previous one's list.
  utils.onNeptunCodeChange(() => {
    subjects = [];
    verdict = null;
  });

  let scheduled = false;
  function mount() {
    scheduled = false;
    const filter = document.getElementById(FILTER_BUTTON_ID);
    // The button sits in a block-level <neptun-filter-button>; its flex row is one up.
    const host = filter && filter.parentElement;
    if (
      router.getPath() !== ROUTE ||
      subjects.length === 0 ||
      !host ||
      !host.parentElement ||
      document.getElementById(LAUNCHER_ID)
    ) {
      return;
    }
    const launcher = utils.cloneButton(filter);
    launcher.id = LAUNCHER_ID;
    ["aria-label", "aria-expanded", "aria-controls", "aria-haspopup"].forEach(name => launcher.removeAttribute(name));
    // Only the caption: the filter's count badge and chevron mean nothing here.
    launcher.querySelectorAll("neptun-badge, .neptun-button__postfix-icon").forEach(node => node.remove());
    utils.setButtonLabel(launcher, "Átlagkalkulátor");
    utils.markNpu(launcher, "Átlag- és kreditindex-kalkulátor");
    launcher.addEventListener("click", () => openCalculator(() => subjects));
    host.parentElement.insertBefore(launcher, host);
  }
  function scheduleMount() {
    if (!scheduled) {
      scheduled = true;
      setTimeout(mount, 0);
    }
  }
  router.onChange(scheduleMount);
  new MutationObserver(scheduleMount).observe(document.documentElement, { childList: true, subtree: true });
}

module.exports = {
  meta,
  shouldActivate,
  initialize,
  parseGrade,
  computeIndices,
  sameAsReported,
  checkFormula,
  closedTerms,
};
