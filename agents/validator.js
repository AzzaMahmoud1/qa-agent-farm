/** @see skills/validator/SKILL.md */
export const AGENT_ID = "validator";
export const SKILL_PATH = "skills/validator/SKILL.md";
export const SKILL_FOLDER = "skills/validator";

import { farmCtx } from "./ctx-bridge.js";
import { AGENT_GUIDELINES, AGENT_META, VALIDATOR_MAX_ATTEMPTS } from "./registry.js";
import { buildRequirementsFromStory } from "../lib/requirements.js";
import { inferRequirementSignals, inferApiFields } from "../lib/test-data.js";
import { isLatitudeKey, isLongitudeKey, parseCoordNumber, isValidLatitude, isValidLongitude, isBoundaryLatitude, isBoundaryLongitude } from "../lib/geo.js";

export const DATA_EXTRACTOR_API_CHECKS = [
  "For API stories: derive datasets from human-provided curl (URL, method, headers, body)",
  "Never use unrelated mock data (e.g. login emails) from other stories",
  "Map each dataset row to a writer test case ID and acceptance criterion",
  "Extract test_oracle per row from writer then/expected_evidence and AC text",
  "Datasets must satisfy current analyst testable conditions",
  "Fail if requirements changed since extraction — data must be re-synced",
  "Valid lat/lon within geographic range; invalid/boundary rows use correct edge values",
  "Extract test data for every writer test case",
];


export function buildValidationResult(targetAgent, passed, failureMessages, recommendation) {
  const g = AGENT_GUIDELINES[targetAgent];
  const failSet = new Set(failureMessages || []);
  const checks = g.rules.map((rule) => ({
    rule,
    status: passed || !failSet.has(rule) ? "pass" : "fail",
  }));
  const failedRules = checks.filter((c) => c.status === "fail").map((c) => c.rule);
  return {
    target_agent: targetAgent,
    agent_level: g.level,
    guidelines: g.rules,
    required_deliverables: g.required_deliverables,
    passed,
    score: passed ? "100%" : `${Math.round(((g.rules.length - failedRules.length) / g.rules.length) * 100)}%`,
    checks,
    failures: failureMessages || failedRules,
    recommendation: recommendation || (passed ? null : `Re-run ${AGENT_META[targetAgent].label} with corrections from failed checks`),
  };
}

export function validateAnalystOutputLive(story, analystOutput) {
  if (typeof farmCtx.prerequisites.validateAnalystOutput !== "function") {
    return buildValidationResult("analyst", true);
  }
  const live = farmCtx.prerequisites.validateAnalystOutput(story, analystOutput);
  const base = buildValidationResult("analyst", live.passed, live.failures, live.passed
    ? null
    : "Exclude ticket metadata from AC mapping; map only testable behaviour to test actions");
  return {
    ...base,
    detail_failures: live.failures,
    ac_quality: {
      valid_ac_count: live.valid_ac_count,
      rejected_ac_count: live.rejected_ac_count,
      failed_rules: live.failedRules,
    },
  };
}

export function validateRequirementAlignment(story, requirements, row, writerTc, api, failures, failedRules) {
  const acIdx = (row.ac_index || 1) - 1;
  const acText = requirements.acceptance_criteria[acIdx] || requirements.testable_conditions[acIdx]?.text || "";
  const testableText = requirements.testable_conditions[acIdx]?.text || acText;
  const combined = [testableText, writerTc?.title, writerTc?.when, writerTc?.then, writerTc?.given].join(" ");
  const signals = inferRequirementSignals(combined);

  if (signals.needsGeo) {
    const hasLat = Object.keys(row.valid_input || {}).some(isLatitudeKey);
    const hasLon = Object.keys(row.valid_input || {}).some(isLongitudeKey);
    if (!hasLat || !hasLon) {
      failures.push(`${row.test_case_id}: requirement ${row.requirement_id || `AC-${acIdx + 1}`} needs coordinates — dataset missing lat/lon`);
      failedRules.add("Datasets must satisfy current requirement testable conditions");
    }
  }

  if (signals.needsWebpage && farmCtx.storyRequiresWebpage(story)) {
    if (!row.webpage_template && !row.valid_input?.page_url) {
      failures.push(`${row.test_case_id}: requirement ${row.requirement_id || `AC-${acIdx + 1}`} needs webpage URL in dataset`);
      failedRules.add("Datasets must satisfy current requirement testable conditions");
    }
  }

  if (signals.needsApi && farmCtx.storyRequiresApi(story)) {
    if (!row.curl_template && !api?.ok && !outputHasApiFields(row)) {
      failures.push(`${row.test_case_id}: requirement ${row.requirement_id || `AC-${acIdx + 1}`} needs API data linkage`);
      failedRules.add("Datasets must satisfy current requirement testable conditions");
    }
  }

  if (writerTc?.when && row.requirement_id) {
    const acNum = String(row.requirement_id).replace("AC-", "");
    if (!writerTc.when.includes(`AC #${acNum}`) && !writerTc.when.includes(`AC-${acNum}`)) {
      failures.push(`${row.test_case_id}: writer when-clause does not reference ${row.requirement_id}`);
      failedRules.add("Map each dataset row to a test case ID and linked acceptance criterion");
    }
  }

  const expectedRole = writerTc?.type === "happy_path" ? "valid_input"
    : writerTc?.type === "edge_case" ? "boundary_input"
    : writerTc?.type === "negative" ? "invalid_input" : row.scenario_role;
  if (writerTc?.type && row.scenario_role && row.scenario_role !== expectedRole) {
    failures.push(`${row.test_case_id}: scenario_role "${row.scenario_role}" does not match writer type "${writerTc.type}" for requirement ${row.requirement_id}`);
    failedRules.add("Datasets must satisfy current requirement testable conditions");
  }

  const reqSnippet = (row.requirement_text || row.mapped_ac || "").slice(0, 30);
  const liveSnippet = testableText.slice(0, 30);
  if (reqSnippet && liveSnippet && reqSnippet !== liveSnippet
    && !testableText.includes(reqSnippet) && !reqSnippet.includes(liveSnippet.slice(0, 20))) {
    failures.push(`${row.test_case_id}: requirement_text out of sync with current ${row.requirement_id} — "${reqSnippet}…" ≠ "${liveSnippet}…"`);
    failedRules.add("Re-validate datasets when requirements change");
  }

  if (row.testable_condition && writerTc?.when && row.testable_condition !== writerTc.when
    && !writerTc.when.includes(row.testable_condition.slice(0, 30))) {
    failures.push(`${row.test_case_id}: testable_condition does not match writer when-clause`);
    failedRules.add("Map each dataset row to a test case ID and linked acceptance criterion");
  }
}

export function outputHasApiFields(row) {
  return !!(row.curl_template || row.valid_input?.url || row.valid_input?.method);
}

export function validateRequirementsFreshness(requirements, output, failures, failedRules) {
  if (!output?.requirements_snapshot || !requirements?.version) return;
  if (output.requirements_snapshot !== requirements.version) {
    failures.push("Requirements changed since data extraction — datasets are stale; re-extract against current AC and writer test cases");
    failedRules.add("Re-validate datasets when requirements change");
  }
}

export function validateWriterCoverage(requirements, output, failures, failedRules) {
  const writerIds = new Set((requirements.writer_test_cases || []).map((tc) => tc.id));
  const dataIds = new Set((output?.datasets || []).map((d) => d.test_case_id));
  for (const id of writerIds) {
    if (!dataIds.has(id)) {
      failures.push(`${id}: writer test case has no extracted dataset — requirement coverage gap`);
      failedRules.add("Extract test data for every writer test case");
    }
  }
  for (const id of dataIds) {
    if (!writerIds.has(id)) {
      failures.push(`${id}: dataset exists but no matching writer test case — orphan data row`);
      failedRules.add("Map each dataset row to a test case ID and linked acceptance criterion");
    }
  }
}

export function validateGeoFieldsInBlob(tcId, label, blob, mode, failures, failedRules) {
  if (!blob || typeof blob !== "object") return;
  for (const [key, val] of Object.entries(blob)) {
    if (isLatitudeKey(key)) {
      const n = parseCoordNumber(val);
      if (n === null) {
        failures.push(`${tcId} ${label}: latitude "${key}" is not a number (${val})`);
        failedRules.add("Valid coordinates: latitude ∈ [-90, 90], longitude ∈ [-180, 180]");
        continue;
      }
      if (mode === "valid" && !isValidLatitude(n)) {
        failures.push(`${tcId} ${label}: latitude ${n} out of valid range [-90, 90]`);
        failedRules.add("Valid coordinates: latitude ∈ [-90, 90], longitude ∈ [-180, 180]");
      }
      if (mode === "invalid" && isValidLatitude(n)) {
        failures.push(`${tcId} ${label}: invalid row should have out-of-range latitude, got ${n}`);
        failedRules.add("Invalid/boundary rows must use geographically correct out-of-range or edge values");
      }
      if (mode === "boundary" && !isBoundaryLatitude(n)) {
        failures.push(`${tcId} ${label}: boundary latitude should be ±90, got ${n}`);
        failedRules.add("Invalid/boundary rows must use geographically correct out-of-range or edge values");
      }
    }
    if (isLongitudeKey(key)) {
      const n = parseCoordNumber(val);
      if (n === null) {
        failures.push(`${tcId} ${label}: longitude "${key}" is not a number (${val})`);
        failedRules.add("Valid coordinates: latitude ∈ [-90, 90], longitude ∈ [-180, 180]");
        continue;
      }
      if (mode === "valid" && !isValidLongitude(n)) {
        failures.push(`${tcId} ${label}: longitude ${n} out of valid range [-180, 180]`);
        failedRules.add("Valid coordinates: latitude ∈ [-90, 90], longitude ∈ [-180, 180]");
      }
      if (mode === "invalid" && isValidLongitude(n)) {
        failures.push(`${tcId} ${label}: invalid row should have out-of-range longitude, got ${n}`);
        failedRules.add("Invalid/boundary rows must use geographically correct out-of-range or edge values");
      }
      if (mode === "boundary" && !isBoundaryLongitude(n)) {
        failures.push(`${tcId} ${label}: boundary longitude should be ±180, got ${n}`);
        failedRules.add("Invalid/boundary rows must use geographically correct out-of-range or edge values");
      }
    }
  }
}

export function validateTestDataExtractorOutput(story, output, writerOutput, analystOutput) {
  const failures = [];
  const failedRules = new Set();
  const tcCount = story?.test_cases?.length || 0;
  const storyTcIds = story?.test_cases || [];
  const acList = story?.acceptance_criteria_list || [];
  const writerCases = writerOutput?.test_cases || farmCtx.storyOutputs?.writer?.test_cases || [];
  const requirements = buildRequirementsFromStory(story, writerCases, analystOutput || farmCtx.storyOutputs?.analyst);
  const api = farmCtx.humanApiInput.ok ? farmCtx.humanApiInput : output?.human_api;

  validateRequirementsFreshness(requirements, output, failures, failedRules);
  validateWriterCoverage(requirements, output, failures, failedRules);

  if (!output?.datasets?.length) {
    if (output?.blocked) {
      failures.push(output.blocked_reason || "Awaiting human input — datasets not extracted");
      failedRules.add("For API stories: derive datasets from human-provided curl (URL, method, headers, body)");
    } else {
      failures.push("No datasets extracted");
    }
    failedRules.add("Extract test data for every writer test case");
  } else if (output.datasets.length < tcCount) {
    failures.push(`Expected ${tcCount} dataset rows, got ${output.datasets.length}`);
    failedRules.add("Extract test data for every writer test case");
  }

  if (!output?.environment_variables?.length) {
    failures.push("Missing environment_variables");
  }

  const seenIds = new Set();
  for (const row of output?.datasets || []) {
    const tcIdx = storyTcIds.indexOf(row.test_case_id);
    if (tcIdx < 0) {
      failures.push(`${row.test_case_id}: dataset not linked to any writer test case ID`);
      failedRules.add("Map each dataset row to a test case ID and linked acceptance criterion");
    } else if (seenIds.has(row.test_case_id)) {
      failures.push(`${row.test_case_id}: duplicate dataset row for same test case`);
      failedRules.add("Map each dataset row to a test case ID and linked acceptance criterion");
    } else {
      seenIds.add(row.test_case_id);
    }

    const writerTc = writerCases.find((tc) => tc.id === row.test_case_id) || writerCases[tcIdx];
    if (!writerTc) {
      failures.push(`${row.test_case_id}: no matching writer test case object`);
      failedRules.add("Map each dataset row to a test case ID and linked acceptance criterion");
    } else {
      if (row.test_case_title && writerTc.title && row.test_case_title !== writerTc.title
        && !writerTc.title.startsWith(row.test_case_title.slice(0, 40))) {
        failures.push(`${row.test_case_id}: test_case_title does not match writer case "${writerTc.title}"`);
        failedRules.add("Map each dataset row to a test case ID and linked acceptance criterion");
      }
      if (row.test_case_type && writerTc.type && row.test_case_type !== writerTc.type) {
        failures.push(`${row.test_case_id}: test_case_type "${row.test_case_type}" ≠ writer type "${writerTc.type}"`);
        failedRules.add("Map each dataset row to a test case ID and linked acceptance criterion");
      }
    }

    const expectedAc = (acList[tcIdx] || acList[0] || story.title || "").slice(0, 80);
    if (expectedAc && row.mapped_ac && expectedAc.slice(0, 40) !== row.mapped_ac.slice(0, 40)
      && !expectedAc.includes(row.mapped_ac.slice(0, 30)) && !row.mapped_ac.includes(expectedAc.slice(0, 30))) {
      failures.push(`${row.test_case_id}: mapped_ac does not match acceptance criterion AC-${tcIdx + 1}`);
      failedRules.add("Map each dataset row to a test case ID and linked acceptance criterion");
    }

    if (row.ac_index !== undefined && row.ac_index !== tcIdx + 1) {
      failures.push(`${row.test_case_id}: ac_index ${row.ac_index} should be ${tcIdx + 1}`);
      failedRules.add("Map each dataset row to a test case ID and linked acceptance criterion");
    }

    const fixturePath = `fixtures/${(story.id || "").toLowerCase()}/${row.test_case_id}.json`;
    if (output.fixtures && !output.fixtures.some((f) => f.includes(row.test_case_id))) {
      failures.push(`${row.test_case_id}: missing fixture path fixtures/.../${row.test_case_id}.json`);
    }

    validateGeoFieldsInBlob(row.test_case_id, "valid", row.valid_input, "valid", failures, failedRules);
    validateGeoFieldsInBlob(row.test_case_id, "invalid", row.invalid_input, "invalid", failures, failedRules);
    validateGeoFieldsInBlob(row.test_case_id, "boundary", row.boundary_input, "boundary", failures, failedRules);
    validateRequirementAlignment(story, requirements, row, writerTc, api, failures, failedRules);

    if (!row.test_oracle?.pass_criteria) {
      failures.push(`${row.test_case_id}: missing test_oracle.pass_criteria — derive from writer expected_evidence and AC`);
      failedRules.add("Extract test_oracle per row from writer then/expected_evidence and AC text");
    } else if (writerTc?.expected_evidence && row.test_oracle.expected_evidence
      && row.test_oracle.expected_evidence !== writerTc.expected_evidence
      && !row.test_oracle.pass_criteria.includes(writerTc.expected_evidence.slice(0, 20))) {
      failures.push(`${row.test_case_id}: test_oracle not aligned with writer expected_evidence`);
      failedRules.add("Extract test_oracle per row from writer then/expected_evidence and AC text");
    }
  }

  if (farmCtx.storyRequiresApi(story)) {
    if (!api?.ok) {
      failures.push("API requirement: human curl must be provided before data extraction");
      failedRules.add("For API stories: derive datasets from human-provided curl (URL, method, headers, body)");
    } else {
      if (!output?.source?.includes("human-provided API")) {
        failures.push("Output source must be human-provided API (curl)");
        failedRules.add("For API stories: derive datasets from human-provided curl (URL, method, headers, body)");
      }

      const expectedEndpoint = `${api.method} ${api.url}`;
      if (output?.api_endpoint !== expectedEndpoint) {
        failures.push(`api_endpoint mismatch — expected "${expectedEndpoint}", got "${output?.api_endpoint || "none"}"`);
        failedRules.add("For API stories: derive datasets from human-provided curl (URL, method, headers, body)");
      }

      const apiFields = inferApiFields(api);
      const apiKeys = new Set(Object.keys(apiFields));

      for (const row of output?.datasets || []) {
        for (const [label, blob] of [["valid", row.valid_input], ["invalid", row.invalid_input], ["boundary", row.boundary_input]]) {
          if (!blob || typeof blob !== "object") continue;
          if (blob.email === "user@example.com" && !apiKeys.has("email")) {
            failures.push(`${row.test_case_id} ${label}: unrelated login-demo email user@example.com — not in curl`);
            failedRules.add("Never use unrelated mock data (e.g. login emails) from other stories");
          }
          if (blob.email === "NOT_AN_EMAIL") {
            failures.push(`${row.test_case_id} ${label}: unrelated mock NOT_AN_EMAIL — not derived from API`);
            failedRules.add("Never use unrelated mock data (e.g. login emails) from other stories");
          }
          if (blob.sample !== undefined && !apiKeys.has("sample")) {
            failures.push(`${row.test_case_id} ${label}: generic 'sample' field not present in curl`);
            failedRules.add("Never use unrelated mock data (e.g. login emails) from other stories");
          }
          if (blob.locale !== undefined && !apiKeys.has("locale")) {
            failures.push(`${row.test_case_id} ${label}: unrelated 'locale' field not in curl`);
            failedRules.add("Never use unrelated mock data (e.g. login emails) from other stories");
          }
        }
      }

      const hasBaseUrl = (output.environment_variables || []).some((v) => String(v).includes(api.base_url));
      if (!hasBaseUrl) {
        failures.push(`environment_variables must include BASE_URL from curl (${api.base_url})`);
        failedRules.add("For API stories: derive datasets from human-provided curl (URL, method, headers, body)");
      }
    }
  }

  const web = farmCtx.humanWebpageInput.ok ? farmCtx.humanWebpageInput : output?.human_webpage;
  if (farmCtx.storyRequiresWebpage(story)) {
    if (!web?.ok) {
      failures.push("Web/UI requirement: human webpage URL must be provided before data extraction");
      failedRules.add("For UI stories: derive datasets from human-provided webpage URL");
    } else {
      if (!output?.source?.includes("human-provided webpage")) {
        failures.push("Output source must include human-provided webpage");
        failedRules.add("For UI stories: derive datasets from human-provided webpage URL");
      }
      if (output?.webpage_url !== web.url) {
        failures.push(`webpage_url mismatch — expected "${web.url}", got "${output?.webpage_url || "none"}"`);
        failedRules.add("For UI stories: derive datasets from human-provided webpage URL");
      }
      const hasPageUrl = (output.environment_variables || []).some((v) => String(v).includes(web.url));
      if (!hasPageUrl) {
        failures.push(`environment_variables must include PAGE_URL from webpage (${web.url})`);
        failedRules.add("For UI stories: derive datasets from human-provided webpage URL");
      }
      for (const row of output?.datasets || []) {
        for (const [label, blob] of [["valid", row.valid_input], ["invalid", row.invalid_input], ["boundary", row.boundary_input]]) {
          if (!blob || typeof blob !== "object") continue;
          if (blob.page_url && blob.page_url !== web.url && !String(blob.page_url).startsWith(web.origin)) {
            failures.push(`${row.test_case_id} ${label}: page_url "${blob.page_url}" does not match provided webpage`);
            failedRules.add("For UI stories: derive datasets from human-provided webpage URL");
          }
        }
      }
    }
  }

  const passed = failures.length === 0;
  return {
    ...buildValidationResult(
      "test_data_extractor",
      passed,
      passed ? [] : [...failedRules],
      passed ? null : failures[0],
    ),
    detail_failures: failures,
    api_checks: DATA_EXTRACTOR_API_CHECKS,
    requirements_checked: requirements.version,
    requirements_summary: requirements.testable_conditions.map((c) => c.id + ": " + c.text.slice(0, 60)).join("; "),
  };
}

export function resolveLiveValidatorReturn(e) {
  if (e.kind !== "validator_return" || !farmCtx.currentStory) return e;

  if (e.target_agent === "analyst") {
    const analystOut = farmCtx.storyOutputs?.analyst;
    if (!analystOut) return e;
    const live = validateAnalystOutputLive(farmCtx.currentStory, analystOut);
    const meta = AGENT_META.analyst;
    const detail = live.detail_failures?.length ? live.detail_failures : live.failures;

    return {
      ...e,
      passed: live.passed,
      validation: live,
      agent_returns: live,
      brake_applied: !live.passed && e.attempt >= VALIDATOR_MAX_ATTEMPTS,
      message: live.passed
        ? `Validation PASSED for ${meta.label} on attempt ${e.attempt}/${VALIDATOR_MAX_ATTEMPTS} (${live.score}) — AC quality and test-action mapping verified`
        : !live.passed && e.attempt >= VALIDATOR_MAX_ATTEMPTS
          ? `Validation FAILED for ${meta.label} on attempt ${e.attempt}/${VALIDATOR_MAX_ATTEMPTS} — brake applied: ${detail.join("; ")}`
          : `Validation FAILED for ${meta.label} on attempt ${e.attempt}/${VALIDATOR_MAX_ATTEMPTS}: ${detail.join("; ")}`,
      decision: live.passed
        ? "approve — orchestrator may proceed"
        : e.attempt >= VALIDATOR_MAX_ATTEMPTS
          ? "abort — 2nd failure, no retry"
          : `reject — 1 retry allowed (${VALIDATOR_MAX_ATTEMPTS - e.attempt} left)`,
    };
  }

  if (e.target_agent !== "test_data_extractor") return e;

  const live = validateTestDataExtractorOutput(
    farmCtx.currentStory,
    farmCtx.storyOutputs.test_data_extractor,
    farmCtx.storyOutputs.writer,
    farmCtx.storyOutputs.analyst,
  );
  const meta = AGENT_META[e.target_agent];
  const detail = live.detail_failures?.length ? live.detail_failures : live.failures;

  return {
    ...e,
    passed: live.passed,
    validation: live,
    agent_returns: live,
    brake_applied: !live.passed && e.attempt >= VALIDATOR_MAX_ATTEMPTS,
    message: live.passed
      ? `Validation PASSED for ${meta.label} on attempt ${e.attempt}/${VALIDATOR_MAX_ATTEMPTS} (${live.score}) — data satisfies current requirements, API, coordinates, and test case links`
      : !live.passed && e.attempt >= VALIDATOR_MAX_ATTEMPTS
        ? `Validation FAILED for ${meta.label} on attempt ${e.attempt}/${VALIDATOR_MAX_ATTEMPTS} — brake applied: ${detail.join("; ")}`
        : `Validation FAILED for ${meta.label} on attempt ${e.attempt}/${VALIDATOR_MAX_ATTEMPTS}: ${detail.join("; ")}`,
    decision: live.passed
      ? "approve — orchestrator may proceed"
      : e.attempt >= VALIDATOR_MAX_ATTEMPTS
        ? "abort — 2nd failure, no retry"
        : `reject — 1 retry allowed (${VALIDATOR_MAX_ATTEMPTS - e.attempt} left)`,
  };
}

export function buildValidatorLiveState(eventIndex) {
  if (eventIndex < 0) return null;
  const validations = [];
  for (let j = 0; j <= eventIndex; j++) {
    const ev = farmCtx.EVENTS[j];
    if (ev?.kind === "validator_return" && ev.validation) {
      const resolved = (ev.target_agent === "test_data_extractor" || ev.target_agent === "analyst")
        ? resolveLiveValidatorReturn(ev)
        : ev;
      validations.push({
        step: j + 1,
        target_agent: resolved.target_agent,
        passed: resolved.passed,
        attempt: resolved.attempt,
        score: resolved.validation.score,
        failures: resolved.validation.detail_failures || resolved.validation.failures,
        recommendation: resolved.validation.recommendation,
        message: resolved.message,
        resolution: resolved.brake_applied
          ? `Brake applied — run aborted after ${VALIDATOR_MAX_ATTEMPTS} failed checks`
          : resolved.passed && resolved.attempt === 2
            ? "Agent corrected output per orchestrator feedback — re-validation passed"
            : !resolved.passed
              ? `Attempt ${resolved.attempt}/${VALIDATOR_MAX_ATTEMPTS} failed — ${resolved.attempt < VALIDATOR_MAX_ATTEMPTS ? "orchestrator may retry once" : "no retries left"}`
              : resolved.target_agent === "test_data_extractor" && farmCtx.getLiveHumanInputNeed(farmCtx.currentStory).needsHumanInput
                ? `Datasets verified against human-provided ${farmCtx.getLiveHumanInputNeed(farmCtx.currentStory).types.join(" + ")}`
                : null,
        brake_applied: !!resolved.brake_applied,
        attempts_used: resolved.attempt,
        attempts_remaining: ev.passed ? 0 : Math.max(0, VALIDATOR_MAX_ATTEMPTS - (ev.attempt || 1)),
      });
    }
  }
  const passed = validations.filter((v) => v.passed).length;
  const failed = validations.filter((v) => !v.passed).length;
  return {
    role: "Output Validator",
    level: "L2",
    purpose: "Gate every agent handoff — max 2 checks per agent, then brake",
    validations_performed: validations.length,
    passed,
    failed,
    validations,
    own_guidelines: VALIDATOR_GUIDELINES.rules,
    max_attempts_per_agent: VALIDATOR_MAX_ATTEMPTS,
    brake_applied: validations.some((v) => v.brake_applied),
    guidelines_enforced: Object.fromEntries(
      AGENT_ROLES.map((r) => [r, AGENT_GUIDELINES[r].rules])
    ),
    events_processed: eventIndex + 1,
  };
}
