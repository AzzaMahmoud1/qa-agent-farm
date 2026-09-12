/**
 * Console view router — turns the sidebar into a real multi-page app.
 *
 * Each nav item (data-view) swaps the visible <section class="cv-view">. The
 * data views (Runs, Usage, Logs, Reports) render from the shared run store
 * (window.QAConsole); the reference views (Skills, Guardrails, Agents) render
 * the farm's real content; Playground runs a live client-side AC extraction on
 * whatever you paste. No pipeline logic is touched.
 */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); };
  function runs() { return (window.QAConsole && window.QAConsole.runs()) || []; }

  var TITLES = {
    dashboard: ["QA Gateway", "Dashboard"], workspace: ["QA Gateway", "Run workspace"],
    runs: ["Observability", "Runs"], playground: ["QA Gateway", "Playground"],
    skills: ["QA Gateway", "Skills"], usage: ["Observability", "Usage"],
    logs: ["Observability", "Logs"], reports: ["Observability", "Reports"],
    guardrails: ["Config", "Guardrails"], agents: ["Pipeline", "Pipeline agents"]
  };

  // ---- static farm content ------------------------------------------------
  var SKILLS = [
    { n: "requirements_analysis", d: "Extract acceptance criteria, each tied to a verbatim quote. Abstains when evidence is thin.", t: ["core", "grounded"], ic: "ti-search", c: "var(--accent)" },
    { n: "risk_analysis", d: "Likelihood × impact → the P0–P3 priority carried onto every test case. Never blocks.", t: ["advisory"], ic: "ti-shield", c: "var(--warn)" },
    { n: "test_gap_analysis", d: "Boundary, negative, state-transition & decision-table lenses → the coverage gaps to fill.", t: ["advisory"], ic: "ti-chart-dots", c: "var(--info, #2e90fa)" },
    { n: "source_analysis", d: "Change-impact from a diff — only runs when a changeset is present.", t: ["advisory", "conditional"], ic: "ti-git-compare", c: "var(--purple)" },
    { n: "root_cause_analysis", d: "5-Whys + Ishikawa for a failure investigation. Advisory, human-reviewed.", t: ["advisory", "conditional"], ic: "ti-flask", c: "var(--coral)" }
  ];
  var AGENTS = [
    { id: "orchestrator", n: "Orchestrator", m: "Fable 5", d: "Only entry point. Dispatches workers, holds the human-input gate, executes analyst actions.", ic: "ti-target", lvl: "L1" },
    { id: "validator", n: "Output Validator", m: "Sonnet", d: "Second-opinion gate — every worker output is approved before the next agent runs.", ic: "ti-checkup-list", lvl: "L2" },
    { id: "analyst", n: "Requirement Analyst", m: "Sonnet", d: "Runs the 5 analysis skills as grounded isolated passes → acceptance criteria.", ic: "ti-search", lvl: "L3" },
    { id: "writer", n: "Test Case Writer", m: "Sonnet", d: "Turns grounded ACs into Given / When / Then test cases with per-case risk.", ic: "ti-edit", lvl: "L3" },
    { id: "test_data_extractor", n: "Test Data Extractor", m: "Sonnet", d: "Builds valid / invalid / boundary datasets and oracles per test case.", ic: "ti-flask", lvl: "L3" },
    { id: "author", n: "Test Author", m: "Sonnet", d: "Plan → Act → Reflect executable steps from approved outlines (optional).", ic: "ti-tool", lvl: "L3" },
    { id: "test_executor", n: "Test Executor", m: "Sonnet", d: "Runs the plan against the live target, records honest evidence.", ic: "ti-player-play", lvl: "L3" },
    { id: "reviewer", n: "QA Reviewer", m: "Sonnet", d: "Scores coverage, flags gaps and unimplemented-rule violations.", ic: "ti-shield", lvl: "L4" },
    { id: "reporter", n: "Report Generator", m: "Sonnet", d: "Builds the SEHA-style test summary report from real artifacts.", ic: "ti-chart-bar", lvl: "L5" }
  ];
  var GUARDRAILS = [
    { n: "Zero-AC kill switch", cat: "Readiness", d: "No placeholder test cases and no success when zero acceptance criteria are extracted — the pipeline holds for human input.", test: "test/zero-ac-gate.js" },
    { n: "Grounding gate", cat: "Evidence", d: "Every acceptance criterion must quote the story verbatim (≥12 chars) or it is dropped — a confident-but-fabricated PROCEED is unreachable.", test: "src/agents/grounding.js" },
    { n: "Human-input recheck", cat: "Human gate", d: "The Reviewer maps each human answer to the analyst's asks and blames empty/placeholder/wrong-shape inputs before unlocking the Writer.", test: "test/human-input-recheck.js" },
    { n: "Dependency gate", cat: "Sequencing", d: "An agent may start only after its upstream returned structured output AND the Validator approved it — no pre-building past open gates.", test: "test/dependency-gate.js" },
    { n: "Risk is non-gating", cat: "Prioritization", d: "Risk (P0–P3) only prioritizes a condition; a missing or unverifiable risk is left off and never blocks the pipeline.", test: "test/analyst-contract.js" },
    { n: "Honest terminal states", cat: "Integrity", d: "run_end succeeds only at COMPLETE (REVIEW + Reporter). Timeline exhaustion alone is never reported as success.", test: "agents/orchestrator.js" }
  ];

  // ---- small render helpers ----------------------------------------------
  function tile(label, val, icon) {
    return '<div class="cd-tile"><div class="cd-k"><i class="ti ' + icon + '"></i> ' + label + '</div><div class="cd-v">' + val + '</div></div>';
  }
  function runStatus(r) { return r.score != null ? '<span class="st pass">Passed</span>' : '<span class="st hold">Running</span>'; }
  function runsTable(list, cols) {
    if (!list.length) return '<div class="cd-empty">No runs yet — start one from <b>New run</b>.</div>';
    var head = "<thead><tr><th>Run</th><th>Story</th><th>Source</th>" + (cols !== "min" ? "<th>Progress</th>" : "") + "<th>Test cases</th><th>QA score</th><th>Status</th></tr></thead>";
    var body = list.slice().reverse().map(function (r) {
      return "<tr><td><span class='mono' style='font-weight:600;color:var(--accent-weak-text)'>" + esc(r.id) + "</span></td>" +
        "<td style='font-weight:600'>" + esc(r.story) + "</td><td><span class='cd-sub2'>" + esc(r.source) + "</span></td>" +
        (cols !== "min" ? "<td class='mono'>" + esc(r.agents || "") + "</td>" : "") +
        "<td class='mono' style='font-weight:600'>" + (r.tc || 0) + "</td>" +
        "<td class='mono'>" + (r.score != null ? r.score + "%" : "—") + "</td><td>" + runStatus(r) + "</td></tr>";
    }).join("");
    return "<table class='cd-table'>" + head + "<tbody>" + body + "</tbody></table>";
  }
  function barChart(list) {
    if (!list.length) return '<div class="cd-empty">No runs yet.</div>';
    var data = list.slice(-10), W = 640, H = 220, PL = 30, PR = 12, PT = 16, PB = 30, gw = W - PL - PR, gh = H - PT - PB;
    var max = Math.max(10, Math.ceil(Math.max.apply(null, data.map(function (r) { return r.tc || 0; })) / 5) * 5), s = "";
    for (var i = 0; i <= 4; i++) { var v = Math.round(max * i / 4), y = PT + gh - (v / max) * gh; s += '<line class="gl" x1="' + PL + '" y1="' + y + '" x2="' + (W - PR) + '" y2="' + y + '"/><text class="at" x="' + (PL - 7) + '" y="' + (y + 3) + '" text-anchor="end">' + v + '</text>'; }
    var bw = gw / data.length;
    data.forEach(function (r, i) { var tc = r.tc || 0, h = tc === 0 ? 4 : (tc / max) * gh, x = PL + i * bw + bw * 0.22, w = bw * 0.56, y = PT + gh - h; s += '<rect class="bar ' + (tc === 0 ? "zero" : "") + '" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="5"/>' + (tc > 0 ? '<text class="bv" x="' + (x + w / 2) + '" y="' + (y - 6) + '" text-anchor="middle">' + tc + '</text>' : '') + '<text class="at" x="' + (x + w / 2) + '" y="' + (H - 10) + '" text-anchor="middle">' + esc((r.id || "").split("-").pop()) + '</text>'; });
    return '<div class="cd-chart-wrap"><svg class="cd-chart" viewBox="0 0 640 220" preserveAspectRatio="none">' + s + '</svg></div>';
  }
  function card(title, sub, bodyHtml, actions) {
    return '<div class="cd-card"><div class="cd-head"><h2>' + title + '</h2>' + (sub ? '<span class="cd-sub2">' + sub + '</span>' : '') + (actions ? '<div class="cd-head-actions">' + actions + '</div>' : '') + '</div>' + bodyHtml + '</div>';
  }

  // ---- per-view renderers -------------------------------------------------
  var R = {};
  R.runs = function () {
    var list = runs();
    $("cv-runs").innerHTML =
      '<div class="cd-card"><div class="cd-head"><h2>All runs</h2><span class="cd-sub2">' + list.length + ' total</span>' +
      '<div class="cd-head-actions"><button class="btn btn-primary" data-view="workspace"><i class="ti ti-plus"></i> New run</button></div></div>' +
      '<div class="tbl-wrap" style="padding:2px 2px 8px">' + runsTable(list) + '</div></div>';
  };
  R.usage = function () {
    var list = runs();
    var tc = list.reduce(function (a, r) { return a + (r.tc || 0); }, 0);
    var scored = list.filter(function (r) { return r.score != null; });
    var avg = scored.length ? Math.round(scored.reduce(function (a, r) { return a + r.score; }, 0) / scored.length) : "—";
    var jira = list.filter(function (r) { return r.source === "jira"; }).length;
    var req = list.length - jira;
    $("cv-usage").innerHTML =
      '<div class="cd-tiles" style="margin-bottom:16px">' +
      tile("Runs", list.length, "ti-list-details") + tile("Test cases", tc, "ti-edit") +
      tile("Avg QA score", avg === "—" ? "—" : avg + "%", "ti-circle-check") +
      tile("From JIRA", jira, "ti-brand-jira") + tile("From paste", req, "ti-file-text") + '</div>' +
      '<div class="cd-grid2">' +
      card("Test cases by run", "throughput", barChart(list)) +
      card("Source mix", "where stories come from",
        '<div style="padding:18px">' + bar2("JIRA", jira, list.length) + bar2("Requirements", req, list.length) + '</div>') +
      '</div>';
  };
  function bar2(label, n, total) {
    var pct = total ? Math.round(n / total * 100) : 0;
    return '<div style="margin-bottom:14px"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px"><span>' + label + '</span><span class="mono" style="color:var(--text-muted)">' + n + ' · ' + pct + '%</span></div><div style="height:8px;border-radius:8px;background:var(--surface-1);overflow:hidden"><div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg,var(--accent),var(--accent-2,#6172f3))"></div></div></div>';
  }
  R.logs = function () {
    var list = runs();
    var rows = list.length ? list.slice().reverse().map(function (r) {
      var t = r.ts ? new Date(r.ts).toLocaleTimeString() : "—";
      var lvl = r.score != null ? '<span class="st pass">completed</span>' : '<span class="st hold">running</span>';
      return "<tr><td class='mono' style='color:var(--text-muted)'>" + t + "</td><td class='mono' style='color:var(--accent-weak-text)'>" + esc(r.id) + "</td><td>" + esc(r.story) + "</td><td class='mono'>" + (r.tc || 0) + " TCs · " + (r.score != null ? r.score + "%" : "—") + "</td><td>" + lvl + "</td></tr>";
    }).join("") : "";
    $("cv-logs").innerHTML = card("Event log", list.length + " entries", list.length ?
      "<div class='tbl-wrap' style='padding:2px 2px 8px'><table class='cd-table'><thead><tr><th>Time</th><th>Run</th><th>Story</th><th>Result</th><th>Status</th></tr></thead><tbody>" + rows + "</tbody></table></div>" :
      "<div class='cd-empty'>No log entries yet — completed runs appear here.</div>");
  };
  R.reports = function () {
    var list = runs().filter(function (r) { return r.score != null; });
    var body = list.length ? "<div class='tbl-wrap' style='padding:2px 2px 8px'><table class='cd-table'><thead><tr><th>Run</th><th>Story</th><th>Test cases</th><th>QA score</th><th></th></tr></thead><tbody>" +
      list.slice().reverse().map(function (r) {
        return "<tr><td class='mono' style='color:var(--accent-weak-text);font-weight:600'>" + esc(r.id) + "</td><td style='font-weight:600'>" + esc(r.story) + "</td><td class='mono'>" + (r.tc || 0) + "</td><td class='mono'>" + r.score + "%</td><td style='text-align:right'><button class='btn' data-view='workspace'><i class='ti ti-external-link'></i> Open</button></td></tr>";
      }).join("") + "</tbody></table></div>" : "<div class='cd-empty'>No reports yet — finish a run to generate its SEHA-style summary.</div>";
    $("cv-reports").innerHTML = card("Reports", list.length + " completed", body);
  };
  R.skills = function () {
    var a = SKILLS.map(function (s) {
      return '<div class="skill-card"><div class="sc-top"><div class="sc-ic" style="background:color-mix(in srgb,' + s.c + ' 16%,transparent);color:' + s.c + '"><i class="ti ' + s.ic + '"></i></div><h3 class="mono">' + esc(s.n) + '</h3></div><p>' + esc(s.d) + '</p><div class="sc-tags">' + s.t.map(function (t) { return '<span class="chip ' + (t === "core" ? "core" : "") + '">' + t + '</span>'; }).join("") + '</div></div>';
    }).join("");
    var g = AGENTS.map(function (s) {
      return '<div class="skill-card"><div class="sc-top"><div class="sc-ic" style="background:var(--accent-weak);color:var(--accent)"><i class="ti ' + s.ic + '"></i></div><h3>' + esc(s.n) + '</h3></div><p>' + esc(s.d) + '</p><div class="sc-tags"><span class="chip">' + s.lvl + '</span><span class="chip mono">' + esc(s.m) + '</span></div></div>';
    }).join("");
    $("cv-skills").innerHTML = '<div class="cd-note" style="margin-bottom:16px"><i class="ti ti-sparkles"></i> Skills the analyst applies as isolated, grounded passes — one narrow job each.</div>' +
      '<div class="cv-sub">Analysis skills · shared brain</div><div class="skill-grid">' + a + '</div>' +
      '<div class="cv-sub" style="margin-top:22px">Pipeline agents</div><div class="skill-grid">' + g + '</div>';
  };
  R.guardrails = function () {
    var cards = GUARDRAILS.map(function (p) {
      return '<div class="skill-card guard"><div class="sc-top"><div class="sc-ic" style="background:color-mix(in srgb,var(--pass) 16%,transparent);color:var(--pass)"><i class="ti ti-shield-check"></i></div><div><h3>' + esc(p.n) + '</h3><span class="chip">' + esc(p.cat) + '</span></div><span class="guard-on">Enforced</span></div><p>' + esc(p.d) + '</p><div class="sc-tags"><span class="chip mono">' + esc(p.test) + '</span></div></div>';
    }).join("");
    $("cv-guardrails").innerHTML = '<div class="cd-note" style="margin-bottom:16px"><i class="ti ti-shield"></i> Hard gates (P0) — the farm\'s guardrails, enforced in code and covered by regression tests.</div><div class="skill-grid">' + cards + '</div>';
  };
  R.agents = function (agentId) {
    var cards = AGENTS.map(function (s) {
      var live = document.querySelector('.pipeline-step.' + s.id + ', .agent-node[data-role="' + s.id + '"]');
      var st = live && live.classList.contains("running") ? '<span class="st hold">active</span>' : live && live.classList.contains("done") ? '<span class="st pass">done</span>' : '<span class="chip">idle</span>';
      return '<div class="skill-card agent-card" data-agent="' + s.id + '"><div class="sc-top"><div class="sc-ic" style="background:var(--accent-weak);color:var(--accent)"><i class="ti ' + s.ic + '"></i></div><div><h3>' + esc(s.n) + '</h3><span class="chip">' + s.lvl + ' · ' + esc(s.m) + '</span></div><span style="margin-left:auto">' + st + '</span></div><p>' + esc(s.d) + '</p></div>';
    }).join("");
    $("cv-agents").innerHTML = '<div class="cd-note" style="margin-bottom:16px"><i class="ti ti-target"></i> The pipeline agents — the orchestrator dispatches each in turn; status reflects the live run.</div><div class="skill-grid">' + cards + '</div>';
    if (agentId) { var el = $("cv-agents").querySelector('[data-agent="' + agentId + '"]'); if (el) { el.classList.add("hi"); el.scrollIntoView({ block: "center" }); } }
  };
  R.playground = function () {
    if ($("pg-log")) return; // build once
    $("cv-playground").innerHTML = card("Analyst playground", "paste a requirement — get grounded ACs",
      '<div class="pg-log" id="pg-log"></div>' +
      '<div class="pg-input"><input id="pg-in" placeholder="Paste a requirement (Business Rules / AF / EF lines)…"><button class="btn btn-primary" id="pg-send"><i class="ti ti-player-play"></i> Analyze</button></div>');
    pgBot("Paste a user story or a few Business Rule / Alternative Flow / Exception Flow lines. I extract grounded acceptance criteria with a P0–P3 risk each.");
    $("pg-send").onclick = pgSend;
    $("pg-in").addEventListener("keydown", function (e) { if (e.key === "Enter") pgSend(); });
  };
  function pgUser(t) { var l = $("pg-log"); l.insertAdjacentHTML("beforeend", '<div class="pg-msg user"><div class="pg-b">' + esc(t) + '</div></div>'); l.scrollTop = l.scrollHeight; }
  function pgBot(html) { var l = $("pg-log"); l.insertAdjacentHTML("beforeend", '<div class="pg-msg bot"><div class="pg-who"><i class="ti ti-robot"></i></div><div class="pg-b">' + html + '</div></div>'); l.scrollTop = l.scrollHeight; }
  function pgSend() {
    var inp = $("pg-in"), t = inp.value.trim(); if (!t) return; inp.value = "";
    pgUser(t);
    var acs = extractACs(t);
    if (!acs.length) { pgBot('No testable criteria found. Add lines like <span class="mono">BR-1: The system must lock the account after 5 failed attempts.</span>'); return; }
    var body = 'Extracted <b>' + acs.length + '</b> grounded acceptance criteria:<ul class="pg-acs">' +
      acs.map(function (a, i) { return '<li><span class="rc ' + a.risk.toLowerCase() + '">' + a.risk + '</span> AC-' + (i + 1) + ' — ' + esc(a.stmt) + '</li>'; }).join("") + '</ul>' +
      '<div class="pg-note">Each AC quotes your text verbatim (grounding). Risk is prioritization only — it never blocks.</div>';
    setTimeout(function () { pgBot(body); }, 250);
  }
  function extractACs(text) {
    var out = [];
    text.split(/\n|(?<=\.)\s+(?=[A-Z])/).map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (line) {
      var tagged = /^(BR|AF|EF|AC|MSG|DM)[-\s#]?\d*\s*[:\-]/i.test(line);
      var modal = /\b(must|must not|should|shall|is required|cannot|only|may not)\b/i.test(line);
      if (!tagged && !modal) return;
      var stmt = line.replace(/^(BR|AF|EF|AC|MSG|DM)[-\s#]?\d*\s*[:\-]\s*/i, "").trim() || line;
      var risk = /\b(lock|auth|passw|payment|secur|delet|refund|token|credential|bypass|unauthor)/i.test(stmt) ? "P0"
        : /\b(error|fail|timeout|invalid|reject|unavail|retr|expire|conflict)/i.test(stmt) ? "P1"
          : /\b(display|message|label|banner|show|format|text|render)/i.test(stmt) ? "P2" : "P2";
      out.push({ stmt: stmt, risk: risk });
    });
    return out;
  }

  // ---- router -------------------------------------------------------------
  function setActive(view, agentId) {
    document.querySelectorAll(".ll-nav-item").forEach(function (n) {
      var match = n.getAttribute("data-view") === view && (!agentId || !n.getAttribute("data-agent") || n.getAttribute("data-agent") === agentId);
      n.classList.toggle("active", match && (view !== "agents" || n.getAttribute("data-agent") === agentId));
    });
    if (view === "agents" && !agentId) { var d = document.querySelector('.ll-nav-item[data-view="agents"]'); if (d) d.classList.add("active"); }
  }
  function show(view, agentId) {
    if (!view) return;
    document.querySelectorAll(".cv-view").forEach(function (s) { s.hidden = s.getAttribute("data-view") !== view; });
    var t = TITLES[view] || ["QA Gateway", view];
    if ($("cv-eyebrow")) $("cv-eyebrow").textContent = t[0];
    if ($("cv-title")) $("cv-title").textContent = t[1];
    setActive(view, agentId);
    if (R[view]) R[view](agentId);
    window.scrollTo(0, 0);
    if (view === "workspace") { var inp = $("req-description") || $("jira-url"); if (inp) setTimeout(function () { try { inp.focus(); } catch (e) {} }, 200); }
  }
  window.QAViews = { show: show };

  document.addEventListener("click", function (e) {
    var a = e.target.closest("[data-view]");
    if (!a) return;
    e.preventDefault();
    show(a.getAttribute("data-view"), a.getAttribute("data-agent"));
  });

  // start on the dashboard
  show("dashboard");
})();
