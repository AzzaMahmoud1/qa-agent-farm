import { farmCtx } from "./ctx-bridge.js";
import {
  AGENT_ROLES, AGENT_GUIDELINES, VALIDATOR_GUIDELINES, VALIDATOR_MAX_ATTEMPTS,
  MODEL_ORCHESTRATOR, MODEL_WORKER, AGENT_MODEL_ROUTING, getModelForAgent,
} from "./registry.js";
import { buildAnalystOutputPayload, buildAnalystPrerequisitePayload } from "./analyst.js";
import { buildWriterTestCases } from "./writer.js";
import { buildReviewerOutput } from "./reviewer.js";
import { buildReporterOutput } from "./reporter.js";
import { buildTestDataExtractorOutput } from "./data-extractor.js";
import { buildTestExecutorOutput } from "./executor.js";
import { ensureAnalystReportActions, resolveAnalystOrchestratorGate } from "./orchestrator.js";

export function buildAgentOutputs(story) {
  const s = story.id;
  const tcIds = story.test_cases;
  const test_cases = buildWriterTestCases(story);

  const analystOutput = (() => {
    const full = buildAnalystOutputPayload(story);
    const prereqLegacy = buildAnalystPrerequisitePayload(story);
    // Attach compliance evidence onto story for downstream reporter/reviewer
    if (full.compliance_evidence) story.compliance_evidence = full.compliance_evidence;

    const withReport = ensureAnalystReportActions({ ...full });
    const gate = resolveAnalystOrchestratorGate(withReport);

    return {
      success: withReport.success,
      scratchpad: withReport.scratchpad,
      analyst_reasoning: withReport.analyst_reasoning,
      testable_conditions: withReport.testable_conditions,
      prerequisites_needed: {
        ...prereqLegacy,
        blocking: withReport.prerequisites_needed?.blocking || [],
        non_blocking: withReport.prerequisites_needed?.non_blocking || [],
      },
      coverage_gaps: withReport.coverage_gaps,
      compliance_evidence: withReport.compliance_evidence || null,
      affected_components: withReport.affected_components,
      related_files: withReport.related_files,
      analyst_report: withReport.analyst_report || null,
      ready_for_test_design: withReport.ready_for_test_design,
      summary: withReport.summary,
      pipeline_state: gate.state,
      writer_input: gate.writer_input,
    };
  })();

  const api = farmCtx.humanApiInput.ok ? farmCtx.humanApiInput : null;
  const web = farmCtx.humanWebpageInput.ok ? farmCtx.humanWebpageInput : null;
  const executorOut = buildTestExecutorOutput(story, api, web, farmCtx.executionResult);

  return {
    orchestrator: {
      role: "orchestrator",
      model: MODEL_ORCHESTRATOR,
      ticket: `${s} — ${story.title}`,
      source: story.from_jira ? "JIRA live" : story.from_requirements ? "Requirements (pasted)" : "mock",
      stage: "1 — Orchestrator leads the pipeline",
      orchestration_mode: story.live_analyst_output ? "agent1_cursor_agent" : "simulated_pipeline",
      orchestration_note: story.live_analyst_output
        ? "Agent 1 (Requirement Analyst) runs via the Cursor Agent CLI on Sonnet 5 (high effort). Downstream agents remain simulated until replaced."
        : "Agent/validator loop is a deterministic simulator except where live Agent 1 output is attached.",
      model_routing: {
        orchestrator: MODEL_ORCHESTRATOR,
        workers: MODEL_WORKER,
        analyst: story.live_analyst_output ? "claude-sonnet-5 (high)" : MODEL_WORKER,
        by_role: { ...AGENT_MODEL_ROUTING, analyst: story.live_analyst_output ? "claude-sonnet-5 (high)" : MODEL_WORKER },
      },
      pipeline_plan: [
        "① Orchestrator assigns ticket → Agent 1 Requirement Analyst (Cursor Agent · Sonnet 5 high)",
        "② Agent 1 extracts conditions + prerequisites + orchestrator_actions",
        "③ If blocking actions → WAITING_ON_HUMAN before Test Case Writer",
        "④ Writer → Human input if needed → Data → Executor → Reviewer → Reporter",
        "⑤ Validator checks worker outputs (max 2 attempts)",
      ],
      agents_in_pipeline: AGENT_ROLES.map((r) => ({ role: r, model: getModelForAgent(r) })),
      acceptance_criteria_count: story.acceptance_criteria,
      priority: story.priority,
      jira_status: story.status,
    },
    analyst: analystOutput,
    writer: { test_cases },
    test_data_extractor: buildTestDataExtractorOutput(story, api, test_cases, analystOutput, web),
    test_executor: executorOut,
    reviewer: buildReviewerOutput(story, tcIds, executorOut),
    reporter: buildReporterOutput(story, test_cases, executorOut),
    validator: {
      role: "Output Validator",
      model: MODEL_WORKER,
      level: "L2",
      mode: "simulated_guideline_checks",
      purpose: "Check worker outputs against role guidelines — never infinite retry",
      own_guidelines: VALIDATOR_GUIDELINES.rules,
      max_attempts_per_agent: VALIDATOR_MAX_ATTEMPTS,
      guidelines_enforced: Object.fromEntries(
        AGENT_ROLES.map((r) => [r, AGENT_GUIDELINES[r].rules]),
      ),
      validations: [],
    },
  };
}
