import { farmCtx } from "./ctx-bridge.js";
import {
  AGENT_ROLES, AGENT_GUIDELINES, VALIDATOR_GUIDELINES, VALIDATOR_MAX_ATTEMPTS,
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
      affected_components: full.affected_components,
      related_files: full.related_files,
      ready_for_test_design: full.ready_for_test_design,
      summary: full.summary,
    };
  })();

  const api = farmCtx.humanApiInput.ok ? farmCtx.humanApiInput : null;
  const web = farmCtx.humanWebpageInput.ok ? farmCtx.humanWebpageInput : null;

  return {
    orchestrator: {
      role: "orchestrator",
      ticket: `${s} — ${story.title}`,
      source: story.from_jira ? "JIRA live" : story.from_requirements ? "Requirements (pasted)" : "mock",
      stage: "1 — Orchestrator leads the pipeline",
      pipeline_plan: [
        "① Orchestrator assigns ticket → Requirement Analyst",
        "② Analyst extracts conditions + prerequisites → Validator checks (max 2 attempts)",
        "③ If prerequisites need human values → orchestrator pauses for your input",
        "④ Writer → Human input if story requires it → no simulated data before you provide it",
        "⑤ Data → Executor → Reviewer → Reporter (only after required input received)",
        "⑥ 1st validator fail → one retry · 2nd fail → run aborts",
      ],
      agents_in_pipeline: AGENT_ROLES,
      acceptance_criteria_count: story.acceptance_criteria,
      priority: story.priority,
      jira_status: story.status,
    },
    analyst: analystOutput,
    writer: { test_cases },
    test_data_extractor: buildTestDataExtractorOutput(story, api, test_cases, analystOutput, web),
    test_executor: buildTestExecutorOutput(story, api, web, farmCtx.executionResult),
    reviewer: buildReviewerOutput(story, tcIds, buildTestExecutorOutput(story, api, web, farmCtx.executionResult)),
    reporter: buildReporterOutput(story, test_cases, buildTestExecutorOutput(story, api, web, farmCtx.executionResult)),
    validator: {
      role: "Output Validator",
      level: "L2",
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
