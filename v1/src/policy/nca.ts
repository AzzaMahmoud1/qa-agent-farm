import type { ComplianceEvidence, Scenario, StructuredRequest } from "../domain/types.js";

export const NCA_ECC_CONTROLS = [
  { id: "ECC-1-6", title: "Secure development and compliance testing" },
  { id: "ECC-2-2", title: "Identity and access management" },
  { id: "ECC-2-10", title: "Vulnerability management" },
  { id: "ECC-2-11", title: "Penetration testing" },
  { id: "ECC-2-12", title: "Event logs and monitoring" },
  { id: "ECC-2-15", title: "Web application security" },
] as const;

const SECURITY_SCENARIOS: Array<Omit<Scenario, "id">> = [
  {
    title: "Injection payloads rejected on user inputs",
    surface: "api",
    type: "security",
    assertion_level: "security",
    nca_controls: ["ECC-1-6", "ECC-2-10", "ECC-2-11", "ECC-2-15"],
  },
  {
    title: "IDOR — cross-tenant object access denied",
    surface: "api",
    type: "security",
    assertion_level: "security",
    nca_controls: ["ECC-2-2", "ECC-2-11", "ECC-2-15"],
  },
  {
    title: "URL / path manipulation does not bypass controls",
    surface: "api",
    type: "security",
    assertion_level: "security",
    nca_controls: ["ECC-2-10", "ECC-2-15"],
  },
  {
    title: "API does not expose secrets or unauthorized fields",
    surface: "api",
    type: "security",
    assertion_level: "security",
    nca_controls: ["ECC-1-6", "ECC-2-11", "ECC-2-15"],
  },
  {
    title: "Auth bypass — missing/expired/wrong-role tokens denied",
    surface: "api",
    type: "security",
    assertion_level: "security",
    nca_controls: ["ECC-2-2", "ECC-2-11", "ECC-2-15"],
  },
];

export function requestNeedsNca(req: StructuredRequest): boolean {
  if (req.nca_applicable === true) return true;
  if (req.nca_applicable === false) return false;
  const corpus = `${req.title}\n${req.requirements}`.toLowerCase();
  return /\b(auth|login|password|token|role|admin|permission|tenant|payment|api|access|security)\b/.test(corpus);
}

export function buildNcaScenarios(req: StructuredRequest): Scenario[] {
  if (!requestNeedsNca(req)) return [];
  return SECURITY_SCENARIOS.map((s, i) => ({
    ...s,
    id: `SEC-${String(i + 1).padStart(2, "0")}`,
  }));
}

export function buildComplianceEvidence(req: StructuredRequest, scenarios: Scenario[]): ComplianceEvidence {
  if (!requestNeedsNca(req)) {
    return {
      status: "not_applicable",
      release_gate: "open",
      controls: [],
      note: "NCA/ECC controls not applicable for this request",
      evidence_records: [],
    };
  }
  const security = scenarios.filter((s) => s.type === "security");
  return {
    status: "blocked_missing_evidence",
    release_gate: "blocked",
    controls: [...new Set(security.flatMap((s) => s.nca_controls || []))],
    note: "NCA/ECC security scenarios planned — evidence not yet attached; release blocked",
    evidence_records: [],
  };
}
