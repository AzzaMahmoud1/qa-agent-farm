import { randomUUID } from "node:crypto";
import type {
  RunRecord,
  RunStatus,
  Scenario,
  ScenarioResult,
  StructuredRequest,
} from "../domain/types.js";
import { assertTransition } from "../domain/run-state.js";
import { buildComplianceEvidence, buildNcaScenarios } from "../policy/nca.js";
import type { FileRunStore } from "../store/file-store.js";
import { executeApiScenario } from "../workers/api-executor.js";

const ORCHESTRATOR_MODEL = process.env.V1_ORCHESTRATOR_MODEL || "claude-fable-5";
const WORKER_MODEL = process.env.V1_WORKER_MODEL || "claude-4.6-sonnet";

function now(): string {
  return new Date().toISOString();
}

function emptySummary() {
  return {
    planned: 0,
    executed: 0,
    passed: 0,
    failed: 0,
    blocked: 0,
    pending_browser: 0,
    transport_observed: 0,
    measured: false,
  };
}

function recomputeSummary(run: RunRecord): void {
  const results = run.results;
  run.summary = {
    planned: run.scenarios.length,
    executed: results.filter((r) =>
      ["passed", "failed", "blocked", "transport_observed", "pending_browser"].includes(r.status),
    ).length,
    passed: results.filter((r) => r.status === "passed" && r.passed).length,
    failed: results.filter((r) => r.status === "failed").length,
    blocked: results.filter((r) => r.status === "blocked").length,
    pending_browser: results.filter((r) => r.status === "pending_browser").length,
    transport_observed: results.filter((r) => r.status === "transport_observed").length,
    measured: results.some((r) => r.status === "passed" || r.status === "failed"),
  };
}

function planScenarios(req: StructuredRequest): Scenario[] {
  const scenarios: Scenario[] = [];
  const wantsApi = !req.surfaces?.length || req.surfaces.includes("api");

  if (wantsApi && req.api_contract?.url) {
    scenarios.push({
      id: "API-01",
      title: `API assertion: ${req.api_contract.method} ${req.api_contract.url}`,
      surface: "api",
      type: "happy_path",
      assertion_level: "per_ac",
      ac_ref: "AC-1",
    });
  }

  if (req.surfaces?.includes("ui")) {
    scenarios.push({
      id: "UI-01",
      title: "UI flow — browser evidence required",
      surface: "ui",
      type: "happy_path",
      assertion_level: "browser_required",
      ac_ref: "AC-UI",
    });
  }

  scenarios.push(...buildNcaScenarios(req));
  return scenarios;
}

export class RunOrchestrator {
  private readonly store: FileRunStore;

  constructor(store: FileRunStore) {
    this.store = store;
  }

  create(request: StructuredRequest): RunRecord {
    const id = `run_${randomUUID().slice(0, 8)}`;
    const at = now();
    const run: RunRecord = {
      id,
      version: "1.0.0-alpha.0",
      status: "draft",
      created_at: at,
      updated_at: at,
      request,
      scenarios: [],
      results: [],
      compliance: {
        status: "not_applicable",
        release_gate: "open",
        controls: [],
        note: "not planned yet",
        evidence_records: [],
      },
      model_routing: {
        orchestrator: ORCHESTRATOR_MODEL,
        workers: WORKER_MODEL,
      },
      orchestration_mode: "durable_control_plane",
      summary: emptySummary(),
      history: [],
    };
    this.store.save(run);
    return run;
  }

  get(id: string): RunRecord | null {
    return this.store.get(id);
  }

  list(): RunRecord[] {
    return this.store.list();
  }

  private transition(run: RunRecord, to: RunStatus, reason: string): void {
    assertTransition(run.status, to);
    run.history.push({ at: now(), from: run.status, to, reason });
    run.status = to;
    run.updated_at = now();
  }

  /** Advance draft → plan → approval (auto-approve for alpha slice). */
  plan(id: string): RunRecord {
    const run = this.require(id);
    if (run.status === "draft") {
      this.transition(run, "control_mapping_pending", "skip clarification for alpha");
    }
    if (run.status === "control_mapping_pending") {
      run.scenarios = planScenarios(run.request);
      run.compliance = buildComplianceEvidence(run.request, run.scenarios);
      run.results = run.scenarios.map((s) => this.plannedResult(s));
      recomputeSummary(run);
      this.transition(run, "plan_pending", "scenarios planned");
    }
    if (run.status === "plan_pending") {
      this.transition(run, "approval_pending", "plan ready for approval");
    }
    this.store.save(run);
    return run;
  }

  approve(id: string): RunRecord {
    const run = this.require(id);
    if (run.status !== "approval_pending") {
      throw new Error(`Cannot approve from status ${run.status}`);
    }
    this.transition(run, "queued", "human/auto approved");
    this.store.save(run);
    return run;
  }

  /** Execute allowlisted API scenarios; UI/security stay pending/blocked. */
  async execute(id: string): Promise<RunRecord> {
    const run = this.require(id);
    if (run.status === "approval_pending") {
      this.approve(id);
    }
    const current = this.require(id);
    if (current.status !== "queued") {
      throw new Error(`Cannot execute from status ${current.status}`);
    }

    this.transition(current, "executing", "worker dispatch");
    this.store.save(current);

    const allowlist = (process.env.EXECUTOR_ALLOWLIST || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const allowLoopback = process.env.EXECUTOR_ALLOW_LOOPBACK === "true";

    const results: ScenarioResult[] = [];
    for (const scenario of current.scenarios) {
      if (scenario.surface === "api" && scenario.assertion_level === "per_ac") {
        results.push(
          await executeApiScenario(scenario, current.request, { allowlist, allowLoopback }),
        );
      } else if (scenario.surface === "ui") {
        results.push({
          scenario_id: scenario.id,
          status: "pending_browser",
          assertion_level: scenario.assertion_level,
          passed: false,
          evidence: "UI URL recorded only — browser execution not available in v1 alpha",
        });
      } else if (scenario.type === "security") {
        results.push({
          scenario_id: scenario.id,
          status: "blocked",
          assertion_level: scenario.assertion_level,
          passed: false,
          evidence: "NCA/ECC security scenario planned — no evidence attached yet",
        });
      } else {
        results.push({
          scenario_id: scenario.id,
          status: "not_executed",
          assertion_level: scenario.assertion_level,
          passed: false,
          evidence: "No executor for this surface in alpha",
        });
      }
    }
    current.results = results;
    recomputeSummary(current);

    this.transition(current, "evidence_verifying", "execution finished");
    this.store.save(current);

    this.transition(current, "independent_review", "deterministic review");
    const terminal = this.decideTerminal(current);
    this.transition(current, terminal.status, terminal.reason);
    this.store.save(current);
    return current;
  }

  private decideTerminal(run: RunRecord): { status: RunStatus; reason: string } {
    if (run.compliance.release_gate === "blocked") {
      return { status: "blocked", reason: "NCA/ECC release gate blocked — missing security evidence" };
    }
    if (run.results.some((r) => r.status === "pending_browser")) {
      return { status: "blocked", reason: "UI scenarios pending browser evidence" };
    }
    if (run.results.some((r) => r.status === "failed")) {
      return { status: "failed", reason: "one or more assertions failed" };
    }
    const apiPasses = run.results.filter(
      (r) => r.assertion_level === "per_ac" && r.status === "passed" && r.passed,
    );
    if (apiPasses.length > 0 && run.results.every((r) => r.status === "passed" || r.status === "skipped")) {
      return { status: "passed", reason: "all executed assertions passed" };
    }
    if (apiPasses.length > 0 && !run.results.some((r) => r.status === "failed" || r.status === "blocked")) {
      return { status: "passed", reason: "API assertions passed" };
    }
    return { status: "blocked", reason: "incomplete evidence or non-pass results" };
  }

  private plannedResult(s: Scenario): ScenarioResult {
    return {
      scenario_id: s.id,
      status: "planned",
      assertion_level: s.assertion_level,
      passed: false,
      evidence: "planned",
    };
  }

  private require(id: string): RunRecord {
    const run = this.store.get(id);
    if (!run) throw new Error(`Run not found: ${id}`);
    return run;
  }
}
