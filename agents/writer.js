/** @see skills/writer/SKILL.md */
export const AGENT_ID = "writer";
export const SKILL_PATH = "skills/writer/SKILL.md";
export const SKILL_FOLDER = "skills/writer";

export function tcType(i, total) {
  if (i === 0) return "happy_path";
  if (i === total - 1 && total > 2) return "edge_case";
  return "negative";
}

export function buildWriterTestCases(story) {
  const s = story.id;
  const acList = story.acceptance_criteria_list || [];
  const tcIds = story.test_cases;
  return tcIds.map((id, i) => {
    const ac = acList[i] || acList[0] || story.title;
    const type = tcType(i, tcIds.length);
    return {
      id,
      title: ac.length > 80 ? ac.slice(0, 77) + "…" : ac,
      type,
      given: story.from_requirements
        ? `Requirements ${s} loaded from pasted description`
        : `Ticket ${s} is loaded with JIRA context`,
      when: `Scenario exercises AC #${i + 1}: ${ac.slice(0, 60)}${ac.length > 60 ? "…" : ""}`,
      then: type === "happy_path" ? "Expected behavior passes per AC" : "System rejects or handles edge correctly",
      expected_evidence: type === "happy_path" ? "HTTP 200 / success response" : "HTTP 4xx with clear error",
      suggested_file: `tests/api/${s.toLowerCase()}.spec.ts`,
    };
  });
}
