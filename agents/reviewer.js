/** @see .cursor/skills/qa-reviewer/SKILL.md */
export const AGENT_ID = "reviewer";
export const SKILL_PATH = ".cursor/skills/qa-reviewer/SKILL.md";
export const SKILL_FOLDER = ".cursor/skills/qa-reviewer";

const PLACEHOLDER_RE = /^(todo|tbd|n\/a|na|none|null|undefined|xxx|placeholder|changeme|example|test)$/i;

function looksLikeUrl(value) {
  return /^https?:\/\/\S+/i.test(String(value || "").trim());
}

function looksLikeCurl(value) {
  return /^curl\b/i.test(String(value || "").trim());
}

function looksLikeEmail(value) {
  return /\b[\w.+-]+@[\w.-]+\.\w{2,}\b/.test(String(value || ""));
}

function isPlaceholder(value) {
  const v = String(value || "").trim();
  if (!v) return true;
  if (PLACEHOLDER_RE.test(v)) return true;
  if (/^(https?:\/\/)?(example\.com|localhost)(\/|$)/i.test(v) && v.length < 24) return true;
  return false;
}

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

function inferExpectedShape(text) {
  const t = String(text || "").toLowerCase();
  if (/\b(curl|api key|bearer|authorization header)\b/.test(t) || /\bapi\b/.test(t) && /\b(url|base|token|endpoint)\b/.test(t)) {
    return "api_access";
  }
  if (/\b(url|uri|endpoint|environment|staging|base url|webpage|page)\b/.test(t) || /\bhttps?:\/\//.test(t)) {
    return "url";
  }
  if (/\b(email)\b/.test(t)) return "email";
  if (/\b(password|credential|username|login|user ?name)\b/.test(t)) return "credentials";
  return "text";
}

function evaluateProvidedValue(expectedShape, value, extras = {}) {
  const v = String(value || "").trim();
  if (!v && !(extras.apiOk || extras.webOk)) {
    return { ok: false, blame: "No value provided" };
  }
  if (v && isPlaceholder(v)) {
    return { ok: false, blame: `Placeholder/empty-looking value rejected: "${v.slice(0, 40)}"` };
  }
  if (expectedShape === "url") {
    if (extras.webOk && looksLikeUrl(extras.webUrl)) return { ok: true, blame: null };
    if (!looksLikeUrl(v)) return { ok: false, blame: "Expected an http(s) URL" };
  }
  if (expectedShape === "api_access") {
    if (extras.apiOk) return { ok: true, blame: null };
    if (!looksLikeCurl(v) && !looksLikeUrl(v)) {
      return { ok: false, blame: "Expected a curl command or API base URL + token" };
    }
  }
  if (expectedShape === "email" && !looksLikeEmail(v)) {
    return { ok: false, blame: "Expected an email address" };
  }
  if (expectedShape === "credentials" && v.length < 3) {
    return { ok: false, blame: "Credentials look too short / incomplete" };
  }
  return { ok: true, blame: null };
}

/**
 * Reviewer gate: after human submits prerequisites, recheck each answer against
 * what Agent 1 (Analyst) asked for. Reject incomplete or shape-wrong input.
 *
 * @param {object} analystOutput
 * @param {object} humanBundle
 * @param {Array} humanBundle.actions — orchestrator actions with provided_value / resolved
 * @param {Array} humanBundle.prereqItems — analyst prerequisite panel items
 * @param {Record<string,{value?:string,label?:string}>} humanBundle.userPrerequisites
 * @param {{ok?:boolean,curl?:string,url?:string}} [humanBundle.api]
 * @param {{ok?:boolean,url?:string}} [humanBundle.webpage]
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

  // 1) Orchestrator ASK_HUMAN / FETCH actions that required a value
  actions.forEach((a, i) => {
    const detail = a.detail || a.item || "";
    const asked = `${a.action || "ACTION"} → ${a.target || "human"}: ${detail}`;
    const shape = inferExpectedShape(detail);
    const value = (a.provided_value || "").trim();
    // Checkbox-only without a value is not enough when Analyst asked to provide something.
    const needsValue = /\b(provide|supply|seed|url|credential|password|token|curl|confirm)\b/i.test(detail)
      || a.action === "ASK_HUMAN"
      || a.action === "FETCH_DEPENDENCY";
    if (needsValue) {
      const result = evaluateProvidedValue(shape, value, extras);
      checks.push({
        id: `action-${i}`,
        analyst_ref: detail || a.action,
        asked_for: asked,
        provided: value || (a.resolved ? "(checked, no value)" : "(empty)"),
        status: result.ok ? "pass" : "fail",
        blame: result.ok ? null : result.blame,
        expected_shape: shape,
      });
    } else if (!a.resolved && !value) {
      checks.push({
        id: `action-${i}`,
        analyst_ref: detail || a.action,
        asked_for: asked,
        provided: "(empty)",
        status: "fail",
        blame: "Action not resolved and no value provided",
        expected_shape: shape,
      });
    } else {
      checks.push({
        id: `action-${i}`,
        analyst_ref: detail || a.action,
        asked_for: asked,
        provided: value || "(checked)",
        status: "pass",
        blame: null,
        expected_shape: shape,
      });
    }
  });

  // 2) Analyst prerequisite panel items (fillable gaps)
  prereqItems.forEach((item) => {
    const label = item.label || item.id;
    const shape = item.input_type === "api_curl"
      ? "api_access"
      : item.input_type === "webpage_url"
        ? "url"
        : inferExpectedShape(`${label} ${item.reason || item.hint || ""}`);
    let value = "";
    if (item.input_type === "api_curl") value = api.curl || api.url || "";
    else if (item.input_type === "webpage_url") value = webpage.url || "";
    else value = userPrereqs[item.id]?.value || "";
    const result = evaluateProvidedValue(shape, value, extras);
    checks.push({
      id: item.id,
      analyst_ref: label,
      asked_for: `${label}${item.derived_from ? ` (from ${item.derived_from})` : ""}`,
      provided: value ? String(value).slice(0, 120) : "(empty)",
      status: result.ok ? "pass" : "fail",
      blame: result.ok ? null : result.blame,
      expected_shape: shape,
    });
  });

  // 3) Blocking analyst prerequisites not already covered by an action/panel check
  for (const b of blocking) {
    const covered = checks.some((c) =>
      asksOverlap(c.analyst_ref, b.item) || asksOverlap(c.asked_for, b.item)
    );
    if (covered) continue;
    // Human may have satisfied via a free-text action; if nothing matched, fail closed when must_be_provided_by human.
    if (b.must_be_provided_by && b.must_be_provided_by !== "human") continue;
    const matchedAction = actions.find((a) => asksOverlap(a.detail || a.item, b.item));
    const matchedPrereq = Object.values(userPrereqs).find((p) => asksOverlap(p.label, b.item));
    const shape = inferExpectedShape(b.item);
    const value = (matchedAction?.provided_value || matchedPrereq?.value || "").trim();
    const result = evaluateProvidedValue(shape, value, extras);
    checks.push({
      id: `blocking-${checks.length}`,
      analyst_ref: b.item,
      asked_for: `[${b.category || "data"}] ${b.item}`,
      provided: value ? String(value).slice(0, 120) : "(not mapped / empty)",
      status: result.ok ? "pass" : "fail",
      blame: result.ok ? null : (result.blame || "Analyst blocking prerequisite not satisfied by human input"),
      expected_shape: shape,
    });
  }

  const failures = checks.filter((c) => c.status === "fail");
  // If Analyst asked for nothing blocking, accept (nothing to recheck).
  const nothingToCheck = checks.length === 0;
  const verdict = nothingToCheck ? "accepted" : (failures.length ? "rejected" : "accepted");
  const passed = verdict === "accepted";

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
