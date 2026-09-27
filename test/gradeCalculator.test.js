const assert = require("assert");
const calc = require("../src/modules/gradeCalculator");

// Measured result shapes: "<Címke> (<n>)", "Teljesítette" and null.
assert.strictEqual(calc.parseGrade("Közepes (3)"), 3);
assert.strictEqual(calc.parseGrade("Elégtelen (1)"), 1);
assert.strictEqual(calc.parseGrade("Teljesítette"), 5, "completed without a grade counts as 5 (measured)");
assert.strictEqual(calc.parseGrade(null), null);
assert.strictEqual(calc.parseGrade("Aláírva"), null, "an unknown result is no grade, never a guess");

// Artificial term: 5 credits at 4, 3 at 2, 4 failed, 2 without a result, 3 completed.
const rows = [
  { credits: 5, grade: 4 },
  { credits: 3, grade: 2 },
  { credits: 4, grade: 1 },
  { credits: 2, grade: null },
  { credits: 3, grade: 5 },
];
const figures = calc.computeIndices(rows);
assert.strictEqual(figures.credit, 11, "completed credits: grade 2 or better");
assert.strictEqual(figures.creditAll, 17, "taken credits: every subject");
assert.ok(Math.abs(figures.average - 41 / 11) < 1e-9, "weighted over completed credits only");
assert.ok(Math.abs(figures.creditIndex - 41 / 30) < 1e-9);
assert.ok(Math.abs(figures.adjustedCreditIndex - ((41 / 30) * 11) / 17) < 1e-9);
assert.strictEqual(calc.computeIndices([{ credits: 4, grade: null }]).average, null, "nothing completed, no average");

// Equal at Neptun's two-decimal rounding, no looser: JSON drops trailing zeros, so
// the digits of the reported value say nothing about its precision.
assert.strictEqual(calc.sameAsReported(41 / 30, 1.37), true);
assert.strictEqual(calc.sameAsReported(41 / 30, 1.4), false, "1.4 is 1.40, not a one-decimal rounding");
assert.strictEqual(calc.sameAsReported(41 / 30, 1.36), false);
assert.strictEqual(calc.sameAsReported(3.49, 3), false, "an integral 3 is 3.00 and must not let 3.49 through");
assert.strictEqual(calc.sameAsReported(3.004, 3), true);
assert.strictEqual(calc.sameAsReported(11, 11, true), true);
assert.strictEqual(calc.sameAsReported(11.004, 11, true), false, "credits match exactly");
assert.strictEqual(calc.sameAsReported(null, 1.36), false);

// The formula check against a closed term, in the measured registry-sheet shape.
const subjects = [
  { subjectCredits: 5, result: "Jó (4)" },
  { subjectCredits: 3, result: "Elégséges (2)" },
  { subjectCredits: 4, result: "Elégtelen (1)" },
  { subjectCredits: 2, result: null },
  { subjectCredits: 3, result: "Teljesítette" },
];
const termData = (overrides = {}) => {
  const values = Object.assign(
    { Credit: 11, CreditAll: 17, Average: 3.73, KreditIndex: 1.37, KorrigaltKreditIndex: 0.88 },
    overrides
  );
  return {
    averagesCreditIndicies: ["Credit", "CreditAll", "Average"].map(field => ({ field, value: values[field] })),
    furtherHalfYearAverages: ["KreditIndex", "KorrigaltKreditIndex"].map(field => ({ field, value: values[field] })),
  };
};
assert.deepStrictEqual(calc.checkFormula(subjects, termData()), { ok: true }, "the unideb formula re-computes");
assert.deepStrictEqual(
  calc.checkFormula(subjects, termData({ Average: 3.5 })),
  { ok: false, reason: "mismatch" },
  "another institution's formula means no numbers at all"
);
assert.deepStrictEqual(
  calc.checkFormula(subjects, termData({ KreditIndex: null })),
  { ok: false, reason: "noValues" },
  "a term without averages proves nothing"
);

assert.deepStrictEqual(
  calc.checkFormula([{ subjectCredits: 4, result: null }], termData({ Credit: 0, KreditIndex: 0 })),
  { ok: false, reason: "noValues" },
  "a term with nothing completed matches any formula and proves nothing"
);

assert.deepStrictEqual(
  calc
    .closedTerms([
      { term: "2025/26/1", studentTrainingTermDataId: "a", uiDisplayState: { reasons: ["Aktív"] } },
      { term: "2026/27/1", studentTrainingTermDataId: "c", uiDisplayState: { reasons: ["Aktuális félév"] } },
      { term: "2025/26/2", studentTrainingTermDataId: "b", uiDisplayState: { reasons: ["Aktív"] } },
    ])
    .map(t => t.term),
  ["2025/26/2", "2025/26/1"],
  "newest closed term first; the current one never"
);
