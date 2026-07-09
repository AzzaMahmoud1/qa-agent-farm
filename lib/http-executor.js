/** Execute allowlisted HTTP requests and return redacted evidence. */

import { redactHeaders, redactString } from "./redaction.js";

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_BODY = 64 * 1024;

export function isUrlAllowlisted(url, allowlist) {
  try {
    const u = new URL(url);
    if (!/^https?:$/i.test(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
    return (allowlist || []).some((entry) => {
      const e = String(entry).toLowerCase().trim();
      return host === e || host.endsWith(`.${e}`);
    });
  } catch {
    return false;
  }
}

export async function executeParsedCurl(parsed, options = {}) {
  if (!parsed?.ok) {
    return { ok: false, error: parsed?.error || "Invalid curl", executed: false };
  }

  const allowlist = options.allowlist || [];
  if (!isUrlAllowlisted(parsed.url, allowlist)) {
    return {
      ok: false,
      executed: false,
      error: `Target host not on execution allowlist: ${new URL(parsed.url).hostname}`,
      request: {
        method: parsed.method,
        url: parsed.url,
        headers: redactHeaders(parsed.headers),
      },
    };
  }

  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxBody = options.maxBody || DEFAULT_MAX_BODY;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers = { ...(parsed.headers || {}) };
  try {
    const res = await fetch(parsed.url, {
      method: parsed.method || "GET",
      headers,
      body: ["GET", "HEAD"].includes(parsed.method) ? undefined : parsed.body || undefined,
      signal: controller.signal,
    });

    const rawText = await res.text();
    const bodySnippet = redactString(rawText.slice(0, maxBody));
    const truncated = rawText.length > maxBody;

    return {
      ok: true,
      executed: true,
      status: res.status,
      statusText: res.statusText,
      passed: res.status >= 200 && res.status < 300,
      request: {
        method: parsed.method,
        url: parsed.url,
        headers: redactHeaders(parsed.headers),
        body: parsed.body ? redactString(parsed.body) : null,
      },
      response: {
        status: res.status,
        headers: redactHeaders(Object.fromEntries(res.headers.entries())),
        body_snippet: bodySnippet,
        truncated,
      },
      evidence: `${parsed.method} ${parsed.url} → HTTP ${res.status}${truncated ? " (body truncated)" : ""}`,
    };
  } catch (err) {
    return {
      ok: false,
      executed: true,
      error: err.name === "AbortError" ? `Request timed out after ${timeoutMs}ms` : err.message,
      request: {
        method: parsed.method,
        url: parsed.url,
        headers: redactHeaders(parsed.headers),
      },
      evidence: `${parsed.method} ${parsed.url} → error: ${err.message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { executeParsedCurl, isUrlAllowlisted, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_BODY };
}
