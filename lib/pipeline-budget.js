/**
 * Pipeline budget tracker — token / cost / wall-clock caps.
 *
 * Honesty: simulated stub agents (Writer, Data, Author, Executor, Reviewer, Reporter)
 * do not emit Cursor Agent CLI usage. Only live Analyst attempts currently capture
 * input_tokens/output_tokens when the CLI envelope includes them. Cost USD is computed
 * only when PIPELINE_USD_PER_MILLION_TOKENS is set, or when usage includes cost_usd.
 */
import {
  PIPELINE_TOKEN_BUDGET,
  PIPELINE_COST_BUDGET_USD,
  PIPELINE_MAX_RUNTIME_MS,
  PIPELINE_USD_PER_MILLION_TOKENS,
} from "../agents/registry.js";

export function createBudgetTracker(opts = {}) {
  return {
    started_at: opts.startedAt || Date.now(),
    token_budget: opts.tokenBudget ?? PIPELINE_TOKEN_BUDGET,
    cost_budget_usd: opts.costBudgetUsd ?? PIPELINE_COST_BUDGET_USD,
    max_runtime_ms: opts.maxRuntimeMs ?? PIPELINE_MAX_RUNTIME_MS,
    usd_per_million_tokens: opts.usdPerMillionTokens ?? PIPELINE_USD_PER_MILLION_TOKENS,
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
    usage_events: 0,
    usage_unavailable_agents: [],
    halted: false,
    halt_reason: null,
  };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Accumulate usage from a Cursor Agent CLI attempt envelope (when present).
 * @returns {{ recorded: boolean, reason?: string }}
 */
export function accumulateUsage(tracker, usage, meta = {}) {
  if (!tracker || tracker.halted) return { recorded: false, reason: "halted_or_missing_tracker" };
  const agent = meta.agent || "unknown";
  if (!usage || typeof usage !== "object") {
    if (!tracker.usage_unavailable_agents.includes(agent)) {
      tracker.usage_unavailable_agents.push(agent);
    }
    return {
      recorded: false,
      reason: "usage_unavailable — stub agents and some CLI responses do not include token fields; not fabricating",
    };
  }

  const input = num(usage.input_tokens);
  const output = num(usage.output_tokens);
  tracker.input_tokens += input;
  tracker.output_tokens += output;
  tracker.usage_events += 1;

  if (usage.cost_usd != null && Number.isFinite(Number(usage.cost_usd))) {
    tracker.cost_usd += Number(usage.cost_usd);
  } else if (tracker.usd_per_million_tokens != null && Number.isFinite(tracker.usd_per_million_tokens)) {
    tracker.cost_usd += ((input + output) / 1_000_000) * tracker.usd_per_million_tokens;
  }

  return { recorded: true };
}

export function totalTokens(tracker) {
  return (tracker?.input_tokens || 0) + (tracker?.output_tokens || 0);
}

export function checkBudget(tracker, now = Date.now()) {
  if (!tracker) {
    return { ok: true, exceeded: null, snapshot: null };
  }
  if (tracker.halted) {
    return { ok: false, exceeded: tracker.halt_reason, snapshot: budgetSnapshot(tracker, now) };
  }

  const elapsed = now - (tracker.started_at || now);
  if (tracker.max_runtime_ms > 0 && elapsed > tracker.max_runtime_ms) {
    tracker.halted = true;
    tracker.halt_reason = "pipeline_max_runtime_exceeded";
    return { ok: false, exceeded: tracker.halt_reason, snapshot: budgetSnapshot(tracker, now) };
  }

  const tokens = totalTokens(tracker);
  if (tracker.token_budget > 0 && tracker.usage_events > 0 && tokens > tracker.token_budget) {
    tracker.halted = true;
    tracker.halt_reason = "pipeline_token_budget_exceeded";
    return { ok: false, exceeded: tracker.halt_reason, snapshot: budgetSnapshot(tracker, now) };
  }

  if (
    tracker.cost_budget_usd > 0
    && tracker.usage_events > 0
    && tracker.cost_usd > tracker.cost_budget_usd
  ) {
    tracker.halted = true;
    tracker.halt_reason = "pipeline_cost_budget_exceeded";
    return { ok: false, exceeded: tracker.halt_reason, snapshot: budgetSnapshot(tracker, now) };
  }

  return { ok: true, exceeded: null, snapshot: budgetSnapshot(tracker, now) };
}

export function budgetSnapshot(tracker, now = Date.now()) {
  if (!tracker) return null;
  return {
    started_at: tracker.started_at,
    elapsed_ms: now - (tracker.started_at || now),
    max_runtime_ms: tracker.max_runtime_ms,
    token_budget: tracker.token_budget,
    cost_budget_usd: tracker.cost_budget_usd,
    input_tokens: tracker.input_tokens,
    output_tokens: tracker.output_tokens,
    total_tokens: totalTokens(tracker),
    cost_usd: Number(tracker.cost_usd.toFixed(6)),
    usage_events: tracker.usage_events,
    usage_unavailable_agents: [...(tracker.usage_unavailable_agents || [])],
    usage_note: tracker.usage_events === 0
      ? "No CLI usage captured this run — token/cost budgets idle until live Analyst (or other CLI) usage is present; wall-clock still enforced"
      : "Accumulated from captured CLI usage envelopes only",
    halted: tracker.halted,
    halt_reason: tracker.halt_reason,
  };
}

/** Seed tracker from live Analyst attempts on the story when present. */
export function seedBudgetFromStory(tracker, story) {
  const attempts = story?.live_analyst_output?.attempts
    || story?.live_analyst_output?.parsed?.attempts
    || [];
  if (!Array.isArray(attempts) || !attempts.length) {
    accumulateUsage(tracker, null, { agent: "analyst" });
    return tracker;
  }
  for (const a of attempts) {
    accumulateUsage(tracker, a?.usage || null, { agent: "analyst" });
  }
  return tracker;
}

export function budgetExceededEvents(story, tracker, check) {
  const snap = check?.snapshot || budgetSnapshot(tracker);
  const reason = check?.exceeded || tracker?.halt_reason || "budget_exceeded";
  return [
    {
      kind: "budget_exceeded",
      phase: "aborted",
      message: `Pipeline budget exceeded — ${reason}`,
      role: null,
      orchestrator_memory: {
        ticket: story?.id,
        phase: "aborted",
        reason,
        budget: snap,
      },
      agent_context: { budget: snap },
      agent_returns: { success: false, reason, budget: snap },
      decision: `abort — ${reason}`,
    },
    {
      kind: "orchestrator_abort",
      phase: "aborted",
      message: `Orchestrator halts pipeline — ${reason}`,
      role: null,
      orchestrator_memory: { ticket: story?.id, phase: "aborted", reason },
      agent_context: { budget: snap },
      agent_returns: { success: false, reason },
      decision: `halt_pipeline — ${reason}`,
    },
    {
      kind: "run_failed",
      phase: "aborted",
      message: `QA run FAILED · ${story?.id} · ${reason}`,
      role: null,
      orchestrator_memory: { ticket: story?.id, phase: "aborted", reason, goal: "not achieved" },
      agent_context: {},
      agent_returns: { success: false, reason, budget: snap },
      decision: `run failed — ${reason}`,
    },
  ];
}
