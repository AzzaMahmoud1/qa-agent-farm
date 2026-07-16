#!/usr/bin/env node
/**
 * Evaluation fix regression tests — run via: npm run test:eval
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { pathToFileURL, fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

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

const humanInput = await import(pathToFileURL(path.join(__dirname, "../lib/human-input.js")).href);
const redaction = await import(pathToFileURL(path.join(__dirname, "../lib/redaction.js")).href);
const httpExecutor = await import(pathToFileURL(path.join(__dirname, "../lib/http-executor.js")).href);
const nca = await import(pathToFileURL(path.join(__dirname, "../lib/nca-controls.js")).href);
const prerequisites = require("../lib/prerequisites.cjs");

const { parseCurl, inferHumanInputNeeds, formatCurlPreview } = humanInput;
const { redactParsedCurl, redactBody, containsSecret } = redaction;
const { isUrlAllowlisted } = httpExecutor;
const { parseFullRequirements, isStrongAcceptanceCriterion } = prerequisites;
const { buildNcaSecurityGaps, mergeNcaGapsIntoCoverage } = nca;

await test("curl parser supports --request PATCH and --header Authorization", () => {
  const parsed = parseCurl(`curl --request PATCH 'https://api.example.com/v1/items/1' --header 'Authorization: Bearer secret-token' --header 'Content-Type: application/json'`);
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.method, "PATCH");
  assert.ok(parsed.headers.Authorization);
});

await test("redaction covers api_key, access_token, password in JSON body", () => {
  const body = JSON.stringify({
    api_key: "sk-live-abc",
    access_token: "tok-xyz",
    password: "hunter2",
    email: "user@example.com",
  });
  const safe = redactBody(body);
  assert.ok(!safe.includes("sk-live-abc"));
  assert.ok(!safe.includes("tok-xyz"));
  assert.ok(!safe.includes("hunter2"));
  assert.ok(safe.includes("[REDACTED]"));
  assert.ok(safe.includes("user@example.com"));
  assert.ok(!containsSecret(safe));
});

await test("curl parser redacts auth and body secrets in preview", () => {
  const parsed = parseCurl(`curl --url 'https://api.example.com/ping' -H 'Authorization: Bearer abc123' -H 'X-Api-Key: key-999' --data-raw '{"password":"secret","api_key":"k"}'`);
  assert.strictEqual(parsed.ok, true, parsed.error);
  const safe = redactParsedCurl(parsed);
  assert.strictEqual(safe.auth, "[REDACTED]");
  assert.ok(safe.headers.Authorization === "[REDACTED]");
  assert.ok(!JSON.stringify(safe).includes("abc123"));
  assert.ok(!JSON.stringify(safe).includes("key-999"));
  assert.ok(!String(safe.body).includes("secret"));
  const preview = formatCurlPreview(parsed);
  assert.ok(!preview.includes("abc123"));
  assert.ok(!String(preview).includes("hunter") && !preview.includes('"password":"secret"'));
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
  assert.ok(serverSrc.includes("checkExecuteRateLimit"));
  assert.ok(serverSrc.includes("X-Execute-Token") || serverSrc.includes("x-execute-token"));
});

await test("executor denies loopback by default and requires allowlist", () => {
  assert.strictEqual(isUrlAllowlisted("http://127.0.0.1:3000/health", []), false);
  assert.strictEqual(isUrlAllowlisted("http://127.0.0.1:3000/health", ["127.0.0.1"], { allowLoopback: true }), true);
  assert.strictEqual(isUrlAllowlisted("https://evil.example.com/x", []), false);
  assert.strictEqual(isUrlAllowlisted("https://api.example.com/x", ["api.example.com"]), true);
  assert.strictEqual(isUrlAllowlisted("https://169.254.169.254/latest", ["api.example.com"]), false);
});

const approvedAuthor = {
  success: true,
  blocked: false,
  status: "REVIEW",
  outlines: [{ id: "TO-01", status: "approved" }],
  steps: [{ task_id: "T1", result: "pass" }],
};

await test("UI URL results are pending_browser not passed", async () => {
  const { setFarmCtx } = await import(pathToFileURL(path.join(__dirname, "../agents/ctx-bridge.js")).href);
  const { buildTestExecutorOutput } = await import(pathToFileURL(path.join(__dirname, "../agents/executor.js")).href);
  setFarmCtx({
    storyRequiresApi: () => false,
    storyRequiresWebpage: () => true,
    getLiveHumanInputNeed: () => ({ needsHumanInput: true, types: ["webpage"] }),
    isHumanInputSatisfied: () => true,
    getPrerequisiteCheck: () => ({ needed: false }),
    isPrerequisitesSatisfied: () => true,
    humanApiInput: { ok: false },
    humanWebpageInput: { ok: true, url: "https://app.example.com/login", title: "Login", path: "/login" },
    storyOutputs: {
      writer: { test_cases: [{ id: "TC-01", type: "happy_path" }, { id: "TC-02", type: "negative" }] },
      author: approvedAuthor,
    },
    executionResult: null,
  });
  const out = buildTestExecutorOutput(
    { id: "S1", test_cases: ["TC-01", "TC-02"] },
    null,
    { ok: true, url: "https://app.example.com/login", title: "Login", path: "/login" },
    null,
    approvedAuthor,
  );
  assert.ok(out.results.every((r) => r.status === "pending_browser"));
  assert.ok(out.results.every((r) => r.passed === false));
  assert.strictEqual(out.summary.passed, 0);
  assert.strictEqual(out.summary.measured, false);
  assert.ok(out.summary.pending_browser >= 1);
});

await test("single HTTP observation is not copied as pass for every TC", async () => {
  const { setFarmCtx } = await import(pathToFileURL(path.join(__dirname, "../agents/ctx-bridge.js")).href);
  const { buildTestExecutorOutput } = await import(pathToFileURL(path.join(__dirname, "../agents/executor.js")).href);
  setFarmCtx({
    storyRequiresApi: () => true,
    storyRequiresWebpage: () => false,
    getLiveHumanInputNeed: () => ({ needsHumanInput: true, types: ["api"] }),
    isHumanInputSatisfied: () => true,
    getPrerequisiteCheck: () => ({ needed: false }),
    isPrerequisitesSatisfied: () => true,
    humanApiInput: { ok: true, method: "GET", url: "https://api.example.com/x", endpoint: "/x", headers: {} },
    humanWebpageInput: { ok: false },
    storyOutputs: {
      writer: { test_cases: [{ id: "TC-01" }, { id: "TC-02" }, { id: "TC-03" }] },
      author: approvedAuthor,
    },
    executionResult: {
      executed: true,
      http_ok: true,
      status: 200,
      evidence: "GET https://api.example.com/x → HTTP 200",
      request: { method: "GET", url: "https://api.example.com/x", headers: {} },
      response: { status: 200, body_snippet: "{}" },
    },
  });
  const out = buildTestExecutorOutput(
    { id: "S1", test_cases: ["TC-01", "TC-02", "TC-03"] },
    { ok: true, method: "GET", url: "https://api.example.com/x", endpoint: "/x", headers: {} },
    null,
    {
      executed: true,
      http_ok: true,
      status: 200,
      evidence: "GET https://api.example.com/x → HTTP 200",
      request: { method: "GET", url: "https://api.example.com/x", headers: {} },
      response: { status: 200, body_snippet: "{}" },
    },
    approvedAuthor,
  );
  assert.strictEqual(out.results[0].status, "transport_observed");
  assert.strictEqual(out.results[0].passed, false);
  assert.strictEqual(out.results[1].status, "not_executed");
  assert.strictEqual(out.results[2].status, "not_executed");
  assert.strictEqual(out.summary.passed, 0);
  assert.strictEqual(out.summary.measured, false);
  assert.strictEqual(out.summary.transport_observed, 1);
});

await test("NCA/ECC security gaps include injection IDOR and bypass", () => {
  const story = {
    title: "Admin payment API",
    description: "Admin may refund via API endpoint with role checks",
    acceptance_criteria_list: ["Admin may refund a payment", "Customer may view only their own payment"],
  };
  const ncaOut = buildNcaSecurityGaps(story);
  assert.strictEqual(ncaOut.applicable, true);
  assert.strictEqual(ncaOut.compliance_evidence.release_gate, "blocked");
  const ids = ncaOut.gaps.map((g) => g.security_test_id);
  assert.ok(ids.includes("injection"));
  assert.ok(ids.includes("idor"));
  assert.ok(ids.includes("url_manipulation"));
  assert.ok(ids.includes("api_exposure"));
  assert.ok(ids.includes("auth_bypass"));
  const merged = mergeNcaGapsIntoCoverage([], story);
  assert.ok(merged.gaps.length >= 5);
});

await test("production agent modules import", async () => {
  await import(pathToFileURL(path.join(__dirname, "../agents/index.js")).href);
});

await test("package.json declares type module", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));
  assert.strictEqual(pkg.type, "module");
  assert.ok(pkg.engines.node.includes("18"));
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
  for (const role of ["validator", "analyst", "writer", "test_data_extractor", "author", "test_executor", "reviewer", "reporter"]) {
    assert.strictEqual(registry.getModelForAgent(role), "claude-4.6-sonnet", role);
  }
  assert.ok(registry.AGENT_ROLES.includes("author"), "author role registered");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
