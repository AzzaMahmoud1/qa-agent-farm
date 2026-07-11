import type { RunStatus } from "./types.js";
import { TERMINAL_STATUSES } from "./types.js";

/** Allowed transitions for the durable run state machine. */
const TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  draft: ["clarification_pending", "control_mapping_pending", "cancelled"],
  clarification_pending: ["control_mapping_pending", "draft", "cancelled"],
  control_mapping_pending: ["plan_pending", "blocked", "cancelled"],
  plan_pending: ["approval_pending", "blocked", "cancelled"],
  approval_pending: ["queued", "blocked", "cancelled"],
  queued: ["executing", "cancelled"],
  executing: ["evidence_verifying", "failed", "blocked", "cancelled"],
  evidence_verifying: ["independent_review", "failed", "blocked"],
  independent_review: ["passed", "failed", "blocked"],
  passed: [],
  failed: [],
  blocked: [],
  cancelled: [],
};

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return (TRANSITIONS[from] || []).includes(to);
}

export function assertTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal run transition: ${from} → ${to}`);
  }
}

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}
