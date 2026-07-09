/** @see skills/orchestrator/SKILL.md */
export const AGENT_ID = "orchestrator";
export const SKILL_PATH = "skills/orchestrator/SKILL.md";
export const SKILL_FOLDER = "skills/orchestrator";

import { farmCtx } from "./ctx-bridge.js";
import { AGENT_META, AGENT_ROLES, AGENT_GUIDELINES, VALIDATOR_MAX_ATTEMPTS, ORCHESTRATOR_INACTIVITY_TIMEOUT_MS, VALIDATOR_GUIDELINES } from "./registry.js";
import { buildAnalystOutputPayload, buildAnalystPrerequisitePayload } from "./analyst.js";
import { tcType } from "./writer.js";
import { inferHumanInputNeeds } from "../lib/human-input.js";
import { buildValidationResult, validateAnalystOutputLive, DATA_EXTRACTOR_API_CHECKS } from "./validator.js";

export function mem(story, extra) {
  return Object.assign({
    story: story.id + " — " + story.title,
    iteration: "1",
    priority: story.priority,
    status: story.status,
  }, extra || {});
}

export function abortRunEvents(targetAgent, phase, story, validation) {
  const meta = AGENT_META[targetAgent];
  return [
    {
      kind: "validator_brake",
      phase,
      role: "validator",
      target_agent: targetAgent,
      message: `Validator brake — ${meta.label} failed ${VALIDATOR_MAX_ATTEMPTS}/${VALIDATOR_MAX_ATTEMPTS} checks. No further retries.`,
      validation,
      attempt: VALIDATOR_MAX_ATTEMPTS,
      orchestrator_memory: mem(story, { phase: "aborted", reason: "validator_brake", agent: targetAgent, attempts: VALIDATOR_MAX_ATTEMPTS }),
      agent_context: { brake: true, max_attempts: VALIDATOR_MAX_ATTEMPTS, validation },
      agent_returns: validation,
      decision: "abort — max validation attempts exceeded",
    },
    {
      kind: "orchestrator_abort",
      phase: "orchestrator",
      target_agent: targetAgent,
      message: `Orchestrator halts pipeline — ${meta.label} did not pass after ${VALIDATOR_MAX_ATTEMPTS} validation checks`,
      validation_feedback: validation,
      orchestrator_memory: mem(story, { phase: "aborted", action: "halt_pipeline", failed_agent: targetAgent }),
      agent_context: {},
      agent_returns: validation,
      decision: "stop — validation failure (2 strikes)",
    },
    {
      kind: "run_failed",
      phase: "aborted",
      message: `QA run FAILED · ${story.id} · ${meta.label} output invalid after ${VALIDATOR_MAX_ATTEMPTS} validator checks`,
      orchestrator_memory: mem(story, { phase: "aborted", failed_agent: targetAgent, goal: "not achieved" }),
      agent_context: {},
      agent_returns: { success: false, reason: "validator_brake", agent: targetAgent, attempts: VALIDATOR_MAX_ATTEMPTS },
      decision: "run failed — validator brake",
    },
  ];
}

export function validationGateEvents(targetAgent, phase, story, agentReturns, opts) {
  const meta = AGENT_META[targetAgent];
  const g = AGENT_GUIDELINES[targetAgent];
  const passValidation = buildValidationResult(targetAgent, true);
  const failValidation = opts.failValidation || buildValidationResult(
    targetAgent,
    false,
    opts.failures || ["Include related source and test file paths"],
    opts.failRecommendation
  );
  const failValidation2 = opts.failValidation2 || buildValidationResult(
    targetAgent,
    false,
    opts.failures2 || opts.failures || ["Output still does not meet L2 guidelines after retry"],
    opts.failRecommendation2 || "Agent failed to apply corrections — run will abort"
  );
  const failAttempts = new Set(opts.failAttempts || (opts.failFirst ? [1] : []));
  const events = [];

export function buildRequirementsFailureDemo(story) {
  const s = story.id;
  const gapSummary = story.gaps + " (" + story.blocking_gaps + " blocking)";
  const acList = story.acceptance_criteria_list || [];
  const acPreview = acList.slice(0, 2).join("; ") || story.acceptance_criteria + " criteria";
  const component = (story.components || [])[0] || "general";

  const analystInstructions = {
    target_agent: "Requirement Analyst (L2 — Forced Scratchpad Mode)",
    task: "Analyze JIRA ticket — scratchpad A–E then structured JSON",
    ticket: s + " · " + story.title,
    scratchpad_steps: [
      "A — Ambiguity scan",
      "B — Section classification",
      "C — ACs from Business Rules / Alt / Exception Flow only",
      "D — Prerequisites (DATA/ENVIRONMENT/DEPENDENCY/KNOWLEDGE)",
      "E — Coverage gaps by category",
    ],
    deliverables: [
      "Visible scratchpad before JSON",
      "Structured testable_conditions",
      "prerequisites_needed.blocking and .non_blocking",
      "Structured coverage_gaps",
      "related_files with reasons",
    ],
    acceptance_criteria: acList.length ? acList : [acPreview],
    constraints: "Only use ticket context — do not assume unlisted behavior",
    priority: story.priority,
  };

  const analystReturnV1 = {
    success: false,
    testable_conditions: "Unmapped summary only",
    coverage_gaps: "Gaps mentioned without blocking split",
    affected_components: "",
    related_files: null,
    ready_for_test_design: false,
    summary: "Demo v1 — requirements output missing AC mapping, components, and related_files",
  };

  const analystReturnV2 = {
    success: false,
    testable_conditions: story.acceptance_criteria + " condition(s) listed without AC IDs",
    coverage_gaps: gapSummary,
    affected_components: (story.components || []).join(", ") || "API",
    related_files: null,
    ready_for_test_design: false,
    summary: "Demo v2 — partial retry: components added but related_files and AC mapping still missing",
  };

  const retryInstructions = {
    target_agent: "Requirement Analyst (L2)",
    task: "RETRY — address validator feedback (last attempt)",
    validator_feedback: "Multiple L2 guideline failures on attempt 1",
    corrections: [
      "Map every acceptance criterion to a testable condition ID",
      "Add related_files with controller, service, and spec paths",
      "Split coverage gaps into blocking vs non-blocking",
    ],
    acceptance_criteria: acList.length ? acList : [acPreview],
    priority: story.priority,
  };

  const failValidation1 = buildValidationResult("analyst", false, [
    "Map every acceptance criterion to a testable condition",
    "Distinguish blocking vs non-blocking coverage gaps",
    "List affected components from the JIRA ticket",
    "Include related source and test file paths",
  ], "Complete all four L2 deliverables before re-submitting");

  const failValidation2 = buildValidationResult("analyst", false, [
    "Map every acceptance criterion to a testable condition",
    "Include related source and test file paths",
  ], "related_files still missing after retry — validator brake will abort run");

  const analystGate = validationGateEvents("analyst", "gap_analysis", story, analystReturnV1, {
    failAttempts: [1, 2],
    failValidation: failValidation1,
    failValidation2: failValidation2,
    retryInstructions,
    retryOutput: analystReturnV2,
    retryEvents: [
      {
        kind: "agent_assign",
        phase: "gap_analysis",
        message: "[Demo] Analyst retry — orchestrator corrections after 1st validation failure",
        role: "analyst",
        is_retry: true,
        feedback_addressed: retryInstructions.corrections,
        orchestrator_memory: mem(story, { phase: "gap_analysis", demo: "requirements", awaiting: "analyst_retry" }),
        agent_context: retryInstructions,
        agent_returns: {},
        decision: null,
      },
      {
        kind: "agent_return",
        phase: "gap_analysis",
        message: analystReturnV2.summary,
        role: "analyst",
        is_retry: true,
        before_output: analystReturnV1,
        changes_made: [
          "Added affected_components from ticket",
          "Improved coverage_gaps summary",
          "Still missing related_files and per-AC condition IDs",
        ],
        orchestrator_memory: mem(story, { phase: "gap_analysis", demo: "requirements", analyst_status: "retry_still_failing" }),
        agent_context: {},
        agent_returns: analystReturnV2,
        decision: null,
      },
    ],
  });

  return [
    {
      kind: "run_start",
      phase: "init",
      message: "[Demo] Requirements failure run for " + s + " — analyst will fail validation twice",
      role: null,
      orchestrator_memory: mem(story, { phase: "init", demo: "requirements_failures", source: story.from_jira ? "jira" : "mock" }),
      agent_context: { demo: "requirements_failures" },
      agent_returns: {},
      decision: "begin demo — requirements step failures only",
    },
    {
      kind: "orchestrator_stage",
      phase: "orchestrator",
      message: "[Demo] Stage 1: assign Requirement Analyst (" + story.acceptance_criteria + " AC)",
      role: null,
      orchestrator_memory: mem(story, { phase: "orchestrator", demo: "requirements" }),
      agent_context: {},
      agent_returns: {},
      decision: "assign Requirement Analyst",
    },
    {
      kind: "orchestrator_instruct",
      phase: "orchestrator",
      message: "[Demo] Orchestrator instructs Requirement Analyst",
      role: null,
      target_agent: "analyst",
      instructions: analystInstructions,
      orchestrator_memory: mem(story, { phase: "orchestrator", action: "instruct_analyst", demo: "requirements" }),
      agent_context: analystInstructions,
      agent_returns: {},
      decision: null,
    },
    {
      kind: "agent_assign",
      phase: "gap_analysis",
      message: "[Demo] Analyst starts requirements analysis",
      role: "analyst",
      orchestrator_memory: mem(story, { phase: "gap_analysis", demo: "requirements" }),
      agent_context: analystInstructions,
      agent_returns: {},
      decision: null,
    },
    {
      kind: "agent_return",
      phase: "gap_analysis",
      message: analystReturnV1.summary,
      role: "analyst",
      orchestrator_memory: mem(story, { phase: "gap_analysis", analyst_status: "returned_v1" }),
      agent_context: {},
      agent_returns: analystReturnV1,
      decision: null,
      output_note: "Demo attempt 1 — 4 guideline failures expected",
    },
    ...analystGate,
  ];
}

export function resolvePipelineEvents(story, runOptions) {
  const opts = runOptions || {};
  if (opts.demo === "requirements") return buildRequirementsFailureDemo(story);
  return buildEvents(story);
}

export function buildPrerequisiteInputEvents(story) {
  const check = buildAnalystPrerequisitePayload(story);
  if (!check.needed) return [];

  return [
    {
      kind: "prerequisite_input_request",
      phase: "gap_analysis",
      prerequisite_need: check,
      message: `Analyst reasoning complete — ${check.items.length} item(s) need your input (${(check.already_satisfied || []).length} already in ticket, ${(check.not_applicable || []).length} N/A). Orchestrator waits before test design.`,
      role: null,
      orchestrator_memory: mem(story, { phase: "gap_analysis", prerequisites: String(check.items.length), awaiting: "human_prerequisites" }),
      agent_context: {
        items: check.items.map((i) => ({ id: i.id, label: i.label, hint: i.hint, reason: i.reason })),
        source: "Requirement Analyst output (validator approved)",
      },
      agent_returns: {},
      decision: "wait for human prerequisite input",
    },
    {
      kind: "prerequisite_input_received",
      phase: "gap_analysis",
      prerequisite_need: check,
      message: "Human provided prerequisite setup details — orchestrator proceeds to test case writing",
      role: null,
      orchestrator_memory: mem(story, { phase: "gap_analysis", prerequisites: "received" }),
      agent_context: { source: "human", count: check.items.length },
      agent_returns: {},
      decision: "proceed to test_case_writing",
    },
  ];
}

export function buildHumanInputEvents(story, writerCases, analystOutput) {
  const need = inferHumanInputNeeds(story, analystOutput, writerCases);
  if (!need.needsHumanInput) return [];

  const askParts = [];
  if (need.types.includes("api")) askParts.push("curl for API");
  if (need.types.includes("webpage")) askParts.push("webpage URL");
  const requiredFields = [];
  if (need.types.includes("api")) requiredFields.push("curl");
  if (need.types.includes("webpage")) requiredFields.push("webpage_url");

  return [
    {
      kind: "human_input_request",
      phase: "test_data_extraction",
      human_input_need: need,
      message: `Requirements need ${need.types.join(" + ")} — orchestrator asks human for ${askParts.join(" and ")}`,
      role: null,
      orchestrator_memory: mem(story, { phase: "test_data_extraction", human_input: need.types.join("+"), input_need: need.primary }),
      agent_context: {
        required_fields: requiredFields,
        input_types: need.types,
        primary: need.primary,
        timeout_seconds: ORCHESTRATOR_INACTIVITY_TIMEOUT_MS / 1000,
        reason: need.reason,
        detected_from: need.detected_from,
        example_api: "curl -X GET 'https://api.example.com/v2/resource' -H 'Authorization: Bearer TOKEN'",
        example_web: "https://staging.example.com/app/dashboard",
      },
      agent_returns: {},
      decision: `wait for human input (${need.types.join(" + ")}) — 1 min orchestrator inactivity limit`,
    },
    {
      kind: "human_input_received",
      phase: "test_data_extraction",
      human_input_need: need,
      message: `Human provided ${askParts.join(" and ")} — Test Data Extractor will derive datasets`,
      role: null,
      orchestrator_memory: mem(story, { phase: "test_data_extraction", human_input: "received" }),
      agent_context: { source: "human", input_types: need.types },
      agent_returns: {},
      decision: "proceed — extract test data from human input",
    },
    {
      kind: "orchestrator_instruct",
      phase: "test_data_extraction",
      target_agent: "test_data_extractor",
      message: "Orchestrator instructs Test Data Extractor to build datasets from human-provided requirement input",
      instructions: {
        task: "Extract valid/invalid/boundary inputs from human-provided " + need.types.join(" and "),
        deliver: "Per-test-case datasets mapped to writer test cases and current AC",
        human_input: need.types,
      },
      orchestrator_memory: mem(story, { phase: "test_data_extraction", action: "assign_test_data_extractor", human_input: "received" }),
      agent_context: {},
      agent_returns: {},
      decision: "assign Test Data Extractor with human input",
    },
  ];
}

const buildHumanApiEvents = buildHumanInputEvents;

export function enrichEventForDisplay(e) {
  if (e.kind === "validator_return") return resolveLiveValidatorReturn(e);

  if (e.kind === "validator_assign" && e.target_agent === "analyst" && farmCtx.currentStory) {
    return {
      ...e,
      message: `Validator check ${e.attempt}/${VALIDATOR_MAX_ATTEMPTS} — verify analyst AC quality, test-action mapping, and related_files`,
      agent_context: {
        ...e.agent_context,
        ac_quality_rules: [
          "Reject ticket metadata (UC ids, Priority, Status) as acceptance criteria",
          "Each test action must map testable behaviour — not verify: UC05",
          "prerequisites_needed.story_analysis must list rejected_as_non_ac when metadata present",
        ],
        story_acceptance_criteria: farmCtx.currentStory.acceptance_criteria_list || [],
        rejected_metadata: farmCtx.currentStory.acceptance_criteria_rejected || [],
        agent_output: farmCtx.storyOutputs.analyst || e.agent_context?.agent_output,
      },
    };
  }

  if (e.kind === "validator_assign" && e.target_agent === "test_data_extractor" && farmCtx.currentStory) {
    const requirements = getLiveRequirements(farmCtx.currentStory);
    return {
      ...e,
      message: `Validator check ${e.attempt}/${VALIDATOR_MAX_ATTEMPTS} — verify datasets vs current requirements, API, and test case links`,
      agent_context: {
        ...e.agent_context,
        api_validation_criteria: DATA_EXTRACTOR_API_CHECKS,
        live_requirements: requirements.testable_conditions.map((c) => `${c.id}: ${c.text.slice(0, 80)}`),
        writer_test_cases: requirements.writer_test_cases.map((tc) => `${tc.id} (${tc.type})`),
        requirements_snapshot: requirements.version,
        human_api: farmCtx.humanApiInput.ok ? { method: farmCtx.humanApiInput.method, url: farmCtx.humanApiInput.url } : "pending",
        human_webpage: farmCtx.humanWebpageInput.ok ? { url: farmCtx.humanWebpageInput.url, title: farmCtx.humanWebpageInput.title } : "pending",
        input_types: farmCtx.getLiveHumanInputNeed(farmCtx.currentStory).types,
        agent_output: farmCtx.storyOutputs.test_data_extractor || e.agent_context?.agent_output,
      },
    };
  }

  if (e.kind === "prerequisite_input_received") {
    const provided = farmCtx.getProvidedPrerequisites();
    return {
      ...e,
      agent_returns: provided.length ? { prerequisites: provided } : { error: "prerequisite fields incomplete" },
      message: provided.length
        ? `Human provided ${provided.length} prerequisite(s) — ${provided.map((p) => p.label).join(", ")}`
        : e.message + " (complete required fields in sidebar)",
    };
  }

  if (e.kind === "human_input_received") {
    const need = e.human_input_need || farmCtx.getLiveHumanInputNeed(farmCtx.currentStory);
    const returns = {};
    if (need.types.includes("api")) {
      const api = farmCtx.humanApiInput.ok ? farmCtx.humanApiInput : farmCtx.getHumanApiInput();
      if (api.ok) returns.api = api;
    }
    if (need.types.includes("webpage") && farmCtx.humanWebpageInput.ok) returns.webpage = farmCtx.humanWebpageInput;
    const ok = farmCtx.isHumanInputSatisfied(need);
    const msgParts = [];
    if (returns.api) msgParts.push(`curl ${returns.api.method} ${returns.api.url}`);
    if (returns.webpage) msgParts.push(`webpage ${returns.webpage.url}`);
    return {
      ...e,
      agent_returns: ok ? returns : { error: "required human input not complete" },
      agent_context: { ...e.agent_context, human_input: returns, input_types: need.types },
      message: ok
        ? `Human provided ${msgParts.join(" + ")}`
        : e.message + " (complete required fields in sidebar)",
    };
  }
  if (e.kind === "agent_return" && e.role === "test_data_extractor" && farmCtx.currentStory) {
    const need = farmCtx.getLiveHumanInputNeed(farmCtx.currentStory);
    const ready = farmCtx.isRequiredInputReady(farmCtx.currentStory);
    const tc = farmCtx.currentStory.test_cases?.length || 0;
    return {
      ...e,
      message: need.needsHumanInput
        ? (ready
          ? `Extracted test data from human-provided ${need.types.join(" + ")} for ${tc} test case(s).`
          : `Blocked — provide human ${need.types.join(" + ")} before extracting test data.`)
        : e.message,
    };
  }
  if (e.kind === "agent_return" && e.role === "test_executor" && farmCtx.currentStory) {
    const need = farmCtx.getLiveHumanInputNeed(farmCtx.currentStory);
    const ready = farmCtx.isRequiredInputReady(farmCtx.currentStory);
    const tc = farmCtx.currentStory.test_cases?.length || 0;
    return {
      ...e,
      message: need.needsHumanInput
        ? (ready
          ? `Test Executor ready — ${tc} case(s) using human ${need.types.join(" + ")}.`
          : `Blocked — provide human ${need.types.join(" + ")} before execution.`)
        : e.message,
    };
  }
  if (e.kind === "agent_assign" && e.role === "test_executor" && farmCtx.currentStory) {
    const need = farmCtx.getLiveHumanInputNeed(farmCtx.currentStory);
    if (!need.needsHumanInput || !farmCtx.isHumanInputSatisfied(need)) return e;
    const ctx = { ...e.agent_context };
    const parts = [];
    if (need.types.includes("api") && farmCtx.humanApiInput.ok) {
      ctx.human_api = farmCtx.humanApiInput;
      parts.push(`curl (${farmCtx.humanApiInput.method} ${farmCtx.humanApiInput.endpoint})`);
    }
    if (need.types.includes("webpage") && farmCtx.humanWebpageInput.ok) {
      ctx.human_webpage = farmCtx.humanWebpageInput;
      parts.push(`webpage (${farmCtx.humanWebpageInput.url})`);
    }
    if (!parts.length) return e;
    return {
      ...e,
      agent_context: ctx,
      message: `Orchestrator assigns task to Test Executor with human-provided ${parts.join(" + ")}`,
    };
  }
  return e;
}

export function buildEvents(story) {
  const s = story.id;
  const tc = story.test_cases.length;
  const gapSummary = story.gaps + " (" + story.blocking_gaps + " blocking)";
  const acList = story.acceptance_criteria_list || [];
  const acPreview = acList.slice(0, 2).join("; ") || story.acceptance_criteria + " criteria";
  const component = (story.components || [])[0] || "general";

  const analystInstructions = {
    target_agent: "Requirement Analyst (L2 — Forced Scratchpad Mode)",
    task: "Analyze ticket — produce scratchpad steps A–E, then final JSON",
    ticket: s + " · " + story.title,
    scratchpad_steps: [
      "A — Ambiguity scan (UNIMPLEMENTED, VAGUE, MISSING ACTOR/STATE, CONFLICT, CLEAN)",
      "B — Section classification (Pre-conditions→prerequisites, Basic Flow→test steps not ACs, Business Rules→ACs)",
      "C — Extract ACs ONLY from Business Rules, Alternative Flow, Exception Flow",
      "D — Prerequisites in DATA/ENVIRONMENT/DEPENDENCY/KNOWLEDGE with BLOCKING/NON-BLOCKING",
      "E — Coverage gaps per category (boundary, negative, security, concurrency, integration, regression, performance, ui)",
    ],
    deliverables: [
      "Visible scratchpad (steps A–E) before JSON",
      "Structured testable_conditions with source, roles, pass/fail evidence",
      "prerequisites_needed.blocking and .non_blocking arrays",
      "Structured coverage_gaps with category and severity",
      "related_files with path and reason",
    ],
    acceptance_criteria: acList.length ? acList : [acPreview],
    constraints: "Never extract ACs from Pre-conditions, Basic Flow, Post-conditions, or metadata",
    priority: story.priority,
  };

  const analystFull = buildAnalystOutputPayload(story);
  const analystPrereqPayload = buildAnalystPrerequisitePayload(story);

  const analystFeedback = {
    success: true,
    scratchpad: analystFull.scratchpad,
    analyst_reasoning: analystFull.analyst_reasoning,
    testable_conditions: analystFull.testable_conditions,
    coverage_gaps: analystFull.coverage_gaps,
    affected_components: analystFull.affected_components,
    related_files: analystFull.related_files,
    prerequisites_needed: { ...analystPrereqPayload, blocking: analystFull.prerequisites_needed?.blocking || [], non_blocking: analystFull.prerequisites_needed?.non_blocking || [] },
    ready_for_test_design: analystFull.ready_for_test_design,
    summary: analystFull.summary,
  };

  const analystFeedbackIncomplete = {
    success: true,
    testable_conditions: story.acceptance_criteria + " condition(s) extracted from JIRA",
    coverage_gaps: [],
    affected_components: (story.components || []).join(", ") || "API, Backend",
    related_files: null,
    prerequisites_needed: null,
    ready_for_test_design: false,
    summary: "Gap analysis returned but missing scratchpad, structured prerequisites, and related_files — incomplete for L2 guidelines",
  };

  const analystRetryInstructions = {
    target_agent: "Requirement Analyst (L2)",
    task: "RETRY — re-run ALL scratchpad steps A–E, then resubmit full JSON",
    validator_feedback: "Missing scratchpad and structured L2 deliverables",
    deliverables: analystInstructions.deliverables,
    corrections: [
      "Output scratchpad steps A–E before final JSON",
      "Add prerequisites_needed.blocking and .non_blocking with category",
      "Add related_files as { path, reason } objects",
      "Map each AC to structured testable_conditions entry",
    ],
    acceptance_criteria: acList.length ? acList : [acPreview],
    priority: story.priority,
  };

  const analystQuality = validateAnalystOutputLive(story, analystFeedback);
  const analystGateOpts = {
    failAttempts: [1],
    failures: [
      "Complete all scratchpad steps A–E before final JSON",
      "Include related source and test file paths with reasons",
    ],
    failRecommendation: "Add scratchpad A–E, prerequisites_needed.blocking/non_blocking, and related_files",
    retryInstructions: analystRetryInstructions,
    retryOutput: analystFeedback,
    gateMessage: analystPrereqPayload.needed
      ? "Orchestrator received validated analyst output — will request human prerequisites next"
      : "Orchestrator received validated analyst feedback — proceeding to test design",
    gateDecision: analystPrereqPayload.needed ? "request human prerequisites" : "proceed to test_case_writing",
    retryEvents: [
      {
        kind: "agent_assign",
        phase: "gap_analysis",
        message: "Analyst receives orchestrator re-instructions (validator retry 1/1)",
        role: "analyst",
        is_retry: true,
        feedback_addressed: analystRetryInstructions.corrections,
        orchestrator_memory: mem(story, { phase: "gap_analysis", awaiting: "analyst_retry", retries_left: 0 }),
        agent_context: analystRetryInstructions,
        agent_returns: {},
        decision: null,
      },
      {
        kind: "agent_return",
        phase: "gap_analysis",
        message: analystFeedback.summary + " (retry — scratchpad + structured deliverables added)",
        role: "analyst",
        is_retry: true,
        before_output: analystFeedbackIncomplete,
        changes_made: [
          "Added scratchpad steps A–E",
          "Added prerequisites_needed.blocking/non_blocking — "
            + (analystPrereqPayload.items.length || 0) + " human gap(s), "
            + (analystPrereqPayload.already_satisfied?.length || 0) + " satisfied in ticket",
          "Added related_files with path and reason",
          "Mapped " + (analystFull.testable_conditions?.length || 0) + " structured testable condition(s)",
          "Set ready_for_test_design: " + analystFull.ready_for_test_design,
        ],
        orchestrator_memory: mem(story, { phase: "gap_analysis", analyst_status: "returned_retry" }),
        agent_context: {},
        agent_returns: analystFeedback,
        decision: null,
        structured_output: "__analyst__",
      },
    ],
  };
  if (!analystQuality.passed) {
    analystGateOpts.failAttempts = [1, 2];
    analystGateOpts.failures2 = analystQuality.failures;
    analystGateOpts.failRecommendation2 = analystQuality.recommendation || "Analyst mapped ticket metadata as acceptance criteria — exclude non-AC lines";
    analystGateOpts.failValidation2 = analystQuality;
  }

  const analystGate = validationGateEvents("analyst", "gap_analysis", story, analystFeedbackIncomplete, analystGateOpts);

  const coreStart = [
    { kind: "run_start", phase: "init", message: "Orchestrator received ticket " + s + (story.from_jira ? " (live from JIRA)" : ""), role: null, orchestrator_memory: mem(story, { phase: "init", source: story.from_jira ? "jira" : "mock" }), agent_context: {}, agent_returns: {}, decision: "begin QA pipeline — orchestrator leads" },

    { kind: "orchestrator_stage", phase: "orchestrator", message: "Stage 1: Orchestrator validates ticket (" + story.acceptance_criteria + " AC · " + story.issueType + " · " + story.priority + ")", role: null, orchestrator_memory: mem(story, { phase: "orchestrator", stage: "1", validation: "valid", component }), agent_context: {}, agent_returns: {}, decision: "assign Requirement Analyst — analyze prerequisites" },

    { kind: "orchestrator_instruct", phase: "orchestrator", message: "Orchestrator issues instructions to Requirement Analyst", role: null, target_agent: "analyst", instructions: analystInstructions, orchestrator_memory: mem(story, { phase: "orchestrator", stage: "1", action: "instruct_analyst" }), agent_context: analystInstructions, agent_returns: {}, decision: null },

    { kind: "agent_assign", phase: "gap_analysis", message: "Analyst receives orchestrator instructions", role: "analyst", orchestrator_memory: mem(story, { phase: "gap_analysis", awaiting: "analyst" }), agent_context: analystInstructions, agent_returns: {}, decision: null },

    { kind: "agent_return", phase: "gap_analysis", message: analystFeedbackIncomplete.summary, role: "analyst", orchestrator_memory: mem(story, { phase: "gap_analysis", analyst_status: "returned" }), agent_context: {}, agent_returns: analystFeedbackIncomplete, decision: null, output_note: "Missing scratchpad + structured deliverables — will fail L2 validation (attempt 1/" + VALIDATOR_MAX_ATTEMPTS + ")" },

    ...analystGate,
  ];

  const prerequisiteEvents = buildPrerequisiteInputEvents(story);

  const requiresApi = farmCtx.storyRequiresApi(story);
  const requiresWeb = farmCtx.storyRequiresWebpage(story);
  const prelimWriter = story.test_cases.map((id, i) => {
    const ac = acList[i] || acList[0] || story.title;
    return {
      id,
      title: ac.length > 80 ? ac.slice(0, 77) + "…" : ac,
      type: tcType(i, story.test_cases.length),
      when: `Scenario exercises AC #${i + 1}: ${ac.slice(0, 60)}`,
      then: "Expected behavior per AC",
    };
  });
  const humanNeed = inferHumanInputNeeds(story, null, prelimWriter);
  const needsHumanInput = humanNeed.needsHumanInput;

  const writerReturns = { success: true, test_cases: tc + " · " + story.test_cases.join(", ") };
  const writerGate = validationGateEvents("writer", "test_case_writing", story, writerReturns, {
    gateDecision: needsHumanInput ? `request human input (${humanNeed.types.join(" + ")}) before data extraction` : "proceed to test_data_extraction",
  });

  const dataExtractorReturns = {
    success: true,
    datasets: tc + " row(s)",
    fixtures: tc + " fixture file(s)",
    env_vars: needsHumanInput ? "from human input" : 3,
    source: needsHumanInput ? `human ${humanNeed.types.join("+")}` : "story context",
  };
  const dataGate = validationGateEvents("test_data_extractor", "test_data_extraction", story, dataExtractorReturns, {
    gateDecision: "proceed to test_execution",
  });

  const executorReturns = {
    success: farmCtx.isRequiredInputReady(story) && (!needsHumanInput || farmCtx.isHumanInputSatisfied(humanNeed)),
    mode: needsHumanInput
      ? (requiresApi && requiresWeb ? "api + ui (human-provided)"
        : requiresApi ? "api (human-provided)"
        : requiresWeb ? "ui (human-provided)"
        : "blocked")
      : "not run — no execution inputs required",
    executed: needsHumanInput && farmCtx.isHumanInputSatisfied(humanNeed) ? 0 : 0,
    passed: 0,
    human_api_used: requiresApi && farmCtx.humanApiInput.ok,
    human_webpage_used: requiresWeb && farmCtx.humanWebpageInput.ok,
  };
  const executorGate = validationGateEvents("test_executor", "test_execution", story, executorReturns, {
    gateDecision: "proceed to qa_review",
  });

  const reviewerReturns = { success: true, score: story.score, impact: story.priority === "High" ? "High" : "Medium", fix: "See analyst gaps + JIRA AC" };
  const reviewerGate = validationGateEvents("reviewer", "qa_review", story, reviewerReturns, {
    gateDecision: "proceed to report_generation",
  });

  const reporterReturns = { success: true, final_report: "Test Summary Report · " + s };
  const reporterGate = validationGateEvents("reporter", "report_generation", story, reporterReturns, {
    gateDecision: "proceed to goal_check",
  });

  return [
    ...coreStart,
    ...prerequisiteEvents,

    { kind: "phase_start", phase: "test_case_writing", message: "Enter phase: test_case_writing", role: null, orchestrator_memory: mem(story, { phase: "test_case_writing", gaps: gapSummary }), agent_context: {}, agent_returns: {}, decision: null },
    { kind: "agent_assign", phase: "test_case_writing", message: "Orchestrator assigns task to writer", role: "writer", orchestrator_memory: mem(story, { phase: "test_case_writing", gaps: gapSummary }), agent_context: { ticket: s, gap_analysis: "ready", acceptance_criteria: story.acceptance_criteria_list?.join(" | ") || String(story.acceptance_criteria) }, agent_returns: {}, decision: null },
    { kind: "agent_return", phase: "test_case_writing", message: "Wrote " + tc + " test case(s) for " + s + ".", role: "writer", orchestrator_memory: mem(story, { phase: "test_case_writing", gaps: gapSummary, test_cases: String(tc) }), agent_context: {}, agent_returns: writerReturns, decision: null, structured_output: "__writer__" },
    ...writerGate,

    ...buildHumanInputEvents(story, prelimWriter, null),

    { kind: "phase_start", phase: "test_data_extraction", message: "Enter phase: test_data_extraction" + (needsHumanInput ? ` (from human ${humanNeed.types.join(" + ")})` : ""), role: null, orchestrator_memory: mem(story, { phase: "test_data_extraction", test_cases: String(tc), human_input: humanNeed.types.join("+") }), agent_context: {}, agent_returns: {}, decision: null },
    { kind: "agent_assign", phase: "test_data_extraction", message: "Orchestrator assigns task to Test Data Extractor" + (needsHumanInput ? ` — extract datasets from human ${humanNeed.types.join(" + ")}` : ""), role: "test_data_extractor", orchestrator_memory: mem(story, { phase: "test_data_extraction", test_cases: String(tc) }), agent_context: { ticket: s, test_cases: tc + " item(s)", deliver: needsHumanInput ? `datasets from human ${humanNeed.types.join(" + ")}` : "datasets + fixtures per TC" }, agent_returns: {}, decision: null },
    { kind: "agent_return", phase: "test_data_extraction", message: needsHumanInput
      ? "Test Data Extractor — requires human " + humanNeed.types.join(" + ") + " before extracting datasets for " + tc + " test case(s)."
      : "Extracted test data for " + tc + " test case(s) from story context.", role: "test_data_extractor", orchestrator_memory: mem(story, { phase: "test_data_extraction", datasets: String(tc) }), agent_context: {}, agent_returns: dataExtractorReturns, decision: null, structured_output: "__test_data_extractor__" },
    ...dataGate,

    { kind: "phase_start", phase: "test_execution", message: "Enter phase: test_execution" + (needsHumanInput ? " (using requirement-driven test data)" : ""), role: null, orchestrator_memory: mem(story, { phase: "test_execution", test_cases: String(tc), human_input: humanNeed.types.join("+") }), agent_context: {}, agent_returns: {}, decision: null },
    { kind: "agent_assign", phase: "test_execution", message: "Orchestrator assigns task to Test Executor" + (needsHumanInput ? ` with human ${humanNeed.types.join(" + ")}` : ""), role: "test_executor", orchestrator_memory: mem(story, { phase: "test_execution", test_cases: String(tc) }), agent_context: { ticket: s, test_cases: tc + " item(s)", test_data: "ready", human_input_types: humanNeed.types, human_api: requiresApi && farmCtx.humanApiInput.ok ? farmCtx.humanApiInput : null, human_webpage: requiresWeb && farmCtx.humanWebpageInput.ok ? farmCtx.humanWebpageInput : null }, agent_returns: {}, decision: null },
    { kind: "agent_return", phase: "test_execution", message: needsHumanInput
      ? "Test Executor — blocked until human provides " + humanNeed.types.join(" + ") + " for " + tc + " case(s)."
      : "Test Executor planned " + tc + " case(s) — no human execution inputs required.", role: "test_executor", orchestrator_memory: mem(story, { phase: "test_execution", executed: "0" }), agent_context: {}, agent_returns: executorReturns, decision: null, structured_output: "__test_executor__" },
    ...executorGate,

    { kind: "phase_start", phase: "qa_review", message: "Enter phase: qa_review", role: null, orchestrator_memory: mem(story, { phase: "qa_review", executed: String(tc) }), agent_context: {}, agent_returns: {}, decision: null },
    { kind: "agent_assign", phase: "qa_review", message: "Orchestrator assigns task to reviewer", role: "reviewer", orchestrator_memory: mem(story, { phase: "qa_review", executed: String(tc) }), agent_context: { ticket: s, test_cases: tc + " item(s)", priority: story.priority }, agent_returns: {}, decision: null },
    { kind: "agent_return", phase: "qa_review", message: "QA score " + story.score + " — root cause and fix assessed.", role: "reviewer", orchestrator_memory: mem(story, { phase: "qa_review", score: story.score }), agent_context: {}, agent_returns: reviewerReturns, decision: null, structured_output: "__reviewer__" },
    ...reviewerGate,

    { kind: "phase_start", phase: "report_generation", message: "Enter phase: report_generation", role: null, orchestrator_memory: mem(story, { phase: "report_generation", score: story.score }), agent_context: {}, agent_returns: {}, decision: null },
    { kind: "agent_assign", phase: "report_generation", message: "Orchestrator assigns task to reporter", role: "reporter", orchestrator_memory: mem(story, { phase: "report_generation", score: story.score }), agent_context: { ticket: s, test_cases: tc + " item(s)", jira_status: story.status }, agent_returns: {}, decision: null },
    { kind: "agent_return", phase: "report_generation", message: s + ": " + tc + "/" + tc + " planned | execution " + (needsHumanInput ? "pending human input" : "not required") + " | coverage " + story.coverage + "%", role: "reporter", orchestrator_memory: mem(story, { phase: "report_generation", report: "ready" }), agent_context: {}, agent_returns: reporterReturns, decision: null, structured_output: "__reporter__" },
    ...reporterGate,

    { kind: "phase_start", phase: "goal_check", message: "Enter phase: goal_check", role: null, orchestrator_memory: mem(story, { phase: "goal_check", report: "complete" }), agent_context: {}, agent_returns: {}, decision: null },
    { kind: "orchestrator_decision", phase: "goal_check", message: "Goal achieved for " + s, role: null, orchestrator_memory: mem(story, { phase: "goal_check" }), agent_context: {}, agent_returns: {}, decision: "stop" },
    { kind: "orchestrator_decision", phase: "complete", message: "Goal check passed", role: null, orchestrator_memory: mem(story, { phase: "complete" }), agent_context: {}, agent_returns: {}, decision: "stop — success" },
    { kind: "run_end", phase: "complete", message: "Final goal achieved · " + story.title, role: null, orchestrator_memory: mem(story, { phase: "complete" }), agent_context: {}, agent_returns: {}, decision: "goal achieved" },
  ];
}

let farmCtx.EVENTS = [];
let farmCtx.storyOutputs = {};
let farmCtx.idx = -1;
let farmCtx.playing = false;
let timer = null;

const farmCtx.el = (id) => document.getElementById(id);

export function buildOrchestratorInactivityFailureEvents(story) {
  const timeoutSec = ORCHESTRATOR_INACTIVITY_TIMEOUT_MS / 1000;
  const need = farmCtx.getLiveHumanInputNeed(story);
  const waitingFor = waitingForHumanInputDescription(need);
  return [
    {
      kind: "orchestrator_inactivity_timeout",
      phase: "test_execution",
      message: `Orchestrator inactivity timeout — no orchestrator action for ${timeoutSec} seconds`,
      role: null,
      orchestrator_memory: mem(story, { phase: "aborted", reason: "orchestrator_inactivity_timeout", timeout_ms: ORCHESTRATOR_INACTIVITY_TIMEOUT_MS }),
      agent_context: { waited_ms: ORCHESTRATOR_INACTIVITY_TIMEOUT_MS, blocked_agent: "test_executor", waiting_for: waitingFor, input_types: need.types },
      agent_returns: { success: false, reason: "orchestrator_inactivity_timeout" },
      decision: "abort — orchestrator inactivity timeout",
    },
    {
      kind: "orchestrator_abort",
      phase: "orchestrator",
      target_agent: "test_executor",
      message: `Orchestrator halts pipeline — no action for ${timeoutSec} seconds while waiting for ${waitingFor}`,
      validation_feedback: { failures: [`Orchestrator inactive for ${timeoutSec}s — pipeline stalled waiting for ${waitingFor}`] },
      orchestrator_memory: mem(story, { phase: "aborted", action: "halt_pipeline", failed_agent: "test_executor", reason: "orchestrator_inactivity_timeout" }),
      agent_context: {},
      agent_returns: { success: false, reason: "orchestrator_inactivity_timeout" },
      decision: "stop — orchestrator inactivity timeout",
    },
    {
      kind: "run_failed",
      phase: "aborted",
      message: `QA run FAILED · ${story.id} · orchestrator took no action for ${timeoutSec} seconds`,
      orchestrator_memory: mem(story, { phase: "aborted", failed_agent: "test_executor", goal: "not achieved", reason: "orchestrator_inactivity_timeout" }),
      agent_context: {},
      agent_returns: { success: false, reason: "orchestrator_inactivity_timeout", agent: "test_executor", timeout_ms: ORCHESTRATOR_INACTIVITY_TIMEOUT_MS },
      decision: "run failed — orchestrator inactivity timeout",
    },
  ];
}

export function buildFeedbackLoops(upToIndex) {
  const loops = [];
  let active = null;

  for (let j = 0; j <= upToIndex; j++) {
    const rawEv = farmCtx.EVENTS[j];
    if (!rawEv) continue;
    const ev = rawEv.kind === "validator_return" ? resolveLiveValidatorReturn(rawEv) : rawEv;

    if (ev.kind === "validator_return" && !ev.passed) {
      if (active && active.agent === ev.target_agent && !active.resolved && ev.attempt === 2) {
        active.second_failure = {
          step: j + 1,
          failures: ev.validation?.failures || [],
          message: ev.message,
          brake_applied: !!ev.brake_applied,
        };
      } else {
        active = {
          id: loops.length + 1,
          agent: ev.target_agent,
          agent_label: AGENT_META[ev.target_agent]?.label || ev.target_agent,
          started_at_step: j + 1,
          feedback: {
            step: j + 1,
            attempt: ev.attempt,
            failures: ev.validation?.failures || [],
            failed_checks: (ev.validation?.checks || []).filter((c) => c.status === "fail"),
            recommendation: ev.validation?.recommendation,
            score: ev.validation?.score,
            message: ev.message,
          },
          orchestrator_action: null,
          agent_retry: null,
          outcome: null,
          resolved: false,
        };
        loops.push(active);
      }
      if (ev.brake_applied && active && active.agent === ev.target_agent) {
        active.outcome = {
          step: j + 1,
          passed: false,
          aborted: true,
          message: ev.message,
          attempt: ev.attempt,
        };
        active.aborted = true;
        active.resolved = false;
        active = null;
      }
    }

    if (ev.kind === "orchestrator_reinstruct" && active && ev.target_agent === active.agent && !active.resolved) {
      active.orchestrator_action = {
        step: j + 1,
        decision: ev.decision,
        message: ev.message,
        corrections: ev.instructions?.corrections || [],
        validator_feedback_summary: ev.instructions?.validator_feedback,
        instructions: ev.instructions,
      };
    }

    if (ev.kind === "agent_assign" && ev.is_retry && active && ev.role === active.agent && !active.resolved) {
      active.agent_retry = active.agent_retry || {};
      active.agent_retry.assign_step = j + 1;
      active.agent_retry.received_corrections = ev.feedback_addressed || ev.agent_context?.corrections || [];
      active.agent_retry.message = ev.message;
    }

    if (ev.kind === "agent_return" && ev.is_retry && active && ev.role === active.agent && !active.resolved) {
      active.agent_retry = active.agent_retry || {};
      active.agent_retry.return_step = j + 1;
      active.agent_retry.changes_made = ev.changes_made || [];
      active.agent_retry.before = ev.before_output;
      active.agent_retry.after = ev.agent_returns;
      active.agent_retry.message = ev.message;
    }

    if (ev.kind === "validator_return" && ev.passed && active && ev.target_agent === active.agent && !active.resolved) {
      active.outcome = {
        step: j + 1,
        passed: true,
        score: ev.validation?.score,
        message: ev.message,
        attempt: ev.attempt,
      };
      active.resolved = true;
      active = null;
    }

    if ((ev.kind === "validator_brake" || ev.kind === "run_failed") && active && !active.resolved && !active.aborted) {
      active.outcome = {
        step: j + 1,
        passed: false,
        aborted: true,
        message: ev.message,
        attempt: VALIDATOR_MAX_ATTEMPTS,
      };
      active.aborted = true;
      active = null;
    }
  }
  return loops;
}

export function buildOrchestratorLiveState(eventIndex) {
  if (eventIndex < 0 || !farmCtx.currentStory) return null;
  const base = farmCtx.storyOutputs.orchestrator || {};
  const phase_log = [];
  const decisions = [];
  const assignments = [];
  let current_phase = "idle";
  let current_memory = {};
  let latest_decision = null;
  let goal = null;

  let instructions_to_analyst = null;
  let feedback_from_analyst = null;
  const validation_gates = [];
  const reinstructions = [];

  for (let j = 0; j <= eventIndex; j++) {
    const ev = farmCtx.EVENTS[j];
    if (!ev) continue;
    current_memory = ev.orchestrator_memory || current_memory;
    if (ev.phase) current_phase = ev.phase;

    if (ev.kind === "orchestrator_instruct" || ev.kind === "orchestrator_reinstruct") {
      if (ev.target_agent === "analyst" || !ev.target_agent) {
        instructions_to_analyst = ev.instructions || ev.agent_context;
      }
      if (ev.kind === "orchestrator_reinstruct") {
        reinstructions.push({ step: j + 1, agent: ev.target_agent, reason: ev.validation_feedback?.failures?.join("; "), message: ev.message });
      }
      assignments.push({ step: j + 1, agent: ev.target_agent || "analyst", phase: ev.phase, message: ev.message });
    }
    if (ev.kind === "orchestrator_receive" || ev.kind === "orchestrator_gate") {
      feedback_from_analyst = ev.agent_returns || ev.feedback || ev.validation_feedback;
    }
    if (ev.kind === "validator_return") {
      validation_gates.push({
        step: j + 1,
        agent: ev.target_agent,
        passed: ev.passed,
        attempt: ev.attempt,
        score: ev.validation?.score,
        failures: ev.validation?.failures,
        brake_applied: !!ev.brake_applied,
      });
    }

    if (ev.kind === "phase_start" || ev.kind === "orchestrator_validate" || ev.kind === "orchestrator_stage"
        || ev.kind === "orchestrator_instruct" || ev.kind === "orchestrator_reinstruct"
        || ev.kind === "orchestrator_receive" || ev.kind === "orchestrator_gate"
        || ev.kind === "orchestrator_abort" || ev.kind === "validator_brake"
        || ev.kind === "orchestrator_inactivity_timeout" || ev.kind === "human_input_request" || ev.kind === "human_input_received"
        || ev.kind === "prerequisite_input_request" || ev.kind === "prerequisite_input_received"
        || ev.kind === "run_start" || ev.kind === "run_end" || ev.kind === "run_failed") {
      phase_log.push({ step: j + 1, kind: ev.kind, phase: ev.phase, message: ev.message });
    }
    if (ev.decision) {
      decisions.push({ step: j + 1, phase: ev.phase, decision: ev.decision, message: ev.message });
      latest_decision = ev.decision;
    }
    if (ev.kind === "agent_assign" && ev.role) {
      assignments.push({ step: j + 1, agent: ev.role, phase: ev.phase, message: ev.message });
    }
    if (ev.kind === "run_end") goal = ev.decision;
    if (ev.kind === "run_failed") goal = ev.decision;
  }

  const run_aborted = (farmCtx.EVENTS[eventIndex]?.kind === "run_failed")
    || EVENTS.slice(0, eventIndex + 1).some((ev) => ev.kind === "run_failed");

  return {
    ...base,
    current_phase,
    current_memory,
    latest_decision,
    goal,
    run_aborted,
    validator_max_attempts: VALIDATOR_MAX_ATTEMPTS,
    validator_guidelines: VALIDATOR_GUIDELINES.rules,
    phase_log,
    decisions,
    assignments,
    instructions_to_analyst,
    feedback_from_analyst,
    validation_gates,
    reinstructions,
    feedback_loops: buildFeedbackLoops(eventIndex),
    events_processed: eventIndex + 1,
    events_total: EVENTS.length,
  };
}
