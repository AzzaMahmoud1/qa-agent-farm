import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApiServer } from "./api/server.js";
import { RunOrchestrator } from "./orchestrator/run-orchestrator.js";
import { FileRunStore } from "./store/file-store.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 5180);
const dataDir = process.env.V1_DATA_DIR || join(__dirname, "..", ".data", "runs");

const store = new FileRunStore(dataDir);
const orchestrator = new RunOrchestrator(store);
const api = createApiServer(orchestrator, port);

await api.listen();
console.log(`QA Agent Farm v1 (alpha) listening on http://127.0.0.1:${port}`);
console.log(`  GET  /health`);
console.log(`  POST /v1/runs`);
console.log(`  POST /v1/runs/:id/plan`);
console.log(`  POST /v1/runs/:id/approve`);
console.log(`  POST /v1/runs/:id/execute`);
