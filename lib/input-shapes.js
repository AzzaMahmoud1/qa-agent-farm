/**
 * Shared human-input shape inference and validation.
 * Used by agents/reviewer.js and js/simulator-app.js — keep in one place only.
 */

const PLACEHOLDER_RE = /^(todo|tbd|n\/a|na|none|null|undefined|xxx+|placeholder|changeme|example|test|asdf+)$/i;

export const SHAPE_PLACEHOLDERS = {
  url: "https://staging.example.com/login",
  api_access: "curl -X GET 'https://api.example.com/v2/x' -H 'Authorization: Bearer TOKEN'",
  email: "qa.user@example.com",
  credentials: "qa.user@example.com / Passw0rd!",
  text: "Short, concrete value — not a restatement of the question",
};

export function looksLikeUrl(value) {
  return /^https?:\/\/\S+/i.test(String(value || "").trim());
}

export function looksLikeCurl(value) {
  return /^curl\b/i.test(String(value || "").trim());
}

export function looksLikeEmail(value) {
  return /\b[\w.+-]+@[\w.-]+\.\w{2,}\b/.test(String(value || ""));
}

export function isPlaceholder(value) {
  const v = String(value || "").trim();
  if (!v) return true;
  if (PLACEHOLDER_RE.test(v)) return true;
  if (/^(https?:\/\/)?(example\.com|localhost)(\/|$)/i.test(v) && v.length < 24) return true;
  return false;
}

export function inferExpectedShape(text) {
  const t = String(text || "").toLowerCase();
  if (/\b(curl|api key|bearer|authorization header)\b/.test(t) || (/\bapi\b/.test(t) && /\b(url|base|token|endpoint)\b/.test(t))) {
    return "api_access";
  }
  if (/\b(url|uri|endpoint|environment|staging|base url|webpage|page)\b/.test(t) || /\bhttps?:\/\//.test(t)) {
    return "url";
  }
  if (/\b(email)\b/.test(t)) return "email";
  if (/\b(password|credential|username|login|user ?name)\b/.test(t)) return "credentials";
  return "text";
}

/**
 * Priority: input_type → explicit expected_shape → infer from labels/details.
 * @param {{ input_type?: string, expected_shape?: string, label?: string, note?: string, detail?: string }} field
 */
export function resolveExpectedShape(field = {}) {
  if (field.input_type === "api_curl") return "api_access";
  if (field.input_type === "webpage_url") return "url";
  const explicit = String(field.expected_shape || "").trim().toLowerCase();
  if (explicit && SHAPE_PLACEHOLDERS[explicit]) return explicit;
  return inferExpectedShape(
    [field.label, field.note, field.detail, field.hint, field.reason].filter(Boolean).join(" "),
  );
}

export function placeholderForShape(shape, itemHint, inputType) {
  // Genuine examples already set on api_curl / webpage_url items — keep them.
  if (inputType === "api_curl" || inputType === "webpage_url") {
    const h = String(itemHint || "").trim();
    if (h) return h;
  }
  return SHAPE_PLACEHOLDERS[shape] || SHAPE_PLACEHOLDERS.text;
}

export function evaluateProvidedValue(expectedShape, value, extras = {}) {
  const v = String(value || "").trim();
  if (!v && !(extras.apiOk || extras.webOk)) {
    return { ok: false, blame: "No value provided" };
  }
  if (v && isPlaceholder(v)) {
    return { ok: false, blame: `Placeholder/empty-looking value rejected: "${v.slice(0, 40)}"` };
  }
  if (expectedShape === "url") {
    if (extras.webOk && looksLikeUrl(extras.webUrl)) return { ok: true, blame: null };
    if (!looksLikeUrl(v)) return { ok: false, blame: "Expected an http(s) URL" };
  }
  if (expectedShape === "api_access") {
    if (extras.apiOk) return { ok: true, blame: null };
    if (!looksLikeCurl(v) && !looksLikeUrl(v)) {
      return { ok: false, blame: "Expected a curl command or API base URL + token" };
    }
  }
  if (expectedShape === "email" && !looksLikeEmail(v)) {
    return { ok: false, blame: "Expected an email address" };
  }
  if (expectedShape === "credentials" && v.length < 3) {
    return { ok: false, blame: "Credentials look too short / incomplete" };
  }
  return { ok: true, blame: null };
}
