/**
 * Story-first prerequisite analysis.
 * Reads the user story, maps ACs → test actions → minimal setup needs.
 * Only surfaces gaps the human must fill; cites ticket text in reasoning.
 */

function isUseCaseSectionHeader(line) {
  const t = String(line || "").trim();
  return /^(post-conditions?|pre-conditions?|preconditions?|prerequisites?|basic flow|alternative flows?|exception flows?|main flow|main success scenario|extensions?|actors?|trigger|primary actor|secondary actors?|success scenario|failure scenario|business rules?|special requirements?|assumptions?|notes?|flow of events|sub-flows?)\s*:?\s*$/i.test(t);
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
  if (/^invalid .+ shows (error|message|warning)/i.test(t) && !/\b(must|should|shall)\b/i.test(t)) return true;
  if (/^user is logged in$/i.test(t)) return true;
  return false;
}

function isStrongAcceptanceCriterion(line) {
  const t = String(line || "").trim();
  if (!t || isMetadataLine(t) || isNarrativeContext(t) || isFlowOrScenarioLine(t)) return false;
  if (/\b(must|should|shall|must not|shall not|required to|needs to|rejects?|will not|cannot|can't|never)\b/i.test(t)) {
    return true;
  }
  if (/\b(valid|invalid|error|display|show|return|accept|allow|deny|email|password|credential|session|token)\b/i.test(t)) {
    return !/^(user|system)\s+(opens|enters|clicks|has|is|logs)/i.test(t);
  }
  return false;
}

function isLikelyAcceptanceCriterion(line) {
  return isStrongAcceptanceCriterion(line);
}

function isBehaviouralLine(line) {
  return isLikelyAcceptanceCriterion(line);
}

function sanitizeAcceptanceCriteria(acList, opts = {}) {
  const allowFlow = !!opts.allowFlow;
  const valid = [];
  const rejected = [];
  for (const ac of acList || []) {
    const text = String(ac || "").trim();
    if (!text) continue;
    if (!allowFlow && isFlowOrScenarioLine(text)) {
      rejected.push({ text, reason: "flow or scenario step — not an acceptance criterion" });
      continue;
    }
    if (isLikelyAcceptanceCriterion(text)) {
      valid.push(text);
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
  if (isMetadataLine(acText) || !isLikelyAcceptanceCriterion(acText)) return true;
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

/**
 * Parse an entire pasted requirements block: title, metadata fields, description, and testable ACs.
 * Every line is classified — metadata never becomes an acceptance criterion.
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

  function rejectLine(line, reason) {
    const t = String(line || "").trim();
    if (!t) return;
    if (!rejected.some((r) => r.text === t)) {
      rejected.push({ text: t, reason });
    }
  }

  function pushAcCandidate(line) {
    const stripped = stripListPrefix(line);
    if (!stripped) return;
    if (isMetadataLine(stripped) && !isLikelyAcceptanceCriterion(stripped)) {
      rejectLine(stripped, "ticket metadata — not testable behaviour");
      return;
    }
    acCandidates.push(stripped);
  }

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      if (section === "body" || section === "description") descriptionLines.push("");
      continue;
    }

    if (/^acceptance criteria?\s*:?\s*$/i.test(trimmed)) {
      section = "ac";
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
    if (isUseCaseSectionHeader(trimmed)) {
      section = "uc_section";
      rejectLine(trimmed, "use-case section header — not a prerequisite or acceptance criterion");
      continue;
    }

    if (section === "uc_section") {
      if (isStrongAcceptanceCriterion(trimmed)) {
        section = "body";
        pushAcCandidate(trimmed);
        continue;
      }
      descriptionLines.push(lines[i]);
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

    if (isMetadataLine(trimmed) && !isLikelyAcceptanceCriterion(trimmed)) {
      rejectLine(trimmed, "ticket metadata — not testable behaviour");
      continue;
    }

    if (section === "ac") {
      pushAcCandidate(lines[i]);
      continue;
    }

    if (isBulletLine(lines[i])) {
      if (isStrongAcceptanceCriterion(stripListPrefix(lines[i]))) {
        pushAcCandidate(lines[i]);
      } else {
        descriptionLines.push(lines[i]);
      }
      continue;
    }

    if (isStrongAcceptanceCriterion(trimmed)) {
      pushAcCandidate(trimmed);
      continue;
    }

    descriptionLines.push(lines[i]);
  }

  if (!title) {
    const firstDesc = descriptionLines.find((l) => l.trim());
    title = (firstDesc || "Requirements").trim().slice(0, 160);
  }

  const { valid: acceptance_criteria_list, rejected: sanitizeRejected } = sanitizeAcceptanceCriteria(acCandidates);
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
    acceptance_criteria_rejected,
    requirements_metadata: metadata,
    requirements_raw: raw,
  };
}

function analyzeStoryPrerequisites(story) {
  const title = (story?.title || "").trim();
  const description = (story?.description || "").trim();
  let rawAcList = (story?.acceptance_criteria_list || []).filter(Boolean);
  const preRejected = story?.acceptance_criteria_rejected || [];

  if (!rawAcList.length && description) {
    for (const line of description.split("\n")) {
      const t = line.trim();
      if (!t || isMetadataLine(t)) continue;
      if (isBehaviouralLine(t)) rawAcList.push(t);
    }
  }

  const { valid: acList, rejected: rejectedAcs } = sanitizeAcceptanceCriteria(rawAcList);
  const allRejected = mergeRejectedLines(preRejected, rejectedAcs);
  const components = story?.components || [];
  const labels = story?.labels || [];

  const fullText = story?.requirements_raw
    ? String(story.requirements_raw)
    : [title, description, ...acList, ...components, ...labels].join("\n");
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
  const items = [];
  const alreadySatisfied = [];

  reasoningSteps.push({
    step: "understand",
    text: title
      ? `This story is about: "${title}".`
      : "Reading the user story to determine what must be tested.",
  });

  if (description) {
    reasoningSteps.push({
      step: "context",
      text: `From the description: "${description.split("\n")[0].slice(0, 140)}${description.length > 140 ? "…" : ""}"`,
      cite: description.split("\n")[0],
    });
  }

  if (allRejected.length) {
    reasoningSteps.push({
      step: "reject_non_ac",
      text: `Excluded ${allRejected.length} line(s) — ticket metadata, not acceptance criteria: ${allRejected.map((r) => `"${r.text}"`).join(", ")}`,
      cite: allRejected.map((r) => r.text).join("; "),
    });
  }

  if (!acList.length && description) {
    reasoningSteps.push({
      step: "no_structured_ac",
      text: "No testable acceptance criteria listed — analysing the description body instead.",
    });
  }

  const testActions = acList.map((ac, i) => {
    const id = `AC-${i + 1}`;
    const action = inferTestAction(ac);
    if (isShallowTestAction(ac, action.summary)) {
      reasoningSteps.push({
        step: "reject_shallow",
        text: `"${ac}" is not a testable acceptance criterion — skipped (would only produce "${action.summary}")`,
        cite: ac,
        ac_id: id,
      });
      return null;
    }
    reasoningSteps.push({
      step: "map_ac",
      text: `${id} "${ac}" → to verify this I need to: ${action.summary}`,
      cite: ac,
      ac_id: id,
    });
    return { ac_id: id, ac_text: ac, ...action };
  }).filter(Boolean);

  if (!testActions.length && description) {
    testActions.push({
      ac_id: "story",
      ac_text: description.slice(0, 120),
      summary: "reproduce the behaviour described",
      needs: inferNeedsFromText(description),
    });
  }

  if (steps.length) {
    reasoningSteps.push({
      step: "steps",
      text: `Reproduction starts with: "${steps[0]}"${steps.length > 1 ? ` (+ ${steps.length - 1} more step(s))` : ""}.`,
      cite: steps[0],
    });
  }

  const mergedNeeds = mergeSetupNeeds(testActions, steps, blob, environmentLine);

  for (const need of mergedNeeds) {
    const evidence = findEvidenceInStory(need, fullText, environmentLine, steps);
    if (evidence) {
      alreadySatisfied.push({
        id: need.id,
        label: need.label,
        status: "already_in_ticket",
        hint: need.hint,
        reason: need.satisfied_reason,
        analyst_note: `Already in ticket — ${need.satisfied_reason}`,
        evidence_in_ticket: evidence,
        required_for: need.required_for,
      });
      reasoningSteps.push({
        step: "satisfied",
        text: `${need.label}: found in ticket (${evidence}). No input needed — covers ${need.required_for.join(", ")}.`,
        cite: evidence,
      });
    } else {
      items.push({
        id: need.id,
        label: need.label,
        status: "required_from_user",
        hint: need.hint,
        reason: need.gap_reason,
        analyst_note: need.gap_reason,
        required_for: need.required_for,
        required: true,
      });
      reasoningSteps.push({
        step: "gap",
        text: `${need.label}: ${need.gap_reason} (required for ${need.required_for.join(", ")}).`,
        cite: need.required_for.map((id) => acList[parseInt(id.replace("AC-", ""), 10) - 1] || id).join("; "),
      });
    }
  }

  const explicitLines = parseExplicitPrerequisites(fullText);
  for (const line of explicitLines) {
    if (items.some((i) => i.label === line.label) || alreadySatisfied.some((s) => s.label === line.label)) continue;
    if (line.hasConcrete) {
      alreadySatisfied.push(line.satisfied);
      reasoningSteps.push({ step: "satisfied", text: `Explicit prerequisite in ticket: "${line.text}" — values included.`, cite: line.text });
    } else {
      items.push(line.required);
      reasoningSteps.push({ step: "gap", text: `Ticket lists prerequisite "${line.text}" but without values — you need to provide it.`, cite: line.text });
    }
  }

  const reasoning = reasoningSteps.map((s) => s.text).join(" ");

  return {
    needed: items.length > 0,
    items,
    already_satisfied: alreadySatisfied,
    not_applicable: [],
    reasoning,
    reasoning_steps: reasoningSteps,
    story_analysis: {
      title,
      goal: description.split("\n")[0] || title,
      acceptance_criteria: acList,
      rejected_as_non_ac: allRejected,
      test_actions: testActions.map((t) => ({ ac: t.ac_id, action: t.summary, ac_text: t.ac_text })),
      reproduction_steps: steps,
      environment: environmentLine || null,
    },
    summary: items.length
      ? `From this story: ${items.length} thing(s) only you can supply`
      : "From this story: ticket has enough detail — nothing extra needed from you",
  };
}

function inferTestAction(acText) {
  const t = acText.toLowerCase();
  const needs = [];

  if (/\b(log\s*in|sign\s*in|email|password|credentials?|session token|authentication|wrong password)\b/.test(t)) {
    needs.push("login_user");
  }
  // Only ask for target URL when the AC explicitly names a URL, API path, or endpoint — not bare "status code" or generic "api"
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
    return false;
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

function validateAnalystOutput(story, analystOutput) {
  const failures = [];
  const failedRules = new Set();
  const g = typeof AGENT_GUIDELINES !== "undefined" ? AGENT_GUIDELINES?.analyst : null;
  const ruleRejectMeta = "Reject ticket metadata (UC ids, Priority, Status) — never map as acceptance criteria";
  const ruleTestable = "Map every acceptance criterion to a testable condition";

  const rawAcs = story?.acceptance_criteria_list || [];
  const { valid, rejected } = sanitizeAcceptanceCriteria(rawAcs);
  const allExpectedRejected = mergeRejectedLines(story?.acceptance_criteria_rejected || [], rejected);
  const prereq = analystOutput?.prerequisites_needed;
  const reportedRejected = prereq?.story_analysis?.rejected_as_non_ac || [];

  if (allExpectedRejected.length) {
    const reportedTexts = new Set(reportedRejected.map((r) => r.text));
    const unreported = allExpectedRejected.filter((r) => !reportedTexts.has(r.text));
    if (unreported.length) {
      failures.push(`Analyst did not exclude non-AC metadata: ${unreported.map((r) => `"${r.text}"`).join(", ")}`);
      failedRules.add(ruleRejectMeta);
    }
  }

  for (const ta of prereq?.story_analysis?.test_actions || []) {
    if (isShallowTestAction(ta.ac_text, ta.action) || isMetadataLine(ta.ac_text) || isFlowOrScenarioLine(ta.ac_text)) {
      failures.push(`${ta.ac} "${ta.ac_text}" → "${ta.action}" is not a valid test action (metadata, flow step, or non-behavioural line)`);
      failedRules.add(ruleTestable);
      failedRules.add(ruleRejectMeta);
    }
  }

  for (const item of prereq?.items || []) {
    if (isUseCaseSectionHeader(item.label) || isMetadataLine(item.label)) {
      failures.push(`Analyst listed "${item.label}" as a human prerequisite — section header or metadata, not a setup gap`);
      failedRules.add("Map each acceptance criterion to a test action; cite ticket text; list only gaps the human must fill");
    }
  }

  if (valid.length && !(prereq?.story_analysis?.test_actions || []).length) {
    failures.push(`${valid.length} testable AC(s) in story but analyst produced no test actions`);
    failedRules.add(ruleTestable);
  }

  if (!analystOutput?.related_files?.length) {
    failures.push("Missing related_files");
    failedRules.add("Include related source and test file paths");
  }

  if (!prereq?.story_analysis) {
    failures.push("Missing prerequisites_needed.story_analysis");
    failedRules.add("Map each acceptance criterion to a test action; cite ticket text; list only gaps the human must fill");
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
  };
}
if (typeof window !== "undefined") {
  window.analyzeStoryPrerequisites = analyzeStoryPrerequisites;
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
}
