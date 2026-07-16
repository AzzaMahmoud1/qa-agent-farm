/**
 * Upstream validated-output dependency gate.
 * Agent N may start only if Agent N-1 has structured output AND Validator approved it.
 */

/** Immediate upstream dependency per worker role (null = ticket/orchestrator only). */
export const PIPELINE_DEPENDENCY = {
  analyst: null,
  writer: "analyst",
  test_data_extractor: "writer",
  author: "test_data_extractor",
  test_executor: "author",
  reviewer: "test_executor",
  reporter: "reviewer",
};

const ROLE_LABEL = {
  analyst: "Analyst",
  writer: "Writer",
  test_data_extractor: "Data Extractor",
  author: "Author",
  test_executor: "Executor",
  reviewer: "Reviewer",
  reporter: "Reporter",
  human: "human input",
  human_input_recheck: "Reviewer human-input recheck",
};

/** True when role has a usable structured payload (shape check). */
export function hasStructuredOutput(role, output) {
  if (!output || typeof output !== "object") return false;
  if (output.blocked === true && !hasMinimumShape(role, output)) {
    // Blocked stubs still count as "returned" only when they carry the role shape;
    // empty placeholders do not.
  }
  return hasMinimumShape(role, output);
}

function hasMinimumShape(role, output) {
  switch (role) {
    case "analyst":
      return Array.isArray(output.testable_conditions) && output.testable_conditions.length > 0;
    case "writer":
      return (Array.isArray(output.test_cases) && output.test_cases.length > 0)
        || (Array.isArray(output.test_outlines) && output.test_outlines.length > 0)
        || (typeof output.test_cases === "string" && output.test_cases.trim().length > 0)
        || output.success === true;
    case "test_data_extractor":
      return Array.isArray(output.datasets) || typeof output.rows_extracted === "number"
        || output.success === true || output.blocked === true;
    case "author":
      return output.status != null || Array.isArray(output.outlines) || output.blocked === true
        || output.success === true || output.success === false;
    case "test_executor":
      return output.summary != null || Array.isArray(output.results) || output.blocked === true
        || output.success === true || output.success === false;
    case "reviewer":
      return output.score != null || output.human_input_recheck != null
        || output.fix != null || output.success === true;
    case "reporter":
      return output.final_report != null || output.ticket_key != null || output.success === true;
    default:
      return Object.keys(output).length > 0;
  }
}

/**
 * Whether Validator may approve this output (unlocks downstream).
 * Blocked / NEEDS_INPUT / PLAN_READY Author must not unlock Executor.
 */
export function isApprovableOutput(role, output) {
  if (!hasStructuredOutput(role, output)) return false;
  if (output.blocked === true) return false;
  if (role === "author") {
    return output.success === true && String(output.status || "") === "REVIEW";
  }
  if (role === "writer" || role === "test_data_extractor") {
    if (output.success === false) return false;
  }
  return true;
}

/** Collect roles that received Validator approve / orchestrator_gate in the event timeline. */
export function deriveValidatedRolesFromEvents(events, upToIndex) {
  const validated = new Set();
  if (!Array.isArray(events)) return validated;
  const end = upToIndex == null ? events.length - 1 : upToIndex;
  for (let i = 0; i <= end; i++) {
    const e = events[i];
    if (!e) continue;
    if (e.kind === "orchestrator_gate" && e.target_agent) {
      validated.add(e.target_agent);
    }
    if (e.kind === "validator_return" && e.passed && e.target_agent) {
      validated.add(e.target_agent);
    }
  }
  return validated;
}

/**
 * @param {string} role
 * @param {object} ctx
 * @param {Record<string, object>} [ctx.storyOutputs]
 * @param {Set<string>|string[]} [ctx.validatedRoles]
 * @param {string} [ctx.pipelineState]
 * @param {boolean} [ctx.requireHumanRecheck]
 * @param {boolean} [ctx.humanInputRecheckPassed]
 * @param {boolean} [ctx.needsHumanInput]
 * @param {boolean} [ctx.humanInputSatisfied]
 */
export function assertCanAssign(role, ctx = {}) {
  const dep = Object.prototype.hasOwnProperty.call(PIPELINE_DEPENDENCY, role)
    ? PIPELINE_DEPENDENCY[role]
    : undefined;

  if (role === "analyst" || dep === null) {
    return { ok: true, blocked_reason: null, missing: null };
  }
  if (dep === undefined) {
    return { ok: true, blocked_reason: null, missing: null };
  }

  const outputs = ctx.storyOutputs || {};
  const validated = ctx.validatedRoles instanceof Set
    ? ctx.validatedRoles
    : new Set(ctx.validatedRoles || []);

  if (!hasStructuredOutput(dep, outputs[dep])) {
    return {
      ok: false,
      blocked_reason: `BLOCKED — ${ROLE_LABEL[role] || role} waiting on ${ROLE_LABEL[dep] || dep} structured output`,
      missing: dep,
    };
  }
  if (!validated.has(dep)) {
    return {
      ok: false,
      blocked_reason: `BLOCKED — ${ROLE_LABEL[role] || role} waiting on validated ${ROLE_LABEL[dep] || dep} output`,
      missing: dep,
    };
  }

  if (role === "writer") {
    if (ctx.pipelineState === "WAITING_ON_HUMAN" || ctx.pipelineState === "NEEDS_INPUT") {
      return {
        ok: false,
        blocked_reason: "BLOCKED — Writer waiting on human prerequisites / clarified acceptance criteria",
        missing: "human",
      };
    }
    if (ctx.requireHumanRecheck && ctx.humanInputRecheckPassed !== true) {
      return {
        ok: false,
        blocked_reason: "BLOCKED — Writer waiting on Reviewer human-input recheck accept",
        missing: "human_input_recheck",
      };
    }
  }

  if (role === "test_data_extractor" && ctx.needsHumanInput && !ctx.humanInputSatisfied) {
    return {
      ok: false,
      blocked_reason: "BLOCKED — Data Extractor waiting on human API/webpage input",
      missing: "human",
    };
  }

  return { ok: true, blocked_reason: null, missing: null };
}

export function dependencyBlockedOutput(role, reason) {
  return {
    success: false,
    blocked: true,
    blocked_reason: reason || `BLOCKED — missing validated upstream for ${role}`,
    role,
  };
}
