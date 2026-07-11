# QA Agent Farm — v1 (alpha)

New control-plane rebuild. **Does not replace v0** (root simulator). Both versions coexist.

| Version | Path | Status |
|---------|------|--------|
| **v0** | repo root (`server.js`, `simulator.html`) | Current simulator — kept |
| **v1** | `v1/` | Rebuild — durable runs, real assertions, NCA gates |

## Design principles

1. Deterministic code owns validation, routing, policy, verdict, and release decisions.
2. No status becomes `passed` without a per-scenario assertion + redacted evidence.
3. UI URL recording ≠ browser execution.
4. HTTP 2xx transport ≠ business/AC pass.
5. Orchestrator uses **Claude Fable 5**; worker agents use **Claude Sonnet** (when LLM stages are enabled).
6. NCA/ECC gaps block release when security controls apply and evidence is missing.

## Run state machine

```text
draft → clarification_pending → control_mapping_pending → plan_pending
→ approval_pending → queued → executing → evidence_verifying
→ independent_review → passed | failed | blocked | cancelled
```

## Quick start

```bash
cd v1
cp .env.example .env
npm install
npm test
npm start
```

API: `http://127.0.0.1:5180`

## First vertical slice (alpha)

- Create a run from a structured request
- Plan scenarios (including NCA security stubs when applicable)
- Execute **one** allowlisted API assertion with redacted evidence
- Release gate: `blocked` until evidence + policy checks pass

## Layout

```text
v1/
  src/
    domain/         # types + state transitions
    policy/         # redaction, allowlist, NCA
    orchestrator/   # durable machine + model routing
    workers/        # api executor (UI later)
    api/            # HTTP control plane
    store/          # file-backed run store (swap for DB later)
  test/
  .data/runs/       # durable run JSON (gitignored)
```

## API (alpha)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Version + mode |
| POST | `/v1/runs` | Create run from structured request |
| GET | `/v1/runs/:id` | Fetch run |
| POST | `/v1/runs/:id/plan` | Plan scenarios + NCA stubs |
| POST | `/v1/runs/:id/approve` | Queue for execution |
| POST | `/v1/runs/:id/execute` | Run allowlisted API assertions |

v0 remains at repo root on port **5173**. This package uses port **5180**.
