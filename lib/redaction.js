/** Redact secrets from strings/objects before UI, logs, or exports. */

const SECRET_HEADER_NAMES = new Set([
  "authorization",
  "x-api-key",
  "api-key",
  "x-auth-token",
  "cookie",
  "set-cookie",
  "proxy-authorization",
]);

const SECRET_PATTERNS = [
  /Bearer\s+[^\s'"]+/gi,
  /Basic\s+[^\s'"]+/gi,
  /api[_-]?key[=:]\s*[^\s&'"]+/gi,
  /token[=:]\s*[^\s&'"]+/gi,
  /password[=:]\s*[^\s&'"]+/gi,
  /secret[=:]\s*[^\s&'"]+/gi,
];

export function redactString(value) {
  if (value == null) return value;
  let s = String(value);
  for (const pattern of SECRET_PATTERNS) {
    s = s.replace(pattern, (m) => {
      const prefix = m.split(/\s+/)[0];
      return `${prefix} [REDACTED]`;
    });
  }
  return s;
}

export function redactHeaders(headers = {}) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SECRET_HEADER_NAMES.has(String(k).toLowerCase()) ? "[REDACTED]" : redactString(v);
  }
  return out;
}

export function redactParsedCurl(parsed) {
  if (!parsed?.ok) return parsed;
  return {
    ...parsed,
    headers: redactHeaders(parsed.headers),
    auth: parsed.auth ? "[REDACTED]" : "",
    body: parsed.body ? redactString(parsed.body) : parsed.body,
    curl: redactString(parsed.curl),
  };
}

export function containsSecret(text) {
  const s = String(text || "");
  if (SECRET_PATTERNS.some((p) => { p.lastIndex = 0; return p.test(s); })) return true;
  if (/\bBearer\s+\S+/i.test(s) || /\bBasic\s+\S+/i.test(s)) return true;
  return false;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    redactString,
    redactHeaders,
    redactParsedCurl,
    containsSecret,
    SECRET_HEADER_NAMES,
  };
}
