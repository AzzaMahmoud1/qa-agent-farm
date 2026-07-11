#!/usr/bin/env node
/** Verify production ES modules parse without error. */
import fs from "fs";
import path from "path";
import { pathToFileURL, fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const modules = [];
let failed = 0;

const SKIP = new Set([]);

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".cjs")) continue;
    else if (SKIP.has(entry.name)) continue;
    else if (entry.name.endsWith(".js") && !entry.name.endsWith(".test.js")) modules.push(full);
  }
}

walk(path.join(root, "agents"));
walk(path.join(root, "lib"));

const simPath = path.join(root, "js", "simulator-app.js");
if (fs.existsSync(simPath)) {
  try {
    execSync(`"${process.execPath}" --check "${simPath}"`, { stdio: "pipe" });
    console.log("OK js/simulator-app.js (syntax)");
  } catch (err) {
    failed++;
    console.error("FAIL js/simulator-app.js", err.stderr?.toString() || err.message);
  }
}

for (const file of modules) {
  try {
    await import(pathToFileURL(file).href);
    console.log("OK", path.relative(root, file));
  } catch (err) {
    failed++;
    console.error("FAIL", path.relative(root, file), err.message);
  }
}

if (failed) process.exit(1);
