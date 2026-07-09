/** @see skills/reviewer/SKILL.md */
export const AGENT_ID = "reviewer";
export const SKILL_PATH = "skills/reviewer/SKILL.md";
export const SKILL_FOLDER = "skills/reviewer";

export function buildReviewerOutput(story, tcIds) {
  return {
    score: story.score,
    what_is_good: `Covers ${tcIds.length} scenarios mapped to JIRA acceptance criteria with API evidence.`,
    root_cause_risk: story.priority === "High" ? "High regression risk if fix is incomplete" : "Moderate — verify AC parity across versions",
    impact: `${story.priority} priority · Status: ${story.status}`,
    missing_coverage: ["Load/performance under filter combinations", "Concurrent request handling"],
    codebase_conflicts: [],
    duplicate_coverage: [],
    fix: "Add regression tests per AC and validate against staging before close.",
  };
}
