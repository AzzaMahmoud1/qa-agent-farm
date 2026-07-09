/** @see skills/reviewer/SKILL.md */
export const AGENT_ID = "reviewer";
export const SKILL_PATH = "skills/reviewer/SKILL.md";
export const SKILL_FOLDER = "skills/reviewer";

export function buildReviewerOutput(story, tcIds, executorOutput) {
  const summary = executorOutput?.summary || {};
  const executed = summary.executed || 0;
  const passed = summary.passed || 0;
  const failed = summary.failed || 0;
  const measured = summary.measured === true;

  let score = "—";
  if (measured && executed > 0) {
    const pct = Math.round((passed / executed) * 100);
    score = `${pct}% (${passed}/${executed} executed)`;
  }

  return {
    score,
    measured,
    what_is_good: measured
      ? `${passed} of ${executed} executed scenario(s) passed with recorded evidence.`
      : "Test cases planned — execution evidence not yet measured.",
    root_cause_risk: measured && failed > 0
      ? `${failed} executed failure(s) require remediation before release`
      : story.priority === "High"
        ? "High priority — execute and verify before release"
        : "Execution evidence pending — do not treat as passed",
    impact: `${story.priority} priority · Status: ${story.status}`,
    missing_coverage: measured
      ? (failed > 0 ? ["Failed executed scenarios need retest after fix"] : [])
      : ["Execution not yet measured — coverage unknown"],
    codebase_conflicts: [],
    duplicate_coverage: [],
    fix: measured
      ? (failed > 0 ? "Fix failed scenarios and re-run with evidence before close." : "Proceed with independent review of evidence.")
      : "Execute against an approved QA target and attach evidence before scoring.",
  };
}
