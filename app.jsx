const { useState, useRef, useMemo } = React;

const SAMPLE_TICKET = `Title: Login fails when email contains uppercase letters

Description:
Users report that logging in with emails like "User@Example.com" fails even when the account exists. The system should be case-insensitive for email matching.

Acceptance Criteria:
- Email login must be case-insensitive
- Error message must be clear when credentials are wrong
- Session token must be generated correctly after login
- Password remains case-sensitive

Steps to Reproduce:
1. Create account with lowercase email
2. Try logging in with mixed-case version of same email
3. Observe failure

Environment: Web (all browsers), API v2.3
Priority: High
Component: Authentication / Login`;

const JIRA_PRESETS = [
  { key: "SEHJ-10668", label: "SEHJ-10668 — Login case sensitivity", ticket: SAMPLE_TICKET },
];

const AGENTS = [
  { id: "analyst", label: "Analyst", fullLabel: "Requirement Analyst", color: "purple", icon: "ti-file-description", task: "Testable conditions + gaps", depth: "L2" },
  { id: "writer", label: "Writer", fullLabel: "Test Case Writer", color: "teal", icon: "ti-list-check", task: "Gherkin + evidence", depth: "L3" },
  { id: "api", label: "API", fullLabel: "API Test Engineer", color: "amber", icon: "ti-api", task: "Request/response tests", depth: "L3" },
  { id: "reviewer", label: "Reviewer", fullLabel: "QA Reviewer", color: "coral", icon: "ti-shield-check", task: "Root cause + impact", depth: "L4" },
  { id: "reporter", label: "Report", fullLabel: "Report Generator", color: "indigo", icon: "ti-report-analytics", task: "Test summary report", depth: "L5" },
];

const colorMap = {
  purple: { bg: "#f3e8ff", border: "#7c3aed", text: "#5b21b6", light: "#ede9fe" },
  teal: { bg: "#e1f5ee", border: "#0f6e56", text: "#085041", light: "#d1fae5" },
  amber: { bg: "#fef3c7", border: "#d97706", text: "#92400e", light: "#fde68a" },
  coral: { bg: "#ffedd5", border: "#c2410c", text: "#9a3412", light: "#fed7aa" },
  indigo: { bg: "#e0e7ff", border: "#4f46e5", text: "#3730a3", light: "#c7d2fe" },
};

const MOCK_RESPONSES = {
  analyst: {
    testable_conditions: [
      "Login accepts mixed-case email matching stored lowercase account",
      "Wrong password returns a clear, non-leaking error message",
      "Successful login returns a valid session token",
      "Password comparison remains case-sensitive",
      "API v2.3 /auth/login handles email normalization",
    ],
    coverage_gaps: [
      "No explicit test for Unicode normalization in email local-part",
      "Missing rate-limit behavior on repeated failed logins",
    ],
    affected_components: ["Authentication API", "Login UI", "Session service"],
    related_files: ["auth.controller.ts", "login.service.ts", "session.middleware.ts"],
  },
  writer: {
    test_cases: [
      { id: "TC-01", title: "Mixed-case email login succeeds", type: "happy_path", given: "Account exists with email user@example.com", when: "User logs in with User@Example.com and correct password", then: "Login succeeds and session token is issued", expected_evidence: "HTTP 200 with access_token in response body", suggested_file: "tests/api/auth.login.spec.ts" },
      { id: "TC-02", title: "Wrong password returns clear error", type: "negative", given: "Valid account exists", when: "User submits correct email but wrong password", then: "Login is rejected with actionable message", expected_evidence: "HTTP 401 with error code INVALID_CREDENTIALS", suggested_file: "tests/api/auth.login.spec.ts" },
      { id: "TC-03", title: "Password remains case-sensitive", type: "edge_case", given: "Account password is Secret123", when: "User submits secret123", then: "Login fails", expected_evidence: "HTTP 401; no session token issued", suggested_file: "tests/api/auth.login.spec.ts" },
      { id: "TC-04", title: "Unknown email returns same error shape", type: "negative", given: "No account for the email", when: "User attempts login", then: "Error message does not reveal account existence", expected_evidence: "HTTP 401 with generic INVALID_CREDENTIALS message", suggested_file: "tests/api/auth.login.spec.ts" },
    ],
  },
  api: {
    info: { name: "QA Collection — Login", _postman_id: "qa-farm-demo", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
    item: [
      { name: "TC-01 Mixed-case email login", request: { method: "POST", header: [{ key: "Content-Type", value: "application/json" }], body: { mode: "raw", raw: '{"email":"User@Example.com","password":"Secret123"}' }, url: { raw: "{{baseUrl}}/api/auth/login", host: ["{{baseUrl}}"], path: ["api", "auth", "login"] } }, event: [{ listen: "test", script: { exec: ["pm.test('Status 200', () => pm.response.to.have.status(200));", "pm.test('Token present', () => pm.expect(pm.response.json().access_token).to.exist);"] } }] },
      { name: "TC-02 Wrong password", request: { method: "POST", header: [{ key: "Content-Type", value: "application/json" }], body: { mode: "raw", raw: '{"email":"user@example.com","password":"wrong"}' }, url: { raw: "{{baseUrl}}/api/auth/login", host: ["{{baseUrl}}"], path: ["api", "auth", "login"] } }, event: [{ listen: "test", script: { exec: ["pm.test('Status 401', () => pm.response.to.have.status(401));"] } }] },
      { name: "TC-03 Password case-sensitive", request: { method: "POST", header: [{ key: "Content-Type", value: "application/json" }], body: { mode: "raw", raw: '{"email":"user@example.com","password":"secret123"}' }, url: { raw: "{{baseUrl}}/api/auth/login", host: ["{{baseUrl}}"], path: ["api", "auth", "login"] } }, event: [{ listen: "test", script: { exec: ["pm.test('Status 401', () => pm.response.to.have.status(401));"] } }] },
      { name: "TC-04 Unknown email — no enumeration", request: { method: "POST", header: [{ key: "Content-Type", value: "application/json" }], body: { mode: "raw", raw: '{"email":"noreply@example.com","password":"any"}' }, url: { raw: "{{baseUrl}}/api/auth/login", host: ["{{baseUrl}}"], path: ["api", "auth", "login"] } }, event: [{ listen: "test", script: { exec: ["pm.test('Status 401', () => pm.response.to.have.status(401));"] } }] },
    ],
  },
  reviewer: {
    score: "8/10",
    what_is_good: "Covers case-insensitivity, password sensitivity, and error messaging with concrete API evidence.",
    root_cause_risk: "Email normalization may be applied inconsistently between signup and login paths.",
    impact: "High — affected users cannot log in despite valid credentials, blocking access across all browsers.",
    missing_coverage: ["OAuth/social login email alias collision", "Concurrent session invalidation after password reset"],
    codebase_conflicts: [],
    duplicate_coverage: [],
    fix: "Normalize email to lowercase at the API boundary before lookup and add regression tests for signup/login parity.",
  },
  reporter: {
    project_name: "SEHA",
    ticket_key: "SEHJ-10668",
    ticket_title: "Login fails when email contains uppercase letters",
    report_date: new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }),
    environment: "QA Simulator / API v2.3",
    scope: { platform: true, backend: false, web: true, mobile: false },
    regression_rows: [
      { id: "TC-01", title: "Mixed-case email login succeeds", type: "Happy path", status: "Planned" },
      { id: "TC-02", title: "Wrong password returns clear error", type: "Negative", status: "Planned" },
      { id: "TC-03", title: "Password remains case-sensitive", type: "Edge case", status: "Planned" },
      { id: "TC-04", title: "Unknown email — no enumeration", type: "Negative", status: "Planned" },
    ],
    summary: { planned: 4, executed: 0, passed: 0, failed: 0, blocked: 0 },
    defects: { reported: 0, fixed: 0, opened: 0, low: 0, medium: 0, high: 0 },
    comments: "Simulator run — execute against staging backend for live results.",
    reported_by: "QA Agent Farm",
  },
};

function parseTicketMeta(text) {
  const title = text.match(/^Title:\s*(.+)$/m)?.[1]?.trim() || "";
  const priority = text.match(/^Priority:\s*(.+)$/m)?.[1]?.trim() || "";
  const component = text.match(/^Component:\s*(.+)$/m)?.[1]?.trim() || "";
  const jiraKey = text.match(/\b(SEHJ-\d+)\b/)?.[1] || JIRA_PRESETS[0].key;
  return { title, priority, component, jiraKey };
}

function PipelineStepper({ agents, states }) {
  return (
    <div className="pipeline">
      {agents.map((agent, i) => {
        const st = states[agent.id];
        const isDone = st.status === "done";
        const isRunning = st.status === "running";
        const cls = ["pipeline-step", agent.color, isDone ? "done" : "", isRunning ? "running" : ""].filter(Boolean).join(" ");
        return (
          <React.Fragment key={agent.id}>
            {i > 0 && <div className={`pipeline-connector ${isDone || isRunning ? "done" : ""}`} />}
            <div className={cls}>
              <div className="pipeline-dot">
                {isDone ? <i className="ti ti-check" /> : isRunning ? <i className="ti ti-loader-2 spin" /> : <i className={`ti ${agent.icon}`} />}
              </div>
              <span className="pipeline-label">{agent.label}</span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function TestCaseCard({ tc }) {
  return (
    <div className="tc-card fade-up">
      <div className="tc-header">
        <span className="tc-id">{tc.id}</span>
        <span className={`tc-type tc-type-${tc.type}`}>{tc.type.replace("_", " ")}</span>
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{tc.title}</span>
      </div>
      <div className="tc-step"><strong>Given</strong> {tc.given}</div>
      <div className="tc-step"><strong>When</strong> {tc.when}</div>
      <div className="tc-step"><strong>Then</strong> {tc.then}</div>
      <div className="tc-step" style={{ marginTop: 6, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>
        <i className="ti ti-check" style={{ marginRight: 4 }} />{tc.expected_evidence}
      </div>
    </div>
  );
}

function KVOutput({ data, accent }) {
  if (!data || typeof data !== "object") return null;
  return (
    <div className="kv-list">
      {Object.entries(data).map(([key, val]) => (
        <div key={key} className="kv-item" style={{ borderLeftColor: accent }}>
          <div className="kv-key">{key.replace(/_/g, " ")}</div>
          <div className="kv-val">
            {Array.isArray(val) ? (
              <ul>{val.map((item, i) => <li key={i}>{typeof item === "object" ? JSON.stringify(item) : item}</li>)}</ul>
            ) : typeof val === "object" && val !== null ? (
              JSON.stringify(val, null, 2)
            ) : (
              String(val)
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReviewPanel({ data }) {
  if (!data) return null;
  const [num, denom] = (data.score || "0/10").split("/");
  const pct = Math.round((parseInt(num, 10) / parseInt(denom, 10)) * 100) || 0;
  const ringColor = pct >= 7 ? "#059669" : pct >= 5 ? "#d97706" : "#dc2626";

  return (
    <div>
      <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 16 }}>
        <div className="score-ring" style={{ borderColor: ringColor, color: ringColor }}>
          <span className="score-value">{data.score}</span>
          <span className="score-label">Score</span>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>What is good</div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.55 }}>{data.what_is_good}</div>
        </div>
      </div>
      <KVOutput data={{
        "Root cause risk": data.root_cause_risk,
        Impact: data.impact,
        Fix: data.fix,
        "Missing coverage": data.missing_coverage,
      }} accent="#c2410c" />
    </div>
  );
}

function ReportPanel({ data, ticketMeta }) {
  if (!data) return null;
  const statusClass = (s) => {
    if (s === "Pass" || s === "Passed") return "status-pass";
    if (s === "Fail" || s === "Failed") return "status-fail";
    if (s === "Blocked") return "status-blocked";
    return "status-manual";
  };

  return (
    <div>
      <div className="report-section">
        <h3 className="report-section-title">General Information</h3>
        <table className="report-table">
          <tbody>
            {[["Project", data.project_name], ["Ticket", data.ticket_key || ticketMeta.jiraKey], ["Title", data.ticket_title || ticketMeta.title], ["Report Date", data.report_date], ["Environment", data.environment]].map(([k, v]) => (
              <tr key={k}><th style={{ width: "30%" }}>{k}</th><td>{v}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="report-section">
        <h3 className="report-section-title">Test Cases — Planned vs Executed</h3>
        <div className="stats-row">
          {[
            { label: "Planned", value: data.summary?.planned ?? 0 },
            { label: "Executed", value: data.summary?.executed ?? 0 },
            { label: "Passed", value: data.summary?.passed ?? 0, color: "#059669" },
            { label: "Failed", value: data.summary?.failed ?? 0, color: "#dc2626" },
          ].map(s => (
            <div key={s.label} className="stat-card">
              <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="report-section">
        <h3 className="report-section-title">Regression Testing</h3>
        <table className="report-table">
          <thead><tr><th>ID</th><th>Test Case</th><th>Type</th><th>Status</th></tr></thead>
          <tbody>
            {(data.regression_rows || []).map(row => (
              <tr key={row.id}>
                <td><code style={{ fontSize: 11 }}>{row.id}</code></td>
                <td>{row.title}</td>
                <td>{row.type}</td>
                <td className={statusClass(row.status)}>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="report-section">
        <h3 className="report-section-title">Defects Report</h3>
        <table className="report-table">
          <thead><tr><th>Reported</th><th>Fixed</th><th>Opened</th><th>Low</th><th>Medium</th><th>High</th></tr></thead>
          <tbody>
            <tr>
              <td>{data.defects?.reported ?? 0}</td>
              <td>{data.defects?.fixed ?? 0}</td>
              <td>{data.defects?.opened ?? 0}</td>
              <td>{data.defects?.low ?? 0}</td>
              <td>{data.defects?.medium ?? 0}</td>
              <td>{data.defects?.high ?? 0}</td>
            </tr>
          </tbody>
        </table>
        {data.comments && <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}><strong>Comments:</strong> {data.comments}</p>}
        <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 8 }}><strong>Reported by:</strong> {data.reported_by}</p>
      </div>
    </div>
  );
}

function AgentCard({ agent, state, expanded, onToggle }) {
  const c = colorMap[agent.color];
  const isRunning = state.status === "running";
  const isDone = state.status === "done";

  return (
    <div className={`agent-card ${isDone ? "is-done" : ""} ${isRunning ? "is-running" : ""} fade-up`}>
      <div className="agent-card-header" onClick={isDone ? onToggle : undefined} style={{ cursor: isDone ? "pointer" : "default" }}>
        <div className="agent-icon" style={{ background: isDone ? c.border : c.light, color: isDone ? "#fff" : c.text }}>
          <i className={`ti ${agent.icon}`} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{agent.fullLabel}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{agent.task} · {agent.depth}</div>
        </div>
        <span className={`agent-status status-${state.status}`}>
          {isDone ? "Done" : isRunning ? "Running" : "Waiting"}
        </span>
        {isDone && <i className={`ti ti-chevron-${expanded ? "up" : "down"}`} style={{ color: "var(--text-muted)", fontSize: 16 }} />}
      </div>
      {isRunning && (
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${state.progress}%`, background: c.border }} />
        </div>
      )}
      {isDone && expanded && state.structured && (
        <div className="agent-card-body">
          <KVOutput data={state.structured} accent={c.border} />
        </div>
      )}
    </div>
  );
}

function QAAgentFarm() {
  const [ticket, setTicket] = useState(SAMPLE_TICKET);
  const [jiraUrl, setJiraUrl] = useState("https://leansa.atlassian.net/browse/SEHJ-10668");
  const [agentStates, setAgentStates] = useState(
    Object.fromEntries(AGENTS.map(a => [a.id, { status: "idle", structured: null, rawOutput: "", progress: 0 }]))
  );
  const [expandedAgents, setExpandedAgents] = useState({});
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState([]);
  const [postmanJSON, setPostmanJSON] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const logRef = useRef(null);

  const ticketMeta = useMemo(() => parseTicketMeta(ticket), [ticket]);
  const priorityChip = ticketMeta.priority.toLowerCase().includes("high") ? "chip-high" : ticketMeta.priority.toLowerCase().includes("low") ? "chip-low" : "chip-medium";

  const outputs = {
    analyst: agentStates.analyst.structured,
    writer: agentStates.writer.structured,
    api: agentStates.api.structured,
    reviewer: agentStates.reviewer.structured,
    reporter: agentStates.reporter.structured,
  };

  const allDone = AGENTS.every(a => agentStates[a.id].status === "done");
  const doneCount = AGENTS.filter(a => agentStates[a.id].status === "done").length;
  const tcCount = outputs.writer?.test_cases?.length ?? 0;

  const addLog = (msg, type = "info") => {
    setLog(prev => [...prev, { time: new Date().toLocaleTimeString(), msg, type }]);
    setTimeout(() => logRef.current?.scrollTo(0, logRef.current.scrollHeight), 50);
  };

  const setAgent = (id, patch) => setAgentStates(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const simulateProgress = async (id, duration = 3000) => {
    const steps = 20;
    for (let i = 1; i <= steps; i++) {
      await new Promise(r => setTimeout(r, duration / steps));
      setAgent(id, { progress: Math.min(i * (100 / steps), 95) });
    }
  };

  const callAgent = async (agentId) => {
    await new Promise(r => setTimeout(r, 500 + Math.random() * 400));
    return JSON.stringify(MOCK_RESPONSES[agentId]);
  };

  const parseJSON = (text) => {
    try { return JSON.parse(text.replace(/```json|```/g, "").trim()); }
    catch { return null; }
  };

  const loadPreset = (preset) => {
    setTicket(preset.ticket);
    setJiraUrl(`https://leansa.atlassian.net/browse/${preset.key}`);
  };

  const runFarm = async () => {
    setRunning(true);
    setPostmanJSON(null);
    setLog([]);
    setExpandedAgents({});
    AGENTS.forEach(a => setAgent(a.id, { status: "idle", structured: null, rawOutput: "", progress: 0 }));
    setActiveTab("overview");

    const steps = [
      { id: "analyst", label: "Requirement Analyst", duration: 2200, log: "Analyst — extracting testable conditions" },
      { id: "writer", label: "Test Case Writer", duration: 2400, log: "Writer — Gherkin cases with evidence" },
      { id: "api", label: "API Test Engineer", duration: 2600, log: "API Engineer — Postman collection ready" },
      { id: "reviewer", label: "QA Reviewer", duration: 2000, log: "Reviewer — root cause + impact assessed" },
      { id: "reporter", label: "Report Generator", duration: 1800, log: "Reporter — test summary report generated" },
    ];

    try {
      let writerCaseCount = MOCK_RESPONSES.writer.test_cases.length;

      for (const step of steps) {
        addLog(`${step.label} starting…`);
        setAgent(step.id, { status: "running", progress: 5 });
        const [raw] = await Promise.all([callAgent(step.id), simulateProgress(step.id, step.duration)]);
        const json = parseJSON(raw);

        if (step.id === "api") {
          if (json) setPostmanJSON(json);
          const apiStructured = json ? {
            collection: json.info?.name,
            requests: (json.item || []).map(i => `${i.request?.method} ${i.name}`),
            assertions: (json.item || []).length * 2,
          } : null;
          setAgent(step.id, { status: "done", structured: apiStructured, rawOutput: raw, progress: 100 });
        } else if (step.id === "writer") {
          if (json?.test_cases) writerCaseCount = json.test_cases.length;
          setAgent(step.id, { status: "done", structured: json, rawOutput: raw, progress: 100 });
        } else if (step.id === "reporter") {
          const report = json ? {
            ...json,
            ticket_key: ticketMeta.jiraKey,
            ticket_title: ticketMeta.title || json.ticket_title,
            summary: { planned: writerCaseCount, executed: 0, passed: 0, failed: 0, blocked: 0 },
          } : null;
          setAgent(step.id, { status: "done", structured: report, rawOutput: raw, progress: 100 });
        } else {
          setAgent(step.id, { status: "done", structured: json, rawOutput: raw, progress: 100 });
        }
        addLog(`✓ ${step.log}`, "success");
      }
      addLog("Pipeline complete — all 5 agents finished", "success");
      setActiveTab("cases");
    } catch (err) {
      addLog(`Error: ${err.message}`, "error");
    }
    setRunning(false);
  };

  const downloadJSON = (data, filename) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  };

  const toggleAgent = (id) => setExpandedAgents(prev => ({ ...prev, [id]: !prev[id] }));

  const tabs = [
    { id: "overview", icon: "ti-layout-dashboard", label: "Overview" },
    { id: "cases", icon: "ti-list-check", label: "Test Cases", badge: tcCount || null },
    { id: "api", icon: "ti-api", label: "API Tests", badge: postmanJSON ? postmanJSON.item?.length : null },
    { id: "review", icon: "ti-shield-check", label: "Review" },
    { id: "report", icon: "ti-report-analytics", label: "Report" },
    { id: "log", icon: "ti-terminal", label: "Activity" },
  ];

  return (
    <div>
      <header className="app-header">
        <div>
          <h1 className="app-title">QA Agent Farm</h1>
          <p className="app-subtitle">5-agent pipeline — requirements → tests → API → review → report</p>
        </div>
        <span className="sim-pill"><i className="ti ti-flask" /> Simulator · no API key needed</span>
      </header>

      <div className="dashboard">
        <aside>
          <div className="panel" style={{ marginBottom: "1rem" }}>
            <div className="panel-header">
              <h2 className="panel-title"><i className="ti ti-ticket" /> Ticket Input</h2>
            </div>
            <div className="panel-body">
              <label className="field-label">JIRA URL</label>
              <input
                className="input"
                value={jiraUrl}
                onChange={e => setJiraUrl(e.target.value)}
                disabled={running}
                placeholder="https://…/browse/SEHJ-XXXX"
                style={{ marginBottom: 12 }}
              />

              <label className="field-label">Quick load</label>
              <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                {JIRA_PRESETS.map(p => (
                  <button key={p.key} className="btn btn-ghost" onClick={() => loadPreset(p)} disabled={running}>
                    {p.key}
                  </button>
                ))}
              </div>

              <label className="field-label">Ticket content</label>
              <textarea
                className="textarea"
                value={ticket}
                onChange={e => setTicket(e.target.value)}
                disabled={running}
                rows={10}
              />

              {ticketMeta.title && (
                <div className="chips">
                  {ticketMeta.jiraKey && <span className="chip chip-key"><i className="ti ti-link" /> {ticketMeta.jiraKey}</span>}
                  {ticketMeta.priority && <span className={`chip ${priorityChip}`}>{ticketMeta.priority}</span>}
                  {ticketMeta.component && <span className="chip"><i className="ti ti-components" /> {ticketMeta.component}</span>}
                </div>
              )}

              <button className="btn btn-primary" onClick={runFarm} disabled={running || !ticket.trim()} style={{ marginTop: 16 }}>
                <i className={`ti ${running ? "ti-loader-2 spin" : "ti-player-play"}`} />
                {running ? `Running… (${doneCount}/5)` : "Run QA Pipeline"}
              </button>
            </div>
          </div>

          {allDone && (
            <div className="panel fade-up">
              <div className="panel-header"><h2 className="panel-title"><i className="ti ti-download" /> Exports</h2></div>
              <div className="panel-body" style={{ display: "grid", gap: 8 }}>
                {postmanJSON && (
                  <button className="btn btn-success" onClick={() => downloadJSON(postmanJSON, "qa_collection.postman_collection.json")}>
                    <i className="ti ti-api" /> Postman Collection
                  </button>
                )}
                {outputs.reporter && (
                  <button className="btn btn-ghost" onClick={() => downloadJSON(outputs.reporter, "test_summary_report.json")}>
                    <i className="ti ti-report" /> Test Report (JSON)
                  </button>
                )}
                {outputs.writer && (
                  <button className="btn btn-ghost" onClick={() => downloadJSON(outputs.writer, "test_cases.json")}>
                    <i className="ti ti-list" /> Test Cases (JSON)
                  </button>
                )}
              </div>
            </div>
          )}
        </aside>

        <main className="panel">
          <PipelineStepper agents={AGENTS} states={agentStates} />

          {allDone && (
            <div className="stats-row" style={{ padding: "0 1.25rem" }}>
              <div className="stat-card"><div className="stat-value" style={{ color: "#7c3aed" }}>{tcCount}</div><div className="stat-label">Test Cases</div></div>
              <div className="stat-card"><div className="stat-value" style={{ color: "#d97706" }}>{postmanJSON?.item?.length ?? 0}</div><div className="stat-label">API Requests</div></div>
              <div className="stat-card"><div className="stat-value" style={{ color: "#059669" }}>{outputs.reviewer?.score ?? "—"}</div><div className="stat-label">QA Score</div></div>
              <div className="stat-card"><div className="stat-value" style={{ color: "#4f46e5" }}>5/5</div><div className="stat-label">Agents Done</div></div>
            </div>
          )}

          <div style={{ padding: "0 1.25rem 1.25rem" }}>
            <div className="tabs">
              {tabs.map(t => (
                <button key={t.id} className={`tab ${activeTab === t.id ? "active" : ""}`} onClick={() => setActiveTab(t.id)}>
                  <i className={`ti ${t.icon}`} />{t.label}
                  {t.badge ? <span className="tab-badge">{t.badge}</span> : null}
                </button>
              ))}
            </div>

            {activeTab === "overview" && (
              !allDone && !running ? (
                <div className="empty-state">
                  <i className="ti ti-robot" />
                  <h3>Ready to run</h3>
                  <p>Paste a JIRA ticket or use a preset, then click <strong>Run QA Pipeline</strong> to watch all 5 agents work.</p>
                </div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {AGENTS.map(agent => (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      state={agentStates[agent.id]}
                      expanded={expandedAgents[agent.id] !== false}
                      onToggle={() => toggleAgent(agent.id)}
                    />
                  ))}
                </div>
              )
            )}

            {activeTab === "cases" && (
              outputs.writer?.test_cases ? (
                <div className="tc-grid">
                  {outputs.writer.test_cases.map(tc => <TestCaseCard key={tc.id} tc={tc} />)}
                </div>
              ) : (
                <div className="empty-state"><i className="ti ti-list-check" /><h3>No test cases yet</h3><p>Run the pipeline to generate Gherkin test cases.</p></div>
              )
            )}

            {activeTab === "api" && (
              postmanJSON ? (
                <div>
                  <div style={{ marginBottom: 12 }}>
                    {(postmanJSON.item || []).map((item, i) => (
                      <div key={i} className="api-request">
                        <span className="method-badge">{item.request?.method}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{item.name}</div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                            {item.request?.url?.path?.join("/")}
                          </div>
                        </div>
                        <button className="btn btn-ghost" onClick={() => downloadJSON(postmanJSON, "qa_collection.postman_collection.json")}>
                          <i className="ti ti-download" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <pre className="code-block">{JSON.stringify(postmanJSON, null, 2)}</pre>
                </div>
              ) : (
                <div className="empty-state"><i className="ti ti-api" /><h3>No API tests yet</h3><p>Run the pipeline to generate a Postman collection.</p></div>
              )
            )}

            {activeTab === "review" && (
              outputs.reviewer ? <ReviewPanel data={outputs.reviewer} /> : (
                <div className="empty-state"><i className="ti ti-shield-check" /><h3>No review yet</h3><p>Run the pipeline for QA score and recommendations.</p></div>
              )
            )}

            {activeTab === "report" && (
              outputs.reporter ? <ReportPanel data={outputs.reporter} ticketMeta={ticketMeta} /> : (
                <div className="empty-state"><i className="ti ti-report-analytics" /><h3>No report yet</h3><p>Run the pipeline to generate a test summary report.</p></div>
              )
            )}

            {activeTab === "log" && (
              <div ref={logRef} className="log-panel">
                {log.length === 0
                  ? <span style={{ color: "#475569" }}>Activity log will appear here…</span>
                  : log.map((l, i) => (
                    <div key={i} className={`log-${l.type}`}>
                      <span className="log-time">{l.time}</span>{l.msg}
                    </div>
                  ))
                }
              </div>
            )}

            {allDone && (
              <div className="success-banner fade-up">
                <i className="ti ti-circle-check" />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#065f46" }}>Pipeline complete</div>
                  <div style={{ fontSize: 12, color: "#047857" }}>
                    {tcCount} test cases · {postmanJSON?.item?.length ?? 0} API requests · score {outputs.reviewer?.score}
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<QAAgentFarm />);

