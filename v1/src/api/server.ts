import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { StructuredRequest } from "../domain/types.js";
import type { RunOrchestrator } from "../orchestrator/run-orchestrator.js";
import { containsSecret, redactJsonValue } from "../policy/redaction.js";

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(redactJsonValue(body), null, 2);
  if (containsSecret(json)) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Refusing to emit unredacted secrets" }));
    return;
  }
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "http://127.0.0.1:5180",
  });
  res.end(json);
}

export function createApiServer(orchestrator: RunOrchestrator, port: number) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    const path = url.pathname;
    const method = (req.method || "GET").toUpperCase();

    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "http://127.0.0.1:5180",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
      });
      res.end();
      return;
    }

    try {
      if (method === "GET" && path === "/health") {
        send(res, 200, {
          ok: true,
          version: "1.0.0-alpha.0",
          orchestration_mode: "durable_control_plane",
        });
        return;
      }

      if (method === "GET" && path === "/v1/runs") {
        send(res, 200, { runs: orchestrator.list() });
        return;
      }

      if (method === "POST" && path === "/v1/runs") {
        const body = (await readJson(req)) as StructuredRequest;
        if (!body?.title || !body?.requirements) {
          send(res, 400, { error: "title and requirements are required" });
          return;
        }
        const run = orchestrator.create({
          product: body.product || "unknown",
          owner: body.owner || "unknown",
          title: body.title,
          requirements: body.requirements,
          surfaces: body.surfaces?.length ? body.surfaces : ["api"],
          risk: body.risk,
          nca_applicable: body.nca_applicable,
          api_contract: body.api_contract,
        });
        send(res, 201, run);
        return;
      }

      const runMatch = path.match(/^\/v1\/runs\/([^/]+)(?:\/(plan|approve|execute))?$/);
      if (runMatch) {
        const id = decodeURIComponent(runMatch[1]);
        const action = runMatch[2];

        if (method === "GET" && !action) {
          const run = orchestrator.get(id);
          if (!run) {
            send(res, 404, { error: "run not found" });
            return;
          }
          send(res, 200, run);
          return;
        }

        if (method === "POST" && action === "plan") {
          send(res, 200, orchestrator.plan(id));
          return;
        }

        if (method === "POST" && action === "approve") {
          send(res, 200, orchestrator.approve(id));
          return;
        }

        if (method === "POST" && action === "execute") {
          send(res, 200, await orchestrator.execute(id));
          return;
        }
      }

      send(res, 404, { error: "not found" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      send(res, 400, { error: message });
    }
  });

  return {
    listen(): Promise<void> {
      return new Promise((resolve) => {
        server.listen(port, "127.0.0.1", () => resolve());
      });
    },
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
    server,
  };
}
