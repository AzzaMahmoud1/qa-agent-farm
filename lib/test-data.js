import { isLatitudeKey, isLongitudeKey, parseCoordNumber } from "./geo.js";

export function inferApiFields(api) {
  const fields = {};
  if (api?.body) {
    try {
      const parsed = JSON.parse(api.body);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        Object.assign(fields, parsed);
      }
    } catch {
      api.body.split("&").forEach((pair) => {
        const [k, v] = pair.split("=");
        if (k) fields[decodeURIComponent(k.trim())] = decodeURIComponent((v || "").trim());
      });
    }
  }
  if (api?.url) {
    try {
      const u = new URL(api.url);
      u.searchParams.forEach((v, k) => { fields[k] = v; });
    } catch { /* ignore */ }
  }
  return fields;
}

export function buildInvalidFieldValue(key, value) {
  if (isLatitudeKey(key)) return 91;
  if (isLongitudeKey(key)) return 181;
  if (typeof value === "number") return value < 0 ? -999 : -1;
  if (typeof value === "boolean") return !value;
  if (/email/i.test(key)) return "not-an-email";
  if (/id$/i.test(key) || /^id$/i.test(key)) return "invalid-id";
  if (typeof value === "string" && value) return "";
  return null;
}

export function buildBoundaryFieldValue(key, value) {
  if (isLatitudeKey(key)) return 90;
  if (isLongitudeKey(key)) return 180;
  if (typeof value === "number") {
    const n = parseCoordNumber(value);
    if (n !== null && n >= 0) return Math.max(0, n - 0.001);
    return 0;
  }
  if (typeof value === "string") return "x".repeat(255);
  return value;
}

export function buildValidFieldValue(key, value, testCaseIndex) {
  if (isLatitudeKey(key)) {
    const base = parseCoordNumber(value) ?? 24.7136;
    return Number(Math.min(89.999, Math.max(-89.999, base + testCaseIndex * 0.01)).toFixed(6));
  }
  if (isLongitudeKey(key)) {
    const base = parseCoordNumber(value) ?? 46.6753;
    return Number(Math.min(179.999, Math.max(-179.999, base + testCaseIndex * 0.01)).toFixed(6));
  }
  return value;
}

export function inferRequirementSignals(text) {
  const s = String(text || "").toLowerCase();
  return {
    needsGeo: /lat|latitude|lon|longitude|coordinate|geo|location|map|position/.test(s),
    needsNegative: /invalid|reject|fail|error|negative|out of range|not allowed|denied/.test(s),
    needsBoundary: /boundary|edge|limit|maximum|minimum|threshold|extreme/.test(s),
    needsApi: /api|endpoint|curl|http|request|response|microservice/.test(s),
    needsWebpage: /web\s*page|webpage|\bui\b|browser|frontend|selenium|playwright|\be2e\b|navigate|login page|dashboard/.test(s),
  };
}

export function scenarioRoleForType(tcType) {
  if (tcType === "happy_path") return "valid_input";
  if (tcType === "edge_case") return "boundary_input";
  if (tcType === "negative") return "invalid_input";
  return "valid_input";
}
