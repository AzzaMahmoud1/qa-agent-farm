/** @see .cursor/skills/qa-orchestrator/SKILL.md */
export const AGENT_ID = "orchestrator";
export const SKILL_PATH = ".cursor/skills/qa-orchestrator/SKILL.md";
export const SKILL_FOLDER = ".cursor/skills/qa-orchestrator";

import { farmCtx } from "./ctx-bridge.js";
import { AGENT_META, AGENT_ROLES, AGENT_GUIDELINES, VALIDATOR_MAX_ATTEMPTS, ORCHESTRATOR_INACTIVITY_TIMEOUT_MS, VALIDATOR_GUIDELINES } from "./registry.js";
import { buildAnalystOutputPayload, buildAnalystPrerequisitePayload } from "./analyst.js";
import { inferTcType } from "./writer.js";
import { inferHumanInputNeeds } from "../lib/human-input.js";
import { getLiveRequirements } from "../lib/requirements.js";
import { buildValidationResult, validateAnalystOutputLive, DATA_EXTRACTOR_API_CHECKS } from "./validator.js";
import { analystReturnV1, buildAnalystReturnV2 } from "./demo-fixtures.js";

/** Pipeline pause after Agent 1 when orchestrator_actions are blocking. */
export const PIPELINE_STATE = {
  RUNNING: "RUNNING",
  WAITING_ON_HUMAN: "WAITING_ON_HUMAN",
  NEEDS_INPUT: "NEEDS_INPUT",
  READY_FOR_WRITER: "READY_FOR_WRITER",
};

/** True when Agent 1 produced at least one structured testable condition. */
export function hasTestableConditions(parsed) {
  return Array.isArray(parsed?.testable_conditions) && parsed.testable_conditions.length > 0;
}

/**
 * After Agent 1 resolves — decide whether to hold for human or proceed to Agent 2.
 * @param {object} parsed Analyst JSON (parsed)
 * @returns {{
 *   state: string,
 *   blocking_actions: Array<object>,
 *   proceed: boolean,
 *   writer_input: { testable_conditions: Array, prerequisites_needed: object } | null,
 *   message: string | null,
 * }}
 */
export function resolveAnalystOrchestratorGate(parsed) {
  const actions = parsed?.analyst_report?.orchestrator_actions || [];
  const blocking = actions.filter((a) => a && a.blocking === true);

  // Hard gate: zero validated ACs → never proceed to Writer/Author.
  if (!hasTestableConditions(parsed)) {
    const acAsk = blocking.length
      ? blocking
      : [{
        action: "ASK_HUMAN",
        target: "human",
        detail: "Provide testable acceptance criteria or clarified test intent — zero validated ACs; Writer/Author blocked",
        blocking: true,
      }];
    return {
      state: PIPELINE_STATE.NEEDS_INPUT,
      blocking_actions: acAsk,
      proceed: false,
      writer_input: null,
      message: "INVALID_REQUIREMENTS — zero testable conditions",
    };
  }

  if (blocking.length) {
    return {
      state: PIPELINE_STATE.WAITING_ON_HUMAN,
      blocking_actions: blocking,
      proceed: false,
      writer_input: null,
      message: null,
    };
  }

  const hasProceed = actions.some((a) => a && a.action === "PROCEED");
  if (parsed?.ready_for_test_design === true && hasProceed) {
    return {
      state: PIPELINE_STATE.READY_FOR_WRITER,
      blocking_actions: [],
      proceed: true,
      writer_input: {
        testable_conditions: parsed.testable_conditions || [],
        prerequisites_needed: parsed.prerequisites_needed || { blocking: [], non_blocking: [] },
      },
      message: null,
    };
  }

  return {
    state: PIPELINE_STATE.WAITING_ON_HUMAN,
    blocking_actions: actions.length
      ? actions
      : [{
        action: "HOLD",
        target: "human",
        detail: "Analyst did not clear the ticket",
        blocking: true,
      }],
    proceed: false,
    writer_input: null,
    message: "Analyst did not clear the ticket",
  };
}

/**
 * Derive orchestrator_actions when the simulated analyst path has none (compat).
 */
export function ensureAnalystReportActions(parsed) {
  if (!parsed || typeof parsed !== "object") return parsed;
  const report = parsed.analyst_report || {};
  if (Array.isArray(report.orchestrator_actions) && report.orchestrator_actions.length) {
    return parsed;
  }

  const missingBlocking = (parsed.prerequisites_needed?.blocking || []).filter((b) => !b.satisfied_by_ticket);
  let orchestrator_actions;
  if (!hasTestableConditions(parsed)) {
    orchestrator_actions = [{
      action: "ASK_HUMAN",
      target: "human",
      detail: "Provide testable acceptance criteria or clarified test intent — zero validated ACs; Writer/Author blocked",
      blocking: true,
    }];
  } else if (missingBlocking.length) {
    orchestrator_actions = missingBlocking.map((b) => ({
      action: "ASK_HUMAN",
      target: "human",
      detail: b.item || "Provide missing prerequisite",
      blocking: true,
    }));
  } else if (parsed.ready_for_test_design === true) {
    orchestrator_actions = [{
      action: "PROCEED",
      target: "writer",
      detail: "Proceed to Test Case Writer with testable_conditions",
      blocking: false,
    }];
  } else {
    orchestrator_actions = [{
      action: "HOLD",
      target: "human",
      detail: "Analyst did not clear the ticket",
      blocking: true,
    }];
  }

  parsed.analyst_report = {
    what_i_did: report.what_i_did || ["Simulated analyst path — actions derived from prerequisites"],
    why: report.why || [],
    assumptions_made: report.assumptions_made || [],
    orchestrator_actions,
    confidence: report.confidence || { overall: "medium", reason: "derived from simulated analyst output" },
  };
  return parsed;
}

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

  function assignEv(attemptNum, outputSnapshot) {
    return {
      kind: "validator_assign",
      phase,
      role: "validator",
      target_agent: targetAgent,
      attempt: attemptNum,
      message: `Validator check ${attemptNum}/${VALIDATOR_MAX_ATTEMPTS} — ${meta.label} output vs ${g.level} guidelines`,
      orchestrator_memory: mem(story, { phase, validation: "in_progress", target: targetAgent, attempt: attemptNum }),
      agent_context: {
        target_agent: targetAgent,
        attempt: attemptNum,
        max_attempts: VALIDATOR_MAX_ATTEMPTS,
        validator_guidelines: VALIDATOR_GUIDELINES.rules,
        worker_guidelines: g.rules,
        required_deliverables: g.required_deliverables,
        agent_output: outputSnapshot || agentReturns,
      },
      agent_returns: {},
      decision: null,
    };
  }

  function returnEv(passed, validation, attemptNum, brake) {
    return {
      kind: "validator_return",
      phase,
      role: "validator",
      target_agent: targetAgent,
      passed,
      validation,
      attempt: attemptNum,
      brake_applied: !!brake,
      message: passed
        ? `Validation PASSED for ${meta.label} on attempt ${attemptNum}/${VALIDATOR_MAX_ATTEMPTS} (${validation.score})`
        : brake
          ? `Validation FAILED for ${meta.label} on attempt ${attemptNum}/${VALIDATOR_MAX_ATTEMPTS} — brake applied, run aborts`
          : `Validation FAILED for ${meta.label} on attempt ${attemptNum}/${VALIDATOR_MAX_ATTEMPTS}: ${validation.failures.join("; ")}`,
      orchestrator_memory: mem(story, {
        phase,
        validation: passed ? "passed" : brake ? "brake" : "failed",
        target: targetAgent,
        attempt: attemptNum,
      }),
      agent_context: { validation, attempt: attemptNum, attempts_remaining: passed ? 0 : VALIDATOR_MAX_ATTEMPTS - attemptNum },
      agent_returns: validation,
      decision: passed
        ? "approve — orchestrator may proceed"
        : brake
          ? "abort — 2nd failure, no retry"
          : `reject — 1 retry allowed (${VALIDATOR_MAX_ATTEMPTS - attemptNum} left)`,
    };
  }

  function gateEv(validation, attemptNum) {
    return {
      kind: "orchestrator_gate",
      phase: "orchestrator",
      target_agent: targetAgent,
      message: opts.gateMessage || `Orchestrator approved ${meta.label} output (passed on attempt ${attemptNum}) — advancing pipeline`,
      validation_feedback: validation,
      orchestrator_memory: mem(story, { phase: "orchestrator", gate: targetAgent, validation: "passed", attempt: attemptNum }),
      agent_context: {},
      agent_returns: validation,
      decision: opts.gateDecision,
    };
  }

  events.push(assignEv(1));
  if (failAttempts.has(1)) {
    events.push(returnEv(false, failValidation, 1, false));
    events.push({
      kind: "orchestrator_reinstruct",
      phase: "orchestrator",
      target_agent: targetAgent,
      message: `Orchestrator re-instructs ${meta.label} (1 retry remaining before run abort)`,
      instructions: opts.retryInstructions,
      validation_feedback: failValidation,
      orchestrator_memory: mem(story, { phase: "orchestrator", action: "reinstruct_" + targetAgent, retries_left: 1 }),
      agent_context: opts.retryInstructions,
      agent_returns: failValidation,
      decision: `retry ${targetAgent} — last chance: ${failValidation.failures[0]}`,
    });
    if (opts.retryEvents) events.push(...opts.retryEvents);

    events.push(assignEv(2, opts.retryOutput || agentReturns));
    if (failAttempts.has(2)) {
      events.push(returnEv(false, failValidation2, 2, true));
      events.push(...abortRunEvents(targetAgent, phase, story, failValidation2));
      return events;
    }
    events.push(returnEv(true, passValidation, 2, false));
    events.push(gateEv(passValidation, 2));
  } else {
    events.push(returnEv(true, passValidation, 1, false));
    events.push(gateEv(passValidation, 1));
  }
  return events;
}

export function buildRequirementsFailureDemo(story) {
  const s = story.id;
  const acList = story.acceptance_criteria_list || [];
  const acPreview = acList.slice(0, 2).join("; ") || story.acceptance_criteria + " criteria";

  const analystInstructions = {
    target_agent: "Requirement Analyst (L2 — Forced Scratchpad Mode)",
    task: "Analyze JIRA ticket — scratchpad A–E then structured JSON",
    ticket: s + " · " + story.title,
    acceptance_criteria: acList.length ? acList : [acPreview],
    constraints: "Only use ticket context — do not assume unlisted behavior",
    priority: story.priority,
  };

  const analystReturnV2 = buildAnalystReturnV2(story);

  const retryInstructions = {
    target_agent: "Requirement Analyst (L2)",
    task: "RETRY — address validator feedback (last attempt)",
    validator_feedback: "Multiple L2 guideline failures on attempt 1",
    corrections: [
      "Map every acceptance criterion to a testable condition ID",
      "Add related_files with controller, service, and spec paths",
      "Split coverage gaps into blocking vs non-blocking",
    ],
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

export function buildPrerequisiteInputEvents(story, analystParsed) {
  const parsed = ensureAnalystReportActions(
    analystParsed || buildAnalystOutputPayload(story),
  );
  const gate = resolveAnalystOrchestratorGate(parsed);
  const check = buildAnalystPrerequisitePayload(story);

  // Zero ACs: hold for clarified requirements — do NOT emit a "received → proceed" event.
  if (gate.state === PIPELINE_STATE.NEEDS_INPUT || !hasTestableConditions(parsed)) {
    return [
      {
        kind: "prerequisite_input_request",
        phase: "gap_analysis",
        pipeline_state: PIPELINE_STATE.NEEDS_INPUT,
        orchestrator_actions: gate.blocking_actions,
        prerequisite_need: {
          needed: true,
          items: check.needed ? (check.items || []) : [],
          already_satisfied: check.already_satisfied || [],
          not_applicable: check.not_applicable || [],
          summary: gate.message || "INVALID_REQUIREMENTS — zero testable conditions",
          blocking: parsed.prerequisites_needed?.blocking || [],
          non_blocking: parsed.prerequisites_needed?.non_blocking || [],
          reasoning: check.reasoning || "",
          reasoning_steps: check.reasoning_steps || [],
          story_analysis: check.story_analysis,
        },
        message: gate.message
          || "INVALID_REQUIREMENTS — zero validated testable conditions. Provide acceptance criteria before Writer/Author.",
        role: null,
        orchestrator_memory: mem(story, {
          phase: "gap_analysis",
          pipeline_state: PIPELINE_STATE.NEEDS_INPUT,
          blocking_actions: String(gate.blocking_actions.length),
          awaiting: "testable_acceptance_criteria",
        }),
        agent_context: {
          pipeline_state: PIPELINE_STATE.NEEDS_INPUT,
          orchestrator_actions: gate.blocking_actions,
          source: "Requirement Analyst — zero testable_conditions",
        },
        agent_returns: { success: false, reason: "invalid_requirements", testable_conditions: 0 },
        decision: "NEEDS_INPUT — Writer/Author blocked until testable ACs exist",
      },
    ];
  }

  // Agent 1 gate: blocking orchestrator_actions → WAITING_ON_HUMAN (stop before Agent 2)
  if (gate.state === PIPELINE_STATE.WAITING_ON_HUMAN) {
    return [
      {
        kind: "prerequisite_input_request",
        phase: "gap_analysis",
        pipeline_state: PIPELINE_STATE.WAITING_ON_HUMAN,
        orchestrator_actions: gate.blocking_actions,
        prerequisite_need: {
          needed: true,
          items: check.needed ? (check.items || []) : [],
          already_satisfied: check.already_satisfied || [],
          not_applicable: check.not_applicable || [],
          summary: gate.message || parsed.summary || "Waiting on human before Test Case Writer",
          blocking: parsed.prerequisites_needed?.blocking || [],
          non_blocking: parsed.prerequisites_needed?.non_blocking || [],
          reasoning: check.reasoning || "",
          reasoning_steps: check.reasoning_steps || [],
          story_analysis: check.story_analysis,
        },
        message: gate.message
          || `Analyst gate — WAITING_ON_HUMAN (${gate.blocking_actions.length} blocking action(s)). Resolve checklist before Agent 2.`,
        role: null,
        orchestrator_memory: mem(story, {
          phase: "gap_analysis",
          pipeline_state: PIPELINE_STATE.WAITING_ON_HUMAN,
          blocking_actions: String(gate.blocking_actions.length),
          awaiting: "human_orchestrator_actions",
        }),
        agent_context: {
          pipeline_state: PIPELINE_STATE.WAITING_ON_HUMAN,
          orchestrator_actions: gate.blocking_actions,
          source: "Requirement Analyst analyst_report.orchestrator_actions",
        },
        agent_returns: {},
        decision: "WAITING_ON_HUMAN — stop before Agent 2 (Test Case Writer)",
      },
      {
        kind: "prerequisite_input_received",
        phase: "gap_analysis",
        pipeline_state: PIPELINE_STATE.READY_FOR_WRITER,
        orchestrator_actions: gate.blocking_actions,
        prerequisite_need: check,
        message: "Human resolved orchestrator actions — resume to Agent 2 (Test Case Writer)",
        role: null,
        orchestrator_memory: mem(story, { phase: "gap_analysis", prerequisites: "received", pipeline_state: PIPELINE_STATE.READY_FOR_WRITER }),
        agent_context: {
          source: "human",
          writer_input: {
            testable_conditions: parsed.testable_conditions || [],
            prerequisites_needed: parsed.prerequisites_needed || { blocking: [], non_blocking: [] },
          },
        },
        agent_returns: {},
        decision: "proceed to test_case_writing",
      },
    ];
  }

  // PROCEED path — no human gate; writer receives testable_conditions + prerequisites_needed
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
    target_agent: "Agent 1 — Requirement Analyst (L3 — Cursor Agent · Sonnet 5 high)",
    task: "Analyze ticket — produce scratchpad Activities A–E, then final JSON with analyst_report",
    ticket: s + " · " + story.title,
    acceptance_criteria: acList.length ? acList : [acPreview],
    constraints: "Never extract ACs from Pre-conditions, Basic Flow, Post-conditions, or metadata",
    priority: story.priority,
  };

  const analystFull = buildAnalystOutputPayload(story);
  const analystPrereqPayload = buildAnalystPrerequisitePayload(story);

  const analystWithActions = ensureAnalystReportActions({ ...analystFull });
  const analystGateDecision = resolveAnalystOrchestratorGate(analystWithActions);

  const analystFeedback = {
    success: true,
    scratchpad: analystWithActions.scratchpad,
    analyst_reasoning: analystWithActions.analyst_reasoning,
    testable_conditions: analystWithActions.testable_conditions,
    coverage_gaps: analystWithActions.coverage_gaps,
    affected_components: analystWithActions.affected_components,
    related_files: analystWithActions.related_files,
    prerequisites_needed: { ...analystPrereqPayload, blocking: analystWithActions.prerequisites_needed?.blocking || [], non_blocking: analystWithActions.prerequisites_needed?.non_blocking || [] },
    analyst_report: analystWithActions.analyst_report,
    ready_for_test_design: analystWithActions.ready_for_test_design,
    summary: analystWithActions.summary,
    pipeline_state: analystGateDecision.state,
    writer_input: analystGateDecision.writer_input,
  };

  // Default pipeline = real run: one Analyst return, then live validate.
  // Forced incomplete→fail→retry lives only in demo: "requirements" (Demos panel).
  const analystQuality = validateAnalystOutputLive(story, analystFeedback);
  const analystGateBase = {
    gateMessage: analystPrereqPayload.needed
      ? "Orchestrator received validated analyst output — will request human prerequisites next"
      : "Orchestrator received validated analyst feedback — proceeding to test design",
    gateDecision: analystPrereqPayload.needed ? "request human prerequisites" : "proceed to test_case_writing",
  };
  let analystGateOpts;
  if (analystQuality.passed) {
    analystGateOpts = {
      ...analystGateBase,
      failAttempts: [],
      failValidation: analystQuality,
    };
  } else {
    const corrections = (analystQuality.failures || []).slice(0, 4);
    const retryInstructions = {
      target_agent: "Requirement Analyst (L2)",
      task: "RETRY — address validator feedback (last attempt)",
      validator_feedback: (analystQuality.failures || []).join("; ") || "L2 guideline failures",
      corrections: corrections.length
        ? corrections
        : ["Re-run scratchpad A–E and resubmit full structured JSON"],
    };
    analystGateOpts = {
      ...analystGateBase,
      failAttempts: [1, 2],
      failures: analystQuality.failures || [],
      failRecommendation: analystQuality.recommendation
        || "Fix validator failures and resubmit full Analyst JSON",
      failValidation: analystQuality,
      failures2: analystQuality.failures || [],
      failRecommendation2: analystQuality.recommendation
        || "Analyst output still invalid after retry — run will abort",
      failValidation2: analystQuality,
      retryInstructions,
      retryOutput: analystFeedback,
      retryEvents: [
        {
          kind: "agent_assign",
          phase: "gap_analysis",
          message: "Analyst receives orchestrator re-instructions (validator retry 1/1)",
          role: "analyst",
          is_retry: true,
          feedback_addressed: retryInstructions.corrections,
          orchestrator_memory: mem(story, { phase: "gap_analysis", awaiting: "analyst_retry", retries_left: 0 }),
          agent_context: retryInstructions,
          agent_returns: {},
          decision: null,
        },
        {
          kind: "agent_return",
          phase: "gap_analysis",
          message: (analystFeedback.summary || "Analyst resubmit") + " (retry)",
          role: "analyst",
          is_retry: true,
          before_output: analystFeedback,
          changes_made: retryInstructions.corrections,
          orchestrator_memory: mem(story, { phase: "gap_analysis", analyst_status: "returned_retry" }),
          agent_context: {},
          agent_returns: analystFeedback,
          decision: null,
          structured_output: "__analyst__",
        },
      ],
    };
  }

  const analystGate = validationGateEvents("analyst", "gap_analysis", story, analystFeedback, analystGateOpts);

  const coreStart = [
    { kind: "run_start", phase: "init", message: "Orchestrator received ticket " + s + (story.from_jira ? " (live from JIRA)" : ""), role: null, orchestrator_memory: mem(story, { phase: "init", source: story.from_jira ? "jira" : "mock" }), agent_context: {}, agent_returns: {}, decision: "begin QA pipeline — orchestrator leads" },

    { kind: "orchestrator_stage", phase: "orchestrator", message: "Stage 1: Orchestrator validates ticket (" + story.acceptance_criteria + " AC · " + story.issueType + " · " + story.priority + ")", role: null, orchestrator_memory: mem(story, { phase: "orchestrator", stage: "1", validation: "valid", component }), agent_context: {}, agent_returns: {}, decision: "assign Requirement Analyst — analyze prerequisites" },

    { kind: "orchestrator_instruct", phase: "orchestrator", message: "Orchestrator issues instructions to Requirement Analyst", role: null, target_agent: "analyst", instructions: analystInstructions, orchestrator_memory: mem(story, { phase: "orchestrator", stage: "1", action: "instruct_analyst" }), agent_context: analystInstructions, agent_returns: {}, decision: null },

    { kind: "agent_assign", phase: "gap_analysis", message: "Analyst receives orchestrator instructions", role: "analyst", orchestrator_memory: mem(story, { phase: "gap_analysis", awaiting: "analyst" }), agent_context: analystInstructions, agent_returns: {}, decision: null },

    {
      kind: "agent_return",
      phase: "gap_analysis",
      message: analystFeedback.summary,
      role: "analyst",
      orchestrator_memory: mem(story, { phase: "gap_analysis", analyst_status: "returned" }),
      agent_context: {},
      agent_returns: analystFeedback,
      decision: null,
      structured_output: "__analyst__",
      output_note: analystQuality.passed
        ? "Live Analyst output — proceeding to single validator check"
        : `Live Analyst output failed quality checks (${(analystQuality.failures || []).length}) — validator retry path`,
    },

    ...analystGate,
  ];

  const prerequisiteEvents = buildPrerequisiteInputEvents(story, analystWithActions);

  // Hard stop: never append Writer→Author→Reporter success path with zero ACs.
  if (!hasTestableConditions(analystWithActions)) {
    return [
      ...coreStart,
      ...prerequisiteEvents,
      {
        kind: "run_failed",
        phase: "aborted",
        message: `QA run FAILED · ${s} · zero testable acceptance criteria`,
        role: null,
        orchestrator_memory: mem(story, {
          phase: "aborted",
          reason: "invalid_requirements",
          testable_conditions: "0",
          goal: "not achieved",
        }),
        agent_context: {},
        agent_returns: { success: false, reason: "invalid_requirements", testable_conditions: 0 },
        decision: "run failed — invalid requirements (zero testable conditions)",
      },
    ];
  }

  const requiresApi = farmCtx.storyRequiresApi(story);
  const requiresWeb = farmCtx.storyRequiresWebpage(story);
  const prelimWriter = story.test_cases.map((id, i) => {
    const ac = acList[i] || acList[0] || story.title;
    return {
      id,
      title: ac.length > 80 ? ac.slice(0, 77) + "…" : ac,
      type: inferTcType(ac, i, story.test_cases.length),
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
    gateDecision: "proceed to test_authoring",
  });

  const authorReturns = {
    success: false,
    status: "BUILDING",
    mode: "plan_act_reflect (stub until S2)",
    blocked: true,
    outlines: tc,
  };
  const authorGate = validationGateEvents("author", "test_authoring", story, authorReturns, {
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

    { kind: "phase_start", phase: "test_authoring", message: "Enter phase: test_authoring (Plan→Act→Reflect)", role: null, orchestrator_memory: mem(story, { phase: "test_authoring", test_cases: String(tc) }), agent_context: {}, agent_returns: {}, decision: null },
    { kind: "agent_assign", phase: "test_authoring", message: "Orchestrator assigns task to Test Author", role: "author", orchestrator_memory: mem(story, { phase: "test_authoring", test_cases: String(tc) }), agent_context: { ticket: s, test_cases: tc + " item(s)", mode: "plan_act_reflect" }, agent_returns: {}, decision: null },
    { kind: "agent_return", phase: "test_authoring", message: "Test Author staged session for " + tc + " case(s) — live Playwright authoring lands in S2.", role: "author", orchestrator_memory: mem(story, { phase: "test_authoring", status: "BUILDING" }), agent_context: {}, agent_returns: authorReturns, decision: null, structured_output: "__author__" },
    ...authorGate,

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
    || farmCtx.EVENTS.slice(0, eventIndex + 1).some((ev) => ev.kind === "run_failed");

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
    events_total: farmCtx.EVENTS.length,
  };
}
