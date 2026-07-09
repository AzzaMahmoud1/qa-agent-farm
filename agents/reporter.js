/** @see skills/reporter/SKILL.md */
export const AGENT_ID = "reporter";
export const SKILL_PATH = "skills/reporter/SKILL.md";
export const SKILL_FOLDER = "skills/reporter";

export function buildReporterOutput(story, test_cases) {
  const s = story.id;
  const tcIds = story.test_cases;
  return {
    project_name: "SEHA",
    ticket_key: s,
    ticket_title: story.title,
    report_date: new Date().toLocaleDateString("en-US"),
    environment: story.from_jira ? "JIRA live + simulator" : "Simulator mock",
    summary: { planned: tcIds.length, executed: 0, passed: 0, failed: 0, blocked: 0 },
    regression_rows: test_cases.map((tc) => ({
      id: tc.id,
      title: tc.title,
      type: tc.type.replace("_", " "),
      status: "Planned",
    })),
    defects: { reported: 0, fixed: 0, opened: 0, low: 0, medium: 0, high: 0 },
    comments: `Generated from ${story.from_jira ? "live JIRA ticket" : "mock data"}. Run against staging to mark executed.`,
    reported_by: "QA Agent Farm",
  };
}
