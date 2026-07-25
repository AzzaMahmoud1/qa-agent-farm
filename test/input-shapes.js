/** Shared input-shape validation. Run: node test/input-shapes.js */
import assert from "node:assert/strict";
import {
  evaluateProvidedValue,
  inferExpectedShape,
  isPlaceholder,
  looksLikeUrl,
  resolveExpectedShape,
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
assert.equal(resolveExpectedShape({ expected_shape: "url", label: "login user" }), "url");
assert.equal(resolveExpectedShape({ input_type: "api_curl" }), "api_access");
assert.equal(resolveExpectedShape({ input_type: "webpage_url" }), "url");

console.log("input-shapes tests: ok");
