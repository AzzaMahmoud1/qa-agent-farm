import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fetchIssue, parseIssueKey, loadEnv, fetchAttachmentBinary } from "./jira.js";
import {
  recordRequirements,
  getRequirements,
  searchRequirements,
  diffAgainstStored,
  buildPriorKnowledgeBlock,
} from "./lib/knowledge-base.js";

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

const PUBLIC_DIRS = new Set(["agents", "js", "lib", "templates"]);
const PUBLIC_FILES = new Set([
  "simulator.html",
  "settings.html",
  "index.html",
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

/** host:port values this server answers to. Anything else is DNS rebinding. */
const ALLOWED_HOSTS = new Set([
  `127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, `${host}:${port}`,
].map((h) => h.toLowerCase()));

function isAllowedHostHeader(req) {
  return ALLOWED_HOSTS.has(String(req.headers.host || "").toLowerCase());
}

/** Only this server's own origin — not any other app on localhost. */
function allowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return null;
  try {
    const u = new URL(origin);
    if (u.protocol === "http:" && ALLOWED_HOSTS.has(u.host.toLowerCase())) return origin;
  } catch { /* ignore */ }
  return null;
}

/**
 * CSRF guard for state-changing API calls. "Local-only" endpoints check the
 * socket IP, but a browser on this machine is always loopback — so any web
 * page the user visits could POST here. Requiring application/json forces a
 * CORS preflight (which allowedOrigin rejects), and a present Origin must be
 * our own.
 */
function checkCsrf(req) {
  const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return { ok: false, status: 415, error: "Content-Type must be application/json" };
  if (req.headers.origin && !allowedOrigin(req)) return { ok: false, status: 403, error: "Cross-origin request rejected" };
  return { ok: true };
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
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
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

    if (pathname.startsWith("/api/")) {
      if (!isAllowedHostHeader(req)) {
        sendText(res, 403, "Forbidden host");
        return;
      }
      if (req.method === "POST") {
        const csrf = checkCsrf(req);
        if (!csrf.ok) {
          sendJson(res, req, csrf.status, { error: csrf.error });
          return;
        }
      }
    }

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

    // Requirements knowledge base: recall one ticket, search across all.
    if (pathname === "/api/knowledge" && req.method === "GET") {
      const id = url.searchParams.get("id");
      if (!id) { sendJson(res, req, 400, { error: "id is required" }); return; }
      sendJson(res, req, 200, { entry: getRequirements(id) });
      return;
    }
    if (pathname === "/api/knowledge/search" && req.method === "GET") {
      const q = url.searchParams.get("q") || "";
      sendJson(res, req, 200, { results: searchRequirements(q, { excludeId: url.searchParams.get("exclude") || undefined }) });
      return;
    }
    // Save a breakdown (used by the local/deterministic analyst path in the UI).
    if (pathname === "/api/knowledge" && req.method === "POST") {
      if (!isLocalRequester(req)) { sendJson(res, req, 403, { error: "Knowledge API is local-only" }); return; }
      try {
        const body = await readBody(req);
        const ticketId = String(body.ticketId || "").trim();
        if (!ticketId || !body.breakdown) { sendJson(res, req, 400, { error: "ticketId and breakdown are required" }); return; }
        const delta = diffAgainstStored(ticketId, body.breakdown);
        recordRequirements({ ticketId, title: body.title, breakdown: body.breakdown });
        sendJson(res, req, 200, { ok: true, delta });
      } catch (err) {
        sendJson(res, req, err.message?.includes("Invalid JSON") ? 400 : 500, { error: err.message });
      }
      return;
    }

    // Authed thumbnail proxy: the browser cannot send Jira credentials, so it
    // asks the server to fetch an attachment's bytes. Only Jira-host URLs pass.
    if (pathname === "/api/jira/attachment" && req.method === "GET") {
      const contentUrl = url.searchParams.get("url");
      if (!contentUrl) {
        sendJson(res, req, 400, { error: "url is required" });
        return;
      }
      try {
        const { buffer, mimeType } = await fetchAttachmentBinary(contentUrl, { timeoutMs: jiraTimeoutMs });
        res.writeHead(200, securityHeaders({ "Content-Type": mimeType, "Cache-Control": "no-store" }));
        res.end(buffer);
      } catch (err) {
        sendJson(res, req, 502, { error: err.message });
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
        // Download image + PDF attachments server-side (Jira auth) so the analyst
        // can pass them to a vision-capable runner. Text-only runners ignore them.
        const downloadAll = async (list) => {
          const out = [];
          for (const att of Array.isArray(list) ? list.slice(0, 6) : []) {
            if (!att?.contentUrl) continue;
            try {
              const { buffer, mimeType } = await fetchAttachmentBinary(att.contentUrl, { timeoutMs: jiraTimeoutMs });
              out.push({ filename: att.filename || "attachment", mimeType: att.mimeType || mimeType, base64: buffer.toString("base64") });
            } catch { /* skip an attachment that fails to download */ }
          }
          return out;
        };
        const images = await downloadAll(body.imageAttachments);
        const documents = await downloadAll(body.documentAttachments);
        // Recall prior requirements for this ticket + related ones from the KB,
        // and inject them so the analyst reasons with continuity across runs.
        const ticketId = String(body.ticketId || "").trim();
        const priorKnowledge = buildPriorKnowledgeBlock(ticketId, `${body.title || ""} ${ticketText}`.slice(0, 2000));
        const { runRequirementAnalyst } = await import("./src/agents/requirementAnalyst.js");
        const result = await runRequirementAnalyst(ticketText, { images, documents, priorKnowledge });
        // Persist the fresh breakdown so future runs benefit from it. Compute the
        // delta against the previously stored version BEFORE overwriting it.
        if (ticketId && result.parsed) {
          try {
            result.knowledge_delta = diffAgainstStored(ticketId, result.parsed);
            recordRequirements({ ticketId, title: body.title, breakdown: result.parsed });
          } catch { /* KB persistence is best-effort */ }
        }
        result.prior_knowledge_used = Boolean(priorKnowledge);
        sendJson(res, req, result.success === false ? 422 : 200, result);
      } catch (err) {
        const status = err.message?.includes("exceeds") || err.message?.includes("Invalid JSON") ? 400 : 500;
        sendJson(res, req, status, { error: err.message });
      }
      return;
    }

    if (pathname === "/api/agents/writer" && req.method === "POST") {
      if (!isLocalRequester(req)) {
        sendJson(res, req, 403, { error: "Writer API is local-only" });
        return;
      }
      try {
        const body = await readBody(req);
        if (!Array.isArray(body.analyst?.testable_conditions) || !body.analyst.testable_conditions.length) {
          sendJson(res, req, 400, { error: "analyst.testable_conditions is required" });
          return;
        }
        const { runLiveWriter } = await import("./src/agents/testWriter.js");
        const result = await runLiveWriter(body.analyst, String(body.ticketText || ""));
        sendJson(res, req, result.success === false ? 422 : 200, result);
      } catch (err) {
        const status = err.message?.includes("exceeds") || err.message?.includes("Invalid JSON") ? 400 : 500;
        sendJson(res, req, status, { error: err.message });
      }
      return;
    }

    if (pathname === "/api/agents/author" && req.method === "POST") {
      if (!isLocalRequester(req)) {
        sendJson(res, req, 403, { error: "Author API is local-only" });
        return;
      }
      try {
        const body = await readBody(req);
        const outline = body.outline;
        if (!outline?.id || outline.status !== "approved" || !Array.isArray(outline.tasks) || !outline.tasks.length) {
          sendJson(res, req, 400, { error: "An approved outline with tasks is required" });
          return;
        }
        let target;
        try { target = new URL(String(body.url || "")); } catch { target = null; }
        if (!target || !/^https?:$/.test(target.protocol)) {
          sendJson(res, req, 400, { error: "A target http(s) URL is required" });
          return;
        }
        const { runAuthorSession, makeLlmPlanner } = await import("./src/agents/liveAuthor.js");
        const { createPlaywrightDriver } = await import("./src/agents/playwrightDriver.js");
        const { callAgentRunner, extractSkillJson, effortForAttempt } = await import("./src/agents/requirementAnalyst.js");
        const skillText = fs.readFileSync(path.join(root, ".claude/skills/qa-author/SKILL.md"), "utf8").replace(/^---[\s\S]*?---\s*/, "");
        let driver;
        try {
          driver = await createPlaywrightDriver();
        } catch (err) {
          sendJson(res, req, 200, { success: false, blocked: true, runner: "live", status: "NEEDS_INPUT", outline_id: outline.id, blocked_reason: err.message, summary: err.message, steps: [], requirement_verdicts: {} });
          return;
        }
        const planner = makeLlmPlanner({
          skillText,
          call: (prompt) => callAgentRunner(prompt, effortForAttempt(1), { agent: "author" }),
          extractJson: extractSkillJson,
        });
        const secrets = { username: String(body.credentials?.username || ""), password: String(body.credentials?.password || "") };
        const result = await runAuthorSession({ outline, url: target.href, secrets, driver, planner, sessionId: `auth-${String(body.storyId || "story")}-${Date.now().toString(36)}` });
        sendJson(res, req, 200, result);
      } catch (err) {
        const status = err.message?.includes("exceeds") || err.message?.includes("Invalid JSON") ? 400 : 500;
        sendJson(res, req, status, { error: err.message });
      }
      return;
    }

    if (pathname === "/api/agents/analyst/health" && req.method === "GET") {
      const { resolveActiveProvider } = await import("./lib/llm-settings.js");
      let provider;
      let runnerError = null;
      try {
        provider = resolveActiveProvider();
      } catch (err) {
        runnerError = err.message;
      }
      const notes = {
        cursor_agent_cli: "Uses Cursor Agent CLI login (cursor-agent login) — routes through Cursor, not api.anthropic.com",
        anthropic_api: "Direct api.anthropic.com/v1/messages call",
        openai_api: "Direct api.openai.com/v1/chat/completions call",
        openrouter_api: "Direct openrouter.ai/api/v1/chat/completions call",
        custom_openai_compatible: "Direct call to a user-configured OpenAI-compatible endpoint",
      };
      const info = !provider
        ? {}
        : provider.runner === "cursor_agent_cli"
          ? {
            runner: provider.runner,
            binary: process.env.CURSOR_AGENT_BIN || "cursor-agent (auto-detected)",
            model: provider.model,
            effort: provider.effort,
            note: notes[provider.runner],
          }
          : {
            runner: provider.runner,
            model: provider.model,
            base_url: provider.baseUrl,
            api_key_configured: Boolean(provider.apiKey),
            note: notes[provider.runner],
          };
      sendJson(res, req, 200, { ok: !runnerError, ...info, ...(runnerError ? { error: runnerError } : {}) });
      return;
    }

    if (pathname === "/api/settings/llm" && req.method === "GET") {
      if (!isLocalRequester(req)) {
        sendJson(res, req, 403, { error: "Settings API is local-only" });
        return;
      }
      const { publicSettings } = await import("./lib/llm-settings.js");
      sendJson(res, req, 200, publicSettings());
      return;
    }

    if (pathname === "/api/settings/llm" && req.method === "POST") {
      if (!isLocalRequester(req)) {
        sendJson(res, req, 403, { error: "Settings API is local-only" });
        return;
      }
      try {
        const body = await readBody(req);
        const { KNOWN_RUNNERS, saveSettings, publicSettings } = await import("./lib/llm-settings.js");
        if (body.runner !== undefined && !KNOWN_RUNNERS.includes(body.runner)) {
          sendJson(res, req, 400, { error: `runner must be one of: ${KNOWN_RUNNERS.join(", ")}` });
          return;
        }
        if (body.providers && typeof body.providers !== "object") {
          sendJson(res, req, 400, { error: "providers must be an object" });
          return;
        }
        saveSettings({ runner: body.runner, providers: body.providers });
        sendJson(res, req, 200, publicSettings());
      } catch (err) {
        const status = err.message?.includes("exceeds") || err.message?.includes("Invalid JSON") ? 400 : 500;
        sendJson(res, req, status, { error: err.message });
      }
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
      // Local dev simulator: never let the browser reuse a stale ES module —
      // a cached copy of a since-fixed module silently breaks the whole app.
      res.writeHead(200, securityHeaders({
        "Content-Type": types[ext] || "text/plain",
        "Cache-Control": "no-store",
      }));
      res.end(data);
    });
  })
  .listen(port, host, () => {
    const configured = Boolean(process.env.JIRA_URL && process.env.JIRA_USERNAME && process.env.JIRA_API_TOKEN);
    console.log(`QA Agent Farm simulator: http://${host}:${port}`);
    console.log(configured ? "JIRA API: configured" : "JIRA API: missing credentials (.env)");
    console.log(`Executor: allowlist=${parseExecutorAllowlist().join(",") || "(empty)"} loopback=${allowLoopback ? "on" : "off"} token=${executeToken ? "required" : "local-only"}`);
  });
