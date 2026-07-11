#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const required = [
  "server.js",
  "simulator.html",
  "js/simulator-app.js",
  "agents/index.js",
  "lib/prerequisites.js",
  "lib/prerequisites.cjs",
  "package.json",
  "README.md",
];

let ok = true;
console.log("QA Agent Farm — doctor\n");

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (pkg.type !== "module") {
  console.log("✗ package.json must set \"type\": \"module\"");
  ok = false;
} else {
  console.log("✓ package.json type=module");
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
const nodeMinor = Number(process.versions.node.split(".")[1] || 0);
if (nodeMajor < 18 || (nodeMajor === 18 && nodeMinor < 18)) {
  console.log("✗ Node.js >=18.18 required (found", process.versions.node + ")");
  ok = false;
} else {
  console.log("✓ Node.js", process.versions.node);
}

for (const rel of required) {
  const exists = fs.existsSync(path.join(root, rel));
  console.log(exists ? "✓" : "✗", rel);
  if (!exists) ok = false;
}

const envExample = path.join(root, ".env.example");
const envFile = path.join(root, ".env");
if (fs.existsSync(envFile)) {
  const text = fs.readFileSync(envFile, "utf8");
  const configured = /JIRA_URL=.+/.test(text) && !/your-org/.test(text);
  console.log(configured ? "✓" : "○", ".env present", configured ? "(JIRA configured)" : "(template values — JIRA optional)");
} else {
  console.log("○", ".env missing — copy from .env.example for JIRA live fetch");
}

console.log("\nRun: npm test && npm start");
process.exit(ok ? 0 : 1);
