/**
 * Deterministic checks the analysis skills promise but the model cannot be
 * trusted to apply to itself: testability scoring + gate, and the per-skill
 * output rules (discrimination, technique spread, evidenced chains).
 * Pure functions — no LLM, no I/O.
 */

/** ISTQB CTAL-TA rubric weights (sum = 100). Mirrors testability_analysis/SKILL.md. */
export const TESTABILITY_WEIGHTS = Object.freeze({
  "US-1": 11, "US-2": 11, "US-3": 14, "US-4": 8, "US-5": 11,
  "T-1": 6, "T-2": 8, "T-3": 6, "T-4": 5, "T-5": 5,
  "R-1": 3, "R-2": 2, "R-3": 4, "R-4": 3, "R-5": 3,
});

/** Criteria whose failure blocks the gate regardless of the weighted total. */
export const TESTABILITY_KNOCKOUTS = Object.freeze(["US-3", "T-2"]);

const RESULT_SCORE = { met: 1, partial: 0.5, not_met: 0 };

function sectionOf(id) {
  if (id.startsWith("US-")) return "user_story";
  if (id.startsWith("T-")) return "testability";
  return "requirements";
}

/**
 * Score the model's per-criterion judgments in code. A criterion the model
 * omitted is scored not_met (never inflated). A knockout criterion that is
 * not_met forces NOT_TEST_READY whatever the total.
 * @param {Array<{id:string,result:string}>} criteria
 */
export function scoreTestability(criteria) {
  const byId = new Map((Array.isArray(criteria) ? criteria : []).map((c) => [String(c?.id || "").toUpperCase(), c]));
  const section_totals = { user_story: 0, testability: 0, requirements: 0 };
  const missing_criteria = [];
  let total = 0;
  for (const [id, weight] of Object.entries(TESTABILITY_WEIGHTS)) {
    const c = byId.get(id);
    if (!c) missing_criteria.push(id);
    const s = RESULT_SCORE[String(c?.result || "not_met").toLowerCase()] ?? 0;
    section_totals[sectionOf(id)] += weight * s;
    total += weight * s;
  }
  const overall_score = Math.round(total);
  const rating = overall_score >= 90 ? "Excellent" : overall_score >= 75 ? "Good" : overall_score >= 51 ? "Fair" : "Poor";
  const knockouts = TESTABILITY_KNOCKOUTS.filter(
    (id) => String(byId.get(id)?.result || "not_met").toLowerCase() === "not_met",
  );
  let verdict = overall_score >= 75 ? "TEST_READY" : overall_score >= 51 ? "NEEDS_REFINEMENT" : "NOT_TEST_READY";
  if (knockouts.length) verdict = "NOT_TEST_READY";
  return { overall_score, rating, verdict, section_totals, knockouts, missing_criteria };
}

const hi = (v) => String(v || "").toLowerCase() === "high";

/**
 * Enforce the rules each skill's SKILL.md states. Returns the findings to keep
 * plus human-readable violations; any violation forces human review.
 * @param {string} name — skill name
 * @param {object[]} findings — grounded findings
 * @param {object} parsed — raw parsed model output
 * @returns {{ findings: object[], violations: string[] }}
 */
export function applySkillRules(name, findings, parsed = {}) {
  const list = Array.isArray(findings) ? findings : [];
  const violations = [];

  if (name === "risk_analysis") {
    // Prioritization without discrimination is worthless.
    if (list.length >= 3 && list.every((r) => hi(r.likelihood) && hi(r.impact))) {
      violations.push("risk_analysis: every risk is high×high — no discrimination between risks");
    }
    return { findings: list, violations };
  }

  if (name === "test_gap_analysis") {
    const counts = {};
    for (const g of list) counts[g.technique] = (counts[g.technique] || 0) + 1;
    const [top, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || [];
    const explained = Array.isArray(parsed.missing_information) && parsed.missing_information.length > 0;
    if (n >= 4 && Object.keys(counts).length === 1 && !explained) {
      violations.push(`test_gap_analysis: all ${n} gaps use one technique (${top}) — other lenses not applied or not explained`);
    }
    return { findings: list, violations };
  }

  if (name === "root_cause_analysis") {
    const kept = [];
    for (const rc of list) {
      const chain = Array.isArray(rc.why_chain) ? rc.why_chain : [];
      const evidenced = chain.filter((s) => s?.support === "evidenced").length;
      const hypotheses = chain.filter((s) => s?.support === "hypothesis").length;
      if (evidenced === 0) {
        violations.push(`root_cause_analysis: dropped "${String(rc.root_cause || "").slice(0, 60)}" — no evidenced step in the why-chain`);
        continue;
      }
      if (hypotheses > evidenced && typeof rc.confidence === "number" && rc.confidence >= 0.75) {
        violations.push(`root_cause_analysis: mostly-hypothesis chain claimed confidence ${rc.confidence} — capped to 0.6`);
        kept.push({ ...rc, confidence: 0.6 });
        continue;
      }
      kept.push(rc);
    }
    return { findings: kept, violations };
  }

  return { findings: list, violations };
}
