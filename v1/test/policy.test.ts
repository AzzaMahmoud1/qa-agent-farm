import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canTransition, assertTransition } from "../src/domain/run-state.js";
import { redactHeaders, redactJsonValue, containsSecret } from "../src/policy/redaction.js";
import { isUrlAllowlisted, isPrivateOrLoopbackHost } from "../src/policy/allowlist.js";
import { buildNcaScenarios, requestNeedsNca } from "../src/policy/nca.js";

describe("run-state", () => {
  it("allows draft → control_mapping_pending", () => {
    assert.equal(canTransition("draft", "control_mapping_pending"), true);
  });

  it("rejects passed → executing", () => {
    assert.equal(canTransition("passed", "executing"), false);
    assert.throws(() => assertTransition("passed", "executing"));
  });
});

describe("redaction", () => {
  it("redacts secret JSON keys", () => {
    const out = redactJsonValue({
      api_key: "sk-live-secret",
      access_token: "tok_abc",
      password: "hunter2",
      user: "alice",
    }) as Record<string, string>;
    assert.equal(out.api_key, "[REDACTED]");
    assert.equal(out.access_token, "[REDACTED]");
    assert.equal(out.password, "[REDACTED]");
    assert.equal(out.user, "alice");
  });

  it("redacts Authorization header", () => {
    const h = redactHeaders({ Authorization: "Bearer super-secret", Accept: "application/json" });
    assert.equal(h.Authorization, "[REDACTED]");
    assert.equal(h.Accept, "application/json");
  });

  it("detects unredacted secrets in text", () => {
    assert.equal(containsSecret('"api_key": "sk-123"'), true);
    assert.equal(containsSecret('"api_key": "[REDACTED]"'), false);
  });
});

describe("allowlist", () => {
  it("denies loopback by default", () => {
    assert.equal(isPrivateOrLoopbackHost("127.0.0.1"), true);
    assert.equal(isUrlAllowlisted("http://127.0.0.1/x", ["127.0.0.1"]), false);
  });

  it("allows loopback when opted in", () => {
    assert.equal(
      isUrlAllowlisted("http://127.0.0.1/x", ["127.0.0.1"], { allowLoopback: true }),
      true,
    );
  });

  it("allows public host on allowlist", () => {
    assert.equal(isUrlAllowlisted("https://api.example.com/v1", ["example.com"]), true);
    assert.equal(isUrlAllowlisted("https://evil.com/v1", ["example.com"]), false);
  });
});

describe("nca", () => {
  it("flags auth-related requirements", () => {
    assert.equal(
      requestNeedsNca({
        product: "p",
        owner: "o",
        title: "Login",
        requirements: "User can authenticate with password",
        surfaces: ["api"],
      }),
      true,
    );
  });

  it("builds security scenarios when applicable", () => {
    const scenarios = buildNcaScenarios({
      product: "p",
      owner: "o",
      title: "API access",
      requirements: "token-based auth",
      surfaces: ["api"],
      nca_applicable: true,
    });
    assert.ok(scenarios.length >= 5);
    assert.ok(scenarios.every((s) => s.type === "security"));
  });
});
