/**
 * Durable farm memory across pipeline runs.
 * Additive — does not change any agent JSON output contract.
 *
 * File: <repo>/.farm/state.json
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STATE_PATH = path.join(__dirname, "..", ".farm", "state.json");

const EMPTY = () => ({ version: 1, updated_at: null, tickets: {} });

export function farmStatePath(overridePath) {
  return overridePath || process.env.FARM_STATE_PATH || DEFAULT_STATE_PATH;
}

export function loadFarmState(overridePath) {
  const file = farmStatePath(overridePath);
  try {
    if (!fs.existsSync(file)) return EMPTY();
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!raw || typeof raw !== "object") return EMPTY();
    return {
      version: Number(raw.version) || 1,
      updated_at: raw.updated_at || null,
      tickets: raw.tickets && typeof raw.tickets === "object" ? raw.tickets : {},
    };
  } catch {
    return EMPTY();
  }
}

export function saveFarmState(state, overridePath) {
  const file = farmStatePath(overridePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next = {
    version: 1,
    updated_at: new Date().toISOString(),
    tickets: state?.tickets && typeof state.tickets === "object" ? state.tickets : {},
  };
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export function getTicketMemory(ticketId, overridePath) {
  const id = String(ticketId || "").trim();
  if (!id) return null;
  const state = loadFarmState(overridePath);
  return state.tickets[id] || null;
}

/**
 * Record end-of-run memory for a ticket.
 * @param {{
 *   ticketId: string,
 *   finalGateOutcome: string,
 *   blockingPrerequisites?: array,
 *   decision?: string,
 *   why?: string,
 * }} entry
 */
export function recordRunOutcome(entry, overridePath) {
  const id = String(entry?.ticketId || "").trim();
  if (!id) return loadFarmState(overridePath);

  const state = loadFarmState(overridePath);
  const prev = state.tickets[id] || {
    final_gate_outcome: null,
    blocking_prerequisites: [],
    decision_log: [],
  };

  const blocking = Array.isArray(entry.blockingPrerequisites)
    ? entry.blockingPrerequisites.map((b) => ({
      id: b.id || b.item || null,
      item: b.item || b.label || String(b),
      category: b.category || null,
    }))
    : (prev.blocking_prerequisites || []);

  const logEntry = {
    at: new Date().toISOString(),
    decision: entry.decision || entry.finalGateOutcome || "unknown",
    why: entry.why || null,
    final_gate_outcome: entry.finalGateOutcome || null,
  };

  const decision_log = [...(prev.decision_log || []), logEntry].slice(-50);

  state.tickets[id] = {
    last_run_at: logEntry.at,
    final_gate_outcome: entry.finalGateOutcome || prev.final_gate_outcome,
    blocking_prerequisites: blocking,
    decision_log,
  };

  return saveFarmState(state, overridePath);
}

/**
 * Infer final gate outcome from a built event timeline (last decisive event).
 */
export function inferOutcomeFromEvents(events) {
  const list = Array.isArray(events) ? events : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (!e) continue;
    if (e.kind === "run_end") return "goal_achieved";
    if (e.kind === "run_failed" || e.kind === "validator_brake" || e.kind === "orchestrator_abort") {
      return e.agent_returns?.reason || e.orchestrator_memory?.reason || "aborted";
    }
    if (e.kind === "prerequisite_input_request") {
      return e.pipeline_state || "waiting_on_human";
    }
    if (e.kind === "human_input_request") return "waiting_on_human_api";
    if (e.kind === "pipeline_hold") return "pipeline_hold";
  }
  return "incomplete";
}

export function summarizePriorMemoryForOrchestrator(ticketId, overridePath) {
  const mem = getTicketMemory(ticketId, overridePath);
  if (!mem) {
    return {
      prior_run: false,
      note: "No prior farm state for this ticket",
    };
  }
  return {
    prior_run: true,
    last_run_at: mem.last_run_at || null,
    final_gate_outcome: mem.final_gate_outcome || null,
    known_blocking_prerequisites: mem.blocking_prerequisites || [],
    recent_decisions: (mem.decision_log || []).slice(-5),
    note: "Prior run memory loaded — reuse known blocking prerequisites when still applicable",
  };
}
