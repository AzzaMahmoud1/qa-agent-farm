/**
 * Analyst MAIN GATE — Validator second-opinion checks.
 * Aligns with src/prompts/agent1_requirement_analyst_v3.md
 */

const VAGUE_ASK_RE = /\b(need more info|more information|clarify|unclear|tbd|todo|n\/a|please clarify|not (enough|clear)|requirements?\s+unclear)\b/i;

function missingBlocking(parsed) {
  return (parsed?.prerequisites_needed?.blocking || []).filter((b) => b && !b.satisfied_by_ticket);
}

/** Missing items that block *test design* (not just later execution). */
function designBlockingMissing(parsed) {
  return missingBlocking(parsed).filter((b) => {
    const cat = String(b.category || "").toLowerCase();
    // Access / env URL usually block execution, not AC design.
    return cat !== "access" && cat !== "environment";
  });
}

function actionsOf(parsed) {
  return parsed?.analyst_report?.orchestrator_actions || [];
}

function isVagueAskDetail(detail) {
  const d = String(detail || "").trim();
  if (d.length < 16) return true;
  if (VAGUE_ASK_RE.test(d)) return true;
  if (!/\b(url|uri|credential|password|token|api|curl|env|environment|staging|uat|role|account|username|confirm|provide|supply|decision|ticket|id)\b/i.test(d)) {
    return true;
  }
  return false;
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
  const designMissing = designBlockingMissing(parsed);
  const hasProceed = actions.some((a) => a && a.action === "PROCEED");
  const blockingActs = actions.filter((a) => a && a.blocking === true);
  const conf = String(parsed.analyst_report?.confidence?.overall || "").toLowerCase();
  const analysisComplete = parsed.analysis_complete;

  if (!Array.isArray(actions) || actions.length === 0) {
    failures.push("MAIN GATE: orchestrator_actions must be non-empty (Analyst readiness proposal required)");
  }

  if (typeof analysisComplete !== "boolean") {
    failures.push("MAIN GATE: analysis_complete must be a boolean");
  }

  if (Array.isArray(conditions) && conditions.length === 0 && hasProceed) {
    failures.push("MAIN GATE: PROCEED forbidden when testable_conditions is empty");
  }

  if (Array.isArray(conditions) && conditions.length === 0 && parsed.ready_for_test_design === true) {
    failures.push("MAIN GATE: ready_for_test_design true forbidden when testable_conditions is empty");
  }

  if (parsed.ready_for_test_design === true && analysisComplete === false) {
    failures.push("MAIN GATE: ready_for_test_design true requires analysis_complete true");
  }

  if (parsed.ready_for_test_design === true && hasProceed === false) {
    failures.push("MAIN GATE: ready_for_test_design true requires a PROCEED action");
  }

  if (hasProceed && blockingActs.length) {
    failures.push("MAIN GATE: cannot emit PROCEED together with blocking orchestrator_actions");
  }

  // Design-blocking gaps (knowledge / dependency / data that prevent writing ACs) — not mere access.
  if (hasProceed && designMissing.length) {
    failures.push(`MAIN GATE: PROCEED while ${designMissing.length} design-blocking prerequisite(s) still missing`);
  }

  if (parsed.ready_for_test_design === true && designMissing.length) {
    failures.push("MAIN GATE: ready_for_test_design true while design-blocking prerequisites are missing");
  }

  if (missing.length && !blockingActs.length && !hasProceed) {
    failures.push("MAIN GATE: every missing blocking prerequisite must map to a blocking ASK_HUMAN / FETCH_DEPENDENCY / HOLD");
  }

  if (conf === "low" && hasProceed && !blockingActs.some((a) => /ASK_HUMAN|HOLD/i.test(a.action || ""))) {
    failures.push("MAIN GATE: low confidence cannot PROCEED alone — need ASK_HUMAN or HOLD");
  }

  for (const a of actions) {
    if (!a || !/^ASK_HUMAN$/i.test(a.action || "")) continue;
    if (isVagueAskDetail(a.detail)) {
      failures.push(`MAIN GATE: vague ASK_HUMAN rejected (escalate with a concrete artifact) — "${String(a.detail || "").slice(0, 80)}"`);
    }
  }

  return { ok: failures.length === 0, failures };
}

export function isLiveAnalystOutput(parsed) {
  return parsed?.runner === "cursor_agent_cli" || parsed?.runner === "live";
}
