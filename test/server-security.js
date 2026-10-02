/**
 * Server hardening: CSRF (simple cross-site POSTs), DNS rebinding (foreign
 * Host header), foreign localhost origins, and executor host classification.
 * Spawns the real server on a spare port; no network beyond loopback.
 * Run: node test/server-security.js
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isPrivateOrLoopbackHost, isUrlAllowlisted } from "../lib/http-executor.js";

// ── executor host classification (pure) ─────────────────────────────────────
{
  for (const h of ["127.0.0.1", "10.1.2.3", "100.64.0.1", "0.0.0.0", "[::1]", "::ffff:7f00:1", "fd00::1", "fe80::1"]) {
    assert.ok(isPrivateOrLoopbackHost(h), `${h} is private/loopback`);
  }
  for (const h of ["fdic.gov", "fcbarcelona.com", "fe80.example.com", "100.200.1.1"]) {
    assert.ok(!isPrivateOrLoopbackHost(h), `${h} is a public host`);
  }
  assert.ok(isUrlAllowlisted("https://fdic.gov/x", ["fdic.gov"]), "domain starting with fd is allowlistable");
  assert.ok(!isUrlAllowlisted("http://[::ffff:127.0.0.1]/", ["example.com"]), "IPv4-mapped loopback denied");
}

// ── live server ──────────────────────────────────────────────────────────────
const PORT = 5100 + Math.floor(Math.random() * 800);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = spawn(process.execPath, ["server.js"], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", JIRA_URL: "", EXECUTE_API_TOKEN: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
await new Promise((resolve, reject) => {
  server.stdout.on("data", (d) => { if (String(d).includes("QA Agent Farm")) resolve(); });
  server.on("exit", (code) => reject(new Error(`server exited ${code}`)));
  setTimeout(() => reject(new Error("server did not start")), 5000);
});

function request(path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, path, method, headers }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

const json = { "Content-Type": "application/json" };
const payload = JSON.stringify({ ticketId: "", breakdown: null });

try {
  // A cross-site "simple" POST (text/plain, no preflight) is refused.
  let r = await request("/api/settings/llm", { method: "POST", headers: { "Content-Type": "text/plain" }, body: '{"runner":"custom_openai_compatible"}' });
  assert.equal(r.status, 415, "text/plain POST rejected (CSRF)");

  // JSON POST from a foreign origin is refused — even another localhost app.
  r = await request("/api/knowledge", { method: "POST", headers: { ...json, Origin: "https://evil.example" }, body: payload });
  assert.equal(r.status, 403, "foreign origin rejected");
  r = await request("/api/knowledge", { method: "POST", headers: { ...json, Origin: "http://localhost:3000" }, body: payload });
  assert.equal(r.status, 403, "other localhost port rejected");

  // DNS rebinding: attacker domain resolving to 127.0.0.1 carries its own Host.
  r = await request("/api/jira/health", { headers: { Host: `attacker.example:${PORT}` } });
  assert.equal(r.status, 403, "foreign Host header rejected");

  // Legitimate same-origin JSON POST still works (400 = reached the handler).
  r = await request("/api/knowledge", { method: "POST", headers: { ...json, Origin: `http://127.0.0.1:${PORT}` }, body: payload });
  assert.equal(r.status, 400, "same-origin JSON POST reaches the handler");
  r = await request("/api/jira/health");
  assert.equal(r.status, 200, "plain local GET works");

  // CORS preflight only for our own origin.
  r = await request("/api/execute", { method: "OPTIONS", headers: { Origin: "http://localhost:3000" } });
  assert.equal(r.status, 403, "preflight from another localhost app rejected");
  r = await request("/api/execute", { method: "OPTIONS", headers: { Origin: `http://localhost:${PORT}` } });
  assert.equal(r.status, 204, "preflight from own origin allowed");

  // Static files are unaffected by the API guards.
  r = await request("/simulator.html");
  assert.equal(r.status, 200);
} finally {
  server.kill();
}

console.log("server-security tests: ok");
