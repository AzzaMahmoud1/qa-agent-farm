/**
 * Analyst MAIN GATE — Validator second-opinion checks.
 * Aligns with src/prompts/agent1_requirement_analyst_v3.md
 */

import { checkDispositionCoverage } from "./disposition-coverage.js";

const VAGUE_ASK_RE = /\b(need more info|more information|clarify|unclear|tbd|todo|n\/a|please clarify|not (enough|clear)|requirements?\s+unclear)\b/i;

// Grounding: PROCEED must be *earned* by evidence, not asserted. Mirrors the
// grounding-first contract in analyst_agent/ (dispatch.py + skills/*/schemas):
// a testable_condition is grounded only when it carries a verbatim ticket quote
// (ac_text / evidence_quote / cite) of at least this many characters after
// whitespace normalization — matching the prompt's "complete verbatim clause
// (≥ ~12 characters)" rule and schemas/output.schema.json's evidence_quote min.
const MIN_EVIDENCE_CHARS = 12;

function evidenceQuoteOf(c) {
  return String(c?.ac_text || c?.evidence_quote || c?.cite || "").replace(/\s+/g, " ").trim();
}

function isGroundedCondition(c) {
  return evidenceQuoteOf(c).length >= MIN_EVIDENCE_CHARS;
}

function missingBlocking(parsed) {
  return (parsed?.prerequisites_needed?.blocking || []).filter((b) => b && !b.satisfied_by_ticket);
}

/**
 * Prefer explicit `blocks: "design" | "execution"`; fall back to category.
 * access/environment → execution only; other categories → design.
 */
export function isDesignBlockingPrereq(b) {
  const explicit = String(b?.blocks || "").toLowerCase();
  if (explicit === "design") return true;
  if (explicit === "execution") return false;
  const cat = String(b?.category || "").toLowerCase();
  return cat !== "access" && cat !== "environment";
}

/** Missing items that block *test design* (not just later execution). */
function designBlockingMissing(parsed) {
  return missingBlocking(parsed).filter(isDesignBlockingPrereq);
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
 * @param {object|null} [story] — when provided, also enforce disposition coverage
 * @returns {{ ok: boolean, failures: string[] }}
 */
export function checkAnalystPromptContract(parsed, story = null) {
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

  // Grounding gate: a readiness claim is only valid when every condition it
  // rests on is traceable to ticket text. This makes a confident-but-fabricated
  // PROCEED unreachable — the decision inherits whatever the evidence supports.
  if ((hasProceed || parsed.ready_for_test_design === true) && Array.isArray(conditions) && conditions.length) {
    const ungrounded = conditions.filter((c) => !isGroundedCondition(c));
    if (ungrounded.length) {
      const ids = ungrounded.map((c) => c?.id || "?").join(", ");
      failures.push(`MAIN GATE: PROCEED/ready_for_test_design requires every testable_condition to carry a verbatim ticket quote ≥${MIN_EVIDENCE_CHARS} chars (grounding) — ungrounded: ${ids}`);
    }
  }

  // Visual (image-derived) evidence is a judgment about a picture — grounding
  // can confirm the image exists but not the reading drawn from it. A PROCEED
  // that rests on any `visual: true` condition must carry a confirming ASK_HUMAN.
  if (hasProceed && Array.isArray(conditions)) {
    const visualConds = conditions.filter((c) => c && c.visual === true);
    if (visualConds.length && !actions.some((a) => a && /^ASK_HUMAN$/i.test(a.action || ""))) {
      failures.push(`MAIN GATE: PROCEED with ${visualConds.length} visual (image-derived) condition(s) requires a confirming ASK_HUMAN — a visual reading cannot self-approve`);
    }
  }

  if (parsed.ready_for_test_design === true && analysisComplete === false) {
    failures.push("MAIN GATE: ready_for_test_design true requires analysis_complete true");
  }

  if (parsed.ready_for_test_design === true && hasProceed === false) {
    failures.push("MAIN GATE: ready_for_test_design true requires a PROCEED action");
  }

  if (hasProceed && parsed.ready_for_test_design !== true) {
    failures.push("MAIN GATE: PROCEED requires ready_for_test_design true");
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

  if (conf === "low" && hasProceed) {
    failures.push("MAIN GATE: low confidence cannot PROCEED — emit a blocking ASK_HUMAN or HOLD instead");
  }

  for (const a of actions) {
    if (!a || !/^ASK_HUMAN$/i.test(a.action || "")) continue;
    if (isVagueAskDetail(a.detail)) {
      failures.push(`MAIN GATE: vague ASK_HUMAN rejected (escalate with a concrete artifact) — "${String(a.detail || "").slice(0, 80)}"`);
    }
  }

  if (story) {
    const disposition = checkDispositionCoverage(story, parsed);
    for (const f of disposition.failures) failures.push(f);
  }

  return { ok: failures.length === 0, failures };
}

export { checkDispositionCoverage } from "./disposition-coverage.js";

export function isLiveAnalystOutput(parsed) {
  return parsed?.runner === "cursor_agent_cli" || parsed?.runner === "live";
}
