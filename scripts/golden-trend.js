/**
 * Golden-set trend: append a report from `GOLDEN_REPORT=… node test/analyst-golden.js`
 * to a JSONL history, print the recent trend, and fail when quality drops.
 *
 *   node scripts/golden-trend.js <report.json> [--history .farm/golden-history.jsonl] [--markdown out.md]
 *
 * Fails (exit 1) when the pass rate is below test/fixtures/analyst-golden/baseline.json
 * `min_pass_rate`, or when a story that passed last run now fails (a regression).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function readHistory(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

/** Compare a report with the previous run of the same mode. */
export function evaluateTrend(report, history, baseline) {
  const prev = [...history].reverse().find((h) => h.mode === report.mode) || null;
  const prevOk = new Set((prev?.results || []).filter((r) => r.ok).map((r) => r.name));
  const regressions = report.results.filter((r) => !r.ok && prevOk.has(r.name)).map((r) => r.name);
  const fixed = report.results.filter((r) => r.ok && prev && !prevOk.has(r.name)).map((r) => r.name);
  const minPass = Number(baseline?.min_pass_rate ?? 0.75);
  const failures = [];
  if (report.pass_rate < minPass) failures.push(`pass rate ${pct(report.pass_rate)} is below the baseline ${pct(minPass)}`);
  if (regressions.length) failures.push(`regressed since last run: ${regressions.join(", ")}`);
  return { prev, regressions, fixed, failures, delta: prev ? report.pass_rate - prev.pass_rate : null };
}

const pct = (x) => `${Math.round(Number(x) * 100)}%`;

export function trendMarkdown(report, history, trend) {
  const recent = [...history.filter((h) => h.mode === report.mode).slice(-9), report];
  const lines = [
    `### Golden set — ${report.mode} (${report.runner}${report.model ? ` · ${report.model}` : ""})`,
    "",
    `**Pass rate:** ${pct(report.pass_rate)}${trend.delta == null ? "" : ` (${trend.delta >= 0 ? "+" : ""}${pct(trend.delta)} vs last run)`}`,
    "",
    "| Run | Pass rate | Commit |",
    "|---|---|---|",
    ...recent.map((h) => `| ${h.at.slice(0, 16).replace("T", " ")} | ${pct(h.pass_rate)} | ${(h.commit || "—").slice(0, 7)} |`),
    "",
    "| Story | Result | Verdict | Conditions | Writer coverage |",
    "|---|---|---|---|---|",
    ...report.results.map((r) => `| ${r.name} | ${r.ok ? "✅" : `❌ ${r.error || ""}`} | ${r.verdict ?? "—"} | ${r.conditions ?? "—"} | ${r.writer_coverage == null ? "—" : pct(r.writer_coverage)} |`),
  ];
  if (trend.regressions.length) lines.push("", `**Regressions:** ${trend.regressions.join(", ")}`);
  if (trend.fixed.length) lines.push("", `**Fixed:** ${trend.fixed.join(", ")}`);
  return lines.join("\n");
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const reportPath = process.argv[2];
  if (!reportPath || reportPath.startsWith("--")) {
    console.error("usage: node scripts/golden-trend.js <report.json> [--history file] [--markdown file]");
    process.exit(2);
  }
  const historyPath = arg("--history", process.env.GOLDEN_HISTORY || join(ROOT, ".farm/golden-history.jsonl"));
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const baseline = JSON.parse(readFileSync(join(ROOT, "test/fixtures/analyst-golden/baseline.json"), "utf8"));
  const history = readHistory(historyPath);
  const trend = evaluateTrend(report, history, baseline);
  const md = trendMarkdown(report, history, trend);

  mkdirSync(dirname(historyPath), { recursive: true });
  appendFileSync(historyPath, `${JSON.stringify(report)}\n`);
  const mdPath = arg("--markdown", null);
  if (mdPath) writeFileSync(mdPath, md);
  console.log(md);
  if (trend.failures.length) {
    console.error(`\nGolden trend check failed: ${trend.failures.join("; ")}`);
    process.exit(1);
  }
}
