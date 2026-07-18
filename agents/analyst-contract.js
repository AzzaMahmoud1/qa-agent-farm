/**
 * Analyst prompt MAIN GATE — readiness contract checks.
 * Orchestrator must execute Analyst actions; it must not invent readiness.
 */

function missingBlocking(parsed) {
  return (parsed?.prerequisites_needed?.blocking || []).filter((b) => b && !b.satisfied_by_ticket);
}

function actionsOf(parsed) {
  return parsed?.analyst_report?.orchestrator_actions || [];
}

/**
 * @param {object} parsed — Analyst JSON
 * @returns {{ ok: boolean, failures: string[] }}
 */
export function checkAnalystPromptContract(parsed) {
  const failures = [];
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, failures: ["Analyst output must be an object"] };
  }

  const conditions = parsed.testable_conditions;
  const actions = actionsOf(parsed);
  const missing = missingBlocking(parsed);
  const hasProceed = actions.some((a) => a && a.action === "PROCEED");
  const blockingActs = actions.filter((a) => a && a.blocking === true);
  const conf = String(parsed.analyst_report?.confidence?.overall || "").toLowerCase();

  if (!Array.isArray(actions) || actions.length === 0) {
    failures.push("MAIN GATE: orchestrator_actions must be non-empty (Analyst owns readiness)");
  }

  if (Array.isArray(conditions) && conditions.length === 0 && hasProceed) {
    failures.push("MAIN GATE: PROCEED forbidden when testable_conditions is empty");
  }

  if (parsed.ready_for_test_design === true && hasProceed === false) {
    failures.push("MAIN GATE: ready_for_test_design true requires a PROCEED action");
  }

  if (hasProceed && blockingActs.length) {
    failures.push("MAIN GATE: cannot emit PROCEED together with blocking orchestrator_actions");
  }

  if (hasProceed && missing.length) {
    failures.push(`MAIN GATE: PROCEED while ${missing.length} blocking prerequisite(s) still missing`);
  }

  if (parsed.ready_for_test_design === true && missing.length) {
    failures.push("MAIN GATE: ready_for_test_design true while blocking prerequisites are missing");
  }

  if (missing.length && !blockingActs.length) {
    failures.push("MAIN GATE: every missing blocking prerequisite must map to a blocking ASK_HUMAN / FETCH_DEPENDENCY / HOLD");
  }

  if (conf === "low" && hasProceed && !blockingActs.some((a) => /ASK_HUMAN|HOLD/i.test(a.action || ""))) {
    failures.push("MAIN GATE: low confidence cannot PROCEED alone — need ASK_HUMAN or HOLD");
  }

  return { ok: failures.length === 0, failures };
}

export function isLiveAnalystOutput(parsed) {
  return parsed?.runner === "cursor_agent_cli" || parsed?.runner === "live";
}
