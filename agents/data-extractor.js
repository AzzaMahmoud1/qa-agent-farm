/** @see .cursor/skills/qa-data-extractor/SKILL.md */
export const AGENT_ID = "test_data_extractor";
export const SKILL_PATH = ".cursor/skills/qa-data-extractor/SKILL.md";
export const SKILL_FOLDER = ".cursor/skills/qa-data-extractor";

import { farmCtx } from "./ctx-bridge.js";
import { buildRequirementsFromStory } from "../lib/requirements.js";
import { inferHumanInputNeeds } from "../lib/human-input.js";
import { inferRequirementSignals, scenarioRoleForType, inferApiFields, buildInvalidFieldValue, buildBoundaryFieldValue, buildValidFieldValue } from "../lib/test-data.js";
import { buildAnalystPrerequisitePayload } from "./analyst.js";

export function blockedDataExtractorOutput(story, reason, requirements, inputNeed) {
  return {
    ticket: story?.id,
    blocked: true,
    blocked_reason: reason,
    human_input_need: inputNeed || null,
    requirements_snapshot: requirements?.version,
    requirements,
    source: "blocked — awaiting human input",
    datasets: [],
    fixtures: [],
    environment_variables: [],
    rows_extracted: 0,
  };
}

export function extractTestOracle(writerTc, acText, scenarioRole, api, webpage) {
  const ac = String(acText || "");
  const combined = [ac, writerTc?.title, writerTc?.when, writerTc?.then, writerTc?.expected_evidence].join(" ");
  const signals = inferRequirementSignals(combined);
  const expected_behavior = writerTc?.then
    || (signals.needsNegative
      ? "System rejects invalid input per AC"
      : "System satisfies acceptance criterion");
  let pass_criteria = writerTc?.expected_evidence || "";
  let fail_criteria = "";

  if (scenarioRole === "invalid_input" || writerTc?.type === "negative") {
    if (/\breject|invalid|fail|error|denied|wrong\b/i.test(combined)) {
      pass_criteria = pass_criteria || (api?.ok
        ? "HTTP 4xx with actionable error; no session/side-effect"
        : webpage?.ok
          ? "Error message visible; user not advanced to success state"
          : "Observable rejection — error shown, success state not reached");
      fail_criteria = api?.ok
        ? "HTTP 2xx or success body when rejection expected"
        : "Success UI/state when rejection expected";
    }
  } else if (scenarioRole === "boundary_input" || writerTc?.type === "edge_case") {
    pass_criteria = pass_criteria || (signals.needsBoundary
      ? "Boundary value handled per AC (accepted or rejected consistently)"
      : "Edge input handled without crash; behaviour matches AC");
    fail_criteria = "Silent failure, crash, or inconsistent boundary handling";
  } else {
    if (/\blog\s*in|session|token|authenticated\b/i.test(combined)) {
      pass_criteria = pass_criteria || (api?.ok ? "HTTP 200 with access_token/session" : "User reaches authenticated state");
      fail_criteria = api?.ok ? "HTTP 4xx or missing token" : "Login/session not established";
    } else if (signals.needsNegative) {
      pass_criteria = pass_criteria || (api?.ok ? "HTTP 2xx for valid input" : "Expected success observable");
      fail_criteria = "Unexpected error for valid input";
    } else {
      pass_criteria = pass_criteria || (api?.ok ? "HTTP 2xx success response" : "Observable success per AC");
      fail_criteria = api?.ok ? "HTTP 4xx or missing expected field" : "Success criteria not met";
    }
  }

  if (!pass_criteria) {
    pass_criteria = scenarioRole === "invalid_input"
      ? "Failure path observable per AC"
      : "Success path observable per AC";
  }
  if (!fail_criteria) {
    fail_criteria = scenarioRole === "invalid_input"
      ? "Incorrect pass when failure expected"
      : "Incorrect fail when success expected";
  }

  return {
    expected_behavior,
    pass_criteria,
    fail_criteria,
    expected_evidence: writerTc?.expected_evidence || pass_criteria,
    scenario_role: scenarioRole,
    primary_input: scenarioRole,
    derived_from: writerTc?.expected_evidence ? "writer.expected_evidence" : "ac_text_and_scenario",
    ac_text: ac.slice(0, 120),
  };
}

export function buildTestDataRow(id, i, ac, fields, fieldKeys, api, writerTc, requirements, webpage) {
  const tcType = writerTc?.type || "happy_path";
  const scenarioRole = scenarioRoleForType(tcType);
  const reqId = `AC-${i + 1}`;
  const reqEntry = requirements?.testable_conditions?.[i];
  const valid_input = fieldKeys.length
    ? Object.fromEntries(fieldKeys.map((k) => [k, buildValidFieldValue(k, fields[k], i)]))
    : { method: api?.method || "GET", url: api?.url || webpage?.url || "" };
  const invalid_input = fieldKeys.length
    ? Object.fromEntries(fieldKeys.map((k) => [k, buildInvalidFieldValue(k, fields[k])]))
    : { method: api?.method || "GET", url: api?.url ? api.url.replace(api.base_url, "https://invalid-host.example") : "not-a-url" };
  const boundary_input = fieldKeys.length
    ? Object.fromEntries(fieldKeys.map((k) => [k, buildBoundaryFieldValue(k, fields[k])]))
    : { page_size: 9999 };

  if (webpage?.ok) {
    valid_input.page_url = webpage.url;
    valid_input.page_path = webpage.path;
    valid_input.page_title = webpage.title;
    invalid_input.page_url = "not-a-valid-url";
    boundary_input.page_url = webpage.url.replace(/\/?$/, "/edge-case");
  }

  return {
    test_case_id: id,
    test_case_title: writerTc?.title || ac.slice(0, 80),
    test_case_type: tcType,
    valid_input,
    invalid_input,
    boundary_input,
    mapped_ac: ac.slice(0, 80),
    ac_index: i + 1,
    requirement_id: reqId,
    requirement_text: (reqEntry?.text || ac).slice(0, 120),
    testable_condition: writerTc?.when || `AC #${i + 1}: ${ac.slice(0, 60)}`,
    curl_template: api?.ok ? `${api.method} ${api.endpoint}` : null,
    webpage_template: webpage?.ok ? webpage.url : null,
    scenario_role: scenarioRole,
    test_oracle: extractTestOracle(writerTc, ac, scenarioRole, api, webpage),
  };
}

export function buildTestDataExtractorOutput(story, api, writerCases, analystOutput, webpage) {
  const s = story.id;
  const acList = story.acceptance_criteria_list || [];
  const tcIds = story.test_cases;
  const cases = writerCases || [];
  const requirements = buildRequirementsFromStory(story, cases, analystOutput);

  const web = webpage || (farmCtx.humanWebpageInput.ok ? farmCtx.humanWebpageInput : null);
  const inputNeed = inferHumanInputNeeds(story, analystOutput, cases);
  const prereq = farmCtx.storyOutputs?.analyst?.prerequisites_needed || buildAnalystPrerequisitePayload(story);

  if (prereq.needed && !farmCtx.isPrerequisitesSatisfied()) {
    return blockedDataExtractorOutput(
      story,
      "Prerequisites must be confirmed before test data can be extracted.",
      requirements,
      inputNeed,
    );
  }

  const needsApi = inputNeed.types.includes("api");
  const needsWeb = inputNeed.types.includes("webpage");
  if (inputNeed.needsHumanInput) {
    if (needsApi && !api?.ok && needsWeb && !web?.ok) {
      return blockedDataExtractorOutput(story, inputNeed.action || "Provide curl and webpage URL before extraction.", requirements, inputNeed);
    }
    if (needsApi && !api?.ok) {
      return blockedDataExtractorOutput(story, inputNeed.action || "Provide a curl command before extraction.", requirements, inputNeed);
    }
    if (needsWeb && !web?.ok) {
      return blockedDataExtractorOutput(story, inputNeed.action || "Provide a webpage URL before extraction.", requirements, inputNeed);
    }
  }

  if (api?.ok || web?.ok) {
    const fields = api?.ok ? inferApiFields(api) : {};
    const fieldKeys = Object.keys(fields);
    const envVars = [];
    if (api?.ok) {
      envVars.push(`BASE_URL=${api.base_url}`);
      if (api.auth) envVars.push("AUTH_TOKEN=(from curl Authorization header)");
      Object.keys(api.headers || {}).forEach((h) => {
        if (!/^content-type$/i.test(h)) envVars.push(`${h.replace(/-/g, "_").toUpperCase()}=(from curl)`);
      });
    }
    if (web?.ok) envVars.push(`PAGE_URL=${web.url}`, `PAGE_ORIGIN=${web.origin}`);

    const sources = [];
    if (api?.ok) sources.push("human-provided API (curl)");
    if (web?.ok) sources.push("human-provided webpage");

    return {
      ticket: s,
      source: sources.join(" + "),
      api_endpoint: api?.ok ? `${api.method} ${api.url}` : null,
      webpage_url: web?.ok ? web.url : null,
      human_api: api?.ok ? api : null,
      human_webpage: web?.ok ? web : null,
      human_input_need: inputNeed,
      requirements_snapshot: requirements.version,
      requirements,
      datasets: tcIds.map((id, i) => {
        const ac = acList[i] || acList[0] || story.title;
        const writerTc = cases.find((tc) => tc.id === id) || cases[i];
        return buildTestDataRow(id, i, ac, fields, fieldKeys, api, writerTc, requirements, web);
      }),
      fixtures: tcIds.map((id) => `fixtures/${s.toLowerCase()}/${id}.json`),
      environment_variables: envVars,
      rows_extracted: tcIds.length,
    };
  }

  return {
    ticket: s,
    source: "story context (no API curl)",
    requirements_snapshot: requirements.version,
    requirements,
    datasets: tcIds.map((id, i) => {
      const ac = acList[i] || acList[0] || story.title;
      const writerTc = cases.find((tc) => tc.id === id) || cases[i];
      return buildTestDataRow(id, i, ac, {}, [], null, writerTc, requirements, null);
    }),
    fixtures: tcIds.map((id) => `fixtures/${s.toLowerCase()}/${id}.json`),
    environment_variables: ["BASE_URL", "TENANT_ID"],
    rows_extracted: tcIds.length,
  };
}
