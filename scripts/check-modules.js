#!/usr/bin/env node
/** Verify production ES modules parse without error. */
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const root = path.join(__dirname, "..");
const modules = [];
let failed = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".js") && !entry.name.endsWith(".test.js")) modules.push(full);
  }
}

walk(path.join(root, "agents"));
walk(path.join(root, "lib"));
// js/simulator-app.js requires browser globals — syntax-only check
const simPath = path.join(root, "js", "simulator-app.js");
if (fs.existsSync(simPath)) {
  const { execSync } = require("child_process");
  try {
    execSync(`"${process.execPath}" --check "${simPath}"`, { stdio: "pipe" });
    console.log("OK js/simulator-app.js (syntax)");
  } catch (err) {
    failed++;
    console.error("FAIL js/simulator-app.js", err.stderr?.toString() || err.message);
  }
}

(async () => {
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
})();
