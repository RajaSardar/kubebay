import type { RBACFinding } from "./api";
import type { AttackPath } from "./attackPaths";
import { controlsFor, rbacFindingControls, type ControlRef } from "./controlIds";
import type { CoverageGap } from "./networkPolicyCoverage";
import type { SecretExposureFinding } from "./secretExposure";
import type { AutomountFinding } from "./serviceAccountAutomount";
import type { SpofFinding } from "./spof";
import type { UpgradeReadinessFinding } from "./upgradeReadiness";

/**
 * KB-15: one report of what Kubebay's detectors found, to share without a
 * server. It takes the findings the existing detectors already computed and
 * writes them as JSON, Markdown or SARIF 2.1.0.
 */

export type Severity = "high" | "medium";

export interface ReportFinding {
  ruleId: string;
  detector: string;
  severity: Severity;
  title: string;
  message: string;
  resource?: { kind: string; namespace?: string; name: string };
  controls: ControlRef[];
}

export interface FindingsReport {
  tool: { name: "Kubebay"; version: string };
  cluster: string;
  generatedAt: string;
  findings: ReportFinding[];
}

/** Whatever each detector found; a detector left out contributes nothing. */
export interface DetectorFindings {
  attackPaths?: AttackPath[];
  rbac?: RBACFinding[];
  upgrade?: UpgradeReadinessFinding[];
  spof?: SpofFinding[];
  netpolGaps?: CoverageGap[];
  secretEnv?: SecretExposureFinding[];
  automount?: AutomountFinding[];
  /** Application namespaces where nothing enforces image signatures. */
  unenforcedSignatureNamespaces?: string[];
}

const pods = (n: number) => `${n} pod${n === 1 ? "" : "s"}`;

const RBAC_RULES: [test: (t: string) => boolean, id: string][] = [
  [(t) => t === "Bound to the built-in cluster-admin role", "cluster-admin-binding"],
  [(t) => t === "Full cluster-admin-equivalent access", "cluster-admin-equivalent"],
  [(t) => t.startsWith("Wildcard "), "wildcard"],
  [(t) => t.startsWith("Privilege-escalation verb"), "escalation-verb"],
  [(t) => t === "Cluster-wide Secret read access", "cluster-secret-read"],
  [(t) => t === "Cluster-wide pod exec access", "cluster-pod-exec"],
];

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function subjectResource(subject: string): ReportFinding["resource"] {
  const m = /^(\w+) (?:([^/\s]+)\/)?(\S+)$/.exec(subject);
  if (!m?.[1] || !m[3]) return undefined;
  return m[2] ? { kind: m[1], namespace: m[2], name: m[3] } : { kind: m[1], name: m[3] };
}

function dedupe(controls: ControlRef[]): ControlRef[] {
  const seen = new Set<string>();
  return controls.filter((c) => !seen.has(c.framework + c.id) && seen.add(c.framework + c.id));
}

const SPOF_TITLES: Record<SpofFinding["kind"], string> = {
  "no-pdb": "One replica and no PodDisruptionBudget",
  "no-spread": "Replicas packed on too few nodes",
  "single-backend": "Service has a single ready backend",
};

export function buildFindingsReport(input: { cluster: string; kubebayVersion: string; generatedAt: string; findings: DetectorFindings }): FindingsReport {
  const f = input.findings;
  const out: ReportFinding[] = [];
  for (const p of f.attackPaths ?? []) {
    const w = p.workload;
    out.push({
      ruleId: "kubebay.attack-path",
      detector: "Attack paths",
      severity: p.complete ? "high" : "medium",
      title: `Attack path to ${w.kind} ${w.ns}/${w.name}`,
      message: p.steps.join(" → "),
      resource: { kind: w.kind, namespace: w.ns, name: w.name },
      controls: dedupe(p.privileges.flatMap((x) => rbacFindingControls(x))),
    });
  }
  for (const r of f.rbac ?? []) {
    const id = RBAC_RULES.find(([test]) => test(r.title))?.[1] ?? slug(r.title);
    out.push({
      ruleId: `kubebay.rbac.${id}`,
      detector: "RBAC",
      severity: r.severity,
      title: r.title,
      message: `${r.subject} via ${r.roleRef}: ${r.why}${r.suggestion ? ` Suggestion: ${r.suggestion}` : ""}`,
      resource: subjectResource(r.subject),
      controls: rbacFindingControls(r),
    });
  }
  for (const u of f.upgrade ?? []) {
    out.push({
      ruleId: "kubebay.upgrade.removed-api",
      detector: "Upgrade readiness",
      severity: u.minorsAway <= 1 ? "high" : "medium",
      title: `${u.kind} ${u.apiVersion} is removed in Kubernetes 1.${u.removedInMinor}`,
      message: `This cluster still serves ${u.apiVersion}, ${u.minorsAway} minor release${u.minorsAway === 1 ? "" : "s"} before its removal. Move manifests to ${u.replacementVersion}.`,
      controls: [],
    });
  }
  for (const s of f.spof ?? []) {
    out.push({
      ruleId: `kubebay.spof.${s.kind}`,
      detector: "Single points of failure",
      severity: "medium",
      title: SPOF_TITLES[s.kind],
      message: `${s.workloadKind} ${s.ns}/${s.name}: ${s.detail}`,
      resource: { kind: s.workloadKind, namespace: s.ns, name: s.name },
      controls: [],
    });
  }
  for (const g of f.netpolGaps ?? []) {
    out.push({
      ruleId: "kubebay.netpol.uncovered",
      detector: "NetworkPolicy coverage",
      severity: "medium",
      title: "No NetworkPolicy selects these pods",
      message:
        g.reason === "no-policy-in-namespace"
          ? `${pods(g.podCount)} of app ${g.appLabel} in ${g.namespace}: the namespace has no NetworkPolicy.`
          : `${pods(g.podCount)} of app ${g.appLabel} in ${g.namespace}: no NetworkPolicy in the namespace selects them.`,
      resource: { kind: "App", namespace: g.namespace, name: g.appLabel },
      controls: controlsFor("netpol-gap"),
    });
  }
  for (const s of f.secretEnv ?? []) {
    out.push({
      ruleId: "kubebay.secret-env",
      detector: "Secret exposure",
      severity: "medium",
      title: "Secrets read into environment variables",
      message: `${pods(s.podCount)} of app ${s.appLabel} in ${s.namespace} read Secret ${s.secretNames.join(", ")} into environment variables.`,
      resource: { kind: "App", namespace: s.namespace, name: s.appLabel },
      controls: controlsFor("secret-env"),
    });
  }
  for (const a of f.automount ?? []) {
    out.push({
      ruleId: "kubebay.sa-token.automount",
      detector: "ServiceAccount tokens",
      severity: "medium",
      title: "Default ServiceAccount token mounted",
      message: `${pods(a.podCount)} of app ${a.appLabel} in ${a.namespace} run as the default ServiceAccount with its API token mounted.`,
      resource: { kind: "App", namespace: a.namespace, name: a.appLabel },
      controls: controlsFor("default-sa-automount"),
    });
  }
  for (const ns of f.unenforcedSignatureNamespaces ?? []) {
    out.push({
      ruleId: "kubebay.signatures.unenforced",
      detector: "Image signatures",
      severity: "medium",
      title: "Image signatures aren't enforced",
      message: `Nothing enforces image signatures in namespace ${ns}.`,
      resource: { kind: "Namespace", name: ns },
      controls: controlsFor("unverified-images"),
    });
  }
  // High first; within a severity, the order above.
  const ranked = out.map((x, i) => ({ x, i })).sort((a, b) => (a.x.severity === b.x.severity ? a.i - b.i : a.x.severity === "high" ? -1 : 1));
  return { tool: { name: "Kubebay", version: input.kubebayVersion }, cluster: input.cluster, generatedAt: input.generatedAt, findings: ranked.map((r) => r.x) };
}

export function reportToJSON(r: FindingsReport): string {
  return JSON.stringify(r, null, 2) + "\n";
}

const control = (c: ControlRef) => `${c.framework} ${c.id} (${c.name})`;
const where = (res: ReportFinding["resource"]) => (res ? `${res.kind} ${res.namespace ? `${res.namespace}/` : ""}${res.name}` : "cluster");
const cell = (s: string) => s.replace(/\|/g, "\\|");

export function reportToMarkdown(r: FindingsReport): string {
  const high = r.findings.filter((f) => f.severity === "high").length;
  const lines = [
    "# Kubebay findings report",
    "",
    `- Cluster: \`${r.cluster}\``,
    `- Generated: ${r.generatedAt}`,
    `- Kubebay: ${r.tool.version}`,
    `- Findings: ${r.findings.length} (${high} high, ${r.findings.length - high} medium)`,
    "",
  ];
  if (r.findings.length === 0) {
    lines.push("No findings.", "");
    return lines.join("\n");
  }
  const detectors = [...new Set(r.findings.map((f) => f.detector))];
  lines.push("| Detector | High | Medium |", "|---|---|---|");
  for (const d of detectors) {
    const of = r.findings.filter((f) => f.detector === d);
    const h = of.filter((f) => f.severity === "high").length;
    lines.push(`| ${cell(d)} | ${h} | ${of.length - h} |`);
  }
  for (const d of detectors) {
    lines.push("", `## ${d}`, "");
    for (const f of r.findings.filter((x) => x.detector === d)) {
      lines.push(`- **${f.severity}** · ${f.title} · \`${where(f.resource)}\``, `  ${f.message}`);
      if (f.controls.length) lines.push(`  Controls: ${f.controls.map(control).join("; ")}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

// Rules whose findings' titles name a specific object get a general description.
const RULE_DESCRIPTIONS: Record<string, string> = {
  "kubebay.attack-path": "Outside traffic can reach a workload whose identity grants risky access",
  "kubebay.upgrade.removed-api": "The cluster still serves an API version an upcoming Kubernetes release removes",
};

export function reportToSARIF(r: FindingsReport): string {
  const ruleIds = [...new Set(r.findings.map((f) => f.ruleId))];
  const rules = ruleIds.map((id) => {
    const of = r.findings.filter((f) => f.ruleId === id);
    const first = of[0]!;
    return {
      id,
      name: first.detector,
      shortDescription: { text: RULE_DESCRIPTIONS[id] ?? first.title },
      defaultConfiguration: { level: of.some((f) => f.severity === "high") ? "error" : "warning" },
      properties: { tags: ["kubernetes", ...dedupe(of.flatMap((f) => f.controls)).map((c) => `${c.framework} ${c.id}`)] },
    };
  });
  const results = r.findings.map((f) => ({
    ruleId: f.ruleId,
    ruleIndex: ruleIds.indexOf(f.ruleId),
    level: f.severity === "high" ? "error" : "warning",
    message: { text: `${f.title}: ${f.message}` },
    locations: [
      {
        logicalLocations: [
          {
            name: f.resource?.name ?? r.cluster,
            fullyQualifiedName: f.resource ? `${r.cluster}/${f.resource.namespace ? `${f.resource.namespace}/` : ""}${f.resource.kind}/${f.resource.name}` : r.cluster,
            kind: "resource",
          },
        ],
      },
    ],
    properties: { severity: f.severity, controls: f.controls.map(control) },
  }));
  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: { driver: { name: "Kubebay", version: r.tool.version, informationUri: "https://github.com/RajaSardar/kubebay", rules } },
        automationDetails: { id: `kubebay/${r.cluster}/${r.generatedAt}` },
        invocations: [{ executionSuccessful: true, endTimeUtc: r.generatedAt }],
        properties: { cluster: r.cluster },
        results,
      },
    ],
  };
  return JSON.stringify(sarif, null, 2) + "\n";
}
