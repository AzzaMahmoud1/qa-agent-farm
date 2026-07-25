/** Shared input-shape validation. Run: node test/input-shapes.js */
import assert from "node:assert/strict";
import {
  evaluateProvidedValue,
  inferExpectedShape,
  isPlaceholder,
  looksLikeUrl,
  resolveExpectedShape,
  SHAPE_EXPECTATIONS,
} from "../lib/input-shapes.js";

assert.equal(looksLikeUrl("https://staging.example.com/login"), true);
assert.equal(looksLikeUrl("asdf"), false);

assert.equal(isPlaceholder("asdf"), true);
assert.equal(isPlaceholder("n/a"), true);
assert.equal(isPlaceholder("TBD"), true);
assert.equal(isPlaceholder("qa.user@example.com / Passw0rd!"), false);

assert.equal(evaluateProvidedValue("url", "asdf").ok, false);
assert.equal(evaluateProvidedValue("url", "https://staging.example.com/login").ok, true);
assert.equal(evaluateProvidedValue("credentials", "ab").ok, false);
assert.equal(evaluateProvidedValue("credentials", "qa.user@example.com / Passw0rd!").ok, true);
assert.equal(evaluateProvidedValue("email", "not-an-email").ok, false);
assert.equal(evaluateProvidedValue("email", "qa.user@example.com").ok, true);

assert.equal(inferExpectedShape("Login test user credentials"), "credentials");
assert.equal(resolveExpectedShape({ input_type: "api_curl" }), "api_access");
assert.equal(resolveExpectedShape({ input_type: "webpage_url" }), "url");

// Real login-test-user ask — hint mentions "environment" but must stay credentials
{
  const label = "Login test user";
  const note = "Acceptance criteria require login, but the ticket never says which account to use.";
  const detail = "Provide the username and password of a working test account (Login test user)";
  const hint = "Email and password for an account that exists in the test environment";
  assert.equal(inferExpectedShape([label, note, detail].join(" ")), "credentials");
  assert.equal(
    resolveExpectedShape({ label, note, detail, hint }),
    "credentials",
    "hint must not flip credentials → url via 'environment'",
  );
  assert.equal(
    resolveExpectedShape({ label, note, detail, expected_shape: "url" }),
    "credentials",
    "strong inference beats wrong explicit url",
  );
  assert.match(SHAPE_EXPECTATIONS.credentials, /Username and password/i);
}

console.log("input-shapes tests: ok");
