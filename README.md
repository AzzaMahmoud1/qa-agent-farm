# QA Agent Farm

Browser-based QA planning simulator with a multi-agent pipeline (Analyst → Writer → Data Extractor → Executor → Reviewer → Reporter), JIRA live fetch, and requirements paste mode. Agent 1 (Requirement Analyst) runs live via the Cursor Agent CLI.

## Model routing

| Role | Model ID |
|------|----------|
| Orchestrator | `claude-fable-5` (Claude Fable 5) |
| Validator + all worker agents | `claude-4.6-sonnet` (Claude Sonnet) |

Configured in `agents/registry.js` (`AGENT_MODEL_ROUTING`) and `.cursor/agents/*.md`.

## Requirements

- **Node.js >= 18.18** with `"type": "module"` in `package.json`
- Browser classic scripts (`lib/prerequisites.js`, samples) stay CJS-compatible; Node loads `lib/prerequisites.cjs` via `createRequire`
- Optional: JIRA credentials in `.env` for live ticket fetch
- For Cursor agent runs: enable **Claude Fable 5** and **Claude Sonnet** in Cursor Models settings

## Honest execution semantics (v0.3)

- Pipeline agent/validator loop is a **simulated** orchestrator (`orchestration_mode: simulated_pipeline`)
- `/api/execute` performs a **transport-only** HTTP call — HTTP 2xx is `transport_observed`, **not** a per-AC pass
- Webpage URLs are `pending_browser` until real browser evidence exists
- Secrets in curl/JSON (`api_key`, `access_token`, `password`, …) are redacted in UI/logs/exports
- NCA/ECC security gaps (injection, IDOR, URL manipulation, API exposure, auth bypass) block release when applicable
- Executor deny-by-default: no loopback, redirect re-allowlisted, rate limit + local/token auth + audit log

## Quick start

```bash
cp .env.example .env   # optional — fill JIRA credentials
npm run doctor
npm start
```

Open http://127.0.0.1:5173/simulator.html

## Scripts

| Command | Purpose |
|---------|---------|
| `npm start` | Run local server on port 5173 |
| `npm test` | Run requirements + evaluation fix tests |
| `npm run doctor` | Check Node version, files, and module health |
| `npm run check:modules` | Verify all production ES modules parse |

## Configuration

| Variable | Description |
|----------|-------------|
| `JIRA_URL` | JIRA base URL |
| `JIRA_USERNAME` | JIRA user email |
| `JIRA_API_TOKEN` | JIRA API token |
| `EXECUTOR_ALLOWLIST` | Comma-separated hosts allowed for `/api/execute` (default: localhost only) |
| `PORT` | Server port (default `5173`) |

## Security notes

- Static file serving uses an **allowlist** — dotfiles (`.env`, `.git`) are blocked
- JIRA API responses use **same-origin CORS** only (no wildcard)
- Curl **Authorization** values are **redacted** in UI, logs, and exports
- API execution is limited to **allowlisted hosts** via `EXECUTOR_ALLOWLIST`

## Project layout

```
agents/          # Pipeline agents (orchestrator, analyst, writer, …)
lib/             # Requirements parser, human-input, redaction, executor
js/              # Browser simulator entry
skills/          # Per-agent SKILL.md for Cursor
simulator.html   # UI shell
server.js        # Local dev server + JIRA proxy + execution endpoint
```

## Evaluation fixes (v0.2.0)

Addresses enterprise evaluation findings:

- **EVAL-001** — Module parse errors fixed; CI module checks added
- **EVAL-002** — Executor records HTTP evidence via `/api/execute`
- **EVAL-003** — Improved AC classification (auth rules, time limits, data tables)
- **EVAL-004** — Both API and UI surfaces routed when detected
- **EVAL-005** — Curl parser supports `--request` / `--header`; secrets redacted
- **EVAL-006** — Server hardening (allowlist, CORS, limits, security headers)
- **EVAL-007** — Fallback metrics are null until measured

## License

Private / unlicensed — internal use.
