/** @see skills/reporter/SKILL.md */
export const AGENT_ID = "reporter";
export const SKILL_PATH = "skills/reporter/SKILL.md";
export const SKILL_FOLDER = "skills/reporter";

export function buildReporterOutput(story, test_cases, executorOutput) {
  const s = story.id;
  const tcIds = story.test_cases;
  const summary = executorOutput?.summary || {
    planned: tcIds.length,
    executed: 0,
    passed: 0,
    failed: 0,
    blocked: 0,
    measured: false,
  };

  const resultById = Object.fromEntries((executorOutput?.results || []).map((r) => [r.test_case_id, r]));

  return {
    project_name: "SEHA",
    ticket_key: s,
    ticket_title: story.title,
    report_date: new Date().toLocaleDateString("en-US"),
    environment: story.from_jira ? "JIRA live + simulator" : story.from_requirements ? "Requirements" : "Simulator",
    summary,
    metrics_note: summary.measured
      ? "Metrics derived from executed scenarios with evidence"
      : "Metrics unknown until execution completes — planned counts only",
    regression_rows: test_cases.map((tc) => {
      const result = resultById[tc.id];
      let status = "Planned";
      if (result?.status === "passed" || result?.status === "executed") status = "Passed";
      else if (result?.status === "failed") status = "Failed";
      else if (result?.status === "blocked") status = "Blocked";
      return {
        id: tc.id,
        title: tc.title,
        type: tc.type.replace("_", " "),
        status,
        evidence: result?.evidence || null,
      };
    }),
    defects: {
      reported: summary.failed || 0,
      fixed: 0,
      opened: summary.failed || 0,
      low: 0,
      medium: 0,
      high: summary.failed || 0,
    },
    comments: summary.measured
      ? `Report generated after ${summary.executed} executed scenario(s).`
      : "Execution not measured — report shows planned work only.",
    reported_by: "QA Agent Farm",
  };
}
