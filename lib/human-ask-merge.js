/**
 * Merge orchestrator ASK_HUMAN actions with Analyst prerequisite panel items
 * into one field per underlying need (avoids duplicate UI / recheck rows).
 */

export function slugifyPrereqId(text, index = 0) {
  const base = String(text || "prereq").toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 32);
  return base || `prereq_${index}`;
}

function normalizeLabel(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function labelInDetail(label, detail) {
  const l = normalizeLabel(label);
  const d = normalizeLabel(detail);
  if (!l || !d) return false;
  return d.includes(l) || l.includes(d);
}

/**
 * @param {{ actions?: Array, prereqItems?: Array }} opts
 * @returns {Array<{
 *   key: string,
 *   label: string,
 *   note: string,
 *   required_for: string[],
 *   input_type?: string,
 *   expected_shape?: string,
 *   required: boolean,
 *   value: string,
 *   sources: { action_idx: number|null, prereq_id: string|null },
 *   action?: object,
 *   item?: object,
 * }>}
 */
export function mergeHumanAskFields({ actions = [], prereqItems = [] } = {}) {
  const items = Array.isArray(prereqItems) ? prereqItems : [];
  const acts = Array.isArray(actions) ? actions : [];
  const usedItems = new Set();
  const usedActions = new Set();
  const merged = [];

  const findItemForAction = (a) => {
    if (a?.prereq_id) {
      const byId = items.findIndex((it) => it && it.id === a.prereq_id && !usedItems.has(it.id));
      if (byId >= 0) return byId;
    }
    const detail = a?.detail || a?.item || "";
    return items.findIndex(
      (it) => it && !usedItems.has(it.id) && labelInDetail(it.label || it.id, detail),
    );
  };

  acts.forEach((a, i) => {
    if (!a) return;
    const itemIdx = findItemForAction(a);
    const item = itemIdx >= 0 ? items[itemIdx] : null;
    if (item) usedItems.add(item.id);
    usedActions.add(i);
    const prereq_id = a.prereq_id || item?.id || null;
    const key = prereq_id || `action-${i}`;
    merged.push({
      key,
      label: item?.label || a.detail || a.target || `Action ${i + 1}`,
      note: item?.analyst_note || item?.reason || "",
      required_for: item?.required_for || [],
      input_type: item?.input_type,
      expected_shape: a.expected_shape || item?.expected_shape,
      required: a.requires_value === true
        || a.action === "ASK_HUMAN"
        || a.action === "FETCH_DEPENDENCY"
        || item?.required !== false,
      value: (a.provided_value || item?.value || "").trim(),
      hint: item?.hint || "",
      detail: a.detail || "",
      sources: { action_idx: i, prereq_id },
      action: a,
      item,
    });
  });

  items.forEach((item) => {
    if (!item || usedItems.has(item.id)) return;
    usedItems.add(item.id);
    merged.push({
      key: item.id,
      label: item.label || item.id,
      note: item.analyst_note || item.reason || "",
      required_for: item.required_for || [],
      input_type: item.input_type,
      expected_shape: item.expected_shape,
      required: item.required !== false,
      value: "",
      hint: item.hint || "",
      detail: "",
      sources: { action_idx: null, prereq_id: item.id },
      action: null,
      item,
    });
  });

  return merged;
}
