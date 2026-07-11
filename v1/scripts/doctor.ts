import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "package.json",
  "src/index.ts",
  "src/domain/types.ts",
  "src/domain/run-state.ts",
  "src/policy/redaction.ts",
  "src/policy/allowlist.ts",
  "src/policy/nca.ts",
  "src/orchestrator/run-orchestrator.ts",
  "src/workers/api-executor.ts",
  "src/api/server.ts",
  "src/store/file-store.ts",
];

let ok = true;
for (const rel of required) {
  const path = join(root, rel);
  const present = existsSync(path);
  console.log(`${present ? "OK" : "MISSING"}  ${rel}`);
  if (!present) ok = false;
}

console.log(ok ? "\nv1 doctor: healthy" : "\nv1 doctor: failed");
process.exit(ok ? 0 : 1);
