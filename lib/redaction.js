/** Redact secrets from strings/objects before UI, logs, or exports. */

const SECRET_HEADER_NAMES = new Set([
  "authorization",
  "x-api-key",
  "api-key",
  "api_key",
  "x-auth-token",
  "access-token",
  "access_token",
  "x-access-token",
  "refresh-token",
  "refresh_token",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "x-csrf-token",
  "x-session-token",
]);

const SECRET_JSON_KEYS = new Set([
  "password",
  "passwd",
  "pwd",
  "secret",
  "token",
  "access_token",
  "accessToken",
  "refresh_token",
  "refreshToken",
  "id_token",
  "idToken",
  "api_key",
  "apiKey",
  "apikey",
  "client_secret",
  "clientSecret",
  "private_key",
  "privateKey",
  "authorization",
  "auth",
  "credentials",
  "session",
  "session_id",
  "sessionId",
]);

const SECRET_PATTERNS = [
  /Bearer\s+[^\s'"]+/gi,
  /Basic\s+[^\s'"]+/gi,
  /api[_-]?key["'\s:=]+[^\s&'",}]+/gi,
  /access[_-]?token["'\s:=]+[^\s&'",}]+/gi,
  /refresh[_-]?token["'\s:=]+[^\s&'",}]+/gi,
  /client[_-]?secret["'\s:=]+[^\s&'",}]+/gi,
  /password["'\s:=]+[^\s&'",}]+/gi,
  /passwd["'\s:=]+[^\s&'",}]+/gi,
  /secret["'\s:=]+[^\s&'",}]+/gi,
  /token["'\s:=]+[^\s&'",}]+/gi,
];

function isSecretKey(key) {
  const k = String(key || "");
  if (SECRET_JSON_KEYS.has(k) || SECRET_JSON_KEYS.has(k.toLowerCase())) return true;
  return /password|passwd|secret|token|api[_-]?key|authorization|credential/i.test(k);
}

export function redactString(value) {
  if (value == null) return value;
  let s = String(value);
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    s = s.replace(pattern, (m) => {
      const eq = m.search(/[=:]/);
      if (eq >= 0) return `${m.slice(0, eq + 1)}[REDACTED]`;
      const prefix = m.split(/\s+/)[0];
      return `${prefix} [REDACTED]`;
    });
  }
  return s;
}

export function redactJsonValue(value, depth = 0) {
  if (depth > 12) return "[REDACTED_DEPTH]";
  if (value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((v) => redactJsonValue(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = isSecretKey(k) ? "[REDACTED]" : redactJsonValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function redactBody(body) {
  if (body == null || body === "") return body;
  if (typeof body === "object") return redactJsonValue(body);
  const text = String(body);
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(redactJsonValue(parsed));
  } catch {
    return redactString(text);
  }
}

export function redactHeaders(headers = {}) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = String(k).toLowerCase();
    out[k] = SECRET_HEADER_NAMES.has(lower) || isSecretKey(k)
      ? "[REDACTED]"
      : redactString(v);
  }
  return out;
}

export function redactParsedCurl(parsed) {
  if (!parsed?.ok) return parsed;
  const headers = redactHeaders(parsed.headers || {});
  const hadAuth = !!(parsed.auth || parsed.headers?.Authorization || parsed.headers?.authorization
    || Object.keys(parsed.headers || {}).some((k) => /authorization|api[_-]?key|token/i.test(k)));
  return {
    ...parsed,
    headers,
    auth: hadAuth ? "[REDACTED]" : "",
    body: parsed.body != null ? redactBody(parsed.body) : parsed.body,
    curl: redactString(parsed.curl),
  };
}

export function containsSecret(text) {
  const s = String(text || "");
  if (!s || s === "[REDACTED]") return false;
  // Unredacted JSON secret fields
  if (/"api_key"\s*:\s*"(?!\[REDACTED\])[^"]+"/i.test(s)) return true;
  if (/"access_token"\s*:\s*"(?!\[REDACTED\])[^"]+"/i.test(s)) return true;
  if (/"password"\s*:\s*"(?!\[REDACTED\])[^"]+"/i.test(s)) return true;
  if (/"refresh_token"\s*:\s*"(?!\[REDACTED\])[^"]+"/i.test(s)) return true;
  if (/\bBearer\s+(?!\[REDACTED\])\S+/i.test(s)) return true;
  if (/\bBasic\s+(?!\[REDACTED\])\S+/i.test(s)) return true;
  if (/api[_-]?key\s*[:=]\s*(?!\[REDACTED\])[^\s&'",}]+/i.test(s)) return true;
  if (/access[_-]?token\s*[:=]\s*(?!\[REDACTED\])[^\s&'",}]+/i.test(s)) return true;
  if (/password\s*[:=]\s*(?!\[REDACTED\])[^\s&'",}]+/i.test(s)) return true;
  return false;
}

export { SECRET_HEADER_NAMES, SECRET_JSON_KEYS, SECRET_PATTERNS, isSecretKey };
