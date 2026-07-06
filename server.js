const http = require("http");
const fs = require("fs");
const path = require("path");
const { fetchIssue, parseIssueKey } = require("./jira");

const root = __dirname;
const port = Number(process.env.PORT) || 5173;
const types = {
  ".html": "text/html",
  ".jsx": "text/javascript",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const pathname = url.pathname;

    if (pathname === "/api/jira/health") {
      const configured = Boolean(
        process.env.JIRA_URL && process.env.JIRA_USERNAME && process.env.JIRA_API_TOKEN
      );
      sendJson(res, 200, { ok: true, configured });
      return;
    }

    if (pathname === "/api/jira/issue" && req.method === "GET") {
      const key = parseIssueKey(url.searchParams.get("key") || url.searchParams.get("url"));
      if (!key) {
        sendJson(res, 400, { error: "Missing or invalid issue key" });
        return;
      }
      try {
        const issue = await fetchIssue(key);
        sendJson(res, 200, issue);
      } catch (err) {
        sendJson(res, 502, { error: err.message });
      }
      return;
    }

    if (pathname === "/api/jira/issue" && req.method === "POST") {
      try {
        const body = await readBody(req);
        const key = parseIssueKey(body.key || body.url);
        if (!key) {
          sendJson(res, 400, { error: "Missing or invalid issue key" });
          return;
        }
        const issue = await fetchIssue(key);
        sendJson(res, 200, issue);
      } catch (err) {
        sendJson(res, 502, { error: err.message });
      }
      return;
    }

    const filePath = pathname === "/" ? "simulator.html" : pathname.replace(/^\//, "");
    const file = path.join(root, filePath);
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const ext = path.extname(file);
      res.writeHead(200, { "Content-Type": types[ext] || "text/plain" });
      res.end(data);
    });
  })
  .listen(port, "127.0.0.1", () => {
    const configured = Boolean(process.env.JIRA_URL && process.env.JIRA_USERNAME && process.env.JIRA_API_TOKEN);
    console.log(`QA Agent Farm simulator: http://127.0.0.1:${port}`);
    console.log(configured ? "JIRA API: configured" : "JIRA API: missing credentials (.env)");
  });
