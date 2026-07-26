/**
 * Merge orchestrator ASK_HUMAN actions with Analyst prerequisite panel items
 * into one field per underlying need (avoids duplicate UI / recheck rows).
 */

import { inferExpectedShape } from "./input-shapes.js";

export function slugifyPrereqId(text, index = 0) {
  const base = String(text || "prereq").toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 32);
  return base || `prereq_${index}`;
}

function normalizeLabel(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Whole-phrase match only (not loose substring / token overlap). */
function labelInDetail(label, detail) {
  const l = normalizeLabel(label);
  const d = normalizeLabel(detail);
  if (!l || !d) return false;
  return (` ${d} `).includes(` ${l} `);
}

function shapeFromInputType(inputType) {
  if (inputType === "webpage_url") return "url";
  if (inputType === "api_curl") return "api_access";
  return null;
}

/**
 * @param {{ actions?: Array, prereqItems?: Array }} opts
 */
export function mergeHumanAskFields({ actions = [], prereqItems = [] } = {}) {
  const items = Array.isArray(prereqItems) ? prereqItems : [];
  const acts = Array.isArray(actions) ? actions : [];
  const usedItems = new Set();
  const merged = [];

  const findItemForAction = (a) => {
    // Explicit link wins; do not fall back to label guessing when prereq_id is set but missing.
    if (a?.prereq_id) {
      return items.findIndex((it) => it && it.id === a.prereq_id && !usedItems.has(it.id));
    }
    const detail = a?.detail || a?.item || "";
    const actionShape = inferExpectedShape(detail);
    return items.findIndex((it) => {
      if (!it || usedItems.has(it.id)) return false;
      if (!labelInDetail(it.label || it.id, detail)) return false;
      const itemShape = shapeFromInputType(it.input_type);
      if (itemShape && actionShape !== "text" && itemShape !== actionShape) {
        return false; // never absorb a webpage/api item into a credentials ask
      }
      return true;
    });
  };

  acts.forEach((a, i) => {
    if (!a) return;
    const itemIdx = findItemForAction(a);
    const item = itemIdx >= 0 ? items[itemIdx] : null;
    if (item) usedItems.add(item.id);
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
