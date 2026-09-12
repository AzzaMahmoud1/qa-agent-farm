/**
 * Console dashboard — the Farm Console view over the real simulator.
 *
 * Reads the running app's own DOM (the live #pipeline-bar and the per-run
 * stats) — it changes no pipeline logic. Every completed run (detected when
 * "View report" becomes enabled) is appended to a per-browser run store, and
 * the tiles / chart / recent-runs table are derived from those REAL runs. The
 * live pipeline element is relocated into the dashboard so its strip shows the
 * actual run in progress.
 */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var STORE_KEY = "qa-console-runs";

  // ---- run store (per browser) -------------------------------------------
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); }
    catch (e) { return []; }
  }
  function save(runs) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(runs.slice(-40))); } catch (e) {}
  }
  // Example runs (match the Farm Console reference) shown until the first real
  // run completes — display-only, never written to storage.
  var EXAMPLE_RUNS = [
    { id: "SEHA-1280", story: "Password reset token", source: "jira", tc: 12, score: 94, validated: 10, agents: "9/9" },
    { id: "REQ-8825", story: "Concurrent checkout", source: "requirements", tc: 16, score: 87, validated: 13, agents: "9/9" },
    { id: "REQ-8830", story: "Bilingual error messages", source: "requirements", tc: 19, score: 95, validated: 15, agents: "9/9" },
    { id: "SEHA-1287", story: "OTP resend limit", source: "jira", tc: 0, score: null, validated: 6, agents: "4/9" },
    { id: "REQ-8839", story: "Session timeout redirect", source: "requirements", tc: 11, score: 88, validated: 8, agents: "9/9" },
    { id: "SEHA-1291", story: "Refund approval flow", source: "jira", tc: 0, score: null, validated: 9, agents: "2/9" },
    { id: "REQ-8842", story: "Account lockout", source: "requirements", tc: 14, score: 92, validated: 12, agents: "9/9" }
  ];
  // Fixed aggregate tiles for example mode (24h totals, like the reference).
  var EXAMPLE_TILES = {
    runs: "24", runsD: ["up", "12%"], tc: "312", tcD: ["up", "8%"],
    score: "91%", scoreD: ["up", "3 pts"], acs: "1,786", acsD: ["up", "9%"],
    gaps: "47", gapsD: ["down", "5"]
  };
  var runs = load();
  var exampleMode = runs.length === 0;
  if (exampleMode) runs = EXAMPLE_RUNS.slice();

  // ---- relocate the live pipeline into the dashboard ----------------------
  var host = $("dash-pipeline-host");
  var bar = $("pipeline-bar");
  if (host && bar) host.appendChild(bar);           // same node → JS keeps driving it by id
  var oldWrap = $("sec-pipeline"); if (oldWrap) oldWrap.hidden = true;
  var oldStats = $("stats-row"); if (oldStats) oldStats.style.display = "none";

  // ---- helpers ------------------------------------------------------------
  function num(txt) { var n = parseInt(String(txt || "").replace(/[^\d-]/g, ""), 10); return isNaN(n) ? 0 : n; }
  function pct(txt) { var m = String(txt || "").match(/(\d+(?:\.\d+)?)/); return m ? Math.round(parseFloat(m[1])) : null; }
  function currentStoryId() {
    var t = document.title || "";
    var m = t.match(/·\s*([A-Z]+-[A-Za-z0-9]+)/);
    if (m) return m[1];
    var meta = ($("story-meta") || {}).textContent || "";
    m = meta.match(/([A-Z]+-[A-Za-z0-9]+)/);
    return m ? m[1] : ("RUN-" + Date.now().toString(36).slice(-5).toUpperCase());
  }
  function currentSource() {
    var meta = (($("story-meta") || {}).textContent || "").toLowerCase();
    return /jira/.test(meta) ? "jira" : "requirements";
  }
  function storyTitle() {
    var t = (($("story-title") || {}).textContent || "").trim();
    return t && !/load a jira/i.test(t) ? t : "Untitled story";
  }

  // ---- capture a completed run -------------------------------------------
  var lastSig = "";
  function reportReady() {
    var b = $("btn-view-report");
    return b && !b.disabled;
  }
  function maybeRecord() {
    if (!reportReady()) return;
    var tc = num(($("stat-ac") || {}).textContent);
    var score = pct(($("stat-score") || {}).textContent);
    var validated = num(($("stat-validations") || {}).textContent);
    var agents = (($("stat-agents") || {}).textContent || "0/6").trim();
    var id = currentStoryId();
    var sig = id + "|" + tc + "|" + score + "|" + validated + "|" + agents;
    if (sig === lastSig) return;         // already recorded this exact result
    lastSig = sig;
    if (exampleMode) { runs = []; exampleMode = false; }   // first real run replaces the sample data
    runs.push({ id: id, story: storyTitle(), source: currentSource(), tc: tc, score: score, validated: validated, agents: agents, ts: Date.now() });
    save(runs);
    render();
  }

  // ---- live status --------------------------------------------------------
  function updateStatus() {
    var pill = $("cd-pipe-status");
    var story = $("cd-pipe-story");
    if (!pill) return;
    var running = bar && bar.querySelector(".pipeline-step.running");
    var d = '<span class="d"></span>';
    if (running) {
      pill.className = "cd-status run"; pill.innerHTML = d + "Running";
      if (story) story.textContent = currentStoryId() + " · " + storyTitle();
    } else if (reportReady()) {
      pill.className = "cd-status done"; pill.innerHTML = d + "Complete";
      if (story) story.textContent = currentStoryId() + " · " + storyTitle();
    } else {
      pill.className = "cd-status"; pill.innerHTML = d + "Idle";
      if (story) story.textContent = "no active run";
    }
  }

  // ---- render tiles / chart / table / detail ------------------------------
  function avg(arr) { var v = arr.filter(function (x) { return x != null; }); return v.length ? Math.round(v.reduce(function (a, b) { return a + b; }, 0) / v.length) : null; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }

  function setDelta(id, spec) {
    var el = $(id); if (!el) return;
    if (!spec) { el.className = "cd-delta"; el.innerHTML = ""; return; }
    var arrow = spec[0] === "up" ? "ti-chevron-up" : spec[0] === "down" ? "ti-chevron-down" : "ti-minus";
    el.className = "cd-delta " + spec[0];
    el.innerHTML = '<i class="ti ' + arrow + '"></i>' + spec[1];
  }
  function render() {
    var n = runs.length;
    var note = $("cd-example-note"); if (note) note.hidden = !exampleMode;
    if (exampleMode) {
      var t = EXAMPLE_TILES;
      $("cd-runs").textContent = t.runs; $("cd-tc").textContent = t.tc; $("cd-score").textContent = t.score;
      $("cd-acs").textContent = t.acs; $("cd-gaps").textContent = t.gaps;
      setDelta("cd-runs-delta", t.runsD); setDelta("cd-tc-delta", t.tcD); setDelta("cd-score-delta", t.scoreD);
      setDelta("cd-acs-delta", t.acsD); setDelta("cd-gaps-delta", t.gapsD);
      $("nav-runs-count").textContent = t.runs;
    } else {
      $("cd-runs").textContent = n;
      $("cd-tc").textContent = runs.reduce(function (a, r) { return a + (r.tc || 0); }, 0);
      var a = avg(runs.map(function (r) { return r.score; }));
      $("cd-score").textContent = a == null ? "—" : a + "%";
      $("cd-acs").textContent = runs.reduce(function (a, r) { return a + (r.validated || 0); }, 0);
      $("cd-gaps").textContent = n ? "—" : "0";
      ["cd-runs-delta", "cd-tc-delta", "cd-score-delta", "cd-acs-delta", "cd-gaps-delta"].forEach(function (i) { setDelta(i, null); });
      $("nav-runs-count").textContent = n;
    }
    $("cd-runs-count").textContent = n + (n === 1 ? " run" : " runs");
    renderChart();
    renderTable();
    renderDetail();
    updateStatus();
  }

  function renderChart() {
    var svg = $("cd-chart"), empty = $("cd-chart-empty");
    var data = runs.slice(-7);
    if (!data.length) { svg.style.display = "none"; empty.style.display = "block"; return; }
    svg.style.display = "block"; empty.style.display = "none";
    var W = 640, H = 220, PL = 30, PR = 12, PT = 16, PB = 30, gw = W - PL - PR, gh = H - PT - PB;
    var max = Math.max(10, Math.ceil(Math.max.apply(null, data.map(function (r) { return r.tc || 0; })) / 5) * 5);
    var s = "";
    for (var i = 0; i <= 4; i++) {
      var v = Math.round(max * i / 4), y = PT + gh - (v / max) * gh;
      s += '<line class="gl" x1="' + PL + '" y1="' + y + '" x2="' + (W - PR) + '" y2="' + y + '"/>';
      s += '<text class="at" x="' + (PL - 7) + '" y="' + (y + 3) + '" text-anchor="end">' + v + "</text>";
    }
    var bw = gw / data.length;
    data.forEach(function (r, i) {
      var tc = r.tc || 0, h = tc === 0 ? 4 : (tc / max) * gh, x = PL + i * bw + bw * 0.22, w = bw * 0.56, y = PT + gh - h;
      s += '<rect class="bar ' + (tc === 0 ? "zero" : "") + '" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="5"/>';
      if (tc > 0) s += '<text class="bv" x="' + (x + w / 2) + '" y="' + (y - 6) + '" text-anchor="middle">' + tc + "</text>";
      s += '<text class="at" x="' + (x + w / 2) + '" y="' + (H - 10) + '" text-anchor="middle">' + esc((r.id || "").split("-").pop()) + "</text>";
    });
    svg.innerHTML = s;
    // mini table (Table view)
    $("cd-chart-table").innerHTML = "<table><thead><tr><th>Run</th><th>Story</th><th>Test cases</th></tr></thead><tbody>" +
      data.slice().reverse().map(function (r) { return "<tr><td class='mono'>" + esc(r.id) + "</td><td>" + esc(r.story) + "</td><td>" + (r.tc || 0) + "</td></tr>"; }).join("") + "</tbody></table>";
  }

  function renderTable() {
    var t = $("cd-runs-table");
    if (!runs.length) {
      t.innerHTML = "<tbody><tr><td><div class='cd-empty'>No runs yet — click <b>New run</b>, load a story, and press Play. Completed runs land here.</div></td></tr></tbody>";
      return;
    }
    var head = "<thead><tr><th>Run</th><th>Story</th><th>Source</th><th>Progress</th><th>Test cases</th><th>QA score</th><th>Status</th></tr></thead>";
    var rows = runs.slice().reverse().map(function (r) {
      var status = r.score != null ? "pass" : "hold";
      var label = r.score != null ? "Passed" : (exampleMode ? "Running" : "Recorded");
      return "<tr><td><span class='mono' style='font-weight:600;color:var(--accent-weak-text)'>" + esc(r.id) + "</span></td>" +
        "<td style='font-weight:600'>" + esc(r.story) + "</td>" +
        "<td><span class='cd-sub2'>" + esc(r.source) + "</span></td>" +
        "<td class='mono'>" + esc(r.agents || "") + "</td>" +
        "<td class='mono' style='font-weight:600'>" + (r.tc || 0) + "</td>" +
        "<td class='mono'>" + (r.score != null ? r.score + "%" : "—") + "</td>" +
        "<td><span class='st " + status + "'>" + label + "</span></td></tr>";
    }).join("");
    t.innerHTML = head + "<tbody>" + rows + "</tbody>";
  }

  function renderDetail() {
    var host = $("cd-detail");
    if (!runs.length) { host.innerHTML = "<div class='cd-empty'>Run detail appears here after your first run.</div>"; return; }
    var r = runs[runs.length - 1];
    host.innerHTML = "<span class='rid'>" + esc(r.id) + "</span>" +
      "<div class='rstory'>" + esc(r.story) + "</div>" +
      "<div class='cd-sub2'>" + esc(r.source) + " · " + esc(r.agents || "") + " agents</div>" +
      "<div class='kv'>" +
      "<div class='k'>Test cases</div><div class='v'>" + (r.tc || 0) + "</div>" +
      "<div class='k'>QA score</div><div class='v'>" + (r.score != null ? r.score + "%" : "—") + "</div>" +
      "<div class='k'>Validated</div><div class='v'>" + (r.validated || 0) + "</div>" +
      "</div>";
  }

  // ---- controls -----------------------------------------------------------
  var segChart = $("cd-seg-chart"), segTable = $("cd-seg-table");
  function toggle(chart) {
    segChart.classList.toggle("on", chart); segTable.classList.toggle("on", !chart);
    $("cd-chart-wrap").hidden = !chart; $("cd-chart-table").hidden = chart;
  }
  if (segChart) segChart.onclick = function () { toggle(true); };
  if (segTable) segTable.onclick = function () { toggle(false); };

  // "New run" buttons carry data-view="workspace" — the view router (console-views.js)
  // switches to the workspace and focuses the story input.

  // Expose the live run data + example state to the view router.
  window.QAConsole = {
    runs: function () { return runs.slice(); },
    exampleMode: function () { return exampleMode; },
    EXAMPLE_TILES: EXAMPLE_TILES,
    STAGES: (window.__QA_STAGES__ || null),
    refresh: render
  };

  // Topbar search → filter the recent-runs table live.
  var search = $("cd-search");
  if (search) search.addEventListener("input", function () {
    var q = search.value.toLowerCase().trim();
    var rows = $("cd-runs-table").querySelectorAll("tbody tr");
    rows.forEach(function (tr) {
      tr.style.display = !q || tr.textContent.toLowerCase().indexOf(q) !== -1 ? "" : "none";
    });
  });

  var clear = $("cd-clear");
  if (clear) clear.onclick = function () {
    if (exampleMode) { alert("These are example runs — start a real run and it will replace them."); return; }
    if (!runs.length) return;
    if (!confirm("Clear this session's run history?")) return;
    runs = []; exampleMode = true; runs = EXAMPLE_RUNS.slice(); lastSig = "";
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    render();
  };

  // ---- observe the live app ----------------------------------------------
  var mo = new MutationObserver(function () { maybeRecord(); updateStatus(); });
  if (bar) mo.observe(bar, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  var vr = $("btn-view-report");
  if (vr) mo.observe(vr, { attributes: true, attributeFilter: ["disabled"] });

  render();
})();
