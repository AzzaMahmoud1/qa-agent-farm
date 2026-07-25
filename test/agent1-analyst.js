/**
 * Unit tests for Agent 1 extractFinalJson + validateAnalystOutput + thin orchestrator gate.
 * Run: node test/agent1-analyst.js
 */
import assert from "node:assert/strict";
import { extractFinalJson } from "../src/agents/utils/extractFinalJson.js";
import {
  validateAnalystOutput,
  effortForAttempt,
  extractUsageFromEnvelope,
  buildRetryExtra,
} from "../src/agents/requirementAnalyst.js";
import { checkAnalystPromptContract } from "../agents/analyst-contract.js";
import {
  resolveAnalystOrchestratorGate,
  ensureAnalystReportActions,
  PIPELINE_STATE,
} from "../agents/orchestrator.js";

function validParsed(overrides = {}) {
  return {
    success: true,
    analyst_reasoning: {
      ticket_read: "ok",
      ambiguous_acs: [],
      unimplemented_rules: [],
      rejected_as_non_ac: [],
    },
    testable_conditions: [{ id: "AC-1" }],
    prerequisites_needed: { blocking: [], non_blocking: [] },
    coverage_gaps: [],
    analyst_report: {
      what_i_did: ["scanned"],
      why: [],
      orchestrator_actions: [
        { action: "PROCEED", target: "writer", detail: "go", blocking: false },
      ],
      confidence: { overall: "high", reason: "ok" },
    },
    analysis_complete: true,
    ready_for_test_design: true,
    summary: "1 condition",
    ...overrides,
  };
}

// --- extractFinalJson ---
{
  const full = `AMBIGUITY SCAN:\n- [CLEAN]\n\n\`\`\`json\n{"scratch":true}\n\`\`\`\n\nmore\n\n\`\`\`json\n${JSON.stringify(validParsed())}\n\`\`\``;
  const { scratchpad, parsed } = extractFinalJson(full);
  assert.ok(scratchpad.includes("AMBIGUITY SCAN"));
  assert.equal(parsed.success, true);
  assert.equal(parsed.summary, "1 condition");
}

{
  assert.throws(() => extractFinalJson("no json here"), /No ```json/);
}

{
  assert.throws(
    () => extractFinalJson("```json\n{bad}\n```"),
    /Failed to parse/,
  );
}

// --- validateAnalystOutput + MAIN GATE ---
{
  assert.equal(validateAnalystOutput(validParsed()), true);
  assert.throws(() => validateAnalystOutput({ success: true }), /missing required keys/);
  assert.throws(
    () => validateAnalystOutput(validParsed({ prerequisites_needed: {} })),
    /blocking must be an array/,
  );
  assert.throws(
    () => validateAnalystOutput(validParsed({
      testable_conditions: [],
      ready_for_test_design: true,
    })),
    /MAIN GATE|PROCEED forbidden|ready_for_test_design/i,
  );
  // A5: analyst_reasoning required + shape
  {
    const missingReasoning = validParsed();
    delete missingReasoning.analyst_reasoning;
    assert.throws(() => validateAnalystOutput(missingReasoning), /analyst_reasoning/);
  }
  assert.throws(
    () => validateAnalystOutput(validParsed({
      analyst_reasoning: {
        ambiguous_acs: "not-an-array",
        unimplemented_rules: [],
        rejected_as_non_ac: [],
      },
    })),
    /analyst_reasoning\.ambiguous_acs must be an array/,
  );
}

{
  const bad = checkAnalystPromptContract(validParsed({
    ready_for_test_design: true,
    analyst_report: {
      what_i_did: [],
      why: [],
      orchestrator_actions: [],
    },
  }));
  assert.equal(bad.ok, false);
  assert.ok(bad.failures.some((f) => /non-empty|PROCEED/i.test(f)));
}

// --- thin orchestrator gate (executes Analyst actions only) ---
{
  const hold = resolveAnalystOrchestratorGate(validParsed({
    ready_for_test_design: false,
    analyst_report: {
      what_i_did: [],
      why: [],
      orchestrator_actions: [
        { action: "ASK_HUMAN", target: "human", detail: "need URL", blocking: true },
      ],
    },
  }));
  assert.equal(hold.state, PIPELINE_STATE.WAITING_ON_HUMAN);
  assert.equal(hold.proceed, false);
  assert.equal(hold.blocking_actions[0].action, "ASK_HUMAN");
}

{
  const go = resolveAnalystOrchestratorGate(validParsed());
  assert.equal(go.state, PIPELINE_STATE.READY_FOR_WRITER);
  assert.equal(go.proceed, true);
  assert.ok(go.writer_input.testable_conditions.length);
}

{
  // Empty actions → contract incomplete (NEEDS_INPUT), not invented clarification.
  const unclear = resolveAnalystOrchestratorGate(validParsed({
    ready_for_test_design: false,
    analyst_report: { what_i_did: [], why: [], orchestrator_actions: [] },
  }));
  assert.equal(unclear.state, PIPELINE_STATE.NEEDS_INPUT);
  assert.equal(unclear.proceed, false);
  assert.match(unclear.message || "", /MAIN GATE|incomplete/i);
}

{
  // HOLD is passed through — not rewritten to ASK_HUMAN.
  const holdPass = resolveAnalystOrchestratorGate(validParsed({
    ready_for_test_design: false,
    analyst_report: {
      what_i_did: [],
      why: [],
      orchestrator_actions: [
        { action: "HOLD", target: "human", detail: "waiting on product decision", blocking: true },
      ],
    },
  }));
  assert.equal(holdPass.state, PIPELINE_STATE.WAITING_ON_HUMAN);
  assert.equal(holdPass.blocking_actions[0].action, "HOLD");
}

{
  // Live path: do not invent actions when omitted.
  const live = ensureAnalystReportActions({
    success: true,
    runner: "cursor_agent_cli",
    ready_for_test_design: false,
    testable_conditions: [{ id: "AC-1" }],
    prerequisites_needed: { blocking: [], non_blocking: [] },
    analyst_report: { what_i_did: [], why: [] },
  });
  assert.equal(live.prompt_contract_broken, true);
  assert.deepEqual(live.analyst_report.orchestrator_actions, []);
}

{
  // Stub: access-only missing → PROCEED (blocks execution later, not design).
  const derived = ensureAnalystReportActions({
    success: true,
    analysis_complete: true,
    ready_for_test_design: true,
    testable_conditions: [{ id: "AC-1" }],
    prerequisites_needed: {
      blocking: [{ item: "Staging URL", category: "access", satisfied_by_ticket: false }],
      non_blocking: [],
    },
  });
  assert.equal(derived.analyst_report.orchestrator_actions[0].action, "PROCEED");
  assert.equal(derived.analyst_report.orchestrator_actions[0].blocking, false);
}

{
  // Stub: design-blocking knowledge gap → ASK_HUMAN.
  const ask = ensureAnalystReportActions({
    success: true,
    analysis_complete: true,
    ready_for_test_design: false,
    testable_conditions: [{ id: "AC-1" }],
    prerequisites_needed: {
      blocking: [{ item: "Confirm role mapping for AC-1", category: "knowledge", satisfied_by_ticket: false }],
      non_blocking: [],
    },
  });
  assert.equal(ask.analyst_report.orchestrator_actions[0].action, "ASK_HUMAN");
  assert.equal(ask.analyst_report.orchestrator_actions[0].blocking, true);
}

{
  // Login gap + execution-only URL → both blocking ASKs in the same gate.
  const both = ensureAnalystReportActions({
    success: true,
    analysis_complete: true,
    ready_for_test_design: false,
    testable_conditions: [{ id: "AC-1" }],
    prerequisites_needed: {
      blocking: [
        { id: "login_user", item: "Login test user", category: "data", satisfied_by_ticket: false },
        {
          id: "target_environment",
          item: "Where to test",
          category: "environment",
          blocks: "execution",
          satisfied_by_ticket: false,
        },
      ],
      non_blocking: [],
    },
  });
  const acts = both.analyst_report.orchestrator_actions;
  assert.equal(acts.length, 2);
  assert.ok(acts.every((a) => a.action === "ASK_HUMAN" && a.blocking === true));
  assert.ok(acts.some((a) => a.prereq_id === "login_user"));
  assert.ok(acts.some((a) => a.prereq_id === "target_environment"));
  const urlPrereq = both.prerequisites_needed.blocking.find((b) => b.id === "target_environment");
  assert.equal(urlPrereq.blocks, "design");
}

{
  const emptyAc = resolveAnalystOrchestratorGate(validParsed({
    testable_conditions: [],
    ready_for_test_design: true,
  }));
  assert.equal(emptyAc.state, PIPELINE_STATE.NEEDS_INPUT);
  assert.equal(emptyAc.proceed, false);
}

// --- effort + retry payload (token-cost helpers) ---
{
  const prevEffort = process.env.ANALYST_EFFORT;
  const prevRetry = process.env.ANALYST_RETRY_EFFORT;
  delete process.env.ANALYST_EFFORT;
  delete process.env.ANALYST_RETRY_EFFORT;
  // Default stays high until medium is empirically validated against retry rate.
  assert.equal(effortForAttempt(1), "high");
  assert.equal(effortForAttempt(2), "high");
  process.env.ANALYST_EFFORT = "medium";
  assert.equal(effortForAttempt(1), "medium");
  assert.equal(effortForAttempt(2), "medium"); // retry falls back to ANALYST_EFFORT
  process.env.ANALYST_RETRY_EFFORT = "high";
  assert.equal(effortForAttempt(2), "high");
  if (prevEffort === undefined) delete process.env.ANALYST_EFFORT;
  else process.env.ANALYST_EFFORT = prevEffort;
  if (prevRetry === undefined) delete process.env.ANALYST_RETRY_EFFORT;
  else process.env.ANALYST_RETRY_EFFORT = prevRetry;
}

{
  const u = extractUsageFromEnvelope({
    result: "ok",
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 80 },
  });
  assert.equal(u.input_tokens, 100);
  assert.equal(u.output_tokens, 50);
  assert.equal(u.cache_read_input_tokens, 80);
  assert.equal(extractUsageFromEnvelope({ result: "ok" }), null);
}

{
  const err = new Error("MAIN GATE: PROCEED requires ready_for_test_design true");
  err.parsed = { success: true, ready_for_test_design: false };
  const extra = buildRetryExtra(err, "long scratchpad that must not appear " + "x".repeat(100));
  assert.match(extra, /Failures:/);
  assert.match(extra, /corrected final/);
  assert.match(extra, /"ready_for_test_design":false/);
  assert.doesNotMatch(extra, /long scratchpad that must not appear/);

  const extractFail = new Error("No ```json fenced block");
  extractFail.extractFailed = true;
  const raw = "prefix-" + "y".repeat(2500);
  const truncated = buildRetryExtra(extractFail, raw);
  assert.ok(truncated.includes(raw.slice(-2000)));
  assert.ok(!truncated.includes("prefix-"));
}

console.log("agent1-analyst tests: ok");
