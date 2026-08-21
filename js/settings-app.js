const PROVIDER_META = [
  {
    id: "cursor_agent_cli",
    label: "Cursor Agent CLI",
    icon: "ti-terminal-2",
    desc: "Default. Uses your local <code>cursor-agent login</code> session — no API key needed here.",
    fields: ["model", "effort"],
  },
  {
    id: "anthropic_api",
    label: "Anthropic (Claude)",
    icon: "ti-sparkles",
    desc: "Direct call to api.anthropic.com. Get a key at <a href=\"https://console.anthropic.com\" target=\"_blank\" rel=\"noopener\">console.anthropic.com</a>.",
    fields: ["apiKey", "model"],
  },
  {
    id: "openai_api",
    label: "OpenAI",
    icon: "ti-brand-openai",
    desc: "Direct call to api.openai.com. Get a key at <a href=\"https://platform.openai.com/api-keys\" target=\"_blank\" rel=\"noopener\">platform.openai.com</a>.",
    fields: ["apiKey", "model"],
  },
  {
    id: "openrouter_api",
    label: "OpenRouter",
    icon: "ti-route",
    desc: "One key routes to many providers/models via <a href=\"https://openrouter.ai\" target=\"_blank\" rel=\"noopener\">openrouter.ai</a>.",
    fields: ["apiKey", "model"],
  },
  {
    id: "custom_openai_compatible",
    label: "Custom (OpenAI-compatible)",
    icon: "ti-plug",
    desc: "Any OpenAI-compatible chat-completions endpoint — Ollama, LM Studio, vLLM, Groq, Together, etc.",
    fields: ["baseUrl", "apiKey", "model"],
  },
];

const FIELD_LABEL = { apiKey: "API key", model: "Model", baseUrl: "Base URL", effort: "Reasoning effort" };

let settings = null;
// Fields the user has actually edited this session, keyed "provider.field" —
// only these get sent on save, so an unedited masked apiKey never overwrites
// the saved one with a blank value.
const dirty = new Set();

function el(id) { return document.getElementById(id); }

function fieldPlaceholder(providerId, field, provider) {
  if (field === "apiKey") return provider.configured ? provider.apiKeyMasked : "sk-...";
  if (field === "baseUrl") return "http://localhost:11434/v1/chat/completions";
  if (field === "model") {
    return {
      cursor_agent_cli: "claude-sonnet-5",
      anthropic_api: "claude-sonnet-5",
      openai_api: "gpt-5",
      openrouter_api: "anthropic/claude-sonnet-5",
      custom_openai_compatible: "llama3",
    }[providerId] || "";
  }
  return "";
}

function renderFieldInput(providerId, field, provider) {
  const value = provider[field] || "";
  const placeholder = fieldPlaceholder(providerId, field, provider);
  if (field === "effort") {
    const opts = ["low", "medium", "high", "xhigh", "max"];
    return `<select class="input" data-provider="${providerId}" data-field="${field}">
      ${opts.map((o) => `<option value="${o}" ${value === o ? "selected" : ""}>${o}</option>`).join("")}
    </select>`;
  }
  const type = field === "apiKey" ? "password" : "text";
  const safeValue = field === "apiKey" ? "" : escapeHtml(value);
  return `<input class="input" type="${type}" data-provider="${providerId}" data-field="${field}" placeholder="${escapeHtml(placeholder)}" value="${safeValue}" autocomplete="off" spellcheck="false">`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderProviders() {
  const container = el("providers");
  container.innerHTML = PROVIDER_META.map((meta) => {
    const provider = settings.providers[meta.id] || {};
    const isActive = settings.runner === meta.id;
    return `
    <div class="panel-card" data-provider-card="${meta.id}">
      <div class="panel-head">
        <label class="provider-select">
          <input type="radio" name="active-runner" value="${meta.id}" ${isActive ? "checked" : ""}>
          <i class="ti ${meta.icon}"></i> ${meta.label}
        </label>
        <span>
          ${isActive ? '<span class="badge active">Active</span>' : ""}
          ${meta.id === "cursor_agent_cli" ? "" : `<span class="badge ${provider.configured ? "on" : ""}">${provider.configured ? "Key configured" : "No key set"}</span>`}
        </span>
      </div>
      <div class="panel-body">
        <p class="hint" style="margin:0 0 .75rem">${meta.desc}</p>
        <div class="two-col">
          ${meta.fields.map((field) => `
            <div class="field">
              <span class="field-label">${FIELD_LABEL[field]}</span>
              ${renderFieldInput(meta.id, field, provider)}
            </div>
          `).join("")}
        </div>
      </div>
    </div>`;
  }).join("");

  container.querySelectorAll("input.input, select.input").forEach((input) => {
    input.addEventListener("input", () => {
      dirty.add(`${input.dataset.provider}.${input.dataset.field}`);
    });
  });
  container.querySelectorAll('input[name="active-runner"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      settings.runner = radio.value;
      dirty.add("__runner__");
      renderProviders();
    });
  });
}

async function loadSettings() {
  const res = await fetch("/api/settings/llm");
  settings = await res.json();
  dirty.clear();
  renderProviders();
}

async function loadHealth() {
  const dot = el("health-dot");
  const text = el("health-text");
  try {
    const res = await fetch("/api/agents/analyst/health");
    const data = await res.json();
    dot.className = "status-dot " + (data.ok ? "ok" : "err");
    if (!data.ok) {
      text.textContent = data.error || "Runner misconfigured";
      return;
    }
    const parts = [`runner: ${data.runner}`, `model: ${data.model}`];
    if (data.runner === "cursor_agent_cli") {
      parts.push(`effort: ${data.effort}`);
    } else {
      parts.push(data.api_key_configured ? "key configured" : "no key set");
    }
    text.textContent = parts.join(" · ");
  } catch (err) {
    dot.className = "status-dot err";
    text.textContent = "Could not reach server: " + err.message;
  }
}

function collectPayload() {
  const payload = { providers: {} };
  if (dirty.has("__runner__")) payload.runner = settings.runner;
  document.querySelectorAll("#providers input.input, #providers select.input").forEach((input) => {
    const key = `${input.dataset.provider}.${input.dataset.field}`;
    if (!dirty.has(key)) return;
    payload.providers[input.dataset.provider] = payload.providers[input.dataset.provider] || {};
    payload.providers[input.dataset.provider][input.dataset.field] = input.value;
  });
  return payload;
}

async function saveSettings() {
  const statusEl = el("save-status");
  statusEl.className = "save-status";
  statusEl.textContent = "Saving…";
  try {
    const payload = collectPayload();
    const res = await fetch("/api/settings/llm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    settings = data;
    dirty.clear();
    renderProviders();
    statusEl.className = "save-status ok";
    statusEl.textContent = "Saved";
    loadHealth();
  } catch (err) {
    statusEl.className = "save-status err";
    statusEl.textContent = "Failed to save: " + err.message;
  }
}

el("btn-save").addEventListener("click", saveSettings);

(async function init() {
  await loadSettings();
  await loadHealth();
})();
