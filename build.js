const fs = require("fs");
const https = require("https");
const vm = require("vm");

const babelUrl = "https://cdn.jsdelivr.net/npm/@babel/standalone@7.26.9/babel.min.js";

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

async function build() {
  const [babelSource, jsxSource] = await Promise.all([
    fetchText(babelUrl),
    fs.promises.readFile(`${__dirname}/app.jsx`, "utf8"),
  ]);

  const context = { window: {}, self: {}, global: {} };
  context.window = context;
  context.self = context;
  context.global = context;
  vm.runInNewContext(babelSource, context);
  const Babel = context.Babel;
  const transformed = Babel.transform(jsxSource, {
    presets: [["react", { runtime: "classic" }]],
  }).code;

  fs.writeFileSync(`${__dirname}/app.compiled.js`, transformed);
  console.log("Built app.compiled.js");
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
