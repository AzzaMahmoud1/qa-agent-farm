/**
 * Initial smoke run for Agent 1 (Requirement Analyst).
 * Usage: node scripts/run-agent1-once.js
 *
 * Auth: Cursor Agent CLI login (`cursor-agent login` / `cursor-agent status`).
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const SAMPLE_TICKET = `Title: View Organization Subscriptions

Actor / Role: System Admin, Account Manager

Pre-conditions:
- User is authenticated
- Organization exists in the system

Basic Flow:
1. User opens Organization details
2. User navigates to Subscriptions tab
3. System displays list of subscriptions

Business Rules:
BR-1: System Admin can view all subscriptions for any organization
BR-2: Account Manager can view subscriptions only for organizations they manage
BR-3: Inactive subscriptions must be visually distinguished from active ones
BR-4: Unapplied business — Premium + Services bundle exclusion (TBD)

Alternative Flow:
AF-1: If organization has zero subscriptions, show empty state message

Exception Flow:
EF-1: If Billing API is unavailable, show error and allow retry

Used API:
GET /api/v1/organizations/{orgId}/subscriptions

Data Table:
| Field | Type | Source |
| status | enum(active,inactive) | Billing API |
| type | string | Billing API |
`;

const { runRequirementAnalyst } = await import("../src/agents/requirementAnalyst.js");

console.log("Running Agent 1 (Requirement Analyst) via Cursor Agent CLI…");
console.log("Binary:", process.env.CURSOR_AGENT_BIN || "cursor-agent (auto-detected)");
console.log("Model:", process.env.ANALYST_MODEL || "claude-sonnet-5", "· effort:", process.env.ANALYST_EFFORT || "high");
console.log("Prompt:", "src/prompts/agent1_requirement_analyst_v3.md");
console.log("---");

const started = Date.now();
const result = await runRequirementAnalyst(SAMPLE_TICKET);
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

const outDir = join(root, ".data");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "agent1-last-run.json");
writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");

if (result.success === false) {
  console.error("FAILED after retry:", result.error);
  console.error("Raw length:", (result.raw || "").length);
  console.error("Saved:", outPath);
  process.exit(1);
}

const { scratchpad, parsed } = result;
console.log(`OK in ${elapsed}s`);
console.log("Summary:", parsed.summary);
console.log("ready_for_test_design:", parsed.ready_for_test_design);
console.log("testable_conditions:", parsed.testable_conditions?.length ?? 0);
console.log("blocking prerequisites:", parsed.prerequisites_needed?.blocking?.length ?? 0);
console.log("coverage_gaps:", parsed.coverage_gaps?.length ?? 0);
console.log("orchestrator_actions:");
for (const a of parsed.analyst_report?.orchestrator_actions || []) {
  console.log(`  - [${a.action}] ${a.target} — ${a.detail} (blocking=${a.blocking})`);
}
console.log("---");
console.log("Scratchpad preview (first 600 chars):");
console.log(String(scratchpad).slice(0, 600));
console.log("---");
console.log("Full result saved to:", outPath);
