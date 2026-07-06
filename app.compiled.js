const {
  useState,
  useRef
} = React;
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
const AGENTS = [{
  id: "analyst",
  label: "Requirement Analyst",
  color: "purple",
  icon: "ti-file-description",
  task: "L2 — Conditions + coverage gaps",
  depth: "Level 2"
}, {
  id: "writer",
  label: "Test Case Writer",
  color: "teal",
  icon: "ti-list-check",
  task: "L3 — Steps + expected evidence",
  depth: "Level 3"
}, {
  id: "api",
  label: "API Test Engineer",
  color: "amber",
  icon: "ti-api",
  task: "L3 — Request/response evidence",
  depth: "Level 3"
}, {
  id: "reviewer",
  label: "QA Reviewer",
  color: "coral",
  icon: "ti-shield-check",
  task: "L4 — Root cause + impact + fix",
  depth: "Level 4"
}];
const colorMap = {
  purple: {
    bg: "var(--bg-pro)",
    border: "var(--border-pro)",
    text: "var(--text-pro)",
    badge: "#7C3AED"
  },
  teal: {
    bg: "#E1F5EE",
    border: "#0F6E56",
    text: "#085041",
    badge: "#0F6E56"
  },
  amber: {
    bg: "var(--bg-warning)",
    border: "var(--border-warning)",
    text: "var(--text-warning)",
    badge: "#B45309"
  },
  coral: {
    bg: "#FAECE7",
    border: "#993C1D",
    text: "#712B13",
    badge: "#993C1D"
  }
};
const MOCK_RESPONSES = {
  analyst: {
    testable_conditions: ["Login accepts mixed-case email matching stored lowercase account", "Wrong password returns a clear, non-leaking error message", "Successful login returns a valid session token", "Password comparison remains case-sensitive", "API v2.3 /auth/login handles email normalization"],
    coverage_gaps: ["No explicit test for Unicode normalization in email local-part", "Missing rate-limit behavior on repeated failed logins"],
    affected_components: ["Authentication API", "Login UI", "Session service"]
  },
  writer: {
    test_cases: [{
      id: "TC-01",
      title: "Mixed-case email login succeeds",
      type: "happy_path",
      given: "Account exists with email user@example.com",
      when: "User logs in with User@Example.com and correct password",
      then: "Login succeeds and session token is issued",
      expected_evidence: "HTTP 200 with access_token in response body"
    }, {
      id: "TC-02",
      title: "Wrong password returns clear error",
      type: "negative",
      given: "Valid account exists",
      when: "User submits correct email but wrong password",
      then: "Login is rejected with actionable message",
      expected_evidence: "HTTP 401 with error code INVALID_CREDENTIALS"
    }, {
      id: "TC-03",
      title: "Password remains case-sensitive",
      type: "edge_case",
      given: "Account password is Secret123",
      when: "User submits secret123",
      then: "Login fails",
      expected_evidence: "HTTP 401; no session token issued"
    }, {
      id: "TC-04",
      title: "Unknown email returns same error shape",
      type: "negative",
      given: "No account for the email",
      when: "User attempts login",
      then: "Error message does not reveal account existence",
      expected_evidence: "HTTP 401 with generic INVALID_CREDENTIALS message"
    }]
  },
  api: {
    info: {
      name: "QA Collection — Login",
      _postman_id: "qa-farm-demo",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
    },
    item: [{
      name: "TC-01 Mixed-case email login",
      request: {
        method: "POST",
        header: [{
          key: "Content-Type",
          value: "application/json"
        }],
        body: {
          mode: "raw",
          raw: '{"email":"User@Example.com","password":"Secret123"}'
        },
        url: {
          raw: "{{baseUrl}}/api/auth/login",
          host: ["{{baseUrl}}"],
          path: ["api", "auth", "login"]
        }
      },
      event: [{
        listen: "test",
        script: {
          exec: ["pm.test('Status 200', () => pm.response.to.have.status(200));", "pm.test('Token present', () => pm.expect(pm.response.json().access_token).to.exist);"]
        }
      }]
    }, {
      name: "TC-02 Wrong password",
      request: {
        method: "POST",
        header: [{
          key: "Content-Type",
          value: "application/json"
        }],
        body: {
          mode: "raw",
          raw: '{"email":"user@example.com","password":"wrong"}'
        },
        url: {
          raw: "{{baseUrl}}/api/auth/login",
          host: ["{{baseUrl}}"],
          path: ["api", "auth", "login"]
        }
      },
      event: [{
        listen: "test",
        script: {
          exec: ["pm.test('Status 401', () => pm.response.to.have.status(401));"]
        }
      }]
    }]
  },
  reviewer: {
    score: "8/10",
    what_is_good: "Covers case-insensitivity, password sensitivity, and error messaging with concrete API evidence.",
    root_cause_risk: "Email normalization may be applied inconsistently between signup and login paths.",
    impact: "High — affected users cannot log in despite valid credentials, blocking access across all browsers.",
    missing_coverage: ["OAuth/social login email alias collision", "Concurrent session invalidation after password reset"],
    fix: "Normalize email to lowercase at the API boundary before lookup and add regression tests for signup/login parity."
  }
};
function StructuredOutput({
  data,
  color
}) {
  const c = colorMap[color];
  if (!data || typeof data !== "object") return null;
  const renderValue = val => {
    if (Array.isArray(val)) {
      return /*#__PURE__*/React.createElement("ul", {
        style: {
          margin: "4px 0 0 0",
          paddingLeft: 16
        }
      }, val.map((item, i) => /*#__PURE__*/React.createElement("li", {
        key: i,
        style: {
          marginBottom: 3,
          fontSize: 12,
          lineHeight: 1.5
        }
      }, typeof item === "object" ? JSON.stringify(item) : item)));
    }
    if (typeof val === "object" && val !== null) {
      return /*#__PURE__*/React.createElement("div", {
        style: {
          paddingLeft: 10,
          borderLeft: `2px solid ${c.border}`,
          marginTop: 4
        }
      }, Object.entries(val).map(([k, v]) => /*#__PURE__*/React.createElement("div", {
        key: k,
        style: {
          marginBottom: 4
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          opacity: 0.7
        }
      }, k, ": "), /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 12
        }
      }, String(v)))));
    }
    return /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        lineHeight: 1.6
      }
    }, String(val));
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 8,
      marginTop: 10
    }
  }, Object.entries(data).map(([key, val]) => /*#__PURE__*/React.createElement("div", {
    key: key,
    style: {
      background: "rgba(255,255,255,0.6)",
      borderRadius: 7,
      padding: "8px 10px",
      borderLeft: `3px solid ${c.border}`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: "0.06em",
      color: c.badge,
      marginBottom: 3
    }
  }, key.replace(/_/g, " ")), /*#__PURE__*/React.createElement("div", {
    style: {
      color: c.text
    }
  }, renderValue(val)))));
}
function DepthBadge({
  label,
  color
}) {
  const c = colorMap[color];
  return /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      fontWeight: 600,
      padding: "2px 7px",
      borderRadius: 99,
      background: c.badge,
      color: "#fff",
      letterSpacing: "0.04em"
    }
  }, label);
}
function AgentCard({
  agent,
  status,
  structured,
  rawOutput,
  progress
}) {
  const c = colorMap[agent.color];
  const isRunning = status === "running";
  const isDone = status === "done";
  return /*#__PURE__*/React.createElement("div", {
    style: {
      border: `1px solid ${isDone ? c.border : "var(--border)"}`,
      borderRadius: 12,
      padding: "16px",
      background: isDone ? c.bg : "var(--surface-1)",
      transition: "all 0.3s ease",
      position: "relative",
      overflow: "hidden"
    }
  }, isRunning && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: 3,
      background: `linear-gradient(90deg, transparent, ${c.border}, transparent)`,
      animation: "shimmer 1.4s infinite"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 36,
      height: 36,
      borderRadius: 8,
      background: isDone ? c.border : "var(--surface-0)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      transition: "all 0.3s",
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: `ti ${agent.icon}`,
    style: {
      fontSize: 18,
      color: isDone ? "#fff" : "var(--text-secondary)"
    },
    "aria-hidden": "true"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      fontWeight: 500,
      color: isDone ? c.text : "var(--text-primary)"
    }
  }, agent.label), /*#__PURE__*/React.createElement(DepthBadge, {
    label: agent.depth,
    color: agent.color
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "var(--text-muted)",
      marginTop: 2
    }
  }, agent.task)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      fontWeight: 500,
      flexShrink: 0,
      color: isDone ? c.text : isRunning ? "var(--text-accent)" : "var(--text-muted)"
    }
  }, isDone ? "Done" : isRunning ? "Running…" : "Waiting")), isRunning && /*#__PURE__*/React.createElement("div", {
    style: {
      height: 4,
      background: "var(--surface-0)",
      borderRadius: 2,
      margin: "8px 0"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: "100%",
      borderRadius: 2,
      background: c.border,
      width: `${progress}%`,
      transition: "width 0.3s ease"
    }
  })), isDone && (structured ? /*#__PURE__*/React.createElement(StructuredOutput, {
    data: structured,
    color: agent.color
  }) : rawOutput && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10,
      fontSize: 12,
      color: c.text,
      background: "rgba(255,255,255,0.55)",
      borderRadius: 8,
      padding: "10px 12px",
      whiteSpace: "pre-wrap",
      lineHeight: 1.6,
      maxHeight: 220,
      overflowY: "auto",
      fontFamily: agent.id === "api" ? "var(--font-mono)" : "inherit"
    }
  }, rawOutput)));
}
function QAAgentFarm() {
  const [ticket, setTicket] = useState(SAMPLE_TICKET);
  const [agentStates, setAgentStates] = useState(Object.fromEntries(AGENTS.map(a => [a.id, {
    status: "idle",
    structured: null,
    rawOutput: "",
    progress: 0
  }])));
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState([]);
  const [postmanJSON, setPostmanJSON] = useState(null);
  const [activeTab, setActiveTab] = useState("agents");
  const logRef = useRef(null);
  const addLog = msg => {
    setLog(prev => [...prev, {
      time: new Date().toLocaleTimeString(),
      msg
    }]);
    setTimeout(() => logRef.current?.scrollTo(0, logRef.current.scrollHeight), 50);
  };
  const setAgent = (id, patch) => setAgentStates(prev => ({
    ...prev,
    [id]: {
      ...prev[id],
      ...patch
    }
  }));
  const simulateProgress = async (id, duration = 3500) => {
    const steps = 20;
    for (let i = 1; i <= steps; i++) {
      await new Promise(r => setTimeout(r, duration / steps));
      setAgent(id, {
        progress: Math.min(i * (100 / steps), 95)
      });
    }
  };
  const callClaude = async agentId => {
    await new Promise(r => setTimeout(r, 600 + Math.random() * 400));
    return JSON.stringify(MOCK_RESPONSES[agentId]);
  };
  const parseJSON = text => {
    try {
      return JSON.parse(text.replace(/```json|```/g, "").trim());
    } catch {
      return null;
    }
  };
  const runFarm = async () => {
    setRunning(true);
    setPostmanJSON(null);
    setLog([]);
    AGENTS.forEach(a => setAgent(a.id, {
      status: "idle",
      structured: null,
      rawOutput: "",
      progress: 0
    }));
    setActiveTab("agents");
    try {
      addLog("🔍 Requirement Analyst starting (Level 2 reporting)…");
      setAgent("analyst", {
        status: "running",
        progress: 5
      });
      const [analystRaw] = await Promise.all([callClaude("analyst"), simulateProgress("analyst", 2500)]);
      const analystJSON = parseJSON(analystRaw);
      setAgent("analyst", {
        status: "done",
        structured: analystJSON,
        rawOutput: analystRaw,
        progress: 100
      });
      addLog("✅ Analyst — testable conditions + coverage gaps extracted");
      addLog("📝 Test Case Writer starting (Level 3 reporting)…");
      setAgent("writer", {
        status: "running",
        progress: 5
      });
      const [writerRaw] = await Promise.all([callClaude("writer"), simulateProgress("writer", 2800)]);
      const writerJSON = parseJSON(writerRaw);
      setAgent("writer", {
        status: "done",
        structured: writerJSON,
        rawOutput: writerRaw,
        progress: 100
      });
      addLog("✅ Writer — Gherkin cases with expected evidence written");
      addLog("🔌 API Test Engineer starting (Level 3 reporting)…");
      setAgent("api", {
        status: "running",
        progress: 5
      });
      const [apiRaw] = await Promise.all([callClaude("api"), simulateProgress("api", 3000)]);
      const postman = parseJSON(apiRaw);
      if (postman) setPostmanJSON(postman);
      const apiStructured = postman ? {
        collection_name: postman.info?.name || "QA Collection",
        requests: (postman.item || []).map(i => `${i.request?.method} — ${i.name}`),
        evidence_checks: (postman.item || []).flatMap(i => (i.event || []).filter(e => e.listen === "test").flatMap(e => e.script?.exec || []).filter(l => l.trim()).slice(0, 2))
      } : null;
      setAgent("api", {
        status: "done",
        structured: apiStructured,
        rawOutput: apiRaw,
        progress: 100
      });
      addLog("✅ API Engineer — Postman collection with evidence checks ready");
      addLog("🛡️ QA Reviewer starting (Level 4 reporting)…");
      setAgent("reviewer", {
        status: "running",
        progress: 5
      });
      const [reviewRaw] = await Promise.all([callClaude("reviewer"), simulateProgress("reviewer", 2200)]);
      const reviewJSON = parseJSON(reviewRaw);
      setAgent("reviewer", {
        status: "done",
        structured: reviewJSON,
        rawOutput: reviewRaw,
        progress: 100
      });
      addLog("✅ Reviewer — root cause, impact, and fix assessed");
      addLog("🎉 Farm run complete — all 4 agents finished with structured reports");
    } catch (err) {
      addLog(`❌ Error: ${err.message}`);
    }
    setRunning(false);
  };
  const downloadPostman = () => {
    if (!postmanJSON) return;
    const blob = new Blob([JSON.stringify(postmanJSON, null, 2)], {
      type: "application/json"
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "qa_collection.postman_collection.json";
    a.click();
  };
  const allDone = AGENTS.every(a => agentStates[a.id].status === "done");
  return /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-sans)",
      color: "var(--text-primary)",
      padding: "0 0 2rem"
    }
  }, /*#__PURE__*/React.createElement("style", null, `
        @keyframes shimmer { 0%{transform:translateX(-100%)} 100%{transform:translateX(200%)} }
        textarea:focus { outline: none; box-shadow: 0 0 0 2px var(--border-accent); }
        .tab-btn { background: none; border: none; padding: 8px 16px; font-size: 13px; cursor: pointer; border-bottom: 2px solid transparent; color: var(--text-secondary); font-family: var(--font-sans); }
        .tab-btn.active { border-bottom-color: var(--text-accent); color: var(--text-accent); font-weight: 500; }
        .tab-btn:hover:not(.active) { color: var(--text-primary); }
      `), /*#__PURE__*/React.createElement("div", {
    className: "sim-banner"
  }, /*#__PURE__*/React.createElement("strong", null, "Simulator mode"), " \u2014 agents run with mock responses (no API key required). Click ", /*#__PURE__*/React.createElement("em", null, "Run agent farm"), " to watch the pipeline."), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 18,
      fontWeight: 500,
      marginBottom: 4
    }
  }, "QA Agent Farm"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "var(--text-muted)"
    }
  }, "Each agent reports at a defined depth level \u2014 conditions \u2192 evidence \u2192 root cause")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap",
      marginBottom: 18,
      padding: "10px 12px",
      background: "var(--surface-1)",
      borderRadius: 8,
      border: "0.5px solid var(--border)"
    }
  }, [{
    label: "Level 2",
    desc: "What + gaps",
    color: "purple"
  }, {
    label: "Level 3",
    desc: "Steps + evidence",
    color: "teal"
  }, {
    label: "Level 3",
    desc: "Request/response",
    color: "amber"
  }, {
    label: "Level 4",
    desc: "Root cause + impact",
    color: "coral"
  }].map((d, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(DepthBadge, {
    label: d.label,
    color: d.color
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: "var(--text-muted)"
    }
  }, d.desc), i < 3 && /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--border-strong)",
      fontSize: 14,
      marginLeft: 2
    }
  }, "\u2192")))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      fontSize: 13,
      color: "var(--text-secondary)",
      display: "block",
      marginBottom: 6
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "ti ti-ticket",
    "aria-hidden": "true",
    style: {
      marginRight: 6,
      fontSize: 15,
      verticalAlign: -2
    }
  }), "JIRA ticket"), /*#__PURE__*/React.createElement("textarea", {
    value: ticket,
    onChange: e => setTicket(e.target.value),
    disabled: running,
    rows: 7,
    style: {
      width: "100%",
      boxSizing: "border-box",
      fontFamily: "var(--font-mono)",
      fontSize: 12,
      background: "var(--surface-1)",
      color: "var(--text-primary)",
      border: "0.5px solid var(--border-strong)",
      borderRadius: 8,
      padding: "10px 12px",
      resize: "vertical",
      opacity: running ? 0.6 : 1
    }
  })), /*#__PURE__*/React.createElement("button", {
    onClick: runFarm,
    disabled: running || !ticket.trim(),
    style: {
      padding: "10px 24px",
      borderRadius: 8,
      background: running ? "var(--surface-0)" : "var(--text-primary)",
      color: running ? "var(--text-muted)" : "var(--surface-2)",
      border: "0.5px solid var(--border-strong)",
      fontSize: 14,
      fontWeight: 500,
      cursor: running ? "not-allowed" : "pointer",
      fontFamily: "var(--font-sans)",
      marginBottom: 24,
      display: "flex",
      alignItems: "center",
      gap: 8,
      transition: "all 0.2s"
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: `ti ${running ? "ti-loader-2" : "ti-player-play"}`,
    style: {
      fontSize: 16
    },
    "aria-hidden": "true"
  }), running ? "Farm running…" : "Run agent farm"), /*#__PURE__*/React.createElement("div", {
    style: {
      borderBottom: "0.5px solid var(--border)",
      marginBottom: 20,
      display: "flex"
    }
  }, [{
    id: "agents",
    icon: "ti-robot",
    label: "Agents"
  }, {
    id: "log",
    icon: "ti-terminal",
    label: "Log"
  }, ...(postmanJSON ? [{
    id: "postman",
    icon: "ti-api",
    label: "Postman"
  }] : [])].map(t => /*#__PURE__*/React.createElement("button", {
    key: t.id,
    className: `tab-btn ${activeTab === t.id ? "active" : ""}`,
    onClick: () => setActiveTab(t.id)
  }, /*#__PURE__*/React.createElement("i", {
    className: `ti ${t.icon}`,
    "aria-hidden": "true",
    style: {
      marginRight: 5
    }
  }), t.label))), activeTab === "agents" && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 12
    }
  }, AGENTS.map(agent => /*#__PURE__*/React.createElement(AgentCard, {
    key: agent.id,
    agent: agent,
    status: agentStates[agent.id].status,
    structured: agentStates[agent.id].structured,
    rawOutput: agentStates[agent.id].rawOutput,
    progress: agentStates[agent.id].progress
  }))), activeTab === "log" && /*#__PURE__*/React.createElement("div", {
    ref: logRef,
    style: {
      background: "var(--surface-0)",
      borderRadius: 8,
      padding: 14,
      fontFamily: "var(--font-mono)",
      fontSize: 12,
      color: "var(--text-secondary)",
      lineHeight: 1.8,
      minHeight: 160,
      maxHeight: 320,
      overflowY: "auto",
      border: "0.5px solid var(--border)"
    }
  }, log.length === 0 ? /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--text-muted)"
    }
  }, "Run the farm to see live logs\u2026") : log.map((l, i) => /*#__PURE__*/React.createElement("div", {
    key: i
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--text-muted)",
      marginRight: 10
    }
  }, l.time), l.msg))), activeTab === "postman" && postmanJSON && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("button", {
    onClick: downloadPostman,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "8px 18px",
      borderRadius: 8,
      marginBottom: 14,
      background: "#E1F5EE",
      border: "0.5px solid #0F6E56",
      color: "#085041",
      fontSize: 13,
      fontWeight: 500,
      cursor: "pointer",
      fontFamily: "var(--font-sans)"
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "ti ti-download",
    "aria-hidden": "true",
    style: {
      fontSize: 15
    }
  }), "Download .postman_collection.json"), /*#__PURE__*/React.createElement("pre", {
    style: {
      background: "var(--surface-0)",
      borderRadius: 8,
      padding: 14,
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: "var(--text-secondary)",
      lineHeight: 1.7,
      maxHeight: 360,
      overflowY: "auto",
      border: "0.5px solid var(--border)",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word"
    }
  }, JSON.stringify(postmanJSON, null, 2))), allDone && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 20,
      padding: "14px 16px",
      background: "#E1F5EE",
      border: "0.5px solid #0F6E56",
      borderRadius: 10,
      display: "flex",
      alignItems: "center",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "ti ti-circle-check",
    style: {
      fontSize: 22,
      color: "#0F6E56"
    },
    "aria-hidden": "true"
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 500,
      color: "#085041"
    }
  }, "All agents finished"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "#0F6E56"
    }
  }, "Structured reports ready at L2 \u2192 L3 \u2192 L3 \u2192 L4.", postmanJSON ? " Postman tab has the downloadable collection." : ""))));
}
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(/*#__PURE__*/React.createElement(QAAgentFarm, null));