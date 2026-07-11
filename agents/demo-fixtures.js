// Hardcoded analyst-return fixtures used only by the requirements-failure DEMO
// (buildRequirementsFailureDemo). Kept out of the orchestrator so they don't
// inflate the real per-run payloads.

/** Demo v1 — first analyst attempt, missing AC mapping / components / related_files. */
export const analystReturnV1 = {
  success: false,
  testable_conditions: "Unmapped summary only",
  coverage_gaps: "Gaps mentioned without blocking split",
  affected_components: "",
  related_files: null,
  ready_for_test_design: false,
  summary: "Demo v1 — requirements output missing AC mapping, components, and related_files",
};

/** Demo v2 — partial retry; still missing related_files and AC mapping. */
export function buildAnalystReturnV2(story) {
  const gapSummary = story.gaps + " (" + story.blocking_gaps + " blocking)";
  return {
    success: false,
    testable_conditions: story.acceptance_criteria + " condition(s) listed without AC IDs",
    coverage_gaps: gapSummary,
    affected_components: (story.components || []).join(", ") || "API",
    related_files: null,
    ready_for_test_design: false,
    summary: "Demo v2 — partial retry: components added but related_files and AC mapping still missing",
  };
}
