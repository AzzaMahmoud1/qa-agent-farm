const https = require("https");

function loadEnv(filePath) {
  try {
    const fs = require("fs");
    const text = fs.readFileSync(filePath, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* optional .env */
  }
}

loadEnv(`${__dirname}/.env`);

function adfToText(node) {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(adfToText).join("");
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  const inner = (node.content || []).map(adfToText).join("");
  if (node.type === "paragraph" || node.type === "heading") return inner + "\n";
  if (node.type === "bulletList" || node.type === "orderedList") return inner;
  if (node.type === "listItem") return "• " + inner.trim() + "\n";
  return inner;
}

function extractAcceptanceCriteria(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const ac = [];
  let inAc = false;
  for (const line of lines) {
    if (/^acceptance criteria/i.test(line)) {
      inAc = true;
      continue;
    }
    if (inAc && /^(steps to reproduce|environment|priority|component|description)/i.test(line)) {
      break;
    }
    if (inAc && (line.startsWith("-") || line.startsWith("•") || /^\d+\./.test(line))) {
      ac.push(line.replace(/^[-•]\s*|\d+\.\s*/, "").trim());
    }
  }
  if (!ac.length) {
    for (const line of lines) {
      if (line.startsWith("-") || line.startsWith("•")) ac.push(line.replace(/^[-•]\s*/, "").trim());
    }
  }
  return ac;
}

function parseIssueKey(input) {
  if (!input) return null;
  const s = String(input).trim();

  try {
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s);
      const browse = u.pathname.match(/\/browse\/([A-Z][A-Z0-9]+-\d+)/i);
      if (browse) return browse[1].toUpperCase();
      const selected = u.searchParams.get("selectedIssue");
      if (selected) {
        const fromQuery = selected.match(/([A-Z][A-Z0-9]+-\d+)/i);
        if (fromQuery) return fromQuery[1].toUpperCase();
      }
    }
  } catch {
    /* not a valid URL */
  }

  const m = s.match(/([A-Z][A-Z0-9]+-\d+)/i);
  return m ? m[1].toUpperCase() : null;
}

function jiraRequest(path, options = {}) {
  const base = (process.env.JIRA_URL || "").replace(/\/$/, "");
  const user = process.env.JIRA_USERNAME;
  const token = process.env.JIRA_API_TOKEN;
  if (!base || !user || !token) {
    return Promise.reject(new Error("JIRA credentials missing. Copy .env.example to .env and fill in values."));
  }

  const auth = Buffer.from(`${user}:${token}`).toString("base64");
  const url = new URL(path, base);
  const timeoutMs = options.timeoutMs || 15000;
  const maxBytes = options.maxBytes || 1024 * 1024;

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Basic ${auth}`,
        },
      },
      (res) => {
        let data = "";
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            reject(new Error(`JIRA response exceeds ${maxBytes} bytes`));
            req.destroy();
            return;
          }
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode >= 400) {
            reject(new Error(`JIRA ${res.statusCode}: ${data.slice(0, 300)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`JIRA request timed out after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    req.end();
  });
}

async function fetchIssue(issueKey, options = {}) {
  const key = parseIssueKey(issueKey);
  if (!key) throw new Error("Invalid JIRA issue key");

  const fields = [
    "summary",
    "description",
    "priority",
    "components",
    "labels",
    "status",
    "issuetype",
  ].join(",");

  const raw = await jiraRequest(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=${fields}`);
  const f = raw.fields || {};
  const description = adfToText(f.description).trim();
  const acceptanceCriteria = extractAcceptanceCriteria(description);

  return {
    id: raw.key,
    key: raw.key,
    title: f.summary || key,
    description,
    priority: f.priority?.name || "Medium",
    status: f.status?.name || "Unknown",
    issueType: f.issuetype?.name || "Task",
    components: (f.components || []).map((c) => c.name),
    labels: f.labels || [],
    acceptance_criteria: acceptanceCriteria,
    acceptance_criteria_count: acceptanceCriteria.length || Math.max(1, Math.ceil(description.length / 120)),
    jira_url: `${(process.env.JIRA_URL || "").replace(/\/$/, "")}/browse/${key}`,
    fetched_at: new Date().toISOString(),
  };
}

module.exports = { fetchIssue, parseIssueKey, loadEnv };
