import { buildRequirementsFromStory } from "./requirements.js";
import { redactHeaders, redactString, redactBody } from "./redaction.js";

export function acTextNeedsApi(text) {
  const t = String(text || "").toLowerCase();
  if (/\b(curl|graphql|postman|request body|json response|restful|microservice)\b/.test(t)) return true;
  if (/\bhttps?:\/\//.test(t)) return true;
  if (/\/api\/|\bapi endpoint\b|\brest endpoint\b/.test(t)) return true;
  if (/\b(get|post|put|patch|delete)\s+\/[\w/-]+/.test(t)) return true;
  if (/\b(refund|payment|invoice|webhook|callback)\b/.test(t) && /\b(api|endpoint|request|http)\b/.test(t)) return true;
  if (/\b(status code|returns \d{3}|http \d{3})\b/.test(t) && /\b(api|endpoint|request|response|http)\b/.test(t)) return true;
  return false;
}

export function acTextNeedsWeb(text) {
  const t = String(text || "").toLowerCase();
  return /\b(web\s*page|webpage|\bui\b|browser|navigate|click|form submit|login page|dashboard|e2e|selenium|playwright|redirect|screen|button|viewport|reset link|email link)\b/.test(t);
}

export function acTextNeedsAuth(text) {
  const t = String(text || "").toLowerCase();
  return /\b(may view|may not|must not|shall not|only their own|cross-tenant|authorization|authorised|authorized|role|permission|admin may|customer may)\b/.test(t);
}

export function inferHumanInputNeeds(story, analystOutput, writerCases) {
  const requirements = buildRequirementsFromStory(story, writerCases, analystOutput);
  const acList = (requirements.acceptance_criteria?.length
    ? requirements.acceptance_criteria
    : requirements.testable_conditions.map((c) => c.text)).filter(Boolean);

  const stepsMatch = [story?.description || "", ...(story?.acceptance_criteria_list || [])].join("\n").match(
    /steps to reproduce[:\s]*\n([\s\S]*?)(?=\n\n|Environment:|Priority:|Component:|Acceptance Criteria:|$)/i
  );
  const steps = stepsMatch
    ? stepsMatch[1].split("\n").map((l) => l.replace(/^[\s\d.]+\s*/, "").trim()).filter(Boolean)
    : [];

  const textsToScan = [...acList, ...steps];
  const apiFor = [];
  const webFor = [];

  textsToScan.forEach((text, i) => {
    const acId = i < acList.length ? `AC-${i + 1}` : "steps";
    if (acTextNeedsApi(text)) apiFor.push(acId);
    if (acTextNeedsWeb(text)) webFor.push(acId);
  });

  const types = [];
  if (apiFor.length) types.push("api");
  if (webFor.length) types.push("webpage");

  const primary = types.length === 1 ? types[0] : types[0];
  const activeTypes = types;

  const action = activeTypes.length === 2
    ? "Provide curl and webpage URL — both API and UI surfaces are required"
    : activeTypes.length === 1 && activeTypes[0] === "api"
      ? "Paste a curl command so Test Data Extractor can build API datasets"
      : activeTypes.length === 1 && activeTypes[0] === "webpage"
        ? "Provide the webpage URL so Test Data Extractor can map UI test data"
        : null;

  const citeParts = [];
  if (activeTypes.includes("api") && apiFor.length) citeParts.push(`API signals in ${[...new Set(apiFor)].join(", ")}`);
  if (activeTypes.includes("webpage") && webFor.length) citeParts.push(`UI signals in ${[...new Set(webFor)].join(", ")}`);

  return {
    needsHumanInput: activeTypes.length > 0,
    types: activeTypes,
    primary,
    action,
    reason: citeParts.length ? citeParts.join(" · ") : "No API or UI test action in acceptance criteria",
    detected_from: [...new Set([...apiFor, ...webFor])].join(", ") || "acceptance criteria",
    requirements_snapshot: requirements.version,
  };
}

export function normalizeCurlInput(raw) {
  return String(raw || "").replace(/\\\s*\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

export function parseCurl(raw) {
  const curl = String(raw || "").trim();
  const text = normalizeCurlInput(curl);
  if (!text) return { ok: false, error: "Paste a curl command" };
  if (!/^curl\b/i.test(text)) return { ok: false, error: "Command must start with curl" };

  let method = "GET";
  const xMatch = text.match(/(?:-X|--request)\s+['"]?(\w+)['"]?/i);
  if (xMatch) method = xMatch[1].toUpperCase();

  let body = null;
  const dataMatch = text.match(/(?:--data(?:-raw|-binary)?|-d)\s+('([^']*)'|"([^"]*)"|(\{[^}]+\})|(\S+))/i);
  if (dataMatch) {
    body = dataMatch[2] ?? dataMatch[3] ?? dataMatch[4] ?? dataMatch[5] ?? "";
    if (method === "GET") method = "POST";
  }

  const headers = {};
  const headerRegex = /(?:-H|--header)\s+(['"])(.*?)\1/gi;
  let hm;
  while ((hm = headerRegex.exec(text)) !== null) {
    const colon = hm[2].indexOf(":");
    if (colon > 0) {
      headers[hm[2].slice(0, colon).trim()] = hm[2].slice(colon + 1).trim();
    }
  }

  let url = null;
  const urlFlag = text.match(/(?:--url)\s+(['"])(.*?)\1/i);
  if (urlFlag) url = urlFlag[2];
  if (!url) {
    const quoted = text.match(/['"](https?:\/\/[^'"]+)['"]/i);
    if (quoted) url = quoted[1];
  }
  if (!url) {
    const bare = text.match(/\bcurl\s+(?:-[A-Za-z]+\s+(?:'[^']*'|"[^"]*"|\S+)\s+)*(https?:\/\/\S+)/i);
    if (bare) url = bare[1].replace(/['"]$/, "");
  }
  if (!url) return { ok: false, error: "Could not find URL in curl — include https://…" };

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { ok: false, error: "Invalid URL in curl command" };
  }

  const auth = headers.Authorization || headers.authorization || "";

  return {
    ok: true,
    curl,
    method,
    url: parsedUrl.href,
    base_url: parsedUrl.origin,
    endpoint: parsedUrl.pathname + parsedUrl.search,
    headers,
    auth,
    body,
    source: "curl",
  };
}

export function formatCurlPreview(parsed) {
  if (!parsed?.ok) return "";
  const safe = {
    ...parsed,
    headers: redactHeaders(parsed.headers || {}),
    auth: parsed.auth ? "[REDACTED]" : "",
    body: parsed.body ? redactString(parsed.body) : parsed.body,
  };
  const headerLines = Object.entries(safe.headers || {}).map(([k, v]) => `  ${k}: ${v}`).join("\n");
  return `${safe.method} ${safe.url}\n${headerLines || "  (no headers)"}${safe.body ? `\n  body: ${redactBody(safe.body)}` : ""}`;
}

export function parseWebpageInput(urlRaw, titleRaw) {
  const raw = String(urlRaw || "").trim();
  if (!raw) return { ok: false, error: "Enter a webpage URL" };
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: "Invalid webpage URL — use https://…" };
  }
  if (!/^https?:$/i.test(parsed.protocol)) {
    return { ok: false, error: "Webpage URL must start with http:// or https://" };
  }
  return {
    ok: true,
    url: parsed.href,
    origin: parsed.origin,
    path: parsed.pathname + parsed.search,
    title: String(titleRaw || "").trim() || parsed.hostname + parsed.pathname,
    source: "webpage",
  };
}

export function humanInputTypeLabel(types) {
  if (!types?.length) return "input";
  return types.map((t) => (t === "api" ? "curl" : "webpage URL")).join(" + ");
}

export function orchestratorAwaitingLabel(need) {
  if (!need?.needsHumanInput) return "awaiting human input";
  const parts = [];
  if (need.types.includes("api")) parts.push("API curl");
  if (need.types.includes("webpage")) parts.push("webpage");
  return "awaiting " + parts.join(" + ");
}

export function waitingForHumanInputDescription(need) {
  if (!need?.needsHumanInput) return "human input";
  const parts = [];
  if (need.types.includes("api")) parts.push("curl");
  if (need.types.includes("webpage")) parts.push("webpage URL");
  return parts.join(" + ");
}

export function describeHumanInputNeed(need) {
  if (!need?.needsHumanInput) return "";
  return need.action || `Story requires ${humanInputTypeLabel(need.types)} for ${need.detected_from}.`;
}
