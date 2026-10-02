/**
 * Golden trend: regression detection, baseline floor, markdown, and the CLI
 * appending to history.
 * Run: node test/golden-trend.js
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateTrend, trendMarkdown, readHistory } from "../scripts/golden-trend.js";

const run = (at, rows, mode = "live") => ({
  at, mode, runner: "anthropic_api", model: null, commit: "abcdef1234",
  pass_rate: rows.filter(([, ok]) => ok).length / rows.length,
  results: rows.map(([name, ok]) => ({ name, ok, error: ok ? null : "boom", verdict: "TEST_READY", conditions: 3, writer_coverage: ok ? 1 : 0.5 })),
});

const prev = run("2026-09-28T06:00:00Z", [["a", true], ["b", true], ["c", false], ["d", true]]);
const now = run("2026-10-05T06:00:00Z", [["a", true], ["b", false], ["c", true], ["d", true]]);

{
  const t = evaluateTrend(now, [prev], { min_pass_rate: 0.5 });
  assert.deepEqual(t.regressions, ["b"], "story that passed last run and fails now is a regression");
  assert.deepEqual(t.fixed, ["c"]);
  assert.equal(t.delta, 0);
  assert.equal(t.failures.length, 1);

  const floor = evaluateTrend(run("x", [["a", false], ["b", true]]), [], { min_pass_rate: 0.75 });
  assert.match(floor.failures[0], /below the baseline/);
  assert.equal(floor.delta, null, "first run has no delta");

  const otherMode = evaluateTrend(now, [run("y", [["b", true]], "replay")], { min_pass_rate: 0 });
  assert.equal(otherMode.regressions.length, 0, "only compares runs of the same mode");

  const md = trendMarkdown(now, [prev], t);
  assert.match(md, /Pass rate:\*\* 75%/);
  assert.match(md, /Regressions:\*\* b/);
  assert.match(md, /\| abcdef1 \|/);
}

// CLI: appends to history and exits 1 on a regression
{
  const dir = mkdtempSync(join(tmpdir(), "golden-trend-"));
  const history = join(dir, "h.jsonl");
  writeFileSync(join(dir, "prev.json"), JSON.stringify(prev));
  writeFileSync(join(dir, "now.json"), JSON.stringify(now));
  const script = join(dirname(fileURLToPath(import.meta.url)), "../scripts/golden-trend.js");
  execFileSync(process.execPath, [script, join(dir, "prev.json"), "--history", history], { stdio: "pipe" });
  assert.equal(readHistory(history).length, 1);
  let code = 0;
  try {
    execFileSync(process.execPath, [script, join(dir, "now.json"), "--history", history, "--markdown", join(dir, "t.md")], { stdio: "pipe" });
  } catch (err) {
    code = err.status;
  }
  assert.equal(code, 1, "regression fails the CLI");
  assert.equal(readHistory(history).length, 2, "report still recorded in history");
  assert.match(readFileSync(join(dir, "t.md"), "utf8"), /Regressions/);
}

console.log("golden-trend tests: ok");
