/** Execute allowlisted HTTP requests and return redacted evidence. */

import { redactHeaders, redactString, redactBody } from "./redaction.js";

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_BODY = 64 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "metadata.google.internal",
  "169.254.169.254",
]);

function isPrivateOrLoopbackHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTS.has(host) || BLOCKED_HOSTS.has(hostname)) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (/^127\.\d+\.\d+\.\d+$/.test(host)) return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)) return true;
  if (/^169\.254\.\d+\.\d+$/.test(host)) return true;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return true;
  return false;
}

/**
 * Allowlist check. Loopback/private hosts are denied unless allowLoopback is true
 * AND the host is explicitly listed in allowlist (or allowlist includes "localhost").
 */
export function isUrlAllowlisted(url, allowlist, options = {}) {
  try {
    const u = new URL(url);
    if (!/^https?:$/i.test(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    const list = (allowlist || []).map((e) => String(e).toLowerCase().trim()).filter(Boolean);
    const allowLoopback = options.allowLoopback === true;

    if (isPrivateOrLoopbackHost(host)) {
      if (!allowLoopback) return false;
      return list.some((e) => host === e || host.endsWith(`.${e}`) || e === "localhost" || e === "127.0.0.1");
    }

    if (!list.length) return false;
    return list.some((entry) => host === entry || host.endsWith(`.${entry}`));
  } catch {
    return false;
  }
}

function auditEntry(event, detail) {
  return {
    at: new Date().toISOString(),
    event,
    ...detail,
  };
}

async function fetchNoAutoRedirect(url, init, allowlist, options, redirectsLeft, audit) {
  const res = await fetch(url, { ...init, redirect: "manual" });
  const status = res.status;

  if (status >= 300 && status < 400) {
    const location = res.headers.get("location");
    if (!location) {
      audit.push(auditEntry("redirect_missing_location", { from: url, status }));
      return { res, finalUrl: url };
    }
    let nextUrl;
    try {
      nextUrl = new URL(location, url).href;
    } catch {
      audit.push(auditEntry("redirect_invalid", { from: url, location }));
      throw new Error("Invalid redirect Location header");
    }
    if (redirectsLeft <= 0) {
      audit.push(auditEntry("redirect_limit", { from: url, to: nextUrl }));
      throw new Error("Too many redirects");
    }
    if (!isUrlAllowlisted(nextUrl, allowlist, options)) {
      audit.push(auditEntry("redirect_blocked", { from: url, to: nextUrl }));
      throw new Error(`Redirect target not on allowlist: ${new URL(nextUrl).hostname}`);
    }
    audit.push(auditEntry("redirect_follow", { from: url, to: nextUrl, status }));
    return fetchNoAutoRedirect(nextUrl, init, allowlist, options, redirectsLeft - 1, audit);
  }

  return { res, finalUrl: url };
}

export async function executeParsedCurl(parsed, options = {}) {
  const audit = [];
  if (!parsed?.ok) {
    return { ok: false, error: parsed?.error || "Invalid curl", executed: false, audit };
  }

  const allowlist = options.allowlist || [];
  const allowLoopback = options.allowLoopback === true;
  audit.push(auditEntry("execute_request", {
    method: parsed.method,
    host: (() => { try { return new URL(parsed.url).hostname; } catch { return null; } })(),
  }));

  if (!isUrlAllowlisted(parsed.url, allowlist, { allowLoopback })) {
    audit.push(auditEntry("allowlist_denied", { url_host: (() => { try { return new URL(parsed.url).hostname; } catch { return null; } })() }));
    return {
      ok: false,
      executed: false,
      error: `Target host not on execution allowlist: ${new URL(parsed.url).hostname}`,
      request: {
        method: parsed.method,
        url: parsed.url,
        headers: redactHeaders(parsed.headers),
      },
      audit,
    };
  }

  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxBody = options.maxBody || DEFAULT_MAX_BODY;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers = { ...(parsed.headers || {}) };
  try {
    const init = {
      method: parsed.method || "GET",
      headers,
      body: ["GET", "HEAD"].includes(String(parsed.method || "GET").toUpperCase())
        ? undefined
        : parsed.body || undefined,
      signal: controller.signal,
    };

    const { res, finalUrl } = await fetchNoAutoRedirect(
      parsed.url,
      init,
      allowlist,
      { allowLoopback },
      maxRedirects,
      audit,
    );

    const rawText = await res.text();
    const bodySnippet = redactBody(rawText.slice(0, maxBody));
    const truncated = rawText.length > maxBody;
    const httpOk = res.status >= 200 && res.status < 300;

    audit.push(auditEntry("execute_response", { status: res.status, final_host: new URL(finalUrl).hostname }));

    return {
      ok: true,
      executed: true,
      status: res.status,
      statusText: res.statusText,
      // Transport observation only — NOT a business/AC pass
      http_ok: httpOk,
      assertion_level: "transport_only",
      passed: false,
      request: {
        method: parsed.method,
        url: parsed.url,
        final_url: finalUrl,
        headers: redactHeaders(parsed.headers),
        body: parsed.body != null ? redactBody(parsed.body) : null,
      },
      response: {
        status: res.status,
        headers: redactHeaders(Object.fromEntries(res.headers.entries())),
        body_snippet: typeof bodySnippet === "string" ? bodySnippet : JSON.stringify(bodySnippet),
        truncated,
      },
      evidence: `${parsed.method} ${parsed.url} → HTTP ${res.status} (transport observed; per-AC assertions not evaluated)${truncated ? " (body truncated)" : ""}`,
      audit,
    };
  } catch (err) {
    audit.push(auditEntry("execute_error", { message: err.message }));
    return {
      ok: false,
      executed: true,
      error: err.name === "AbortError" ? `Request timed out after ${timeoutMs}ms` : err.message,
      assertion_level: "transport_only",
      passed: false,
      request: {
        method: parsed.method,
        url: parsed.url,
        headers: redactHeaders(parsed.headers),
      },
      evidence: `${parsed.method} ${parsed.url} → error: ${err.message}`,
      audit,
    };
  } finally {
    clearTimeout(timer);
  }
}

export { BLOCKED_HOSTS, isPrivateOrLoopbackHost, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_BODY, DEFAULT_MAX_REDIRECTS };
