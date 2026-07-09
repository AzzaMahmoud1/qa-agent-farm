#!/usr/bin/env node
/**
 * Evaluation fix regression tests — run via: npm run test:eval
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log("✓", name);
      passed++;
    })
    .catch((e) => {
      console.log("✗", name, "—", e.message);
      failed++;
    });
}

(async () => {
  const humanInput = await import(pathToFileURL(path.join(__dirname, "../lib/human-input.js")).href);
  const redaction = await import(pathToFileURL(path.join(__dirname, "../lib/redaction.js")).href);
  const httpExecutor = await import(pathToFileURL(path.join(__dirname, "../lib/http-executor.js")).href);
  const prerequisites = require("../lib/prerequisites.js");

  const { parseCurl, inferHumanInputNeeds } = humanInput;
  const { redactParsedCurl, containsSecret } = redaction;
  const { isUrlAllowlisted } = httpExecutor;
  const { parseFullRequirements, isStrongAcceptanceCriterion } = prerequisites;

  await test("curl parser supports --request PATCH and --header Authorization", () => {
    const parsed = parseCurl(`curl --request PATCH 'https://api.example.com/v1/items/1' --header 'Authorization: Bearer secret-token' --header 'Content-Type: application/json'`);
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.method, "PATCH");
    assert.ok(parsed.headers.Authorization);
  });

  await test("curl parser redacts auth in safe export", () => {
    const parsed = parseCurl(`curl -H 'Authorization: Bearer abc123' https://api.example.com/ping`);
    const safe = redactParsedCurl(parsed);
    assert.strictEqual(safe.auth, "[REDACTED]");
    assert.ok(safe.headers.Authorization === "[REDACTED]");
    assert.ok(!JSON.stringify(safe).includes("abc123"));
  });

  await test("inferHumanInputNeeds keeps both api and webpage surfaces", () => {
    const story = {
      id: "DEMO-1",
      title: "Payment refund",
      description: "Admin refunds via API and customer views dashboard in browser",
      acceptance_criteria_list: [
        "Admin may refund a payment via POST /api/payments/refund",
        "Customer may view only their own payment on the dashboard page",
      ],
      test_cases: ["TC-01", "TC-02"],
    };
    const need = inferHumanInputNeeds(story, null, null);
    assert.ok(need.types.includes("api"));
    assert.ok(need.types.includes("webpage"));
    assert.strictEqual(need.types.length, 2);
  });

  await test("authorization rules are accepted as acceptance criteria", () => {
    assert.strictEqual(isStrongAcceptanceCriterion("Customer may view only their own payment", "business_rules"), true);
    assert.strictEqual(isStrongAcceptanceCriterion("Admin may refund a payment", "business_rules"), true);
  });

  await test("BDD time-limit criterion is accepted", () => {
    assert.strictEqual(isStrongAcceptanceCriterion("Reset link expires after 15 minutes", "business_rules"), true);
  });

  await test("pure data-table field constraint is rejected", () => {
    assert.strictEqual(isStrongAcceptanceCriterion("Field: email — string, max length 255", "data_table"), false);
  });

  await test("server static allowlist blocks dotfiles", () => {
    const serverSrc = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
    assert.ok(serverSrc.includes('base.startsWith(".")'));
    assert.ok(serverSrc.includes("PUBLIC_DIRS"));
    assert.ok(!serverSrc.includes('Access-Control-Allow-Origin": "*"'));
  });

  await test("executor allowlist permits localhost only by default", () => {
    assert.strictEqual(isUrlAllowlisted("http://127.0.0.1:3000/health", []), true);
    assert.strictEqual(isUrlAllowlisted("https://evil.example.com/x", []), false);
  });

  await test("production agent modules import", async () => {
    await import(pathToFileURL(path.join(__dirname, "../agents/index.js")).href);
  });

  const authStory = parseFullRequirements(
    "Payment rules\n\nBusiness Rules:\n- Customer may view only their own payment\n- Admin may refund a payment\n- Reset link expires after 15 minutes\n",
  );

  await test("requirements parser keeps authorization and time-limit rules", () => {
    const acs = authStory.acceptance_criteria_list;
    assert.ok(acs.some((a) => /only their own payment/i.test(a)));
    assert.ok(acs.some((a) => /refund/i.test(a)));
    assert.ok(acs.some((a) => /expires after 15 minutes/i.test(a)));
  });

  await test("model routing: orchestrator Fable 5, workers Sonnet", async () => {
    const registry = await import(pathToFileURL(path.join(__dirname, "../agents/registry.js")).href);
    assert.strictEqual(registry.MODEL_ORCHESTRATOR, "claude-fable-5");
    assert.strictEqual(registry.MODEL_WORKER, "claude-4.6-sonnet");
    assert.strictEqual(registry.getModelForAgent("orchestrator"), "claude-fable-5");
    for (const role of ["validator", "analyst", "writer", "test_data_extractor", "test_executor", "reviewer", "reporter"]) {
      assert.strictEqual(registry.getModelForAgent(role), "claude-4.6-sonnet", role);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
