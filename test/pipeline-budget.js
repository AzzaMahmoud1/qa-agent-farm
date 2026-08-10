import assert from "node:assert/strict";
import {
  createBudgetTracker,
  accumulateUsage,
  checkBudget,
  seedBudgetFromStory,
  totalTokens,
} from "../lib/pipeline-budget.js";

const t = createBudgetTracker({
  startedAt: Date.now() - 1000,
  tokenBudget: 100,
  costBudgetUsd: 1,
  maxRuntimeMs: 60_000,
  usdPerMillionTokens: 10,
});

const miss = accumulateUsage(t, null, { agent: "writer" });
assert.equal(miss.recorded, false);
assert.match(miss.reason, /usage_unavailable/);

accumulateUsage(t, { input_tokens: 40, output_tokens: 20 }, { agent: "analyst" });
assert.equal(totalTokens(t), 60);
assert.ok(t.cost_usd > 0);

const ok = checkBudget(t);
assert.equal(ok.ok, true);
assert.match(ok.snapshot.usage_note, /Accumulated from captured/);

accumulateUsage(t, { input_tokens: 50, output_tokens: 50 }, { agent: "analyst" });
const overTokens = checkBudget(t);
assert.equal(overTokens.ok, false);
assert.equal(overTokens.exceeded, "pipeline_token_budget_exceeded");

const clock = createBudgetTracker({
  startedAt: Date.now() - 10_000,
  maxRuntimeMs: 1000,
  tokenBudget: 1_000_000,
  costBudgetUsd: 100,
});
const overTime = checkBudget(clock);
assert.equal(overTime.ok, false);
assert.equal(overTime.exceeded, "pipeline_max_runtime_exceeded");

const seeded = createBudgetTracker({ tokenBudget: 1_000_000, costBudgetUsd: 100, maxRuntimeMs: 60_000 });
seedBudgetFromStory(seeded, {
  live_analyst_output: {
    attempts: [{ usage: { input_tokens: 10, output_tokens: 5 } }],
  },
});
assert.equal(totalTokens(seeded), 15);

console.log("pipeline-budget tests: ok");
