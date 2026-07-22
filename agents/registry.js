/** Agent registry — roles, pipeline steps, guidelines, constants */
const FALLBACK_STORIES = {
      "SEHJ-10668": {
        id: "SEHJ-10668",
        title: "Login fails when email contains uppercase letters",
        jira: "https://leansa.atlassian.net/browse/SEHJ-10668",
        description: "Users report mixed-case email login failures.",
        acceptance_criteria_list: [
          "Email login must be case-insensitive",
          "Error message must be clear when credentials are wrong",
          "Session token must be generated correctly after login",
          "Password remains case-sensitive",
        ],
        priority: "High",
        status: "To Do",
        issueType: "Bug",
        components: ["Authentication / Login"],
        acceptance_criteria: 4,
        gaps: 5,
        blocking_gaps: 0,
        test_cases: ["TC-01", "TC-02", "TC-03", "TC-04"],
        api_requests: null,
        score: null,
        passed: null,
        failed: null,
        coverage: null,
        from_jira: false,
      },
    };


const AGENT_ROLES = ["analyst", "writer", "test_data_extractor", "author", "test_executor", "reviewer", "reporter"];

/** Cursor / Anthropic model IDs for pipeline routing */
const MODEL_ORCHESTRATOR = "claude-fable-5";
const MODEL_WORKER = "claude-4.6-sonnet";

/**
 * Model routing policy:
 * - Orchestrator (L1) → Claude Fable 5 (long-horizon coordination)
 * - All worker agents + validator → Claude Sonnet (execution / analysis)
 */
const AGENT_MODEL_ROUTING = {
  orchestrator: MODEL_ORCHESTRATOR,
  validator: MODEL_WORKER,
  analyst: MODEL_WORKER,
  writer: MODEL_WORKER,
  test_data_extractor: MODEL_WORKER,
  author: MODEL_WORKER,
  test_executor: MODEL_WORKER,
  reviewer: MODEL_WORKER,
  reporter: MODEL_WORKER,
};

function getModelForAgent(role) {
  return AGENT_MODEL_ROUTING[role] || MODEL_WORKER;
}

const PIPELINE_STEPS = [
      { id: "orchestrator", label: "Orchestrator", icon: "🎯" },
      { id: "validator", label: "Validator", icon: "✅" },
      { id: "analyst", label: "Agent 1", icon: "🔍" },
      { id: "writer", label: "Writer", icon: "📝" },
      { id: "test_data_extractor", label: "Data", icon: "🧪" },
      { id: "author", label: "Author", icon: "🛠️" },
      { id: "test_executor", label: "Executor", icon: "▶️" },
      { id: "reviewer", label: "Reviewer", icon: "🛡️" },
      { id: "reporter", label: "Report", icon: "📊" },
    ];

const AGENT_META = {
      orchestrator: { label: "Orchestrator", icon: "🎯", level: "L1", model: MODEL_ORCHESTRATOR, skillPath: ".cursor/skills/qa-orchestrator/SKILL.md", skillFolder: ".cursor/skills/qa-orchestrator" },
      validator: { label: "Output Validator", icon: "✅", level: "L2", model: MODEL_WORKER, skillPath: ".cursor/skills/qa-validator/SKILL.md", skillFolder: ".cursor/skills/qa-validator" },
      analyst: { label: "Agent 1 · Requirement Analyst", icon: "🔍", level: "L3", model: "claude-sonnet-5 (high)", skillPath: ".cursor/skills/qa-analyst/SKILL.md", skillFolder: ".cursor/skills/qa-analyst" },
      writer: { label: "Test Case Writer", icon: "📝", level: "L3", model: MODEL_WORKER, skillPath: ".cursor/skills/qa-writer/SKILL.md", skillFolder: ".cursor/skills/qa-writer" },
      test_data_extractor: { label: "Test Data Extractor", icon: "🧪", level: "L3", model: MODEL_WORKER, skillPath: ".cursor/skills/qa-data-extractor/SKILL.md", skillFolder: ".cursor/skills/qa-data-extractor" },
      author: { label: "Test Author", icon: "🛠️", level: "L3", model: MODEL_WORKER, skillPath: ".cursor/skills/qa-author/SKILL.md", skillFolder: ".cursor/skills/qa-author" },
      test_executor: { label: "Test Executor", icon: "▶️", level: "L3", model: MODEL_WORKER, skillPath: ".cursor/skills/qa-executor/SKILL.md", skillFolder: ".cursor/skills/qa-executor" },
      reviewer: { label: "QA Reviewer", icon: "🛡️", level: "L4", model: MODEL_WORKER, skillPath: ".cursor/skills/qa-reviewer/SKILL.md", skillFolder: ".cursor/skills/qa-reviewer" },
      reporter: { label: "Report Generator", icon: "📊", level: "L5", model: MODEL_WORKER, skillPath: ".cursor/skills/qa-reporter/SKILL.md", skillFolder: ".cursor/skills/qa-reporter" },
    };

const AGENT_GUIDELINES = {
      analyst: {
        level: "L2",
        required_deliverables: ["testable_conditions", "coverage_gaps", "prerequisites_needed", "analyst_reasoning", "analysis_complete", "ready_for_test_design", "analyst_report"],
        rules: [
          "Disposition every Business Rules / Alternative / Exception line; never silent-drop (Validator enforces coverage)",
          "Reject ticket metadata and wrong sections — never map Basic Flow / Pre-conditions as ACs",
          "Extract ACs only from Business Rules, Alternative Flow, Exception Flow",
          "Map every acceptance criterion to a structured testable condition",
          "Categorize prerequisites as data/environment/dependency/knowledge/access with blocking/non-blocking",
          "Keep analysis_complete separate from ready_for_test_design (access usually blocks execution, not design)",
          "Emit non-empty orchestrator_actions — PROCEED alone when ready, else blocking ASK/HOLD",
        ],
      },
      writer: {
        level: "L3",
        required_deliverables: ["test_cases", "given_when_then", "ac_mapping"],
        rules: [
          "Refuse work without validated Analyst output",
          "Each test case must use Given / When / Then format",
          "At least one happy-path and one negative or edge case",
          "Every acceptance criterion must be covered by a test case",
          "Skip ACs listed in analyst unimplemented_rules with skip_reason",
          "Prerequisites must reference Agent 1 blocking list only",
          "Include expected evidence (status code or observable outcome)",
        ],
      },
      test_data_extractor: {
        level: "L3",
        required_deliverables: ["datasets", "fixtures", "env_variables", "tc_mapping", "test_oracle"],
        rules: [
          "Refuse work without validated Writer output",
          "Extract test data for every writer test case",
          "For API stories: derive datasets from human-provided curl (URL, method, headers, body)",
          "For UI stories: derive datasets from human-provided webpage URL and page context",
          "Provide valid, invalid, and boundary sample inputs per scenario",
          "Extract test_oracle per row from writer then/expected_evidence and AC text",
          "Map each dataset row to a test case ID and linked acceptance criterion",
          "Datasets must satisfy current requirement testable conditions",
          "Re-validate datasets when requirements change",
          "Valid coordinates: latitude ∈ [-90, 90], longitude ∈ [-180, 180]",
          "Invalid/boundary rows must use geographically correct out-of-range or edge values",
          "Never use unrelated mock data (e.g. login emails) from other stories",
        ],
      },
      author: {
        level: "L3",
        required_deliverables: ["session_id", "status", "steps", "requirement_verdicts"],
        rules: [
          "Refuse work without validated Data Extractor (and Analyst/Writer) output",
          "Refuse to author when testable_conditions is empty",
          "Build only from approved test outlines",
          "Use Plan→Act→Reflect; never fabricate a pass without evidence",
          "Emit one verdict per requirement ID",
        ],
      },
      test_executor: {
        level: "L3",
        required_deliverables: ["execution_plan", "results", "evidence"],
        rules: [
          "Refuse work without validated Author output (status REVIEW)",
          "Execute all test cases using extracted test data",
          "Record pass/fail/blocked per test case with evidence",
          "For API stories: use human-provided curl command only",
          "Parse method, URL, headers, and body from curl — never invent endpoints",
        ],
      },
      reviewer: {
        level: "L4",
        required_deliverables: ["score", "impact", "missing_coverage", "fix", "unimplemented_rules_tested"],
        rules: [
          "Refuse post-exec review without validated Executor output (human-input recheck may run earlier)",
          "Provide a numeric or scored QA assessment",
          "Assess impact and regression risk",
          "List missing coverage and duplicate scenarios",
          "Flag tests written for unimplemented_rules (out of scope)",
          "After human prerequisites: recheck each answer against Analyst asks; reject wrong/empty input with blame",
          "Recommend concrete fix or follow-up actions",
        ],
      },
      reporter: {
        level: "L5",
        required_deliverables: ["summary", "regression_rows", "ticket_metadata"],
        rules: [
          "Refuse work without validated Reviewer output",
          "Include ticket key, title, and environment",
          "Summarize planned vs executed test counts",
          "List all regression rows with status",
          "Align final metrics with reviewer score",
        ],
      },
    };

const VALIDATOR_MAX_ATTEMPTS = 2;

const ORCHESTRATOR_INACTIVITY_TIMEOUT_MS = 60 * 1000;

const VALIDATOR_GUIDELINES = {
      level: "L2",
      role: "Output Validator",
      max_attempts_per_agent: VALIDATOR_MAX_ATTEMPTS,
      rules: [
        "Check worker output against role guidelines only — never rewrite agent output",
        "Allow at most 2 validation checks per agent handoff (initial output + 1 retry)",
        "On 1st failure: send structured feedback to orchestrator for one corrective re-instruction",
        "On 2nd failure: apply brake — abort the entire QA run (no further retries)",
        "Never loop or re-validate unchanged output beyond the 2-attempt limit",
      ],
    };

const OUTPUT_ROLES = ["orchestrator", "validator", ...AGENT_ROLES];

export {
  FALLBACK_STORIES,
  AGENT_ROLES,
  PIPELINE_STEPS,
  AGENT_META,
  AGENT_GUIDELINES,
  VALIDATOR_MAX_ATTEMPTS,
  ORCHESTRATOR_INACTIVITY_TIMEOUT_MS,
  VALIDATOR_GUIDELINES,
  OUTPUT_ROLES,
  MODEL_ORCHESTRATOR,
  MODEL_WORKER,
  AGENT_MODEL_ROUTING,
  getModelForAgent,
};
