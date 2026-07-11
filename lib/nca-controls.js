/**
 * NCA ECC 2:2024 oriented control mapping for QA coverage gaps and evidence hooks.
 * Source: https://cdn.nca.gov.sa/ (Essential Cybersecurity Controls ECC 2:2024)
 *
 * This module does NOT claim compliance. It maps applicable control themes to
 * required test categories and evidence fields so gaps are explicit and blocking
 * when security-relevant stories lack coverage.
 */

export const NCA_ECC_CONTROLS = [
  {
    id: "ECC-1-6",
    title: "Secure development and compliance testing",
    category: "security",
    required_tests: ["injection", "input_validation", "api_exposure"],
  },
  {
    id: "ECC-2-2",
    title: "Identity and access management",
    category: "security",
    required_tests: ["idor", "auth_bypass", "privilege_escalation"],
  },
  {
    id: "ECC-2-10",
    title: "Vulnerability management",
    category: "security",
    required_tests: ["injection", "url_manipulation"],
  },
  {
    id: "ECC-2-11",
    title: "Penetration testing",
    category: "security",
    required_tests: ["injection", "idor", "auth_bypass", "api_exposure"],
  },
  {
    id: "ECC-2-12",
    title: "Event logs and monitoring",
    category: "security",
    required_tests: ["audit_evidence"],
  },
  {
    id: "ECC-2-15",
    title: "Web application security",
    category: "security",
    required_tests: ["injection", "url_manipulation", "idor", "auth_bypass"],
  },
];

const SECURITY_GAP_TEMPLATES = [
  {
    id: "injection",
    gap: "Injection testing (SQLi/XSS/command) not evidenced",
    category: "security",
    severity: "blocking",
    nca_controls: ["ECC-1-6", "ECC-2-10", "ECC-2-11", "ECC-2-15"],
    suggested_test: "Submit injection payloads on every user-controlled input and assert rejection + safe encoding",
    evidence_required: ["request_payload_redacted", "response_status", "assertion_result"],
  },
  {
    id: "idor",
    gap: "IDOR / cross-object authorization not evidenced",
    category: "security",
    severity: "blocking",
    nca_controls: ["ECC-2-2", "ECC-2-11", "ECC-2-15"],
    suggested_test: "Access another tenant/user resource ID and expect 403/404 with audit log",
    evidence_required: ["actor_role", "target_resource_id", "http_status", "audit_event_id"],
  },
  {
    id: "url_manipulation",
    gap: "URL / path / query manipulation bypass not evidenced",
    category: "security",
    severity: "blocking",
    nca_controls: ["ECC-2-10", "ECC-2-15"],
    suggested_test: "Tamper path segments, encoded traversal, and unexpected query params",
    evidence_required: ["mutated_url", "http_status", "assertion_result"],
  },
  {
    id: "api_exposure",
    gap: "API exposure / excessive data disclosure not evidenced",
    category: "security",
    severity: "blocking",
    nca_controls: ["ECC-1-6", "ECC-2-11", "ECC-2-15"],
    suggested_test: "Verify responses omit secrets and unauthorized fields; check undocumented endpoints return 401/404",
    evidence_required: ["response_schema_check", "redaction_check"],
  },
  {
    id: "auth_bypass",
    gap: "Authentication / authorization bypass paths not evidenced",
    category: "security",
    severity: "blocking",
    nca_controls: ["ECC-2-2", "ECC-2-11", "ECC-2-15"],
    suggested_test: "Call protected routes without token, with expired token, and with wrong role",
    evidence_required: ["auth_state", "http_status", "assertion_result"],
  },
  {
    id: "audit_evidence",
    gap: "Security-relevant audit/monitoring evidence not captured",
    category: "security",
    severity: "non-blocking",
    nca_controls: ["ECC-2-12"],
    suggested_test: "Confirm denied access and privilege changes emit auditable events",
    evidence_required: ["audit_event_id", "timestamp"],
  },
];

export function storyNeedsSecurityControls(story) {
  const corpus = [
    story?.title,
    story?.description,
    ...(story?.acceptance_criteria_list || []),
  ].join("\n").toLowerCase();
  return /\b(auth|login|password|token|role|admin|permission|tenant|payment|refund|api|endpoint|session|access|idor|security)\b/.test(corpus);
}

export function buildNcaSecurityGaps(story) {
  if (!storyNeedsSecurityControls(story)) {
    return {
      applicable: false,
      controls: [],
      gaps: [],
      compliance_evidence: {
        status: "not_applicable",
        note: "Story corpus does not trigger NCA/ECC security control mapping",
        controls: [],
        evidence_records: [],
      },
    };
  }

  const gaps = SECURITY_GAP_TEMPLATES.map((t) => ({
    gap: t.gap,
    category: t.category,
    severity: t.severity,
    suggested_test: t.suggested_test,
    nca_controls: t.nca_controls,
    security_test_id: t.id,
    evidence_required: t.evidence_required,
  }));

  const controls = NCA_ECC_CONTROLS.map((c) => ({
    ...c,
    status: "unmapped_evidence",
    evidence: null,
  }));

  return {
    applicable: true,
    controls,
    gaps,
    compliance_evidence: {
      status: "blocked_missing_evidence",
      note: "NCA/ECC controls applicable — no penetration-test or security assertion evidence attached yet",
      controls: controls.map((c) => c.id),
      evidence_records: [],
      release_gate: "blocked",
    },
  };
}

export function mergeNcaGapsIntoCoverage(existingGaps, story) {
  const nca = buildNcaSecurityGaps(story);
  if (!nca.applicable) {
    return { gaps: existingGaps || [], compliance_evidence: nca.compliance_evidence };
  }
  const existing = existingGaps || [];
  const seen = new Set(existing.map((g) => g.gap));
  const merged = [...existing];
  for (const g of nca.gaps) {
    if (!seen.has(g.gap)) merged.push(g);
  }
  return { gaps: merged, compliance_evidence: nca.compliance_evidence };
}
