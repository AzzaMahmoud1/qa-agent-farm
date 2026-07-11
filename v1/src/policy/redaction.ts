/** Secret redaction for UI, logs, evidence, and exports. */

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
]);

const SECRET_JSON_KEYS = new Set([
  "password",
  "passwd",
  "secret",
  "token",
  "access_token",
  "accessToken",
  "refresh_token",
  "refreshToken",
  "api_key",
  "apiKey",
  "client_secret",
  "clientSecret",
  "authorization",
  "auth",
]);

function isSecretKey(key: string): boolean {
  if (SECRET_JSON_KEYS.has(key) || SECRET_JSON_KEYS.has(key.toLowerCase())) return true;
  return /password|passwd|secret|token|api[_-]?key|authorization|credential/i.test(key);
}

export function redactString(value: unknown): string {
  if (value == null) return "";
  let s = String(value);
  const patterns = [
    /Bearer\s+[^\s'"]+/gi,
    /Basic\s+[^\s'"]+/gi,
    /api[_-]?key["'\s:=]+[^\s&'",}]+/gi,
    /access[_-]?token["'\s:=]+[^\s&'",}]+/gi,
    /password["'\s:=]+[^\s&'",}]+/gi,
    /secret["'\s:=]+[^\s&'",}]+/gi,
  ];
  for (const pattern of patterns) {
    s = s.replace(pattern, (m) => {
      const eq = m.search(/[=:]/);
      if (eq >= 0) return `${m.slice(0, eq + 1)}[REDACTED]`;
      return `${m.split(/\s+/)[0]} [REDACTED]`;
    });
  }
  return s;
}

export function redactJsonValue(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[REDACTED_DEPTH]";
  if (value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((v) => redactJsonValue(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSecretKey(k) ? "[REDACTED]" : redactJsonValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function redactBody(body: unknown): unknown {
  if (body == null || body === "") return body;
  if (typeof body === "object") return redactJsonValue(body);
  const text = String(body);
  try {
    return JSON.stringify(redactJsonValue(JSON.parse(text)));
  } catch {
    return redactString(text);
  }
}

export function redactHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    out[k] = SECRET_HEADER_NAMES.has(lower) || isSecretKey(k) ? "[REDACTED]" : redactString(v);
  }
  return out;
}

export function containsSecret(text: string): boolean {
  const s = String(text || "");
  if (/"api_key"\s*:\s*"(?!\[REDACTED\])[^"]+"/i.test(s)) return true;
  if (/"access_token"\s*:\s*"(?!\[REDACTED\])[^"]+"/i.test(s)) return true;
  if (/"password"\s*:\s*"(?!\[REDACTED\])[^"]+"/i.test(s)) return true;
  if (/\bBearer\s+(?!\[REDACTED\])\S+/i.test(s)) return true;
  return false;
}
