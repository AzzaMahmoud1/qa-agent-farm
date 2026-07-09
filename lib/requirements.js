import { farmCtx } from "../agents/ctx-bridge.js";

export function buildRequirementsFromStory(story, writerCases, analystOutput) {
  const acList = story?.acceptance_criteria_list || [];
  const cases = writerCases || [];
  const analyst = analystOutput || {};
  let testable_conditions = [];

  if (Array.isArray(analyst.testable_conditions)) {
    testable_conditions = analyst.testable_conditions.map((t, i) => {
      if (t && typeof t === "object" && t.ac_text) {
        return { id: t.id || `AC-${i + 1}`, index: i + 1, text: t.ac_text };
      }
      const m = String(t).match(/^AC-(\d+):\s*(.*)/);
      return m
        ? { id: `AC-${m[1]}`, index: parseInt(m[1], 10), text: m[2] }
        : { id: `AC-${i + 1}`, index: i + 1, text: String(t) };
    });
  } else if (typeof analyst.testable_conditions === "string") {
    testable_conditions = acList.map((ac, i) => ({ id: `AC-${i + 1}`, index: i + 1, text: ac }));
  } else {
    testable_conditions = acList.map((ac, i) => ({ id: `AC-${i + 1}`, index: i + 1, text: ac }));
  }

  return {
    ticket_id: story?.id,
    ticket_title: story?.title,
    acceptance_criteria: acList,
    testable_conditions,
    writer_test_cases: cases.map((tc) => ({
      id: tc.id,
      title: tc.title,
      type: tc.type,
      when: tc.when,
      then: tc.then,
      given: tc.given,
    })),
    components: analyst.affected_components || story?.components || [],
    analyst_summary: analyst.summary || null,
    user_provided_prerequisites: farmCtx.getProvidedPrerequisites(),
    version: [
      story?.id || "",
      story?.fetched_at || story?.updated_at || "",
      acList.join("||"),
      cases.map((t) => `${t.id}:${t.title}:${t.type}:${t.when}`).join("||"),
      JSON.stringify(analyst.testable_conditions || ""),
      JSON.stringify(analyst.affected_components || ""),
      JSON.stringify(farmCtx.getProvidedPrerequisites()),
    ].join("::"),
  };
}

export function getLiveRequirements(story) {
  return buildRequirementsFromStory(story, farmCtx.storyOutputs?.writer?.test_cases, farmCtx.storyOutputs?.analyst);
}
