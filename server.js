import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fetchIssue, parseIssueKey, loadEnv } from "./jira.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(__dirname, ".env"));

const root = __dirname;
const port = Number(process.env.PORT) || 5173;
const host = process.env.HOST || "127.0.0.1";
const maxBodyBytes = Number(process.env.MAX_BODY_BYTES) || 1024 * 1024;
const jiraTimeoutMs = Number(process.env.JIRA_TIMEOUT_MS) || 15000;
const executeTimeoutMs = Number(process.env.EXECUTE_TIMEOUT_MS) || 15000;
const executeRateLimit = Number(process.env.EXECUTE_RATE_LIMIT) || 10;
const executeRateWindowMs = Number(process.env.EXECUTE_RATE_WINDOW_MS) || 60_000;
const executeToken = process.env.EXECUTE_API_TOKEN || "";
const allowLoopback = process.env.EXECUTOR_ALLOW_LOOPBACK === "1";

const types = {
  ".html": "text/html",
  ".jsx": "text/javascript",
  ".js": "text/javascript",
  ".cjs": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const PUBLIC_DIRS = new Set(["agents", "js", "lib", "skills", "templates"]);
const PUBLIC_FILES = new Set([
  "simulator.html",
  "index.html",
  "requirements-sample.js",
  "report-docx.js",
]);

const executeBuckets = new Map();
const executeAuditLog = [];

function securityHeaders(extra = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://fonts.googleapis.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    ...extra,
  };
}

function allowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return null;
  try {
    const u = new URL(origin);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return origin;
    if (u.origin === `http://${host}:${port}` || u.origin === `http://127.0.0.1:${port}`) return origin;
  } catch { /* ignore */ }
  return null;
}

function sendJson(res, req, status, body) {
  const headers = securityHeaders({
    "Content-Type": "application/json",
  });
  const origin = allowedOrigin(req);
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  headers.Vary = "Origin";
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function sendText(res, status, body, contentType = "text/plain") {
  res.writeHead(status, securityHeaders({ "Content-Type": contentType }));
  res.end(body);
}

function readBody(req, limit = maxBodyBytes) {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error(`Request body exceeds ${limit} bytes`));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function isPublicStaticPath(relPath) {
  const normalized = path.normalize(relPath).replace(/\\/g, "/");
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) return false;
  const base = path.basename(normalized);
  if (base.startsWith(".")) return false;
  if (PUBLIC_FILES.has(normalized)) return true;
  const top = normalized.split("/")[0];
  return PUBLIC_DIRS.has(top);
}

function resolveStaticFile(pathname) {
  const rel = pathname === "/" ? "simulator.html" : pathname.replace(/^\//, "");
  if (!isPublicStaticPath(rel)) return null;
  const file = path.join(root, rel);
  const resolved = path.resolve(file);
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

function parseExecutorAllowlist() {
  const raw = process.env.EXECUTOR_ALLOWLIST || "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function clientIp(req) {
  return req.socket?.remoteAddress || "unknown";
}

function isLocalRequester(req) {
  const ip = clientIp(req);
  return ip === "127.0.0.1" || ip === "::1" || ip === ":ffff:127.0.0.1";
}

function checkExecuteAuth(req) {
  if (executeToken) {
    const provided = req.headers["x-execute-token"] || "";
    if (provided !== executeToken) {
      return { ok: false, error: "Missing or invalid X-Execute-Token" };
    }
    return { ok: true };
  }
  // No token configured: only local loopback callers may execute
  if (!isLocalRequester(req)) {
    return { ok: false, error: "EXECUTE_API_TOKEN required for non-local execute calls" };
  }
  return { ok: true };
}

function checkExecuteRateLimit(req) {
  const ip = clientIp(req);
  const now = Date.now();
  let bucket = executeBuckets.get(ip);
  if (!bucket || now - bucket.windowStart > executeRateWindowMs) {
    bucket = { windowStart: now, count: 0 };
    executeBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  if (bucket.count > executeRateLimit) {
    return { ok: false, error: `Rate limit exceeded (${executeRateLimit}/${executeRateWindowMs}ms)` };
  }
  return { ok: true, remaining: executeRateLimit - bucket.count };
}

function pushAudit(entry) {
  executeAuditLog.push(entry);
  if (executeAuditLog.length > 200) executeAuditLog.shift();
  console.log("[execute-audit]", JSON.stringify(entry));
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${host}:${port}`);
    const pathname = url.pathname;

    if (req.method === "OPTIONS" && pathname.startsWith("/api/")) {
      const origin = allowedOrigin(req);
      if (!origin) {
        sendText(res, 403, "Forbidden");
        return;
      }
      res.writeHead(204, securityHeaders({
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Execute-Token",
        Vary: "Origin",
      }));
      res.end();
      return;
    }

    if (pathname === "/api/jira/health" && req.method === "GET") {
      const configured = Boolean(
        process.env.JIRA_URL && process.env.JIRA_USERNAME && process.env.JIRA_API_TOKEN
      );
      sendJson(res, req, 200, { ok: true, configured });
      return;
    }

    if (pathname === "/api/jira/issue" && req.method === "GET") {
      const key = parseIssueKey(url.searchParams.get("key") || url.searchParams.get("url"));
      if (!key) {
        sendJson(res, req, 400, { error: "Missing or invalid issue key" });
        return;
      }
      try {
        const issue = await fetchIssue(key, { timeoutMs: jiraTimeoutMs });
        sendJson(res, req, 200, issue);
      } catch (err) {
        sendJson(res, req, 502, { error: err.message });
      }
      return;
    }

    if (pathname === "/api/jira/issue" && req.method === "POST") {
      try {
        const body = await readBody(req);
        const key = parseIssueKey(body.key || body.url);
        if (!key) {
          sendJson(res, req, 400, { error: "Missing or invalid issue key" });
          return;
        }
        const issue = await fetchIssue(key, { timeoutMs: jiraTimeoutMs });
        sendJson(res, req, 200, issue);
      } catch (err) {
        const status = err.message.includes("exceeds") || err.message.includes("Invalid JSON") ? 400 : 502;
        sendJson(res, req, status, { error: err.message });
      }
      return;
    }

    if (pathname === "/api/agents/analyst" && req.method === "POST") {
      if (!isLocalRequester(req)) {
        sendJson(res, req, 403, { error: "Analyst API is local-only" });
        return;
      }
      try {
        const body = await readBody(req);
        const ticketText = body.ticketText || body.ticket || body.text || "";
        if (!String(ticketText).trim()) {
          sendJson(res, req, 400, { error: "ticketText is required" });
          return;
        }
        const { runRequirementAnalyst } = await import("./src/agents/requirementAnalyst.js");
        const result = await runRequirementAnalyst(ticketText);
        sendJson(res, req, result.success === false ? 422 : 200, result);
      } catch (err) {
        const status = err.message?.includes("exceeds") || err.message?.includes("Invalid JSON") ? 400 : 500;
        sendJson(res, req, status, { error: err.message });
      }
      return;
    }

    if (pathname === "/api/agents/analyst/health" && req.method === "GET") {
      sendJson(res, req, 200, {
        ok: true,
        runner: "cursor_agent_cli",
        binary: process.env.CURSOR_AGENT_BIN || "cursor-agent (auto-detected)",
        model: process.env.ANALYST_MODEL || "claude-sonnet-5",
        effort: process.env.ANALYST_EFFORT || "high",
        note: "Uses Cursor Agent CLI login (cursor-agent login) — routes through Cursor, not api.anthropic.com",
      });
      return;
    }

    if (pathname === "/api/execute/audit" && req.method === "GET") {
      if (!isLocalRequester(req)) {
        sendJson(res, req, 403, { error: "Audit log is local-only" });
        return;
      }
      sendJson(res, req, 200, { entries: executeAuditLog.slice(-50) });
      return;
    }

    if (pathname === "/api/execute" && req.method === "POST") {
      const auth = checkExecuteAuth(req);
      if (!auth.ok) {
        pushAudit({ at: new Date().toISOString(), event: "auth_denied", ip: clientIp(req), error: auth.error });
        sendJson(res, req, 401, { error: auth.error });
        return;
      }
      const rate = checkExecuteRateLimit(req);
      if (!rate.ok) {
        pushAudit({ at: new Date().toISOString(), event: "rate_limited", ip: clientIp(req) });
        sendJson(res, req, 429, { error: rate.error });
        return;
      }
      try {
        const body = await readBody(req);
        const { parseCurl } = await import("./lib/human-input.js");
        const { executeParsedCurl } = await import("./lib/http-executor.js");
        const parsed = parseCurl(body.curl || "");
        if (!parsed.ok) {
          sendJson(res, req, 400, { error: parsed.error });
          return;
        }
        const result = await executeParsedCurl(parsed, {
          allowlist: parseExecutorAllowlist(),
          timeoutMs: executeTimeoutMs,
          allowLoopback,
        });
        pushAudit({
          at: new Date().toISOString(),
          event: result.ok ? "execute_ok" : "execute_fail",
          ip: clientIp(req),
          host: (() => { try { return new URL(parsed.url).hostname; } catch { return null; } })(),
          status: result.status || null,
          error: result.error || null,
        });
        sendJson(res, req, result.ok ? 200 : 502, result);
      } catch (err) {
        const status = err.message.includes("exceeds") || err.message.includes("Invalid JSON") ? 400 : 500;
        pushAudit({ at: new Date().toISOString(), event: "execute_error", ip: clientIp(req), error: err.message });
        sendJson(res, req, status, { error: err.message });
      }
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendText(res, 405, "Method not allowed");
      return;
    }

    const file = resolveStaticFile(pathname);
    if (!file) {
      sendText(res, 404, "Not found");
      return;
    }

    fs.readFile(file, (err, data) => {
      if (err) {
        sendText(res, 404, "Not found");
        return;
      }
      const ext = path.extname(file);
      res.writeHead(200, securityHeaders({ "Content-Type": types[ext] || "text/plain" }));
      res.end(data);
    });
  })
  .listen(port, host, () => {
    const configured = Boolean(process.env.JIRA_URL && process.env.JIRA_USERNAME && process.env.JIRA_API_TOKEN);
    console.log(`QA Agent Farm simulator: http://${host}:${port}`);
    console.log(configured ? "JIRA API: configured" : "JIRA API: missing credentials (.env)");
    console.log(`Executor: allowlist=${parseExecutorAllowlist().join(",") || "(empty)"} loopback=${allowLoopback ? "on" : "off"} token=${executeToken ? "required" : "local-only"}`);
  });
