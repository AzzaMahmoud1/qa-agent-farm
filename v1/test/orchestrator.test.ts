import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { RunOrchestrator } from "../src/orchestrator/run-orchestrator.js";
import { FileRunStore } from "../src/store/file-store.js";

describe("orchestrator vertical slice", () => {
  const dir = mkdtempSync(join(tmpdir(), "qaf-v1-"));
  const store = new FileRunStore(dir);
  const orch = new RunOrchestrator(store);

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates, plans, and blocks non-allowlisted execute", async () => {
    const run = orch.create({
      product: "demo",
      owner: "qa",
      title: "Auth API check",
      requirements: "System must authenticate with token and return profile",
      surfaces: ["api"],
      nca_applicable: true,
      api_contract: {
        method: "GET",
        url: "https://api.example.com/me",
        headers: { Authorization: "Bearer secret-token" },
        expect_status: 200,
      },
    });

    assert.equal(run.status, "draft");
    assert.equal(run.orchestration_mode, "durable_control_plane");
    assert.equal(run.model_routing.orchestrator, "claude-fable-5");

    const planned = orch.plan(run.id);
    assert.equal(planned.status, "approval_pending");
    assert.ok(planned.scenarios.some((s) => s.id === "API-01"));
    assert.ok(planned.scenarios.some((s) => s.type === "security"));
    assert.equal(planned.compliance.release_gate, "blocked");

    orch.approve(run.id);
    const executed = await orch.execute(run.id);

    // No allowlist → API blocked; NCA gate also blocked → terminal blocked
    assert.equal(executed.status, "blocked");
    const apiResult = executed.results.find((r) => r.scenario_id === "API-01");
    assert.ok(apiResult);
    assert.equal(apiResult!.status, "blocked");
    assert.match(apiResult!.evidence, /not allowlisted/i);
    assert.equal(
      (apiResult!.request as { headers?: Record<string, string> })?.headers?.Authorization,
      "[REDACTED]",
    );
  });

  it("does not mark UI as passed", async () => {
    const run = orch.create({
      product: "demo",
      owner: "qa",
      title: "UI only",
      requirements: "Open dashboard page",
      surfaces: ["ui"],
      nca_applicable: false,
    });
    orch.plan(run.id);
    orch.approve(run.id);
    const executed = await orch.execute(run.id);
    const ui = executed.results.find((r) => r.scenario_id === "UI-01");
    assert.equal(ui?.status, "pending_browser");
    assert.equal(ui?.passed, false);
    assert.equal(executed.status, "blocked");
  });
});
