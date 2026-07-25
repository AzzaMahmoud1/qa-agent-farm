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

/** Persistent "Expected:" copy — shape wording + short example. */
export const SHAPE_EXPECTATIONS = {
  credentials: "Username and password for a working test account — e.g. `qa.user@example.com / Passw0rd!`",
  url: "A full http(s) URL — e.g. `https://staging.example.com/login`",
  api_access: "A runnable curl command, or a base URL plus token — e.g. `curl -X GET 'https://api.example.com/v2/x' -H 'Authorization: Bearer TOKEN'`",
  email: "A single email address — e.g. `qa.user@example.com`",
  text: "A short concrete value — not a restatement of the question",
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
  // Credentials before url: hints like "test environment" must not override login/password asks.
  if (/\b(password|credential|username|login|user ?name)\b/.test(t)) {
    return "credentials";
  }
  if (/\b(url|uri|endpoint|environment|staging|base url|webpage|page)\b/.test(t) || /\bhttps?:\/\//.test(t)) {
    return "url";
  }
  if (/\b(email)\b/.test(t)) return "email";
  return "text";
}

/**
 * Priority: input_type → infer (label/note/detail) → explicit expected_shape when inference is weak.
 * Do not use `hint` for inference — examples often contain "environment" / sample URLs.
 * @param {{ input_type?: string, expected_shape?: string, label?: string, note?: string, detail?: string, reason?: string }} field
 */
export function resolveExpectedShape(field = {}) {
  if (field.input_type === "api_curl") return "api_access";
  if (field.input_type === "webpage_url") return "url";

  const inferred = inferExpectedShape(
    [field.label, field.note, field.detail, field.reason].filter(Boolean).join(" "),
  );

  const explicit = String(field.expected_shape || "").trim().toLowerCase();
  if (explicit && SHAPE_PLACEHOLDERS[explicit]) {
    if (inferred !== "text" && inferred !== explicit) {
      console.warn(
        `[input-shapes] expected_shape "${explicit}" contradicted by inference "${inferred}" — using inferred`,
      );
      return inferred;
    }
    return explicit;
  }
  return inferred;
}

export function placeholderForShape(shape, itemHint, inputType) {
  // Genuine examples already set on api_curl / webpage_url items — keep them.
  if (inputType === "api_curl" || inputType === "webpage_url") {
    const h = String(itemHint || "").trim();
    if (h) return h;
  }
  return SHAPE_PLACEHOLDERS[shape] || SHAPE_PLACEHOLDERS.text;
}

export function expectationLine(shape) {
  return SHAPE_EXPECTATIONS[shape] || SHAPE_EXPECTATIONS.text;
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
    if (!looksLikeUrl(v)) {
      return { ok: false, blame: SHAPE_EXPECTATIONS.url };
    }
  }
  if (expectedShape === "api_access") {
    if (extras.apiOk) return { ok: true, blame: null };
    if (!looksLikeCurl(v) && !looksLikeUrl(v)) {
      return { ok: false, blame: SHAPE_EXPECTATIONS.api_access };
    }
  }
  if (expectedShape === "email" && !looksLikeEmail(v)) {
    return { ok: false, blame: SHAPE_EXPECTATIONS.email };
  }
  if (expectedShape === "credentials" && v.length < 3) {
    return { ok: false, blame: "Credentials look too short / incomplete — " + SHAPE_EXPECTATIONS.credentials };
  }
  return { ok: true, blame: null };
}
