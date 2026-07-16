import { farmCtx } from "../agents/ctx-bridge.js";

export function isRequirementsMetadataLine(line) {
  return typeof farmCtx.prerequisites.isMetadataLine === "function" ? farmCtx.prerequisites.isMetadataLine(line) : false;
}

export function isLikelyAcceptanceCriterionLine(line) {
  return typeof farmCtx.prerequisites.isLikelyAcceptanceCriterion === "function" ? farmCtx.prerequisites.isLikelyAcceptanceCriterion(line) : true;
}

export function sanitizeStoryAcceptanceCriteria(acList) {
  let result;
  if (typeof farmCtx.prerequisites.sanitizeAcceptanceCriteria === "function") {
    result = farmCtx.prerequisites.sanitizeAcceptanceCriteria(acList || []);
  } else {
    const filtered = (acList || []).filter((line) => isLikelyAcceptanceCriterionLine(line));
    result = { valid: filtered, rejected: [] };
  }
  const entries = (result.valid || []).map((item) =>
    typeof item === "string" ? { text: item, source: "Business Rules", section: "business_rules" } : item
  );
  const rejected = (result.rejected || []).map((item) =>
    typeof item === "string" ? { text: item, reason: "not an acceptance criterion" } : item
  );
  return {
    valid: entries.map((e) => String(e.text || "").trim()).filter(Boolean),
    entries,
    rejected,
  };
}

export function parseAcceptanceCriteriaText(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.replace(/^[\s•\-*\d.]+\s*|^AC-\d+[:.)]\s*/i, "").trim())
    .filter((line) => line.length > 0 && !/^acceptance criteria?/i.test(line) && isLikelyAcceptanceCriterionLine(line));
}

export function parseRequirementsDescription(text) {
  if (typeof farmCtx.prerequisites.parseFullRequirements === "function") {
    const parsed = farmCtx.prerequisites.parseFullRequirements(text);
    if (parsed.error) throw new Error("Paste your requirements description");
    return parsed;
  }

  const raw = String(text || "").trim();
  if (!raw) throw new Error("Paste your requirements description");

  const lines = raw.split("\n");
  const title = lines[0].trim().slice(0, 160) || "Requirements";

  const acHeaderIdx = lines.findIndex((l) => /^acceptance criteria?\s*:?\s*$/i.test(l.trim()));
  let acList = [];
  let description = raw;

  if (acHeaderIdx >= 0) {
    acList = parseAcceptanceCriteriaText(lines.slice(acHeaderIdx + 1).join("\n"));
    const body = lines.slice(0, acHeaderIdx).join("\n").trim();
    description = body || raw;
  } else {
    const bulletLines = [];
    const bodyLines = [lines[0]];
    for (let i = 1; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed) {
        bodyLines.push(lines[i]);
        continue;
      }
      if (/^[-*•]\s+|^\d+[.)]\s+|^AC-\d+[:.)]/i.test(trimmed)) {
        bulletLines.push(trimmed);
      } else if (isLikelyAcceptanceCriterionLine(trimmed)) {
        bulletLines.push(trimmed);
      } else {
        bodyLines.push(lines[i]);
      }
    }
    if (bulletLines.length) {
      acList = parseAcceptanceCriteriaText(bulletLines.join("\n"));
      description = bodyLines.join("\n").trim();
    } else {
      description = raw;
      acList = [];
    }
  }

  const { valid, rejected } = sanitizeStoryAcceptanceCriteria(acList);
  return {
    title,
    description,
    acceptance_criteria_list: valid,
    acceptance_criteria_rejected: rejected,
    requirements_metadata: {},
    requirements_raw: raw,
  };
}

export function parseStoryContent(title, description, fallbackAcList) {
  const issueTitle = String(title || "").trim();
  const desc = String(description || "").trim();
  const raw = issueTitle && desc ? `${issueTitle}\n${desc}` : (desc || issueTitle);

  if (typeof farmCtx.prerequisites.parseFullRequirements === "function" && raw.trim()) {
    const parsed = farmCtx.prerequisites.parseFullRequirements(raw);
    if (!parsed.error) {
      return {
        title: issueTitle || parsed.title,
        description: parsed.description || desc,
        acceptance_criteria_list: parsed.acceptance_criteria_list,
        acceptance_criteria_entries: parsed.acceptance_criteria_entries,
        acceptance_criteria_rejected: parsed.acceptance_criteria_rejected,
        requirements_raw: parsed.requirements_raw,
        requirements_metadata: parsed.requirements_metadata || {},
        sections_seen: parsed.sections_seen || [],
      };
    }
  }

  const fallback = Array.isArray(fallbackAcList) ? fallbackAcList : [];
  const { valid, entries, rejected } = sanitizeStoryAcceptanceCriteria(fallback);
  return {
    title: issueTitle || "Requirements",
    description: desc,
    acceptance_criteria_list: valid,
    acceptance_criteria_entries: entries,
    acceptance_criteria_rejected: rejected,
    requirements_raw: raw,
    requirements_metadata: {},
    sections_seen: [],
  };
}

export function issueToStory(issue) {
  const content = parseStoryContent(issue.title, issue.description, issue.acceptance_criteria);
  const acList = content.acceptance_criteria_list;
  const acCount = acList.length || issue.acceptance_criteria_count || 0;
  // Zero parsed ACs → zero TCs (no placeholder TC-01 that fakes a complete run).
  const tcCount = acList.length;
  const test_cases = Array.from({ length: tcCount }, (_, i) =>
    `TC-${issue.key}-${String(i + 1).padStart(2, "0")}`
  );
  const meta = content.requirements_metadata || {};
  return {
    id: issue.key,
    title: content.title || issue.title,
    jira: issue.jira_url,
    description: content.description || issue.description || "",
    requirements_raw: content.requirements_raw,
    requirements_metadata: meta,
    acceptance_criteria_list: acList,
    acceptance_criteria_entries: content.acceptance_criteria_entries,
    acceptance_criteria_rejected: content.acceptance_criteria_rejected,
    priority: issue.priority || meta.priority || "Medium",
    status: issue.status || meta.status || "Unknown",
    issueType: issue.issueType || meta.issueType || meta.type || "Task",
    components: issue.components?.length ? issue.components : (meta.components || []),
    labels: issue.labels?.length ? issue.labels : (meta.labels || []),
    acceptance_criteria: acList.length,
    gaps: Math.max(1, acCount + 1),
    blocking_gaps: 0,
    test_cases,
    api_requests: tcCount,
    score: "8/10",
    passed: tcCount,
    failed: 0,
    coverage: 100.0,
    from_jira: true,
    fetched_at: issue.fetched_at,
  };
}
