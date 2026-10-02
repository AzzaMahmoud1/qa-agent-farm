# QA Agent Farm

Browser-based QA planning simulator with a multi-agent pipeline, JIRA live fetch, and requirements paste mode. Agent 1 (Requirement Analyst) runs live via a pluggable runner — the Cursor Agent CLI (default) or a direct Anthropic API call.

Inspired by mabl-style **Plan → Approve → Author (Plan→Act→Reflect)** — without cloning proprietary auto-heal. The farm owns its own durable gates, honest terminal states, and evidence-based execution.

## Target pipeline

```text
Analyst → (human gate) → Writer(outlines) → (approve) → Data Extractor → Author → Executor → Reviewer → Reporter
                                                              │
                                                              └─ always runs; source = human curl/URL or story context
```

```mermaid
flowchart TD
  start[Ticket or paste] --> orch[Orchestrator]
  orch --> analyst[Analyst LIVE via prompt]
  analyst --> valA[Validator MAIN GATE]
  valA -->|fail| retryA[Retry Analyst or abort]
  valA -->|pass| actions{Analyst orchestrator_actions}
  actions -->|blocking ASK_HUMAN| human[Human typed answers]
  human --> recheck[Reviewer recheck vs asks]
  recheck -->|rejected| human
  recheck -->|accepted| writer
  actions -->|PROCEED| writer[Writer outlines]
  writer --> approve[Human Approve outlines]
  approve --> data[Data Extractor]
  data --> author[Author Plan Act Reflect]
  author -->|status REVIEW| exec[Executor]
  author -->|stub PLAN_READY or BUILDING| hold[Pipeline hold no COMPLETE]
  exec --> rev[Reviewer coverage]
  rev --> rep[Reporter]
  rep --> done[COMPLETE]
```

| Agent | Role |
|-------|------|
| **Orchestrator** | Only entry point; assigns workers; **executes Analyst actions** (does not invent readiness) |
| **Analyst** | **Readiness main gate** — ACs, gaps, prereqs, `orchestrator_actions` via prompt |
| **Writer** | Emits `test_outlines` (primary) + GWT docs; human Approve/Reject before Author |
| **Data Extractor** | Always runs; builds datasets / oracles from human input or story context |
| **Author** | Builds executable steps from **approved** outlines (Playwright stub — cannot COMPLETE yet) |
| **Executor** | Transport / evidence observation (honest HTTP / pending browser) |
| **Reviewer** | Coverage + evidence review; also **rechecks human input vs Analyst asks** |
| **Reporter** | SEHA-style summary from real artifacts |

`Writer` stops treating offline Given/When/Then as the primary unblock for Author. Outlines + human approval do. Legacy GWT may remain as documentation only.

Trigger a run with `qa:`, `test:`, `ticket:`, or “write tests for” / “review this ticket”. Worker subagents run **only** when the orchestrator dispatches them.

## `.claude/` folder (keep it)

Claude Code dispatch config — the interactive pipeline. **Not** the simulator runtime; code changes live under `agents/`, `src/`, `js/`.

| Path | Purpose |
|------|---------|
| `.claude/agents/*.md` | Subagent entrypoints Claude Code can dispatch (`qa-orchestrator`, `qa-analyst`, …) |
| `.claude/skills/qa-*/SKILL.md` | Per-role rules for those subagents |
| `.claude/skills/qa-analyst/analysis/*_analysis/SKILL.md` | The analysis skills (testability gate first) the Analyst runs as isolated grounded passes; shared rules in `COMMON.md` |
| `.claude/skills/qa-analyst/template.md` | Output layout of `test-artifacts/<ISSUE_ID>-requirements.md` |
| `.claude/skills/qa-analyst/jira-review.md` | Testing Team review of a Jira story (rubric-based; posts only after human approval) |
| `CLAUDE.md` | Triggers (`qa:` / `test:` / `ticket:`) + "orchestrator-only dispatch" |

**Do not remove.** Without it, Claude Code cannot run the farm as subagents.

### Analyst analysis skills

Analysis rules live in **one place** — `.claude/skills/qa-analyst/analysis/` — and are applied as grounded, isolated passes by both the `qa-analyst` subagent and the simulator's JS Analyst (`src/agents/requirementAnalyst.js`). `COMMON.md` holds the rules every pass shares (grounding, status, confidence, untrusted input); the loader prefixes it to each skill, so each `SKILL.md` states only its own job.

| Order | Skill | Runs | Output |
|---|---|---|---|
| 1 | `testability_analysis` | always — **the gate** | ISTQB CTAL-TA criteria → score/verdict computed in code |
| 2 | `requirements_analysis` | always | grounded acceptance criteria + per-criterion conflicts |
| 3 | `risk_analysis` | always (advisory) | likelihood × impact → `P0–P3` derived in code |
| 4 | `test_gap_analysis` | always (advisory) | technique × element conditions the checklist must cover |
| 5 | `source_analysis` | only with a diff | changed surfaces + regression areas |
| — | `root_cause_analysis` | failure investigation (lives in `qa-reviewer/analysis/`) | 5-Whys chain, evidenced vs hypothesis |

What code enforces, so the model doesn't grade itself:

- **Grounding** (`src/agents/grounding.js`) — every finding's quote must appear verbatim in the story or it is dropped. Image/PDF-derived findings are kept only when attachments were actually sent, and are marked provisional (human-confirmed).
- **Skill rules** (`src/agents/skillChecks.js`) — testability scoring + gate; risk lists that rate everything high×high, single-technique gap lists, and root-cause chains without evidence are flagged or dropped. Any violation forces human review.
- **No invented priority** — an unknown likelihood/impact yields no risk, never a default.
- **Security context** — login/session/API stories get the NCA ECC failure modes (`lib/nca-controls.js`) as prompts for the risk pass; a risk still needs a story quote.

Checklist lines in the breakdown come in three kinds: grounded (quoted from the story), `[Provisional]` (a safe default pending PO), and `[Standing]` (farm rules such as the baseline "UI is designed properly" TC).

> Claude Code is the only host. A former `.cursor/` mirror (+ `.cursorrules`) was removed when the skills were consolidated into one folder; recover it from git history if Cursor support is ever needed again.

## Hard gates (P0)

**Analyst prompt owns readiness (MAIN GATE in the prompt).** The same contract is a **second gate** in Validator (+ Writer/Author/Reviewer refuse invalid readiness). Orchestrator executes only **validated** actions. Vague ASK / bad PROCEED → Validator reject → retry → escalate to human.

### 0. Testability gate (first pass)

```text
score = Σ weight × (met 1 | partial 0.5 | not_met 0)      # computed in code
75–100 → TEST_READY        proceed
51–74  → NEEDS_REFINEMENT  proceed; defects carried forward; confidence ≤ medium
0–50   → NOT_TEST_READY    HOLD — extraction skipped, defects returned to PO
US-3 (testable AC) or T-2 (measurable) not_met → NOT_TEST_READY regardless of score
```

A blocking verdict always requires human confirmation. Regression: `test/analyst-skill-checks.js`, `test/analyst-golden.js`.

### 1. Zero-AC kill switch

```text
IF validated testable_conditions.length === 0:
  pipeline_state = NEEDS_INPUT
  ask human for testable acceptance criteria / clarified intent
  FORBID: placeholder TC-01, Writer, Author, run_end(success)
```

Regression: `test/zero-ac-gate.js`.

### 2. Prerequisites cannot bypass empty ACs

`submitPrerequisites()` may only unlock Writer when:

```text
testable_conditions.length > 0
AND missing_blocking_prereqs.length === 0
AND Reviewer human-input recheck = accepted
```

### 3. Human-input recheck (Reviewer)

After the human submits prerequisites:

1. Reviewer maps each answer to Analyst blocking asks / `ASK_HUMAN`
2. **Blames** mismatches (empty, placeholder, wrong shape: URL / curl / credentials)
3. Verdict:
   - `accepted` → unlock Writer / Author path
   - `rejected` → stay on human gate until corrected

Regression: `test/human-input-recheck.js`.

### 4. Upstream validated-output dependency

```text
Agent N may start ONLY IF Agent N-1 has:
  1) structured output in storyOutputs, AND
  2) Validator approve (orchestrator_gate)
```

Writer+ phases are not pre-built while human gates are open; they append after unlock. Blocked Author → pipeline hold (no Executor).

Regression: `test/dependency-gate.js`.

### 5. Honest terminal states

| State | Meaning |
|-------|---------|
| `NEEDS_INPUT` | Missing ACs / credentials / URL / blocked step |
| `PLAN_READY` | Outline awaiting human approval |
| `BUILDING` | Author session running |
| `REVIEW` | Executable test built + verified |
| `FAILED` | Author exhausted retries / invalid requirements |
| `COMPLETE` | Only after REVIEW + Reporter |

`run_end` success only if `status === COMPLETE`. Timeline exhaustion alone is **not** success.

## Author agent (chosen: dedicated `qa-author`)

**Decision:** Option **B** — new `qa-author` between Writer and Reviewer (cleaner role split than upgrading Executor).

### Input

```text
approved outline + env URL + credentials + (optional) curl/API contract
```

### Loop per task/step

```text
PLAN    → next action from outline + last screenshot/DOM
ACT     → Playwright click/type/navigate (or API call)
REFLECT → assert validation; capture screenshot/console/network
if fail → undo/retry once with alternate locator/strategy
if still fail → NEEDS_INPUT (never invent pass)
replay prefix steps before advancing (stability check)
```

Author is **scaffolded** (`agents/author.js`, `.claude/skills/qa-author/`) — refuses empty ACs / unapproved outlines; Playwright MVP is Sprint S2.

## Writer outline contract (S1)

Primary Writer artifact:

```json
{
  "test_outlines": [
    {
      "id": "TO-01",
      "title": "…",
      "mapped_acs": ["AC-1"],
      "intent": "…",
      "preconditions": [],
      "tasks": [{ "id": "T1", "action": "…", "validation": "…" }],
      "status": "draft"
    }
  ],
  "coverage_matrix": { "AC-1": ["TO-01"] }
}
```

Rules:

- One outline per distinct intent (happy / negative / exception)
- Every AC ID in `coverage_matrix` or explicitly `not_testable` with reason
- Human gate: Approve / Edit / Reject — only `approved` outlines enter Author

## Delivery status

| Sprint | Deliverable | Status |
|--------|-------------|--------|
| **S0** | Zero-AC gate + no placeholder TC + no success without ACs | Done |
| **S0+** | Reviewer human-input recheck vs Analyst (blame + accept/reject) | Done |
| **S0+** | `qa-author` scaffold in pipeline | Done (stub) |
| **S0+** | Upstream validated-output dependency gate | Done |
| **S1** | Writer emits `test_outlines` + approval UI | Done |
| **S1+** | Stub/LIVE runner badges + honest Author COMPLETE block messaging | Done |
| **S2** | Author MVP (Playwright) for 1 happy-path outline | Planned |
| **S3** | Persist run state + rehydrate simulator | Planned |
| **S4** | Failure classification + recovery proposals | Planned |

### Explicit non-goals (for now)

- Don’t clone mabl visual auto-heal
- Don’t require cloud MCP
- Don’t delete GWT entirely — demote it to documentation
- Don’t let Author “fix” product code

## Model routing

| Role | Cursor model ID | Claude Code model ID |
|------|------------------|-----------------------|
| Orchestrator | `claude-fable-5` (Claude Fable 5) | `claude-fable-5` (Claude Fable 5) |
| Validator + all worker agents | `claude-4.6-sonnet` (Claude Sonnet) | `claude-sonnet-5` (Claude Sonnet) |

Configured in `agents/registry.js` (`AGENT_MODEL_ROUTING`), `.claude/agents/*.md`, and `.claude/agents/*.md`.

## Requirements

- **Node.js >= 18.18** with `"type": "module"` in `package.json`
- Browser classic scripts (`lib/prerequisites.js`) stay CJS-compatible; Node loads `lib/prerequisites.cjs` via `createRequire`
- Optional: JIRA credentials in `.env` for live ticket fetch
- Agent 1 runner (`ANALYST_RUNNER`, default `cursor_agent_cli`):
  - `cursor_agent_cli` — enable **Claude Fable 5** and **Claude Sonnet** in Cursor Models settings, `cursor-agent login`
  - `anthropic_api` — set `ANTHROPIC_API_KEY` (console.anthropic.com); no Cursor install needed

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
| `npm test` | Full regression suite (requirements, analyst skills + golden set, gates, contracts, …) |
| `npm run test:analyst-checks` | Analyst skill rules, testability scoring, grounding |
| `npm run test:analyst-golden` | Golden stories replayed offline through grounding → checks → assembly |
| `npm run eval:analyst-golden` | Golden stories run against the **live** analyst runner — use after editing a skill |
| `npm run test:zero-ac` | Zero-AC hard gate only |
| `npm run test:human-recheck` | Reviewer human-input recheck only |
| `npm run doctor` | Check Node version, files, and module health |
| `npm run check:modules` | Verify all production ES modules parse |

## Configuration

| Variable | Description |
|----------|-------------|
| `JIRA_URL` | JIRA base URL |
| `JIRA_USERNAME` | JIRA user email |
| `JIRA_API_TOKEN` | JIRA API token |
| `ANALYST_RUNNER` | Agent 1 transport: `cursor_agent_cli` (default) or `anthropic_api` |
| `ANTHROPIC_API_KEY` | Required only when `ANALYST_RUNNER=anthropic_api` |
| `CURSOR_AGENT_BIN` | Optional — path to a specific `cursor-agent` binary (`cursor_agent_cli` runner) |
| `ANALYST_MODEL` | Agent 1 model id (default `claude-sonnet-5`) |
| `ANALYST_EFFORT` | Reasoning effort — `cursor_agent_cli` runner only (default `high`) |
| `EXECUTOR_ALLOWLIST` | Comma-separated hosts allowed for `/api/execute` (default: localhost only) |
| `PORT` | Server port (default `5173`) |

## Security notes

- Static file serving uses an **allowlist** — dotfiles (`.env`, `.git`) are blocked
- JIRA API responses use **same-origin CORS** only (no wildcard)
- Curl **Authorization** values are **redacted** in UI, logs, and exports
- API execution is limited to **allowlisted hosts** via `EXECUTOR_ALLOWLIST`

## Project layout

```
agents/            # Pipeline agents (orchestrator, analyst, writer, author, …)
lib/               # Requirements parser, human-input, redaction, executor
js/                # Browser simulator entry
.claude/skills/    # Per-agent qa-*/SKILL.md (incl. qa-analyst/analysis/ — the analysis skills + COMMON.md)
.claude/agents/    # Per-agent subagent entrypoints for Claude Code
src/agents/        # JS Analyst: runner, skill loader, grounding, skill checks
simulator.html     # UI shell
server.js          # Local dev server + JIRA proxy + execution endpoint
test/              # Gate + agent regression tests (golden analyst stories in test/fixtures/analyst-golden/)
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
