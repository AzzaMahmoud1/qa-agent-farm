import type { Scenario, ScenarioResult, StructuredRequest } from "../domain/types.js";
import { isUrlAllowlisted } from "../policy/allowlist.js";
import { redactBody, redactHeaders, redactString } from "../policy/redaction.js";

export interface ExecutorOptions {
  allowlist: string[];
  allowLoopback?: boolean;
  timeoutMs?: number;
}

/**
 * Execute one API scenario with per-AC assertion.
 * HTTP 2xx alone is never enough — expect_status (and optional body) must match.
 */
export async function executeApiScenario(
  scenario: Scenario,
  request: StructuredRequest,
  options: ExecutorOptions,
): Promise<ScenarioResult> {
  const contract = request.api_contract;
  if (!contract?.url || !contract.method) {
    return {
      scenario_id: scenario.id,
      status: "blocked",
      assertion_level: scenario.assertion_level,
      passed: false,
      evidence: "Missing api_contract on request",
    };
  }

  if (!isUrlAllowlisted(contract.url, options.allowlist, { allowLoopback: options.allowLoopback })) {
    return {
      scenario_id: scenario.id,
      status: "blocked",
      assertion_level: scenario.assertion_level,
      passed: false,
      evidence: `URL not allowlisted: ${redactString(contract.url)}`,
      request: {
        method: contract.method,
        url: redactString(contract.url),
        headers: redactHeaders(contract.headers || {}),
      },
    };
  }

  const timeoutMs = options.timeoutMs ?? 15_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    const res = await fetch(contract.url, {
      method: contract.method.toUpperCase(),
      headers: contract.headers || {},
      body: contract.body ?? undefined,
      redirect: "manual",
      signal: controller.signal,
    });

    const rawText = await res.text();
    const expectStatus = contract.expect_status ?? 200;
    const bodyOk =
      !contract.expect_body_includes ||
      rawText.includes(contract.expect_body_includes);
    const statusOk = res.status === expectStatus;
    const passed = statusOk && bodyOk;

    let assertionNote = "";
    if (!statusOk) {
      assertionNote = `Expected status ${expectStatus}, got ${res.status}`;
    } else if (!bodyOk) {
      assertionNote = `Response body missing expected substring`;
    } else {
      assertionNote = `Per-AC assertion passed (status ${res.status})`;
    }

    // Transport-only observation if caller forgot expect_status and we only got 2xx
    // — still require exact expect_status match; default 200 is an explicit AC.
    return {
      scenario_id: scenario.id,
      status: passed ? "passed" : "failed",
      assertion_level: "per_ac",
      passed,
      evidence: assertionNote,
      http_status: res.status,
      request: {
        method: contract.method.toUpperCase(),
        url: redactString(contract.url),
        headers: redactHeaders(contract.headers || {}),
        body: redactBody(contract.body),
      },
      response: {
        status: res.status,
        headers: redactHeaders(Object.fromEntries(res.headers.entries())),
        body: redactBody(rawText.slice(0, 4000)),
        elapsed_ms: Date.now() - started,
      },
      audit: [
        {
          at: new Date().toISOString(),
          event: "api_execute",
          allowlisted: true,
          status: res.status,
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      scenario_id: scenario.id,
      status: "failed",
      assertion_level: "per_ac",
      passed: false,
      evidence: `Request failed: ${redactString(message)}`,
      request: {
        method: contract.method,
        url: redactString(contract.url),
        headers: redactHeaders(contract.headers || {}),
      },
    };
  } finally {
    clearTimeout(timer);
  }
}
