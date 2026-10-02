# QA Agent Farm

A multi-agent QA pipeline that turns a Jira story (or pasted requirements) into **grounded, traceable test cases**, and optionally verifies them in a real browser. Each agent's output passes a validation gate. A human confirms anything the agents can't prove, and no run claims a pass without evidence.

## How it works

```mermaid
flowchart LR
  subgraph IN[Input]
    J[Jira ticket] --- P[Pasted story]
  end

  subgraph AN[Requirement Analyst]
    direction TB
    T{Testability gate<br/>ISTQB score}
    R[Requirements<br/>grounded ACs]
    K[Risk P0–P3]
    G[Test-gap<br/>techniques]
    T -->|ready| R --> K --> G
  end

  IN --> O[Orchestrator] --> T
  T -->|NOT_TEST_READY| PO[/Back to PO/]
  G --> V1{Validator}
  V1 -->|needs input| H1[/Human answers/]
  H1 --> RC{Reviewer<br/>recheck} --> W
  V1 -->|proceed| W[Writer<br/>Given/When/Then]
  W --> V2{Validator}
  V2 --> AP[/Human approves outlines/]
  AP --> D[Data Extractor]
  D --> A[Author<br/>Playwright<br/>Plan → Act → Reflect]
  A -->|REVIEW verified + replayed| E[Executor] --> RV[Reviewer] --> RP[Reporter<br/>DOCX + JSON]
  A -->|not verified| HOLD[/Hold: no COMPLETE/]

  classDef gate fill:#fff4d6,stroke:#c99a06;
  classDef human fill:#e8f0fe,stroke:#4a6fd1;
  class T,V1,V2,RC gate;
  class PO,H1,AP,HOLD human;
```

**Legend:** ◇ = gate (code-enforced) · ▱ = human or hold.

### Three rules hold everywhere

- **Grounding.** Every acceptance criterion, risk and test case quotes the story word for word, or code drops it.
- **Code decides, not the model.** Scores, priorities, citations, browser assertions and gates are checked in code.
- **Honest states.** A run is `COMPLETE` only after a verified, replayed Author session and the Reporter.

## The agents

| Agent | Does | Live in simulator |
|---|---|---|
| Orchestrator | The only entry point. Dispatches agents and carries out validated actions | deterministic |
| Analyst | Testability gate, then grounded ACs, risk and test-gap passes | ✅ LLM |
| Validator | Second-opinion gate on every output | deterministic |
| Writer | One Given/When/Then case per checklist line, with a verbatim citation | ✅ LLM |
| Data Extractor | Valid, invalid and boundary datasets | deterministic |
| Author | Runs an approved outline in a browser and replays it | ✅ LLM + Playwright |
| Executor, Reviewer, Reporter | Execution evidence, coverage review, SEHA-style report | deterministic |

## Quick start

Requires **Node.js 18.18 or later**.

```bash
cp .env.example .env
```

```bash
npm start
```

Open <http://127.0.0.1:5173/simulator.html>. Pick the LLM runner at `/settings.html`: the Cursor CLI, Anthropic, OpenAI, OpenRouter, or any OpenAI-compatible endpoint.

**In Claude Code,** type `qa: PROJ-123` (or `test:` / `ticket:`). `CLAUDE.md` hands the run to `qa-orchestrator`, which dispatches the subagents.

**Optional live Author:**

```bash
npm i -D playwright && npx playwright install chromium
```

## Testing

```bash
npm test
```

That runs the full offline suite, including the end-to-end golden run from story to report.

```bash
npm run eval:golden-trend
```

That runs the golden stories against a real model and checks the trend for regressions. It also runs weekly in CI.

## Project layout

```text
.claude/agents, .claude/skills   Agent entry points + rules (the single source of truth)
src/agents/                      Live Analyst, Writer, Author (+ grounding, skill checks)
agents/                          Pipeline: orchestrator, validator, gates, deterministic agents
lib/  js/                        Shared logic, browser simulator (+ run save/resume)
server.js                        Local server: Jira proxy, live agents, guarded execution
test/                            Regression, e2e and golden tests
docs/REFERENCE.md                Gates, config, env vars, HTTP API, all commands, changelog
```

See **[docs/REFERENCE.md](docs/REFERENCE.md)** for everything else.

Private, for internal use.
