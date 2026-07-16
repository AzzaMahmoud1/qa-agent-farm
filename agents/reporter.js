/** @see .cursor/skills/qa-reporter/SKILL.md */
export const AGENT_ID = "reporter";
export const SKILL_PATH = ".cursor/skills/qa-reporter/SKILL.md";
export const SKILL_FOLDER = ".cursor/skills/qa-reporter";

function rowStatus(result) {
  if (!result) return "Planned";
  if (result.status === "passed") return "Passed";
  if (result.status === "failed") return "Failed";
  if (result.status === "blocked") return "Blocked";
  if (result.status === "transport_observed") return "Transport observed (not AC pass)";
  if (result.status === "pending_browser") return "Pending browser";
  if (result.status === "not_executed") return "Not executed";
  if (result.status === "not_run") return "Not run";
  return "Planned";
}

export function buildReporterOutput(story, test_cases, executorOutput, reviewerOutput) {
  if (reviewerOutput?.blocked && !reviewerOutput?.human_input_recheck) {
    return {
      success: false,
      blocked: true,
      blocked_reason: "BLOCKED — Reporter waiting on Reviewer structured output",
      ticket_key: story?.id,
      final_report: null,
    };
  }
  const s = story.id;
  const tcIds = story.test_cases;
  const summary = executorOutput?.summary || {
    planned: tcIds.length,
    executed: 0,
    passed: 0,
    failed: 0,
    blocked: 0,
    pending_browser: 0,
    transport_observed: 0,
    measured: false,
  };

  const resultById = Object.fromEntries((executorOutput?.results || []).map((r) => [r.test_case_id, r]));
  const compliance = story?.compliance_evidence || null;

  return {
    project_name: "SEHA",
    ticket_key: s,
    ticket_title: story.title,
    report_date: new Date().toLocaleDateString("en-US"),
    environment: story.from_jira ? "JIRA live + simulator" : story.from_requirements ? "Requirements" : "Simulator",
    orchestration_mode: executorOutput?.orchestration_mode || "simulated_pipeline",
    summary,
    metrics_note: summary.measured
      ? "Metrics derived from per-AC asserted scenarios only"
      : "No per-AC passes — transport observations and pending browser URLs are not counted as passed",
    compliance_evidence: compliance,
    regression_rows: test_cases.map((tc) => {
      const result = resultById[tc.id];
      return {
        id: tc.id,
        title: tc.title,
        type: String(tc.type || "").replace("_", " "),
        status: rowStatus(result),
        evidence: result?.evidence || null,
        assertion_level: result?.assertion_level || null,
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
    comments: [
      summary.measured
        ? `Report after ${summary.executed} asserted scenario(s).`
        : "Execution not measured as AC passes — report shows planned/observed work only.",
      compliance?.release_gate === "blocked"
        ? "NCA/ECC release gate: blocked (missing security evidence)."
        : null,
      executorOutput?.orchestration_note || null,
    ].filter(Boolean).join(" "),
    reported_by: "QA Agent Farm",
  };
}
