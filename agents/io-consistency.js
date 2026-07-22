/**
 * Cross-agent Input→Output Consistency Validator.
 * Structural + fidelity + coverage — Orchestrator advances only when ok.
 *
 * Handoffs (auditor matrix):
 *   ticket → analyst → writer → data → author → executor → reviewer → reporter
 */

export const HANDOFF = {
  TICKET_ANALYST: "ticket_analyst",
  ANALYST_WRITER: "analyst_writer",
  WRITER_DATA: "writer_data",
  DATA_AUTHOR: "data_author",
  AUTHOR_EXECUTOR: "author_executor",
  EXECUTOR_REVIEWER: "executor_reviewer",
  ALL_REPORTER: "all_reporter",
};

function acIds(analyst) {
  return new Set(
    (analyst?.testable_conditions || [])
      .map((c) => c?.id)
      .filter(Boolean),
  );
}

function outlineAcRefs(writer) {
  const refs = [];
  for (const o of writer?.test_outlines || []) {
    for (const id of o.mapped_acs || []) refs.push({ outline: o.id, ac: id });
  }
  for (const tc of writer?.test_cases || []) {
    if (tc?.ac_ref) refs.push({ outline: tc.id, ac: tc.ac_ref });
  }
  return refs;
}

function pct(n, d) {
  if (!d) return n ? 0 : 100;
  return Math.round((n / d) * 100);
}

/**
 * @param {string} handoff — HANDOFF.*
 * @param {object} ctx — { story, analyst, writer, data, author, executor, reviewer, reporter }
 * @returns {{
 *   ok: boolean,
 *   handoff: string,
 *   structural_ok: boolean,
 *   fidelity_ok: boolean,
 *   coverage_ok: boolean,
 *   failures: string[],
 *   quality: { coverage_pct: number, ambiguity_residual: number, invention_risk: 'low'|'medium'|'high', overall: 'high'|'medium'|'low' },
 *   evidence: string[],
 * }}
 */
export function checkIoConsistency(handoff, ctx = {}) {
  const failures = [];
  const evidence = [];
  let structural_ok = true;
  let fidelity_ok = true;
  let coverage_ok = true;
  let covered = 0;
  let expected = 0;
  let invention_risk = "low";

  const { story, analyst, writer, data, author, executor, reviewer, reporter } = ctx;

  if (handoff === HANDOFF.TICKET_ANALYST) {
    expected = 1;
    if (!analyst || typeof analyst !== "object") {
      structural_ok = false;
      failures.push("IO: Analyst output missing");
    } else {
      covered = 1;
      evidence.push("analyst payload present");
      if (!Array.isArray(analyst.testable_conditions)) {
        structural_ok = false;
        failures.push("IO: testable_conditions must be an array");
      }
      if (typeof analyst.analysis_complete !== "boolean") {
        structural_ok = false;
        failures.push("IO: analysis_complete required");
      }
      // Fidelity: empty ACs is honest (not invention) — coverage gap handled by MAIN GATE
      const entries = story?.acceptance_criteria_entries || [];
      const allowed = new Set(["business_rules", "alternative_flow", "exception_flow", "ac"]);
      for (const c of analyst.testable_conditions || []) {
        const src = String(c.source || "").toLowerCase();
        if (src && !/business rules|alternative|exception|acceptance/i.test(c.source || "")) {
          // soft: source label unusual
        }
        if (entries.length && c.section && !allowed.has(c.section)) {
          fidelity_ok = false;
          invention_risk = "high";
          failures.push(`IO: AC ${c.id} section "${c.section}" not an allowed AC source`);
        }
      }
      // Zero testable ACs can be honest (all rejected/unimplemented) — MAIN GATE + disposition cover that.
      evidence.push(`testable_conditions=${(analyst.testable_conditions || []).length}`);
    }
  }

  if (handoff === HANDOFF.ANALYST_WRITER) {
    const ids = acIds(analyst);
    expected = ids.size;
    if (!writer || writer.blocked) {
      structural_ok = false;
      failures.push("IO: Writer blocked or missing — cannot hand off from Analyst");
    } else {
      const outlines = writer.test_outlines || [];
      const cases = writer.test_cases || [];
      if (!outlines.length && !cases.length) {
        structural_ok = false;
        failures.push("IO: Writer produced no outlines or test cases");
      }
      if (ids.size === 0) {
        fidelity_ok = false;
        invention_risk = "high";
        failures.push("IO: Writer must not author when Analyst testable_conditions is empty");
      }
      const refs = outlineAcRefs(writer);
      const mapped = new Set();
      for (const r of refs) {
        if (!ids.has(r.ac)) {
          fidelity_ok = false;
          invention_risk = "high";
          failures.push(`IO: ${r.outline} maps to unknown AC ${r.ac} (not in Analyst testable_conditions)`);
        } else {
          mapped.add(r.ac);
        }
      }
      covered = mapped.size;
      for (const id of ids) {
        if (!mapped.has(id)) {
          coverage_ok = false;
          failures.push(`IO: Analyst ${id} has no Writer outline/case mapping`);
        }
      }
      evidence.push(`mapped ${mapped.size}/${ids.size} Analyst AC(s)`);
    }
  }

  if (handoff === HANDOFF.WRITER_DATA) {
    const outlines = writer?.test_outlines || writer?.test_cases || [];
    expected = outlines.length;
    if (!data || typeof data !== "object") {
      structural_ok = false;
      failures.push("IO: Data Extractor output missing");
    } else if (data.blocked) {
      structural_ok = false;
      failures.push("IO: Data Extractor blocked");
    } else {
      const rows = Array.isArray(data.datasets) ? data.datasets : [];
      const rowIds = new Set();
      for (const row of rows) {
        if (row?.test_case_id) rowIds.add(row.test_case_id);
        if (row?.id) rowIds.add(row.id);
      }
      // Stub summary-only datasets without per-TC linkage → fidelity fail
      const hasPerTc = rows.some((r) => r?.test_case_id || r?.requirement_id || r?.valid_input);
      if (outlines.length && !hasPerTc && (data.rows_extracted > 0 || rows.length)) {
        fidelity_ok = false;
        invention_risk = "medium";
        failures.push("IO: datasets lack per-test-case linkage to Writer outlines (stub summary is not fidelity-safe)");
      }
      for (const o of outlines) {
        const id = o.id;
        if (hasPerTc && !rowIds.has(id) && !rows.some((r) => r.test_case_id === id)) {
          // only enforce when datasets claim per-TC shape
          if (rows.some((r) => r.test_case_id)) {
            coverage_ok = false;
            failures.push(`IO: Writer ${id} has no dataset row`);
          }
        } else if (hasPerTc) {
          covered++;
        }
      }
      if (!hasPerTc) covered = 0;
      evidence.push(`datasets=${rows.length}, per_tc=${hasPerTc}`);
    }
  }

  if (handoff === HANDOFF.DATA_AUTHOR) {
    expected = 1;
    if (!author) {
      structural_ok = false;
      failures.push("IO: Author output missing");
    } else {
      covered = 1;
      if (author.blocked || author.success === false) {
        // Honest block is OK structurally
        evidence.push(`author status=${author.status || "blocked"}`);
      }
      const ids = acIds(analyst);
      if (ids.size === 0 && author.status === "REVIEW") {
        fidelity_ok = false;
        invention_risk = "high";
        failures.push("IO: Author must not reach REVIEW with zero Analyst ACs");
      }
      const approved = (writer?.test_outlines || []).filter((o) => o.status === "approved");
      if (author.status === "REVIEW" && (writer?.test_outlines || []).length && !approved.length) {
        fidelity_ok = false;
        failures.push("IO: Author REVIEW without any approved Writer outlines");
      }
      if (author.status === "BUILDING" || author.status === "PLAN_READY") {
        evidence.push("Author not REVIEW — Executor must not run");
      }
    }
  }

  if (handoff === HANDOFF.AUTHOR_EXECUTOR) {
    expected = 1;
    if (!executor) {
      structural_ok = false;
      failures.push("IO: Executor output missing");
    } else {
      covered = 1;
      if (author && author.status !== "REVIEW" && !author.blocked) {
        fidelity_ok = false;
        failures.push(`IO: Executor ran while Author status is ${author.status || "unknown"} (need REVIEW)`);
      }
      if (executor.summary?.measured === false || (executor.executed === 0 && executor.mode && /not run|blocked/i.test(executor.mode))) {
        // Honest non-execution is allowed — mark coverage incomplete for COMPLETE claims
        coverage_ok = true;
        evidence.push("Executor planned/not measured — honest non-COMPLETE");
      }
      if (executor.passed > 0 && !executor.results?.length && executor.summary?.measured !== true) {
        fidelity_ok = false;
        invention_risk = "high";
        failures.push("IO: Executor claimed passes without evidence results");
      }
    }
  }

  if (handoff === HANDOFF.EXECUTOR_REVIEWER) {
    expected = 1;
    if (!reviewer) {
      structural_ok = false;
      failures.push("IO: Reviewer output missing");
    } else {
      covered = 1;
      if (reviewer.score != null && executor?.summary?.measured === false && !reviewer.human_input_recheck) {
        fidelity_ok = false;
        invention_risk = "medium";
        failures.push("IO: Reviewer scored run without measured Executor evidence (or human_input_recheck)");
      }
      evidence.push(`reviewer.score=${reviewer.score ?? "n/a"}`);
    }
  }

  if (handoff === HANDOFF.ALL_REPORTER) {
    expected = 1;
    if (!reporter) {
      structural_ok = false;
      failures.push("IO: Reporter output missing");
    } else {
      covered = 1;
      if (reporter.final_report && !analyst && !writer) {
        fidelity_ok = false;
        invention_risk = "high";
        failures.push("IO: Reporter has final_report without upstream Analyst/Writer artifacts");
      }
      evidence.push(`report=${reporter.final_report || reporter.summary || "n/a"}`);
    }
  }

  const coverage_pct = pct(covered, expected || 1);
  const ambiguity_residual = (analyst?.analyst_reasoning?.ambiguous_acs || []).length;
  if (invention_risk === "low" && !fidelity_ok) invention_risk = "medium";

  let overall = "high";
  if (!structural_ok || !fidelity_ok || invention_risk === "high") overall = "low";
  else if (!coverage_ok || coverage_pct < 100 || ambiguity_residual > 0 || invention_risk === "medium") overall = "medium";

  const ok = structural_ok && fidelity_ok && coverage_ok && failures.length === 0;

  return {
    ok,
    handoff,
    structural_ok,
    fidelity_ok,
    coverage_ok,
    failures,
    quality: {
      coverage_pct,
      ambiguity_residual,
      invention_risk,
      overall,
    },
    evidence,
  };
}

/** Merge IO failures into a guideline-style validation result shape. */
export function ioFailuresAsMessages(io) {
  return (io?.failures || []).slice();
}
