/**
 * Orchestrator — the brain of a live run.
 *
 * It alone assigns agents, judges every output, decides whether the run moves
 * on, and hands the ACCEPTED output to the next agent. Nobody else passes one
 * agent's output to another: the UI only starts a run and supplies human
 * decisions (outline approvals, target URL, test credentials).
 *
 *   start(story) → Analyst ─judge─▶ Writer ─judge─▶ AWAITING_APPROVAL
 *   resume(run, human input) → Author (per approved outline) ─judge─▶ READY_FOR_EXECUTION
 *
 * A rejected output is retried once with the judge's reasons; a second
 * rejection escalates to a human. Every decision is recorded on the run.
 * Agent runners are injected so the brain is testable without an LLM/browser.
 */
import { validateAnalystOutput } from "./requirementAnalyst.js";

export const STAGES = Object.freeze({
  ANALYSIS: "ANALYSIS",
  HELD_FOR_PO: "HELD_FOR_PO",
  AWAITING_HUMAN: "AWAITING_HUMAN",
  WRITING: "WRITING",
  AWAITING_APPROVAL: "AWAITING_APPROVAL",
  AUTHORING: "AUTHORING",
  READY_FOR_EXECUTION: "READY_FOR_EXECUTION",
  ESCALATED: "ESCALATED",
});

const MAX_ATTEMPTS = 2;

// ── Judges: is this agent's output correct enough to hand on? ────────────────

/** @returns {{ verdict: "accept"|"retry"|"hold"|"ask_human", reasons: string[] }} */
export function judgeAnalyst(out) {
  if (!out || out.success === false) return { verdict: "retry", reasons: [out?.error || "Analyst returned no output"] };
  const parsed = out.parsed || out;
  try {
    validateAnalystOutput(parsed);
  } catch (err) {
    return { verdict: "retry", reasons: [`Contract check failed: ${err.message}`] };
  }
  if (parsed.testability?.verdict === "NOT_TEST_READY") {
    return { verdict: "hold", reasons: [`Story is NOT_TEST_READY (${parsed.testability.overall_score}/100) — back to the PO`] };
  }
  if (parsed.ready_for_test_design !== true) {
    const asks = (parsed.analyst_report?.orchestrator_actions || []).filter((a) => a.blocking).map((a) => a.detail);
    return { verdict: "ask_human", reasons: asks.length ? asks : ["Analyst needs human input before test design"] };
  }
  return { verdict: "accept", reasons: [`${parsed.testable_conditions.length} grounded AC(s), contract valid`] };
}

export function judgeWriter(out, analyst) {
  if (!out || out.success === false || !(out.test_cases || []).length) {
    return { verdict: "retry", reasons: [out?.error || "Writer produced no test cases"] };
  }
  const ids = (analyst.testable_conditions || []).map((c) => c.id);
  const reasons = [];
  const missing = ids.filter((id) => !out.ac_verdicts?.[id]);
  if (missing.length) reasons.push(`No verdict for ${missing.join(", ")} (silent drop)`);
  const foreign = (out.test_cases || []).filter((t) => !ids.includes(t.ac_ref)).map((t) => t.id);
  if (foreign.length) reasons.push(`Cases for unknown ACs: ${foreign.join(", ")}`);
  const uncited = (out.test_cases || []).filter((t) => !t.evidence_citation).map((t) => t.id);
  if (uncited.length) reasons.push(`Cases without a citation: ${uncited.join(", ")}`);
  if (reasons.length) return { verdict: "retry", reasons };
  const written = ids.filter((id) => out.ac_verdicts[id].verdict === "written").length;
  if (written / ids.length < 0.5) return { verdict: "retry", reasons: [`Only ${written}/${ids.length} ACs covered`] };
  return { verdict: "accept", reasons: [`${out.test_cases.length} case(s) covering ${written}/${ids.length} AC(s)`] };
}

export function judgeAuthor(out, outline, analyst) {
  if (!out) return { verdict: "retry", reasons: ["Author returned no output"] };
  if (out.status === "NEEDS_INPUT") return { verdict: "ask_human", reasons: [out.blocked_reason || "Author needs input"] };
  if (out.status !== "REVIEW") return { verdict: "retry", reasons: [out.blocked_reason || `Author status ${out.status}`] };
  const ids = new Set((analyst.testable_conditions || []).map((c) => c.id));
  const reasons = [];
  if (out.replay_ok !== true) reasons.push("Session was not replayed successfully");
  if (out.outline_id !== outline.id) reasons.push(`Author ran ${out.outline_id}, not ${outline.id}`);
  if (!(out.steps || []).some((s) => s.kind === "assert" && s.ok)) reasons.push("No verified assertion in the session");
  if (Object.keys(out.requirement_verdicts || {}).some((id) => !ids.has(id))) reasons.push("Verdicts for ACs the Analyst never produced");
  return reasons.length ? { verdict: "retry", reasons } : { verdict: "accept", reasons: [`${outline.id} verified and replayed`] };
}

// ── The run ──────────────────────────────────────────────────────────────────

/** The orchestrator keeps its own copy of every output it holds. */
const own = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));

function decide(run, agent, attempt, judgement, next) {
  run.decisions.push({ at: new Date().toISOString(), agent, attempt, verdict: judgement.verdict, reasons: judgement.reasons, next });
}

/** Run one agent with the orchestrator's retry policy. Returns { output, judgement }. */
async function runJudged(run, agent, invoke, judge) {
  let feedback = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let output;
    try {
      output = await invoke(feedback);
    } catch (err) {
      output = { success: false, error: err.message };
    }
    const judgement = judge(output);
    const last = attempt === MAX_ATTEMPTS;
    const next = judgement.verdict === "retry" ? (last ? "escalate" : "retry") : judgement.verdict;
    decide(run, agent, attempt, judgement, next);
    if (judgement.verdict !== "retry") return { output, judgement };
    feedback = judgement.reasons;
    if (last) return { output, judgement: { verdict: "escalate", reasons: judgement.reasons } };
  }
  return { output: null, judgement: { verdict: "escalate", reasons: ["unreachable"] } };
}

export function newRun(input) {
  return {
    run_id: `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    story: { ticketText: String(input.ticketText || ""), ticketId: input.ticketId || null, title: input.title || null },
    stage: STAGES.ANALYSIS,
    outputs: {},
    decisions: [],
    awaiting: null,
  };
}

/**
 * Start a run: Analyst → (judge) → Writer → (judge) → wait for outline approval.
 * @param {object} input — { ticketText, ticketId, title, imageAttachments, documentAttachments }
 * @param {{ analyst: Function, writer: Function }} runners
 */
export async function startRun(input, runners, run = newRun(input)) {
  if (!run.story.ticketText.trim()) {
    run.stage = STAGES.ESCALATED;
    run.awaiting = { type: "story", detail: "The orchestrator needs ticket text to start" };
    return run;
  }

  // 1. Analyst
  const a = await runJudged(run, "analyst", (feedback) => runners.analyst({ ...input, orchestrator_feedback: feedback }), judgeAnalyst);
  run.outputs.analyst = own(a.output?.parsed || a.output);
  if (a.judgement.verdict === "hold") return Object.assign(run, { stage: STAGES.HELD_FOR_PO, awaiting: { type: "po_refinement", detail: a.judgement.reasons.join("; ") } });
  if (a.judgement.verdict === "ask_human") return Object.assign(run, { stage: STAGES.AWAITING_HUMAN, awaiting: { type: "analyst_questions", detail: a.judgement.reasons } });
  if (a.judgement.verdict !== "accept") return Object.assign(run, { stage: STAGES.ESCALATED, awaiting: { type: "human_review", agent: "analyst", detail: a.judgement.reasons } });

  // 2. Writer — receives the ACCEPTED Analyst output from the orchestrator.
  run.stage = STAGES.WRITING;
  const analyst = run.outputs.analyst;
  const w = await runJudged(run, "writer", (feedback) => runners.writer({ analyst, ticketText: run.story.ticketText, orchestrator_feedback: feedback }), (out) => judgeWriter(out, analyst));
  run.outputs.writer = own(w.output);
  if (w.judgement.verdict !== "accept") return Object.assign(run, { stage: STAGES.ESCALATED, awaiting: { type: "human_review", agent: "writer", detail: w.judgement.reasons } });

  run.stage = STAGES.AWAITING_APPROVAL;
  run.awaiting = { type: "outline_approval", detail: `Approve the outlines to author (${run.outputs.writer.test_outlines.length} drafted) and give the target URL` };
  return run;
}

/**
 * Resume after the human approved outlines: Author each approved outline with
 * the Writer output the orchestrator holds, judging every session.
 * @param {object} run
 * @param {{ approvals: Record<string,"approved"|"rejected">, url: string, credentials?: object }} human
 * @param {{ author: Function }} runners
 */
export async function resumeRun(run, human, runners) {
  if (run.stage !== STAGES.AWAITING_APPROVAL) {
    throw new Error(`Run ${run.run_id} is ${run.stage}, not awaiting outline approval`);
  }
  let url;
  try { url = new URL(String(human?.url || "")); } catch { url = null; }
  if (!url || !/^https?:$/.test(url.protocol)) {
    run.awaiting = { type: "outline_approval", detail: "A target http(s) URL is required before authoring" };
    return run;
  }
  for (const o of run.outputs.writer.test_outlines) {
    if (human.approvals?.[o.id]) o.status = human.approvals[o.id];
  }
  const approved = run.outputs.writer.test_outlines.filter((o) => o.status === "approved");
  if (!approved.length) {
    run.awaiting = { type: "outline_approval", detail: "Approve at least one outline" };
    return run;
  }

  run.stage = STAGES.AUTHORING;
  run.awaiting = null;
  const analyst = run.outputs.analyst;
  run.outputs.author = {};
  for (const outline of approved) {
    const r = await runJudged(run, `author:${outline.id}`,
      () => runners.author({ outline, url: url.href, credentials: human.credentials || {}, storyId: run.story.ticketId }),
      (out) => judgeAuthor(out, outline, analyst));
    run.outputs.author[outline.id] = own(r.output);
    if (r.judgement.verdict === "ask_human") return Object.assign(run, { stage: STAGES.AWAITING_HUMAN, awaiting: { type: "author_input", outline: outline.id, detail: r.judgement.reasons } });
    if (r.judgement.verdict !== "accept") return Object.assign(run, { stage: STAGES.ESCALATED, awaiting: { type: "human_review", agent: "author", outline: outline.id, detail: r.judgement.reasons } });
  }
  run.stage = STAGES.READY_FOR_EXECUTION;
  return run;
}
