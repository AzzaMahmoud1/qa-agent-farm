/**
 * Deliberative Orchestrator control plane (observe → judge → decide → act → log).
 * Does not invent Analyst PROCEED/ASK — judges handoffs after Validator + IO checks.
 */

import { checkIoConsistency, HANDOFF } from "./io-consistency.js";

export const ORCH_ACTION = {
  ASSIGN: "ASSIGN",
  PROCEED: "PROCEED",
  RETRY: "RETRY",
  ASK_HUMAN: "ASK_HUMAN",
  HOLD: "HOLD",
  REPLAN: "REPLAN",
  ABORT: "ABORT",
};

/**
 * @param {object} opts
 * @param {string} opts.handoff
 * @param {object} opts.ctx — story + agent outputs for IO check
 * @param {object} [opts.validation] — buildValidationResult-shaped
 * @param {object} [opts.analystActions] — orchestrator_actions from Analyst
 * @param {number} [opts.attempt]
 * @param {number} [opts.maxAttempts]
 * @returns {object} decision record
 */
export function deliberateHandoff(opts = {}) {
  const {
    handoff,
    ctx = {},
    validation = null,
    analystActions = null,
    attempt = 1,
    maxAttempts = 2,
  } = opts;

  const io = checkIoConsistency(handoff, ctx);
  const observed = {
    handoff,
    validation_passed: validation ? !!validation.passed : null,
    io_ok: io.ok,
    quality: io.quality,
    attempt,
  };

  const evidence = [
    ...io.evidence,
    ...(io.failures || []).slice(0, 4),
    ...(validation?.detail_failures || validation?.failures || []).slice(0, 3),
  ];

  // Analyst actions still win for ticket readiness (do not invent PROCEED).
  if (handoff === HANDOFF.TICKET_ANALYST && Array.isArray(analystActions) && analystActions.length) {
    const blocking = analystActions.filter((a) => a && a.blocking === true);
    const hasProceed = analystActions.some((a) => a && a.action === "PROCEED" && !a.blocking);
    if (blocking.length) {
      const ask = blocking.find((a) => /ASK_HUMAN/i.test(a.action || ""));
      return record({
        action: ask ? ORCH_ACTION.ASK_HUMAN : ORCH_ACTION.HOLD,
        rationale: ask
          ? `Analyst blocking ask — ${ask.detail || ask.action}`
          : `Analyst blocking action(s) — hold before Writer`,
        evidence: [...evidence, ...blocking.map((a) => a.detail || a.action)],
        observed,
        io,
        blocking: true,
      });
    }
    if (!io.ok || (validation && !validation.passed)) {
      if (attempt >= maxAttempts) {
        return record({
          action: ORCH_ACTION.ASK_HUMAN,
          rationale: "Validator/IO rejected Analyst after max attempts — escalate to human",
          evidence,
          observed,
          io,
          blocking: true,
        });
      }
      return record({
        action: ORCH_ACTION.RETRY,
        rationale: "Analyst failed structural/fidelity checks — reinstruct once",
        evidence,
        observed,
        io,
        blocking: true,
      });
    }
    if (hasProceed && io.quality.overall === "low") {
      return record({
        action: ORCH_ACTION.HOLD,
        rationale: "Schema/PROCEED present but handoff quality low — refuse silent advance",
        evidence,
        observed,
        io,
        blocking: true,
      });
    }
    if (hasProceed) {
      return record({
        action: ORCH_ACTION.PROCEED,
        rationale: "Analyst PROCEED + Validator/IO pass — assign Writer",
        evidence,
        observed,
        io,
        blocking: false,
        next_agent: "writer",
      });
    }
  }

  // Generic handoff judgment
  if (validation && !validation.passed) {
    if (attempt >= maxAttempts) {
      return record({
        action: handoff === HANDOFF.TICKET_ANALYST ? ORCH_ACTION.ASK_HUMAN : ORCH_ACTION.ABORT,
        rationale: `Validation failed at ${handoff} on attempt ${attempt}/${maxAttempts}`,
        evidence,
        observed,
        io,
        blocking: true,
      });
    }
    return record({
      action: ORCH_ACTION.RETRY,
      rationale: `Validation failed at ${handoff} — one retry left`,
      evidence,
      observed,
      io,
      blocking: true,
    });
  }

  if (!io.ok) {
    if (io.quality.invention_risk === "high") {
      return record({
        action: ORCH_ACTION.REPLAN,
        rationale: `IO fidelity failed at ${handoff} — invention risk high; reopen upstream`,
        evidence,
        observed,
        io,
        blocking: true,
      });
    }
    return record({
      action: ORCH_ACTION.RETRY,
      rationale: `IO consistency failed at ${handoff}: ${(io.failures[0] || "fidelity/coverage")}`,
      evidence,
      observed,
      io,
      blocking: true,
    });
  }

  if (io.quality.overall === "low") {
    return record({
      action: ORCH_ACTION.HOLD,
      rationale: `Handoff quality low at ${handoff} — refuse PROCEED`,
      evidence,
      observed,
      io,
      blocking: true,
    });
  }

  return record({
    action: ORCH_ACTION.PROCEED,
    rationale: `IO + validation pass at ${handoff} (quality ${io.quality.overall})`,
    evidence,
    observed,
    io,
    blocking: false,
  });
}

function record({ action, rationale, evidence, observed, io, blocking, next_agent = null }) {
  return {
    kind: "orchestrator_decision_record",
    action,
    rationale,
    evidence: evidence || [],
    observed,
    io_summary: {
      ok: io.ok,
      structural_ok: io.structural_ok,
      fidelity_ok: io.fidelity_ok,
      coverage_ok: io.coverage_ok,
      quality: io.quality,
      failures: io.failures,
    },
    blocking: !!blocking,
    next_agent,
    decided_at: new Date().toISOString(),
  };
}

/** Attach decision onto an orchestrator_gate / agent event. */
export function withDecisionRecord(event, decision) {
  if (!event || !decision) return event;
  return {
    ...event,
    decision: `${decision.action}: ${decision.rationale}`,
    orchestrator_decision: decision,
    agent_context: {
      ...(event.agent_context || {}),
      orchestrator_decision: decision,
    },
  };
}
