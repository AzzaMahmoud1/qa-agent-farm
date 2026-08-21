/**
 * Analyst runner selection (cursor_agent_cli vs anthropic_api).
 * Run: node test/analyst-runner.js
 */
import assert from "node:assert/strict";
import {
  resolveAnalystRunner,
  parseAnthropicMessage,
  parseOpenAiCompatibleMessage,
  runRequirementAnalyst,
} from "../src/agents/requirementAnalyst.js";

// --- resolveAnalystRunner ---

{
  delete process.env.ANALYST_RUNNER;
  assert.equal(resolveAnalystRunner(), "cursor_agent_cli", "default runner must stay cursor_agent_cli");
}

{
  process.env.ANALYST_RUNNER = "anthropic_api";
  assert.equal(resolveAnalystRunner(), "anthropic_api");
  delete process.env.ANALYST_RUNNER;
}

{
  process.env.ANALYST_RUNNER = "some_other_runner";
  assert.throws(() => resolveAnalystRunner(), /Unknown ANALYST_RUNNER/);
  delete process.env.ANALYST_RUNNER;
}

// --- parseAnthropicMessage (pure function, no network needed) ---

{
  const body = {
    type: "message",
    content: [{ type: "text", text: '```json\n{"success":true}\n```' }],
    usage: { input_tokens: 120, output_tokens: 340 },
  };
  const { text, usage } = parseAnthropicMessage(body);
  assert.match(text, /"success":true/);
  assert.equal(usage.input_tokens, 120);
  assert.equal(usage.output_tokens, 340);
  assert.equal(usage.source, "envelope");
}

{
  // Multiple text blocks concatenate.
  const body = { content: [{ type: "text", text: "part1 " }, { type: "text", text: "part2" }] };
  const { text } = parseAnthropicMessage(body);
  assert.equal(text, "part1 part2");
}

{
  const body = { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } };
  assert.throws(() => parseAnthropicMessage(body), /invalid x-api-key/);
}

{
  assert.throws(() => parseAnthropicMessage({ content: [] }), /no text content/);
}

{
  assert.throws(() => parseAnthropicMessage(null), /non-object response/);
}

// --- parseOpenAiCompatibleMessage (pure function; shared by openai_api/openrouter_api/custom) ---

{
  const body = {
    choices: [{ message: { role: "assistant", content: '```json\n{"success":true}\n```' } }],
    usage: { prompt_tokens: 200, completion_tokens: 450 },
  };
  const { text, usage } = parseOpenAiCompatibleMessage(body);
  assert.match(text, /"success":true/);
  assert.equal(usage.input_tokens, 200);
  assert.equal(usage.output_tokens, 450);
}

{
  const body = { error: { message: "Incorrect API key provided" } };
  assert.throws(() => parseOpenAiCompatibleMessage(body), /Incorrect API key provided/);
}

{
  assert.throws(() => parseOpenAiCompatibleMessage({ choices: [] }), /no message content/);
}

// --- end-to-end: openai_api / openrouter_api / custom_openai_compatible fail clearly, no network call ---

for (const runner of ["openai_api", "openrouter_api"]) {
  await (async () => {
    process.env.ANALYST_RUNNER = runner;
    try {
      await assert.rejects(
        () => runRequirementAnalyst("Title: X\n\nBusiness Rules:\nBR-1: System must do X\n"),
        /requires an API key/,
        `${runner} should fail fast without a key`,
      );
    } finally {
      delete process.env.ANALYST_RUNNER;
    }
  })();
}

await (async () => {
  process.env.ANALYST_RUNNER = "custom_openai_compatible";
  try {
    await assert.rejects(
      () => runRequirementAnalyst("Title: X\n\nBusiness Rules:\nBR-1: System must do X\n"),
      /requires a base URL/,
      "custom_openai_compatible should fail fast without a base URL",
    );
  } finally {
    delete process.env.ANALYST_RUNNER;
  }
})();

// --- end-to-end: anthropic_api runner without a key fails clearly, no network call ---
// (runRequirementAnalyst's first attempt isn't try/caught internally — same as
// the cursor_agent_cli path when the binary is missing — so this throws rather
// than returning {success:false}. server.js's HTTP handler wraps the call.)

await (async () => {
  process.env.ANALYST_RUNNER = "anthropic_api";
  const savedKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    await assert.rejects(
      () => runRequirementAnalyst("Title: X\n\nBusiness Rules:\nBR-1: System must do X\n"),
      /ANTHROPIC_API_KEY/,
      "should fail fast without ANTHROPIC_API_KEY",
    );
  } finally {
    delete process.env.ANALYST_RUNNER;
    if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
  }
})();

console.log("analyst-runner tests: ok");
