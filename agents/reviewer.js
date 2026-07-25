/** @see .cursor/skills/qa-reviewer/SKILL.md */
export const AGENT_ID = "reviewer";
export const SKILL_PATH = ".cursor/skills/qa-reviewer/SKILL.md";
export const SKILL_FOLDER = ".cursor/skills/qa-reviewer";

import {
  inferExpectedShape,
  evaluateProvidedValue,
  resolveExpectedShape,
} from "../lib/input-shapes.js";
import { mergeHumanAskFields } from "../lib/human-ask-merge.js";

function normalizeAskText(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** True when two ask-strings refer to the same Analyst need (token overlap). */
function asksOverlap(a, b) {
  const aa = normalizeAskText(a);
  const bb = normalizeAskText(b);
  if (!aa || !bb) return false;
  if (aa.includes(bb) || bb.includes(aa)) return true;
  const words = bb.split(/\s+/).filter((w) => w.length > 3);
  if (!words.length) return false;
  const hits = words.filter((w) => aa.includes(w));
  return hits.length >= Math.min(2, words.length);
}

function fieldValue(field, humanBundle) {
  const api = humanBundle.api || {};
  const webpage = humanBundle.webpage || {};
  const userPrereqs = humanBundle.userPrerequisites || {};
  const fromAction = field.action?.provided_value != null
    ? String(field.action.provided_value).trim()
    : "";
  if (field.input_type === "api_curl") return api.curl || api.url || fromAction || "";
  if (field.input_type === "webpage_url") return webpage.url || fromAction || "";
  if (fromAction) return fromAction;
  const pid = field.sources?.prereq_id;
  if (pid && userPrereqs[pid]?.value) return String(userPrereqs[pid].value).trim();
  if (userPrereqs[field.key]?.value) return String(userPrereqs[field.key].value).trim();
  return "";
}

/**
 * Reviewer gate: after human submits prerequisites, recheck each answer against
 * what Agent 1 (Analyst) asked for. Reject incomplete or shape-wrong input.
 *
 * @param {object} analystOutput
 * @param {object} humanBundle
 */
export function reviewHumanInputAgainstAnalyst(analystOutput, humanBundle = {}) {
  const checks = [];
  const actions = humanBundle.actions || [];
  const prereqItems = humanBundle.prereqItems || [];
  const userPrereqs = humanBundle.userPrerequisites || {};
  const api = humanBundle.api || {};
  const webpage = humanBundle.webpage || {};
  const extras = {
    apiOk: !!api.ok,
    webOk: !!webpage.ok,
    webUrl: webpage.url || "",
  };

  const blocking = (analystOutput?.prerequisites_needed?.blocking || [])
    .filter((b) => b && !b.satisfied_by_ticket);

  const merged = mergeHumanAskFields({ actions, prereqItems });

  for (const field of merged) {
    const shape = resolveExpectedShape(field);
    const value = fieldValue(field, humanBundle);
    const needsValue = field.required
      || field.action?.requires_value === true
      || field.action?.action === "ASK_HUMAN"
      || field.action?.action === "FETCH_DEPENDENCY";

    if (needsValue) {
      const result = evaluateProvidedValue(shape, value, extras);
      checks.push({
        id: field.key,
        analyst_ref: field.detail || field.label,
        asked_for: field.action
          ? `${field.action.action || "ACTION"} → ${field.action.target || "human"}: ${field.detail || field.label}`
          : `${field.label}${field.item?.derived_from ? ` (from ${field.item.derived_from})` : ""}`,
        provided: value || (field.action?.resolved ? "(checked, no value)" : "(empty)"),
        status: result.ok ? "pass" : "fail",
        blame: result.ok ? null : result.blame,
        expected_shape: shape,
      });
    } else if (field.action && !field.action.resolved && !value) {
      checks.push({
        id: field.key,
        analyst_ref: field.detail || field.label,
        asked_for: `${field.action.action || "ACTION"} → ${field.action.target || "human"}: ${field.detail || ""}`,
        provided: "(empty)",
        status: "fail",
        blame: "Action not resolved and no value provided",
        expected_shape: shape,
      });
    } else {
      checks.push({
        id: field.key,
        analyst_ref: field.detail || field.label,
        asked_for: field.label,
        provided: value || "(checked)",
        status: "pass",
        blame: null,
        expected_shape: shape,
      });
    }
  }

  // Blocking analyst prerequisites not already covered by a merged check
  for (const b of blocking) {
    const covered = checks.some((c) =>
      asksOverlap(c.analyst_ref, b.item) || asksOverlap(c.asked_for, b.item)
      || (b.id && c.id === b.id),
    );
    if (covered) continue;
    if (b.must_be_provided_by && b.must_be_provided_by !== "human") continue;
    const matchedAction = actions.find((a) =>
      (b.id && a.prereq_id === b.id) || asksOverlap(a.detail || a.item, b.item),
    );
    const matchedPrereq = Object.values(userPrereqs).find((p) => asksOverlap(p.label, b.item));
    const shape = b.expected_shape || inferExpectedShape(b.item);
    const value = (matchedAction?.provided_value || matchedPrereq?.value || "").trim();
    const result = evaluateProvidedValue(shape, value, extras);
    checks.push({
      id: b.id || `blocking-${checks.length}`,
      analyst_ref: b.item,
      asked_for: `[${b.category || "data"}] ${b.item}`,
      provided: value ? String(value).slice(0, 120) : "(not mapped / empty)",
      status: result.ok ? "pass" : "fail",
      blame: result.ok ? null : (result.blame || "Analyst blocking prerequisite not satisfied by human input"),
      expected_shape: shape,
    });
  }

  const failures = checks.filter((c) => c.status === "fail");
  const nothingToCheck = checks.length === 0;
  const verdict = nothingToCheck ? "accepted" : (failures.length ? "rejected" : "accepted");

  return {
    role: "reviewer",
    phase: "human_input_recheck",
    passed: verdict === "accepted",
    verdict,
    checks,
    failures: failures.map((f) => ({
      analyst_ref: f.analyst_ref,
      asked_for: f.asked_for,
      provided: f.provided,
      blame: f.blame,
    })),
    summary: nothingToCheck
      ? "No blocking Analyst prerequisites to recheck — human input gate clear."
      : failures.length
        ? `Rejected ${failures.length}/${checks.length} human answer(s) — does not match Analyst needs.`
        : `Accepted ${checks.length}/${checks.length} human answer(s) against Analyst prerequisites.`,
    fix: failures.length
      ? `Correct the rejected fields (see blame) so they satisfy Analyst prerequisites, then resubmit.`
      : "Human input matches Analyst needs — proceed to Writer/Author.",
  };
}

export function buildReviewerOutput(story, tcIds, executorOutput) {
  if (!executorOutput || (executorOutput.blocked && !executorOutput.summary && !executorOutput.results)) {
    if (!executorOutput) {
      return {
        success: false,
        blocked: true,
        blocked_reason: "BLOCKED — Reviewer waiting on Executor structured output",
        score: "—",
        missing_coverage: ["Executor has not returned"],
        fix: "Run Executor after validated Author output before post-exec review.",
      };
    }
  }
  const summary = executorOutput?.summary || {};
  const executed = summary.executed || 0;
  const passed = summary.passed || 0;
  const failed = summary.failed || 0;
  const measured = summary.measured === true;
  const transportObserved = summary.transport_observed || 0;
  const pendingBrowser = summary.pending_browser || 0;
  const compliance = story?.compliance_evidence || executorOutput?.compliance_evidence;

  let score = "—";
  if (measured && executed > 0) {
    const pct = Math.round((passed / executed) * 100);
    score = `${pct}% (${passed}/${executed} asserted)`;
  }

  const missing = [];
  if (!measured) missing.push("Per-AC assertions not measured — transport/UI URL alone is not a pass");
  if (transportObserved > 0) missing.push(`${transportObserved} transport observation(s) without business assertion`);
  if (pendingBrowser > 0) missing.push(`${pendingBrowser} UI case(s) pending browser evidence`);
  if (compliance?.release_gate === "blocked" || compliance?.status === "blocked_missing_evidence") {
    missing.push("NCA/ECC security evidence missing — release blocked");
  }
  if (measured && failed > 0) missing.push("Failed executed scenarios need retest after fix");

  return {
    score,
    measured,
    orchestration_mode: executorOutput?.orchestration_mode || "simulated_pipeline",
    what_is_good: measured
      ? `${passed} of ${executed} asserted scenario(s) passed with evidence.`
      : "Test cases planned — no per-AC pass recorded yet.",
    root_cause_risk: compliance?.release_gate === "blocked"
      ? "NCA/ECC controls lack evidence — must not release"
      : measured && failed > 0
        ? `${failed} asserted failure(s) require remediation before release`
        : story.priority === "High"
          ? "High priority — execute per-AC assertions before release"
          : "Do not treat transport smoke or URL recording as passed coverage",
    impact: `${story.priority} priority · Status: ${story.status}`,
    missing_coverage: missing,
    compliance_evidence: compliance || null,
    codebase_conflicts: [],
    duplicate_coverage: [],
    fix: compliance?.release_gate === "blocked"
      ? "Attach injection/IDOR/bypass/API-exposure evidence mapped to ECC controls before release."
      : measured
        ? (failed > 0 ? "Fix failed scenarios and re-run with evidence before close." : "Proceed with independent review of evidence.")
        : "Run per-AC assertions (and browser tests for UI) before scoring as passed.",
  };
}
