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

export function buildAgentOutputs(story) {
  const s = story.id;
  const tcIds = story.test_cases;
  const test_cases = buildWriterTestCases(story);

  const analystOutput = (() => {
    const full = buildAnalystOutputPayload(story);
    const prereqLegacy = buildAnalystPrerequisitePayload(story);
    // Attach compliance evidence onto story for downstream reporter/reviewer
    if (full.compliance_evidence) story.compliance_evidence = full.compliance_evidence;
    return {
      success: full.success,
      scratchpad: full.scratchpad,
      analyst_reasoning: full.analyst_reasoning,
      testable_conditions: full.testable_conditions,
      prerequisites_needed: {
        ...prereqLegacy,
        blocking: full.prerequisites_needed?.blocking || [],
        non_blocking: full.prerequisites_needed?.non_blocking || [],
      },
      coverage_gaps: full.coverage_gaps,
      compliance_evidence: full.compliance_evidence || null,
      affected_components: full.affected_components,
      related_files: full.related_files,
      ready_for_test_design: full.ready_for_test_design,
      summary: full.summary,
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
      orchestration_mode: "simulated_pipeline",
      orchestration_note: "Agent/validator loop is a deterministic simulator. Live work is limited to JIRA fetch and optional /api/execute HTTP transport smoke.",
      model_routing: {
        orchestrator: MODEL_ORCHESTRATOR,
        workers: MODEL_WORKER,
        by_role: { ...AGENT_MODEL_ROUTING },
      },
      pipeline_plan: [
        "① Orchestrator (Fable 5) assigns ticket → Requirement Analyst (Sonnet)",
        "② Analyst extracts conditions + prerequisites → Validator checks (max 2 attempts, Sonnet)",
        "③ If prerequisites need human values → orchestrator pauses for your input",
        "④ Writer → Human input if story requires it → no simulated data before you provide it",
        "⑤ Data → Executor → Reviewer → Reporter (Sonnet workers; only after required input received)",
        "⑥ 1st validator fail → one retry · 2nd fail → run aborts",
        "⑦ Note: pipeline events are simulated; HTTP execute is transport-only (not per-AC pass)",
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
