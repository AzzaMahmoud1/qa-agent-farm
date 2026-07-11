/** Core domain types for QA Agent Farm v1. */

export type RunStatus =
  | "draft"
  | "clarification_pending"
  | "control_mapping_pending"
  | "plan_pending"
  | "approval_pending"
  | "queued"
  | "executing"
  | "evidence_verifying"
  | "independent_review"
  | "passed"
  | "failed"
  | "blocked"
  | "cancelled";

export type ScenarioSurface = "api" | "ui" | "db" | "event" | "code";

export type AssertionLevel =
  | "none"
  | "transport_only"
  | "per_ac"
  | "browser_required"
  | "security";

export type ScenarioResultStatus =
  | "planned"
  | "queued"
  | "running"
  | "transport_observed"
  | "pending_browser"
  | "passed"
  | "failed"
  | "blocked"
  | "skipped"
  | "not_executed";

export interface StructuredRequest {
  product: string;
  owner: string;
  title: string;
  requirements: string;
  surfaces: ScenarioSurface[];
  risk?: "low" | "medium" | "high";
  nca_applicable?: boolean;
  api_contract?: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string | null;
    /** Expected HTTP status for per-AC assertion (required for pass). */
    expect_status?: number;
    /** Optional substring that must appear in response body. */
    expect_body_includes?: string;
  };
}

export interface NcaControlRef {
  id: string;
  title: string;
  status: "unmapped_evidence" | "evidenced" | "not_applicable";
}

export interface ComplianceEvidence {
  status: "not_applicable" | "blocked_missing_evidence" | "evidenced";
  release_gate: "open" | "blocked";
  controls: string[];
  note: string;
  evidence_records: string[];
}

export interface Scenario {
  id: string;
  title: string;
  surface: ScenarioSurface;
  type: "happy_path" | "negative" | "edge_case" | "security";
  assertion_level: AssertionLevel;
  nca_controls?: string[];
  ac_ref?: string;
}

export interface ScenarioResult {
  scenario_id: string;
  status: ScenarioResultStatus;
  assertion_level: AssertionLevel;
  passed: boolean;
  evidence: string;
  http_status?: number;
  request?: Record<string, unknown>;
  response?: Record<string, unknown>;
  audit?: unknown[];
}

export interface RunRecord {
  id: string;
  version: "1.0.0-alpha.0";
  status: RunStatus;
  created_at: string;
  updated_at: string;
  request: StructuredRequest;
  scenarios: Scenario[];
  results: ScenarioResult[];
  compliance: ComplianceEvidence;
  model_routing: {
    orchestrator: string;
    workers: string;
  };
  orchestration_mode: "durable_control_plane";
  summary: {
    planned: number;
    executed: number;
    passed: number;
    failed: number;
    blocked: number;
    pending_browser: number;
    transport_observed: number;
    measured: boolean;
  };
  history: Array<{ at: string; from: RunStatus; to: RunStatus; reason: string }>;
}

export const TERMINAL_STATUSES: RunStatus[] = [
  "passed",
  "failed",
  "blocked",
  "cancelled",
];
