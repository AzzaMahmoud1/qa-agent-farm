/**
 * Story-first prerequisite analysis (Analyst L2 — Forced Scratchpad Mode).
 * Deterministic simulator: scratchpad steps A–E + new JSON schema.
 * LLM in Cursor must still produce visible scratchpad text before JSON.
 */

const AC_SOURCE_SECTIONS = new Set(["business_rules", "alternative_flow", "exception_flow", "ac"]);
const VAGUE_WORDS = /\b(clear|valid|correct|fast|proper|simple)\b/i;
const UNIMPLEMENTED_MARKERS = /\b(unapplied|tbd|to be confirmed|n\/a|---)\b/i;

function isUseCaseSectionHeader(line) {
  const t = String(line || "").trim();
  return /^(post-conditions?|pre-conditions?|preconditions?|prerequisites?|basic flow|alternative flows?|exception flows?|main flow|main success scenario|extensions?|actors?|trigger|primary actor|secondary actors?|success scenario|failure scenario|business rules?|special requirements?|assumptions?|notes?|flow of events|sub-flows?|data table|used api|performance metrics?)\s*:?\s*$/i.test(t);
}

function getSectionType(line) {
  const t = String(line || "").trim().toLowerCase().replace(/:?\s*$/, "");
  if (/^pre-conditions?$|^preconditions?$/.test(t)) return "pre_conditions";
  if (/^post-conditions?$/.test(t)) return "post_conditions";
  if (/^basic flow/.test(t)) return "basic_flow";
  if (/^alternative flows?$/.test(t)) return "alternative_flow";
  if (/^exception flows?$/.test(t)) return "exception_flow";
  if (/^business rules?$/.test(t)) return "business_rules";
  if (/^data table$/.test(t)) return "data_table";
  if (/^used api$/.test(t)) return "used_api";
  if (/^performance metrics?$/.test(t)) return "performance_metrics";
  if (/^acceptance criteria?$/.test(t)) return "ac";
  if (isUseCaseSectionHeader(line)) return "uc_other";
  return null;
}

function sectionClassificationLabel(section) {
  const map = {
    pre_conditions: "PREREQUISITES (blocking)",
    post_conditions: "pass_evidence for happy path — not ACs",
    basic_flow: "TEST STEPS (not ACs)",
    alternative_flow: "ALT test cases / AC source",
    exception_flow: "EF test cases / AC source",
    business_rules: "ACs",
    data_table: "FIELD VALIDATION test cases",
    used_api: "prerequisite (API must exist)",
    performance_metrics: "non-functional test cases",
    ac: "ACs",
    uc_other: "scope / metadata — not ACs",
  };
  return map[section] || "scope only";
}

function acSourceLabel(section) {
  if (section === "business_rules") return "Business Rules";
  if (section === "alternative_flow") return "Alternative Flow";
  if (section === "exception_flow") return "Exception Flow";
  if (section === "ac") return "Acceptance Criteria";
  return null;
}

function isMetadataLine(line) {
  const t = String(line || "").trim();
  if (!t) return true;
  if (isUseCaseSectionHeader(t)) return true;
  if (/^UC\d+$/i.test(t)) return true;
  if (/^[A-Z]{1,6}[-_]?\d{1,6}$/.test(t) && t.length <= 12) return true;
  if (/^(priority|status|component|components|type|issue type|description|environment|assignee|reporter|labels?|sprint|epic|story points?|use case|severity|version|id)\s*:?\s*[\w\s.-]*$/i.test(t)) return true;
  if (/^(high|medium|low|critical|blocker|todo|done|draft|in progress)\s*$/i.test(t)) return true;
  return false;
}

function isNarrativeContext(line) {
  const t = String(line || "").trim();
  return /^(this (story|feature|ticket|requirement|module|is)|background|overview|note:|description:|scope:|out of scope|as a|we need to|the purpose|stakeholders|context)/i.test(t)
    || /\b(background|overview|context|stakeholders|purpose of this)\b/i.test(t);
}

function isFlowOrScenarioLine(line) {
  const raw = String(line || "").trim();
  const t = stripListPrefix(raw);
  if (!t) return false;
  if (/^\d+[.)]\s/.test(raw)) return true;
  if (/^(user|system|actor|admin)\s+(opens|enters|clicks|selects|navigates|submits|views|goes|returns|is redirected|has registered|has a registered|logs in|log in to|provides|inputs|types|presses|chooses)/i.test(t)) {
    return true;
  }
  if (/^invalid .+ shows (error|message|warning)/i.test(t) && !/\b(must|should|shall)\b/i.test(t)) return false;
  if (/^user is logged in$/i.test(t)) return true;
  return false;
}

function isStrongAcceptanceCriterion(line, section) {
  const t = String(line || "").trim();
  if (!t || isMetadataLine(t) || isNarrativeContext(t)) return false;
  if (section === "basic_flow" || section === "pre_conditions" || section === "post_conditions") return false;
  if (section === "basic_flow" && isFlowOrScenarioLine(t)) return false;
  if (isFlowOrScenarioLine(t) && section !== "alternative_flow" && section !== "exception_flow") {
    if (!/\b(must|should|shall|rejects?|will not|cannot|can't)\b/i.test(t)) return false;
  }
  if (/\b(must|should|shall|must not|shall not|required to|needs to|rejects?|will not|cannot|can't|never)\b/i.test(t)) {
    return true;
  }
  if (/\b(valid|invalid|error|display|show|return|accept|allow|deny|email|password|credential|session|token)\b/i.test(t)) {
    return !/^(user|system)\s+(opens|enters|clicks|has|is|logs)/i.test(t);
  }
  if ((section === "alternative_flow" || section === "exception_flow")
    && /\b(invalid|error|fail|reject|exception|denied)\b/i.test(t)) {
    return true;
  }
  return false;
}

function isLikelyAcceptanceCriterion(line, section) {
  return isStrongAcceptanceCriterion(line, section);
}

function isBehaviouralLine(line, section) {
  return isLikelyAcceptanceCriterion(line, section);
}

function sanitizeAcceptanceCriteria(acList, opts = {}) {
  const entries = (acList || []).map((item) =>
    typeof item === "string" ? { text: item, source: opts.defaultSource || "Business Rules", section: "business_rules" } : item
  );
  const valid = [];
  const rejected = [];
  for (const entry of entries) {
    const text = String(entry.text || "").trim();
    const section = entry.section || "business_rules";
    if (!text) continue;
    if (section === "basic_flow" || isFlowOrScenarioLine(text)) {
      if (section === "basic_flow" || (isFlowOrScenarioLine(text) && !isStrongAcceptanceCriterion(text, section))) {
        rejected.push({ text, reason: "flow or scenario step — not an acceptance criterion" });
        continue;
      }
    }
    if (section === "pre_conditions") {
      rejected.push({ text, reason: "pre-condition — prerequisite, not an AC" });
      continue;
    }
    if (section === "post_conditions") {
      rejected.push({ text, reason: "post-condition — pass evidence, not an AC" });
      continue;
    }
    if (!AC_SOURCE_SECTIONS.has(section) && section !== "inferred_business_rules") {
      rejected.push({ text, reason: `section "${section}" is not an AC source` });
      continue;
    }
    if (isLikelyAcceptanceCriterion(text, section)) {
      valid.push({ text, source: entry.source || acSourceLabel(section) || "Business Rules", section });
    } else {
      rejected.push({
        text,
        reason: isMetadataLine(text) ? "ticket metadata — not testable behaviour" : "not a testable acceptance criterion",
      });
    }
  }
  return { valid, rejected };
}

function isShallowTestAction(acText, actionSummary) {
  if (!actionSummary || !actionSummary.startsWith("verify: ")) return false;
  if (isMetadataLine(acText) || !isLikelyAcceptanceCriterion(acText, "business_rules")) return true;
  const tail = actionSummary.slice("verify: ".length).trim();
  return tail.length < 18 && !/\b(login|upload|api|error|valid|invalid|password|email)\b/i.test(tail);
}

function stripListPrefix(line) {
  return String(line || "").replace(/^[\s•\-*\d.]+\s*|^AC-\d+[:.)]\s*/i, "").trim();
}

function isBulletLine(line) {
  return /^[-*•]\s+|^\d+[.)]\s+|^AC-\d+[:.)]/i.test(String(line || "").trim());
}

function normalizeRequirementsField(key) {
  const k = String(key || "").toLowerCase().replace(/\s+/g, "_");
  if (k === "components" || k === "component") return "components";
  if (k === "labels" || k === "label") return "labels";
  if (k === "issue_type" || k === "type") return "issueType";
  return k;
}

function parseMetadataField(line) {
  const t = String(line || "").trim();
  if (!t) return null;
  const kv = t.match(
    /^(priority|status|component|components|type|issue type|environment|assignee|reporter|labels?|sprint|epic|story points?|use case|severity|version|id)\s*:\s*(.+)$/i
  );
  if (kv) return { field: normalizeRequirementsField(kv[1]), value: kv[2].trim(), raw: t };
  if (/^UC\d+$/i.test(t)) return { field: "use_case", value: t, raw: t };
  if (/^(high|medium|low|critical|blocker)\s*$/i.test(t)) return { field: "priority", value: t, raw: t };
  if (/^(todo|done|draft|in progress|to do)\s*$/i.test(t)) return { field: "status", value: t, raw: t };
  if (/^priority\s*$/i.test(t) || /^status\s*$/i.test(t)) return { field: "_label_only", raw: t };
  return null;
}

function mergeRejectedLines(existing, incoming) {
  const out = [...(existing || [])];
  for (const item of incoming || []) {
    const text = typeof item === "string" ? item : item.text;
    if (!text || out.some((r) => r.text === text)) continue;
    out.push(typeof item === "string" ? { text: item, reason: "ticket metadata — not testable behaviour" } : item);
  }
  return out;
}

function inferRolesFromText(text) {
  const roles = [];
  const blob = String(text || "");
  for (const role of ["System Admin", "Account Manager", "Organization Manager", "admin", "user", "viewer", "editor"]) {
    if (new RegExp(`\\b${role}\\b`, "i").test(blob)) roles.push(role);
  }
  return roles.length ? [...new Set(roles)] : ["user"];
}

function buildAmbiguityScan(fullText, acEntries) {
  const lines = [];
  const unimplemented = [];
  const ambiguous = [];
  const rawLines = String(fullText || "").split("\n").map((l) => l.trim()).filter(Boolean);

  for (const line of rawLines) {
    if (UNIMPLEMENTED_MARKERS.test(line)) {
      lines.push(`- [UNIMPLEMENTED] ${line} — reason: ticket marks rule as not yet applied`);
      unimplemented.push(line);
    }
    const vagueMatch = line.match(VAGUE_WORDS);
    if (vagueMatch && isBehaviouralLine(line, "business_rules")) {
      lines.push(`- [VAGUE] ${line} — challenge: define "${vagueMatch[1]}" measurably`);
      ambiguous.push({ line, word: vagueMatch[1] });
    }
    if (/\buser can\b/i.test(line) && !/\b(admin|manager|role)\b/i.test(line)) {
      lines.push(`- [MISSING ACTOR] ${line} — which roles?`);
    }
    if (/\b(exists|available|configured)\b/i.test(line) && !/\b(email|password|url|account|@[\w.-]+)\b/i.test(line)) {
      lines.push(`- [MISSING STATE] ${line} — what data must exist?`);
    }
  }

  for (const entry of acEntries || []) {
    const t = entry.text;
    if (VAGUE_WORDS.test(t)) {
      const word = t.match(VAGUE_WORDS)?.[1];
      ambiguous.push({ ac_id: null, issue: `"${word}" is not measurable`, assumption: `Assume standard QA interpretation of "${word}"` });
    }
  }

  if (!lines.length) lines.push("- [CLEAN] no ambiguity signals found");
  return { text: `AMBIGUITY SCAN:\n${lines.join("\n")}`, unimplemented, ambiguous };
}

function buildSectionClassification(fullText) {
  const seen = new Set();
  const rows = [];
  for (const line of String(fullText || "").split("\n")) {
    const section = getSectionType(line.trim());
    if (!section || seen.has(section)) continue;
    seen.add(section);
    rows.push(`- ${line.trim()} → ${sectionClassificationLabel(section)}`);
  }
  if (!rows.length) rows.push("- (no structured sections) → infer ACs from behavioural lines in body");
  return `SECTION CLASSIFICATION:\n${rows.join("\n")}`;
}

function buildTestableConditionsScratchpad(conditions) {
  const rows = (conditions || []).map((c) => {
    const amb = c.ambiguous
      ? `YES → assumption: ${c.assumption}`
      : "NO";
    return `[${c.id}] Source: ${c.source}
Text: ${c.ac_text}
Roles affected: ${(c.roles || []).join(", ")}
Testable as: "${c.testable_statement}"
Pass evidence: ${c.pass_evidence}
Fail evidence: ${c.fail_evidence}
Ambiguous? ${amb}`;
  });
  return rows.length
    ? `EXTRACTED TESTABLE CONDITIONS:\n${rows.join("\n\n")}`
    : "EXTRACTED TESTABLE CONDITIONS:\n(none — check Business Rules / Alt / Exception Flow sections)";
}

function buildPrerequisitesScratchpad(blocking, nonBlocking) {
  const fmt = (items, prefix) => (items || []).map((p) =>
    `  [${prefix}][${p.satisfied_by_ticket ? "SATISFIED" : "MISSING"}] ${p.item}`
  ).join("\n");
  return `PREREQUISITES:
DATA:
${fmt([...(blocking || []), ...(nonBlocking || [])].filter((p) => p.category === "data"), "BLOCKING")}
ENVIRONMENT:
${fmt([...(blocking || []), ...(nonBlocking || [])].filter((p) => p.category === "environment"), "BLOCKING")}
DEPENDENCY:
${fmt([...(blocking || []), ...(nonBlocking || [])].filter((p) => p.category === "dependency"), "BLOCKING")}
KNOWLEDGE:
${fmt([...(blocking || []), ...(nonBlocking || [])].filter((p) => p.category === "knowledge"), "NON-BLOCKING")}`;
}

const COVERAGE_GAP_CATEGORIES = [
  "boundary", "negative", "security", "concurrency", "integration", "regression", "performance", "ui",
];

function buildCoverageGapsScratchpad(gaps) {
  const byCat = Object.fromEntries(COVERAGE_GAP_CATEGORIES.map((c) => [c, null]));
  for (const g of gaps || []) {
    byCat[g.category] = g.gap;
  }
  const rows = COVERAGE_GAP_CATEGORIES.map((cat) => {
    const label = cat === "ui" ? "UI/L10N" : cat.toUpperCase();
    return `${label}: ${byCat[cat] || "NONE"}`;
  });
  return `COVERAGE GAPS:\n${rows.join("\n")}`;
}

function buildScratchpad(fullText, analystPartial) {
  const stepA = buildAmbiguityScan(fullText, analystPartial.testable_conditions);
  const stepB = buildSectionClassification(fullText);
  const stepC = buildTestableConditionsScratchpad(analystPartial.testable_conditions);
  const stepD = buildPrerequisitesScratchpad(
    analystPartial.prerequisites_needed?.blocking,
    analystPartial.prerequisites_needed?.non_blocking,
  );
  const stepE = buildCoverageGapsScratchpad(analystPartial.coverage_gaps);
  return {
    step_a_ambiguity_scan: stepA.text,
    step_b_section_classification: stepB,
    step_c_testable_conditions: stepC,
    step_d_prerequisites: stepD,
    step_e_coverage_gaps: stepE,
    rendered: [
      "#### SCRATCHPAD STEP A — Ambiguity scan",
      stepA.text,
      "",
      "#### SCRATCHPAD STEP B — Section classification",
      stepB,
      "",
      "#### SCRATCHPAD STEP C — Extract ALL testable conditions",
      stepC,
      "",
      "#### SCRATCHPAD STEP D — Extract ALL prerequisites",
      stepD,
      "",
      "#### SCRATCHPAD STEP E — Find coverage gaps",
      stepE,
    ].join("\n"),
    unimplemented_rules: stepA.unimplemented,
  };
}

function inferTestableStatement(acText, roles) {
  const role = (roles || ["user"])[0];
  const t = acText.toLowerCase();
  if (/\breject|invalid|deny|fail|error\b/.test(t)) {
    return `System MUST reject or show error when invalid input is submitted for ${role}`;
  }
  if (/\bmust|should|shall|accept|valid\b/.test(t)) {
    return `System MUST enforce the rule when ${role} exercises the feature`;
  }
  return `System MUST behave per ticket when ${role} triggers the scenario`;
}

function inferPassFailEvidence(acText) {
  const t = acText.toLowerCase();
  if (/\breject|invalid|deny|error|fail\b/.test(t)) {
    return {
      pass: "HTTP 4xx or UI error state with non-leaking message",
      fail: "Invalid input accepted or generic/empty error",
    };
  }
  return {
    pass: "HTTP 200 / success UI state / expected data persisted",
    fail: "Unexpected error, wrong state, or silent failure",
  };
}

function buildCoverageGaps(story, acCount) {
  const gaps = [
    {
      gap: "Unicode / locale edge cases not specified in ticket",
      category: "boundary",
      severity: "non-blocking",
      suggested_test: "Exercise inputs with combining characters and RTL labels",
    },
    {
      gap: "Rate limiting and error recovery not defined",
      category: "negative",
      severity: "non-blocking",
      suggested_test: "Repeat failed requests and verify stable error handling",
    },
    {
      gap: "Cross-tenant or role escalation not specified",
      category: "security",
      severity: "non-blocking",
      suggested_test: "Access resource with wrong role and expect denial",
    },
    {
      gap: "Concurrent sessions or parallel edits not covered",
      category: "concurrency",
      severity: "non-blocking",
      suggested_test: "Two users modify same entity simultaneously",
    },
    {
      gap: "Downstream billing or notification systems untested",
      category: "integration",
      severity: "non-blocking",
      suggested_test: "Verify side-effect webhooks or events after primary action",
    },
    {
      gap: "Adjacent features may regress when this ships",
      category: "regression",
      severity: "non-blocking",
      suggested_test: "Smoke test related modules listed in affected_components",
    },
    {
      gap: "Load or timing thresholds not in ticket",
      category: "performance",
      severity: "non-blocking",
      suggested_test: "Measure p95 latency under nominal load",
    },
    {
      gap: "Layout and localization not specified",
      category: "ui",
      severity: "non-blocking",
      suggested_test: "Verify labels and error text in supported locales",
    },
  ];
  if (acCount === 0) {
    gaps.unshift({
      gap: "No testable ACs extracted — test design blocked",
      category: "negative",
      severity: "blocking",
      suggested_test: "Confirm Business Rules / Alt / Exception Flow content with PO",
    });
  }
  if (story?.blocking_gaps) {
    gaps.push({
      gap: `${story.blocking_gaps} blocking gap(s) flagged in ticket metadata`,
      category: "integration",
      severity: "blocking",
      suggested_test: "Resolve blocking dependencies before execution",
    });
  }
  return gaps;
}

function inferRelatedFiles(story) {
  const slug = (story?.id || story?.title || "feature").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
  return [
    { path: `${slug}.controller.ts`, reason: "HTTP/route handler for described behaviour" },
    { path: `${slug}.service.ts`, reason: "Business logic implementing ACs" },
    { path: `tests/${slug}.spec.ts`, reason: "Automated tests for extracted conditions" },
  ];
}

function slugifyPrereqItem(text, index) {
  const base = String(text || "prereq").toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 32);
  return base || `prereq_${index}`;
}

function legacyPrereqAdapter(prerequisites_needed, testable_conditions, reasoning_steps) {
  const blocking = prerequisites_needed?.blocking || [];
  const nonBlocking = prerequisites_needed?.non_blocking || [];
  const items = [];
  const alreadySatisfied = [];

  blocking.forEach((p, i) => {
    const entry = {
      id: slugifyPrereqItem(p.item, i),
      label: p.item,
      category: p.category,
      status: p.satisfied_by_ticket ? "already_in_ticket" : "required_from_user",
      hint: p.if_not_satisfied || p.assumption_made || "",
      reason: p.if_not_satisfied || p.item,
      analyst_note: p.if_not_satisfied || p.item,
      required_for: (testable_conditions || []).map((c) => c.id),
      required: !p.satisfied_by_ticket,
      evidence_in_ticket: p.satisfied_by_ticket ? p.item : undefined,
    };
    if (p.satisfied_by_ticket) alreadySatisfied.push(entry);
    else if (p.must_be_provided_by === "human") items.push(entry);
    else items.push({ ...entry, status: "required_from_user" });
  });

  nonBlocking.forEach((p, i) => {
    if (p.satisfied_by_ticket) {
      alreadySatisfied.push({
        id: slugifyPrereqItem(p.item, i + 100),
        label: p.item,
        status: "already_in_ticket",
        analyst_note: p.assumption_made || p.item,
        evidence_in_ticket: p.item,
      });
    }
  });

  const test_actions = (testable_conditions || []).map((c) => ({
    ac: c.id,
    ac_text: c.ac_text,
    action: inferTestAction(c.ac_text).summary,
  }));

  return {
    needed: items.length > 0,
    items,
    already_satisfied: alreadySatisfied,
    not_applicable: [],
    blocking,
    non_blocking: nonBlocking,
    reasoning: (reasoning_steps || []).map((s) => s.text).join(" "),
    reasoning_steps,
    story_analysis: {
      title: "",
      goal: "",
      acceptance_criteria: (testable_conditions || []).map((c) => c.ac_text),
      rejected_as_non_ac: [],
      test_actions,
      reproduction_steps: [],
      environment: null,
    },
    summary: items.length
      ? `From this story: ${items.length} blocking prerequisite(s) only you can supply`
      : "From this story: ticket has enough detail — nothing extra needed from you",
  };
}

/**
 * Parse an entire pasted requirements block with section-aware AC extraction.
 */
function parseFullRequirements(text) {
  const raw = String(text || "").trim();
  if (!raw) return { error: "empty" };

  const lines = raw.split("\n");
  let title = "";
  let section = "body";
  const descriptionLines = [];
  const acCandidates = [];
  const rejected = [];
  const metadata = {};
  const sectionsSeen = [];

  function rejectLine(line, reason) {
    const t = String(line || "").trim();
    if (!t) return;
    if (!rejected.some((r) => r.text === t)) {
      rejected.push({ text: t, reason });
    }
  }

  function pushAcCandidate(line, sourceSection) {
    const stripped = stripListPrefix(line);
    if (!stripped) return;
    const src = acSourceLabel(sourceSection) || "Business Rules";
    if (isMetadataLine(stripped) && !isLikelyAcceptanceCriterion(stripped, sourceSection)) {
      rejectLine(stripped, "ticket metadata — not testable behaviour");
      return;
    }
    if (sourceSection === "basic_flow") {
      rejectLine(stripped, "basic flow step — not an acceptance criterion");
      return;
    }
    if (sourceSection === "pre_conditions") {
      rejectLine(stripped, "pre-condition — prerequisite, not an AC");
      return;
    }
    if (sourceSection === "post_conditions") {
      rejectLine(stripped, "post-condition — pass evidence, not an AC");
      return;
    }
    if (!AC_SOURCE_SECTIONS.has(sourceSection) && sourceSection !== "inferred_business_rules") {
      rejectLine(stripped, `section "${sourceSection}" is not an AC source`);
      return;
    }
    acCandidates.push({ text: stripped, source: src, section: sourceSection });
  }

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      if (section === "body" || section === "description") descriptionLines.push("");
      continue;
    }

    const sectionType = getSectionType(trimmed);
    if (sectionType) {
      section = sectionType;
      if (!sectionsSeen.includes(sectionType)) sectionsSeen.push(sectionType);
      rejectLine(trimmed, "use-case section header — not a prerequisite or acceptance criterion");
      continue;
    }

    if (/^description\s*:?\s*$/i.test(trimmed)) {
      section = "description";
      continue;
    }
    if (/^steps to reproduce\s*:?\s*$/i.test(trimmed)) {
      section = "steps";
      continue;
    }
    if (/^environment\s*:?\s*$/i.test(trimmed)) {
      section = "environment";
      continue;
    }

    if (section === "steps") {
      descriptionLines.push(lines[i]);
      continue;
    }

    if (section === "environment") {
      metadata.environment = metadata.environment
        ? `${metadata.environment} ${trimmed}`
        : trimmed;
      descriptionLines.push(`Environment: ${trimmed}`);
      continue;
    }

    if (!title && section === "body" && i === 0 && !isBulletLine(lines[i])) {
      const metaAsTitle = parseMetadataField(trimmed);
      if (!metaAsTitle) {
        title = trimmed.slice(0, 160);
        continue;
      }
    }

    const meta = parseMetadataField(trimmed);
    if (meta) {
      if (meta.field === "_label_only") {
        rejectLine(trimmed, "ticket metadata — not testable behaviour");
      } else if (meta.field === "components") {
        metadata.components = metadata.components || [];
        metadata.components.push(meta.value);
        rejectLine(trimmed, "ticket metadata — moved to story fields");
      } else if (meta.field === "labels") {
        metadata.labels = metadata.labels || [];
        metadata.labels.push(
          ...meta.value.split(/[,;]/).map((s) => s.trim()).filter(Boolean)
        );
        rejectLine(trimmed, "ticket metadata — moved to story fields");
      } else if (meta.field === "use_case") {
        metadata.use_case = meta.value;
        rejectLine(trimmed, "ticket metadata — not testable behaviour");
      } else {
        metadata[meta.field] = meta.value;
        rejectLine(trimmed, "ticket metadata — moved to story fields");
      }
      continue;
    }

    if (isMetadataLine(trimmed) && !isLikelyAcceptanceCriterion(trimmed, section)) {
      rejectLine(trimmed, "ticket metadata — not testable behaviour");
      continue;
    }

    if (section === "ac" || AC_SOURCE_SECTIONS.has(section)) {
      pushAcCandidate(lines[i], section);
      continue;
    }

    if (section === "basic_flow" || section === "pre_conditions" || section === "post_conditions") {
      rejectLine(stripListPrefix(lines[i]) || trimmed, section === "basic_flow"
        ? "basic flow step — not an acceptance criterion"
        : section === "pre_conditions"
          ? "pre-condition — prerequisite, not an AC"
          : "post-condition — pass evidence, not an AC");
      descriptionLines.push(lines[i]);
      continue;
    }

    if (isBulletLine(lines[i])) {
      if (isStrongAcceptanceCriterion(stripListPrefix(lines[i]), "inferred_business_rules")) {
        pushAcCandidate(lines[i], "inferred_business_rules");
      } else {
        descriptionLines.push(lines[i]);
      }
      continue;
    }

    if (isStrongAcceptanceCriterion(trimmed, "inferred_business_rules")) {
      pushAcCandidate(trimmed, "inferred_business_rules");
      continue;
    }

    descriptionLines.push(lines[i]);
  }

  if (!title) {
    const firstDesc = descriptionLines.find((l) => l.trim());
    title = (firstDesc || "Requirements").trim().slice(0, 160);
  }

  const { valid: acceptance_criteria_entries, rejected: sanitizeRejected } = sanitizeAcceptanceCriteria(acCandidates);
  const acceptance_criteria_list = acceptance_criteria_entries.map((e) => e.text);
  const acceptance_criteria_rejected = mergeRejectedLines(rejected, sanitizeRejected);

  let description = descriptionLines.join("\n").trim();
  if (description === title) description = "";
  if (!description && acceptance_criteria_list.length) {
    description = title;
  }
  if (!description) description = title;

  return {
    title,
    description,
    acceptance_criteria_list,
    acceptance_criteria_entries,
    acceptance_criteria_rejected,
    requirements_metadata: metadata,
    requirements_raw: raw,
    sections_seen: sectionsSeen,
  };
}

function buildAnalystOutput(story) {
  const title = (story?.title || "").trim();
  const description = (story?.description || "").trim();
  let acEntries = (story?.acceptance_criteria_entries || []).filter((e) => e?.text);
  if (!acEntries.length) {
    acEntries = (story?.acceptance_criteria_list || []).filter(Boolean).map((text) => ({
      text,
      source: "Business Rules",
      section: "inferred_business_rules",
    }));
  }
  const preRejected = story?.acceptance_criteria_rejected || [];

  if (!acEntries.length && description) {
    for (const line of description.split("\n")) {
      const t = line.trim();
      if (!t || isMetadataLine(t)) continue;
      if (isBehaviouralLine(t, "inferred_business_rules")) {
        acEntries.push({ text: t, source: "Business Rules", section: "inferred_business_rules" });
      }
    }
  }

  const { valid: validEntries, rejected: rejectedAcs } = sanitizeAcceptanceCriteria(acEntries);
  const allRejected = mergeRejectedLines(preRejected, rejectedAcs);
  const components = story?.components || [];
  const labels = story?.labels || [];

  const fullText = story?.requirements_raw
    ? String(story.requirements_raw)
    : [title, description, ...validEntries.map((e) => e.text), ...components, ...labels].join("\n");
  const blob = fullText.toLowerCase();

  const stepsMatch = fullText.match(
    /steps to reproduce[:\s]*\n([\s\S]*?)(?=\n\n|Environment:|Priority:|Component:|Acceptance Criteria:|$)/i
  );
  const steps = stepsMatch
    ? stepsMatch[1].split("\n").map((l) => l.replace(/^[\s\d.]+\s*/, "").trim()).filter(Boolean)
    : [];

  const envMatch = fullText.match(/^Environment:\s*(.+)$/im);
  const environmentLine = envMatch?.[1]?.trim() || "";

  const reasoningSteps = [];
  reasoningSteps.push({
    step: "understand",
    text: title ? `This story is about: "${title}".` : "Reading the user story to determine what must be tested.",
  });

  if (allRejected.length) {
    reasoningSteps.push({
      step: "reject_non_ac",
      text: `Excluded ${allRejected.length} line(s) — metadata, flow, or wrong section: ${allRejected.map((r) => `"${r.text}"`).join(", ")}`,
      cite: allRejected.map((r) => r.text).join("; "),
    });
  }

  const ambiguous_acs = [];
  const testable_conditions = [];

  validEntries.forEach((entry, i) => {
    const id = `AC-${i + 1}`;
    const roles = inferRolesFromText(entry.text);
    const evidence = inferPassFailEvidence(entry.text);
    const vague = VAGUE_WORDS.test(entry.text);
    let assumption = null;
    if (vague) {
      const word = entry.text.match(VAGUE_WORDS)?.[1];
      assumption = `Treat "${word}" as standard QA observable (message visible, field validated, or status code)`;
      ambiguous_acs.push({ ac_id: id, issue: `"${word}" is not measurable in the ticket`, assumption });
    }
    const action = inferTestAction(entry.text);
    if (isShallowTestAction(entry.text, action.summary)) return;

    reasoningSteps.push({
      step: "map_ac",
      text: `${id} "${entry.text}" → ${action.summary}`,
      cite: entry.text,
      ac_id: id,
    });

    testable_conditions.push({
      id,
      source: entry.source,
      ac_text: entry.text,
      roles,
      testable_statement: inferTestableStatement(entry.text, roles),
      pass_evidence: evidence.pass,
      fail_evidence: evidence.fail,
      ambiguous: vague,
      assumption,
    });
  });

  const testActionsForNeeds = testable_conditions.map((c) => ({
    ac_id: c.id,
    ac_text: c.ac_text,
    ...inferTestAction(c.ac_text),
  }));

  const mergedNeeds = mergeSetupNeeds(testActionsForNeeds, steps, blob, environmentLine);
  const blocking = [];
  const non_blocking = [];

  for (const need of mergedNeeds) {
    const evidence = findEvidenceInStory(need, fullText, environmentLine, steps);
    const category = need.id === "target_environment" ? "environment"
      : need.id === "feature_flag" ? "environment"
      : need.id === "login_user" || need.id === "user_role" || need.id === "test_file" ? "data"
      : "data";
    if (evidence) {
      blocking.push({
        item: need.label,
        category,
        satisfied_by_ticket: true,
        if_not_satisfied: need.gap_reason,
        must_be_provided_by: "human",
      });
      reasoningSteps.push({
        step: "satisfied",
        text: `${need.label}: found in ticket (${evidence}).`,
        cite: evidence,
      });
    } else {
      blocking.push({
        item: need.label,
        category,
        satisfied_by_ticket: false,
        if_not_satisfied: need.gap_reason,
        must_be_provided_by: "human",
      });
      reasoningSteps.push({
        step: "gap",
        text: `${need.label}: ${need.gap_reason} (required for ${need.required_for.join(", ")}).`,
        cite: need.required_for.join("; "),
      });
    }
  }

  const explicitLines = parseExplicitPrerequisites(fullText);
  for (const line of explicitLines) {
    if (blocking.some((b) => b.item === line.label)) continue;
    if (line.hasConcrete) {
      blocking.push({
        item: line.label,
        category: "data",
        satisfied_by_ticket: true,
        if_not_satisfied: "Pre-condition listed without concrete values",
        must_be_provided_by: "human",
      });
    } else {
      blocking.push({
        item: line.label,
        category: "data",
        satisfied_by_ticket: false,
        if_not_satisfied: `Pre-condition needs concrete value: ${line.text}`,
        must_be_provided_by: "human",
      });
    }
  }

  if (environmentLine && !blocking.some((b) => b.item === "Target environment")) {
    blocking.push({
      item: "Target environment",
      category: "environment",
      satisfied_by_ticket: true,
      if_not_satisfied: "Tests need environment name",
      must_be_provided_by: "human",
    });
  }

  non_blocking.push({
    item: "Filter option values and undocumented enums",
    category: "knowledge",
    satisfied_by_ticket: false,
    assumption_made: "Use PO defaults or staging catalog values during test design",
  });

  const prerequisites_needed = { blocking, non_blocking };
  const coverage_gaps = buildCoverageGaps(story, testable_conditions.length);
  const related_files = inferRelatedFiles(story);
  const affected_components = components.length ? components : ["API", "Backend service"];
  const unimplemented_rules = buildAmbiguityScan(fullText, testable_conditions).unimplemented;

  const rejected_strings = allRejected.map((r) => `${r.text} — ${r.reason}`);

  const partial = {
    testable_conditions,
    prerequisites_needed,
    coverage_gaps,
  };
  const scratchpad = buildScratchpad(fullText, partial);

  const missingBlocking = blocking.filter((b) => !b.satisfied_by_ticket);
  const summary = `${testable_conditions.length} testable condition(s), ${missingBlocking.length} blocking prerequisite(s) missing, ${coverage_gaps.length} coverage gap(s) found. `
    + (unimplemented_rules.length ? `Unimplemented rules: [${unimplemented_rules.join("; ")}]. ` : "")
    + (missingBlocking.length ? `Human must provide: [${missingBlocking.map((b) => b.item).join(", ")}].` : "Human must provide: [none].");

  const legacy = legacyPrereqAdapter(prerequisites_needed, testable_conditions, reasoningSteps);
  legacy.story_analysis.title = title;
  legacy.story_analysis.goal = description.split("\n")[0] || title;
  legacy.story_analysis.rejected_as_non_ac = allRejected;
  legacy.story_analysis.reproduction_steps = steps;
  legacy.story_analysis.environment = environmentLine || null;

  return {
    success: true,
    scratchpad,
    analyst_reasoning: {
      ticket_read: title ? `Story covers: ${title}` : "Requirements analysis from pasted ticket",
      unimplemented_rules,
      ambiguous_acs,
      rejected_as_non_ac: rejected_strings,
    },
    testable_conditions,
    prerequisites_needed,
    coverage_gaps,
    affected_components,
    related_files,
    ready_for_test_design: testable_conditions.length > 0 && missingBlocking.length === 0,
    summary,
    // Legacy adapter for simulator prerequisite panel
    ...legacy,
  };
}

function analyzeStoryPrerequisites(story) {
  const out = buildAnalystOutput(story);
  return {
    needed: out.needed,
    items: out.items,
    already_satisfied: out.already_satisfied,
    not_applicable: out.not_applicable,
    blocking: out.prerequisites_needed.blocking,
    non_blocking: out.prerequisites_needed.non_blocking,
    reasoning: out.reasoning,
    reasoning_steps: out.reasoning_steps,
    story_analysis: out.story_analysis,
    summary: out.summary,
    scratchpad: out.scratchpad,
  };
}

function inferTestAction(acText) {
  const t = acText.toLowerCase();
  const needs = [];

  if (/\b(log\s*in|sign\s*in|email|password|credentials?|session token|authentication|wrong password)\b/.test(t)) {
    needs.push("login_user");
  }
  if (/\bhttps?:\/\/[^\s]+|\/api\/|api endpoint|rest endpoint|base url|target url|staging url|production url\b/.test(t)) {
    needs.push("target_environment");
  }
  if (/\b(upload|attach|file|document)\b/.test(t)) {
    needs.push("test_file");
  }
  if (/\b(role|permission|admin|rbac)\b/.test(t)) {
    needs.push("user_role");
  }
  if (/\b(flag|toggle|feature)\b/.test(t)) {
    needs.push("feature_flag");
  }

  let summary = "verify acceptance criterion";
  if (needs.includes("login_user")) summary = "log in and check auth behaviour";
  else if (needs.includes("target_environment")) summary = "call or reach the system under test";
  else if (needs.includes("test_file")) summary = "upload or attach a file";
  else if (needs.includes("user_role")) summary = "act as a specific role";

  if (!needs.length) {
    return { summary: `verify: ${acText.slice(0, 80)}`, needs: [] };
  }

  return { summary, needs: [...new Set(needs)] };
}

function inferNeedsFromText(text) {
  return inferTestAction(text).needs;
}

function mergeSetupNeeds(testActions, steps, blob, environmentLine) {
  const needMap = new Map();

  function addNeed(id, spec, acId) {
    if (!needMap.has(id)) needMap.set(id, { ...spec, required_for: [] });
    const entry = needMap.get(id);
    if (!entry.required_for.includes(acId)) entry.required_for.push(acId);
  }

  for (const action of testActions) {
    for (const needId of action.needs || []) {
      const spec = NEED_SPECS[needId];
      if (spec) addNeed(needId, spec, action.ac_id);
    }
  }

  if (steps.some((s) => /create (?:an? )?account|register|existing user/i.test(s)) && needMap.has("login_user")) {
    const login = needMap.get("login_user");
    login.gap_reason =
      "Steps say to create/use an account but the ticket does not give the email and password to use.";
    login.hint = "Email and password for the test account (e.g. user@example.com / Secret123)";
  }

  if (environmentLine && !needMap.has("target_environment")) {
    addNeed("target_environment", NEED_SPECS.target_environment, "Environment");
  }

  return [...needMap.values()];
}

const NEED_SPECS = {
  login_user: {
    id: "login_user",
    label: "Login test user",
    hint: "Email and password for an account that exists in the test environment",
    gap_reason: "Acceptance criteria require login, but the ticket never says which account to use.",
    satisfied_reason: "Ticket includes a test email and password to log in with.",
  },
  target_environment: {
    id: "target_environment",
    label: "Where to test",
    hint: "Base URL or environment name (e.g. https://staging.example.com)",
    gap_reason: "Tests need a target system URL but the ticket does not name one.",
    satisfied_reason: "Ticket names the environment or base URL.",
  },
  test_file: {
    id: "test_file",
    label: "Sample file",
    hint: "File to upload or attach during the test",
    gap_reason: "Story involves file upload but no sample file is specified.",
    satisfied_reason: "Ticket references a concrete file or sample.",
  },
  user_role: {
    id: "user_role",
    label: "User role",
    hint: "Which role to test as (e.g. admin, viewer)",
    gap_reason: "Story is role-sensitive but does not say which role to use.",
    satisfied_reason: "Ticket specifies the role.",
  },
  feature_flag: {
    id: "feature_flag",
    label: "Feature flag state",
    hint: "Which flag must be on or off",
    gap_reason: "Story depends on a flag but state is not documented.",
    satisfied_reason: "Ticket documents flag state.",
  },
};

function findEvidenceInStory(need, fullText, environmentLine, steps) {
  const hasEmail = /\b[\w.-]+@[\w.-]+\.\w{2,}\b/i.test(fullText);
  const hasPassword = /\bpassword\s*[:=]\s*\S+/i.test(fullText) || (hasEmail && /\bpassword\b/i.test(fullText));
  const hasUrl = /https?:\/\/[^\s]+/i.test(fullText);

  switch (need.id) {
    case "login_user":
      if (hasEmail && hasPassword) {
        const email = fullText.match(/\b[\w.-]+@[\w.-]+\.\w{2,}\b/i)?.[0];
        return email ? `${email} + password mentioned` : null;
      }
      return null;
    case "target_environment":
      if (environmentLine && environmentLine.length > 3) return environmentLine;
      if (hasUrl) return fullText.match(/https?:\/\/[^\s]+/i)?.[0];
      return null;
    case "test_file":
      if (/\.\w{2,4}\b|sample file|filename/i.test(fullText)) return "file referenced in ticket";
      return null;
    case "user_role":
      if (/\b(admin|viewer|editor)\b/i.test(fullText)) return fullText.match(/\b(admin|viewer|editor)\b/i)?.[0];
      return null;
    case "feature_flag":
      if (/flag\s*[:=]|enabled|disabled/i.test(fullText)) return "flag state in ticket";
      return null;
    default:
      return null;
  }
}

function isExplicitSetupLine(text) {
  const t = String(text || "").trim();
  if (!t || t.length < 8 || isUseCaseSectionHeader(t) || isMetadataLine(t) || isNarrativeContext(t)) {
    return false;
  }
  if (isFlowOrScenarioLine(t)) return false;
  if (/^[\d.)]+\s*$/.test(t)) return false;
  if (/^(user|system)\s+(has|is|must have)\s+(a|an|the)\s+/i.test(t) && !/\b(email|password|credential|@[\w.-]+)/i.test(t)) {
    return true;
  }
  return (
    /\b(email|password|credential|api key|token|test account|@[\w.-]+\.\w{2,}|https?:\/\/|staging url|production url|environment url|login as|username)\b/i.test(t)
    || (/[:=@]/.test(t) && /\b(account|environment|url|role|file|dataset|fixture|seed)\b/i.test(t))
  );
}

function parseExplicitPrerequisites(fullText) {
  const match = fullText.match(
    /(?:prerequisites?|pre-conditions?|preconditions?)[:\s]*\n([\s\S]*?)(?=\n(?:Post-conditions?|Basic Flow|Alternative Flows?|Exception Flows?|Main Flow|Acceptance Criteria|Steps to Reproduce|Environment:|Priority:|Component:|Description:)\s*:?\s*(?:\n|$)|\n\n(?:Post-conditions?|Basic Flow|Alternative Flow)|$)/i
  );
  if (!match) return [];

  return match[1]
    .split("\n")
    .map((line) => line.replace(/^[\s•\-*\d.]+\s*/, "").trim())
    .filter((line) => line.length > 3)
    .filter((line) => !isUseCaseSectionHeader(line))
    .filter((line) => !isMetadataLine(line))
    .filter((line) => isExplicitSetupLine(line))
    .map((text, i) => {
      const hasConcrete = /[:=@]|\b\d{3,}\b|https?:\/\//i.test(text)
        || /\b[\w.-]+@[\w.-]+\.\w{2,}\b/.test(text);
      const label = text.length > 50 ? text.slice(0, 47) + "…" : text;
      return {
        text,
        label,
        hasConcrete,
        satisfied: {
          id: `explicit-${i}`,
          label,
          status: "already_in_ticket",
          hint: text,
          evidence_in_ticket: text,
          analyst_note: `Listed in ticket pre-conditions: "${text.slice(0, 80)}"`,
        },
        required: {
          id: `explicit-${i}`,
          label,
          status: "required_from_user",
          hint: text,
          analyst_note: `Pre-condition needs a concrete value: "${text.slice(0, 80)}"`,
          required: true,
        },
      };
    });
}

function detectTicketPrerequisites(story) {
  return analyzeStoryPrerequisites(story);
}

function normalizeRelatedFiles(related_files) {
  if (!related_files?.length) return [];
  return related_files.map((f) => (typeof f === "string" ? { path: f, reason: "inferred from ticket component" } : f));
}

function validateAnalystOutput(story, analystOutput) {
  const failures = [];
  const failedRules = new Set();
  const g = typeof AGENT_GUIDELINES !== "undefined" ? AGENT_GUIDELINES?.analyst : null;
  const ruleRejectMeta = "Reject ticket metadata and wrong sections — never map Basic Flow / Pre-conditions as ACs";
  const ruleScratchpad = "Complete all scratchpad steps A–E before final JSON";
  const ruleTestable = "Map every acceptance criterion to a structured testable condition";
  const rulePrereq = "Categorize prerequisites as data/environment/dependency/knowledge with blocking/non-blocking";

  if (!analystOutput?.scratchpad?.step_a_ambiguity_scan) {
    failures.push("Missing scratchpad step A (ambiguity scan)");
    failedRules.add(ruleScratchpad);
  }
  if (!analystOutput?.scratchpad?.step_b_section_classification) {
    failures.push("Missing scratchpad step B (section classification)");
    failedRules.add(ruleScratchpad);
  }
  if (!analystOutput?.scratchpad?.step_c_testable_conditions) {
    failures.push("Missing scratchpad step C (testable conditions)");
    failedRules.add(ruleScratchpad);
  }
  if (!analystOutput?.scratchpad?.step_d_prerequisites) {
    failures.push("Missing scratchpad step D (prerequisites)");
    failedRules.add(ruleScratchpad);
  }
  if (!analystOutput?.scratchpad?.step_e_coverage_gaps) {
    failures.push("Missing scratchpad step E (coverage gaps)");
    failedRules.add(ruleScratchpad);
  }

  const rawAcs = story?.acceptance_criteria_list || [];
  const entries = (story?.acceptance_criteria_entries || rawAcs.map((text) => ({ text, section: "inferred_business_rules" })));
  const { valid, rejected } = sanitizeAcceptanceCriteria(entries);
  const allExpectedRejected = mergeRejectedLines(story?.acceptance_criteria_rejected || [], rejected);

  const reportedRejected = analystOutput?.analyst_reasoning?.rejected_as_non_ac
    || analystOutput?.prerequisites_needed?.story_analysis?.rejected_as_non_ac
    || [];

  if (allExpectedRejected.length) {
    const reportedTexts = new Set(
      reportedRejected.map((r) => (typeof r === "string" ? r.split(" — ")[0] : r.text))
    );
    const unreported = allExpectedRejected.filter((r) => !reportedTexts.has(r.text));
    if (unreported.length) {
      failures.push(`Analyst did not exclude non-AC lines: ${unreported.map((r) => `"${r.text}"`).join(", ")}`);
      failedRules.add(ruleRejectMeta);
    }
  }

  const conditions = analystOutput?.testable_conditions || [];
  if (!Array.isArray(conditions)) {
    failures.push("testable_conditions must be an array of structured objects");
    failedRules.add(ruleTestable);
  } else {
    for (const c of conditions) {
      if (!c?.id || !c?.ac_text || !c?.source || !c?.testable_statement) {
        failures.push(`Testable condition missing required fields: ${JSON.stringify(c?.id || c)}`);
        failedRules.add(ruleTestable);
      }
      if (isMetadataLine(c?.ac_text) || isFlowOrScenarioLine(c?.ac_text)) {
        failures.push(`${c?.id} maps metadata or flow step as AC: "${c?.ac_text}"`);
        failedRules.add(ruleRejectMeta);
      }
    }
    if (valid.length && conditions.length < valid.length) {
      failures.push(`${valid.length} valid AC(s) in story but analyst mapped only ${conditions.length}`);
      failedRules.add(ruleTestable);
    }
  }

  const prereq = analystOutput?.prerequisites_needed;
  if (!prereq?.blocking || !Array.isArray(prereq.blocking)) {
    failures.push("Missing prerequisites_needed.blocking array");
    failedRules.add(rulePrereq);
  }
  if (!prereq?.non_blocking || !Array.isArray(prereq.non_blocking)) {
    failures.push("Missing prerequisites_needed.non_blocking array");
    failedRules.add(rulePrereq);
  }

  for (const item of prereq?.items || []) {
    if (isUseCaseSectionHeader(item.label) || isMetadataLine(item.label)) {
      failures.push(`Analyst listed "${item.label}" as prerequisite — section header or metadata`);
      failedRules.add(rulePrereq);
    }
  }

  const gaps = analystOutput?.coverage_gaps;
  if (!Array.isArray(gaps) || !gaps.length) {
    failures.push("Missing structured coverage_gaps array");
    failedRules.add("Distinguish blocking vs non-blocking coverage gaps by category");
  } else {
    for (const gap of gaps) {
      if (!gap?.gap || !gap?.category || !gap?.severity) {
        failures.push("Coverage gap missing gap/category/severity");
        failedRules.add("Distinguish blocking vs non-blocking coverage gaps by category");
      }
    }
  }

  const files = normalizeRelatedFiles(analystOutput?.related_files);
  if (!files.length) {
    failures.push("Missing related_files");
    failedRules.add("Include related source and test file paths with reasons");
  }

  if (!analystOutput?.analyst_reasoning?.ticket_read) {
    failures.push("Missing analyst_reasoning.ticket_read");
    failedRules.add(ruleTestable);
  }

  const passed = failures.length === 0;
  return {
    passed,
    failures,
    failedRules: [...failedRules],
    ruleRejectMeta,
    ruleTestable,
    valid_ac_count: valid.length,
    rejected_ac_count: allExpectedRejected.length,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    analyzeStoryPrerequisites,
    buildAnalystOutput,
    detectTicketPrerequisites,
    sanitizeAcceptanceCriteria,
    isLikelyAcceptanceCriterion,
    isStrongAcceptanceCriterion,
    isFlowOrScenarioLine,
    isUseCaseSectionHeader,
    isMetadataLine,
    validateAnalystOutput,
    parseFullRequirements,
    mergeRejectedLines,
    buildScratchpad,
  };
}

if (typeof window !== "undefined") {
  window.analyzeStoryPrerequisites = analyzeStoryPrerequisites;
  window.buildAnalystOutput = buildAnalystOutput;
  window.detectTicketPrerequisites = detectTicketPrerequisites;
  window.sanitizeAcceptanceCriteria = sanitizeAcceptanceCriteria;
  window.isLikelyAcceptanceCriterion = isLikelyAcceptanceCriterion;
  window.isStrongAcceptanceCriterion = isStrongAcceptanceCriterion;
  window.isFlowOrScenarioLine = isFlowOrScenarioLine;
  window.isUseCaseSectionHeader = isUseCaseSectionHeader;
  window.isMetadataLine = isMetadataLine;
  window.validateAnalystOutput = validateAnalystOutput;
  window.parseFullRequirements = parseFullRequirements;
  window.mergeRejectedLines = mergeRejectedLines;
  window.buildScratchpad = buildScratchpad;
}
