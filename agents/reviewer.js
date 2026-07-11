/** @see .cursor/skills/qa-reviewer/SKILL.md */
export const AGENT_ID = "reviewer";
export const SKILL_PATH = ".cursor/skills/qa-reviewer/SKILL.md";
export const SKILL_FOLDER = ".cursor/skills/qa-reviewer";

export function buildReviewerOutput(story, tcIds, executorOutput) {
  const summary = executorOutput?.summary || {};
  const executed = summary.executed || 0;
  const passed = summary.passed || 0;
  const failed = summary.failed || 0;
  const measured = summary.measured === true;
  const transportObserved = summary.transport_observed || 0;
  const pendingBrowser = summary.pending_browser || 0;
  const compliance = story?.compliance_evidence || executorOutput?.compliance_evidence;

  let score = "—";
  if (measured && executed > 0) {
    const pct = Math.round((passed / executed) * 100);
    score = `${pct}% (${passed}/${executed} asserted)`;
  }

  const missing = [];
  if (!measured) missing.push("Per-AC assertions not measured — transport/UI URL alone is not a pass");
  if (transportObserved > 0) missing.push(`${transportObserved} transport observation(s) without business assertion`);
  if (pendingBrowser > 0) missing.push(`${pendingBrowser} UI case(s) pending browser evidence`);
  if (compliance?.release_gate === "blocked" || compliance?.status === "blocked_missing_evidence") {
    missing.push("NCA/ECC security evidence missing — release blocked");
  }
  if (measured && failed > 0) missing.push("Failed executed scenarios need retest after fix");

  return {
    score,
    measured,
    orchestration_mode: executorOutput?.orchestration_mode || "simulated_pipeline",
    what_is_good: measured
      ? `${passed} of ${executed} asserted scenario(s) passed with evidence.`
      : "Test cases planned — no per-AC pass recorded yet.",
    root_cause_risk: compliance?.release_gate === "blocked"
      ? "NCA/ECC controls lack evidence — must not release"
      : measured && failed > 0
        ? `${failed} asserted failure(s) require remediation before release`
        : story.priority === "High"
          ? "High priority — execute per-AC assertions before release"
          : "Do not treat transport smoke or URL recording as passed coverage",
    impact: `${story.priority} priority · Status: ${story.status}`,
    missing_coverage: missing,
    compliance_evidence: compliance || null,
    codebase_conflicts: [],
    duplicate_coverage: [],
    fix: compliance?.release_gate === "blocked"
      ? "Attach injection/IDOR/bypass/API-exposure evidence mapped to ECC controls before release."
      : measured
        ? (failed > 0 ? "Fix failed scenarios and re-run with evidence before close." : "Proceed with independent review of evidence.")
        : "Run per-AC assertions (and browser tests for UI) before scoring as passed.",
  };
}
