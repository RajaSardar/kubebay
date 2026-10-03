import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Card, PageHeader, Select, StatusDot, TextField } from "@kubebay/ui";
import { PageLoader } from "../components/PageLoader";
import { RbacFindingsCard } from "../components/RbacFindingsCard";
import { ServiceAccountAutomountCard } from "../components/ServiceAccountAutomountCard";
import { SecretExposureCard } from "../components/SecretExposureCard";
import { ImageSignatureCard } from "../components/ImageSignatureCard";
import { RunningImageSignaturesCard } from "../components/RunningImageSignaturesCard";
import { OrphanedSecretsCard } from "../components/OrphanedSecretsCard";
import { AttackPathsCard } from "../components/AttackPathsCard";
import { AuditSecurityFeedCard } from "../components/AuditSecurityFeedCard";
import { crdApi, rbacApi, type RBACSnapshot } from "../lib/api";
import { detectImageSignatureEngines, summarizeImageSignaturePolicies } from "../lib/imageSignature";
import type { FindingQuery } from "../lib/rbacFindings";
import { findDefaultServiceAccountAutomounts } from "../lib/serviceAccountAutomount";
import { findSecretEnvExposures } from "../lib/secretExposure";
import { findOrphanedSecrets } from "../lib/orphanedSecrets";
import { findAttackPaths } from "../lib/attackPaths";
import { detectTrivyOperator } from "../lib/trivyOperator";
import { detectGatewayApi } from "../lib/routeResolution";
import { useCluster } from "../lib/useCluster";
import { useResourceStream } from "../lib/useResourceStream";
import { DEFS, EXTRA_DEFS } from "../lib/resources";

type Rule = RBACSnapshot["roles"][number]["rules"][number];
type RoleSummary = RBACSnapshot["roles"][number];
type Subject = RBACSnapshot["roleBindings"][number]["subjects"][number];
type BindingSummary = RBACSnapshot["roleBindings"][number];

const VERBS = ["get", "list", "watch", "create", "update", "patch", "delete", "*"];

// A handful of kinds pinned at the top of the dropdown for quick access; the
// full option set below always covers every kind in DEFS/EXTRA_DEFS so it
// can't silently fall out of sync as resource kinds are added.
const CURATED_KINDS = [
  "pods",
  "deployments",
  "statefulsets",
  "services",
  "configmaps",
  "secrets",
  "jobs",
  "nodes",
  "namespaces",
];

// Pods aren't in the DEFS registry (they're handled by the dedicated
// Workloads page rather than the generic resource table), so they're added
// by hand; everything else is derived from DEFS/EXTRA_DEFS, whose `scoped`
// flag means "cluster-scoped" — the inverse of the "namespaced" meaning
// used here.
const KIND_MAP: Record<string, { group: string; resource: string; scoped: boolean }> = {
  pods: { group: "", resource: "pods", scoped: true },
  ...Object.fromEntries(
    Object.entries({ ...DEFS, ...EXTRA_DEFS }).map(([slug, def]) => [
      slug,
      { group: def.group, resource: def.resource, scoped: !def.scoped },
    ]),
  ),
};

const KIND_OPTIONS = [
  ...CURATED_KINDS.filter((k) => KIND_MAP[k]),
  ...Object.keys(KIND_MAP)
    .filter((k) => !CURATED_KINDS.includes(k))
    .sort(),
];

function ruleAllows(rule: Rule, verb: string, group: string, resource: string): boolean {
  const vOk = rule.verbs.includes("*") || rule.verbs.includes(verb);
  const gOk = rule.apiGroups.includes("*") || rule.apiGroups.includes(group);
  const base = resource.split("/")[0] ?? "";
  const rOk =
    !rule.resources ||
    rule.resources.length === 0 ||
    rule.resources.includes("*") ||
    rule.resources.includes(resource) ||
    rule.resources.includes(base);
  return vOk && gOk && rOk;
}

function subjectKey(s: Subject): string {
  return s.kind === "ServiceAccount" ? `SA ${s.ns ?? ""}/${s.name}` : `${s.kind} ${s.name}`;
}

export default function Rbac() {
  const { cluster: effectiveCluster } = useCluster();

  const snap = useQuery({
    queryKey: ["rbac", effectiveCluster],
    queryFn: () => rbacApi.all(effectiveCluster),
    enabled: !!effectiveCluster,
  });

  const [verb, setVerb] = useState("list");
  const [kindSel, setKindSel] = useState("pods");
  const [nsQuery, setNsQuery] = useState("");
  const [results, setResults] = useState<Map<string, string[]> | null>(null);
  const [searched, setSearched] = useState(false);

  const data = snap.data;

  // Backlog #28: independent of the rbacApi.all snapshot above -- pod specs
  // and ServiceAccount objects aren't part of that server-computed RBAC
  // analysis, so this streams them directly, same pattern every other
  // client-side detector this session uses.
  const automountPods = useResourceStream(effectiveCluster || undefined, "v1/pods", { mode: "full" });
  const automountSAs = useResourceStream(effectiveCluster || undefined, "v1/serviceaccounts", { mode: "full" });
  const automountFindings = useMemo(
    () => findDefaultServiceAccountAutomounts(automountPods.rows, automountSAs.rows),
    [automountPods.rows, automountSAs.rows],
  );

  // Backlog #29: independent of the rbacApi.all snapshot -- pod env specs
  // aren't part of that server-computed RBAC analysis.
  const secretExposureFindings = useMemo(() => findSecretEnvExposures(automountPods.rows), [automountPods.rows]);

  // Backlog #32: signature-verification policies, streamed only for the engines the cluster actually has.
  const crds = useQuery({
    queryKey: ["crds", effectiveCluster],
    queryFn: () => crdApi.list(effectiveCluster),
    enabled: !!effectiveCluster,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const sigEngines = useMemo(() => detectImageSignatureEngines(crds.data ?? []), [crds.data]);
  const { kyvernoClusterPolicyGvr: kcpGvr, kyvernoPolicyGvr: kpGvr, sigstoreClusterImagePolicyGvr: cipGvr } = sigEngines;
  const kyvernoClusterPolicies = useResourceStream(kcpGvr ? effectiveCluster || undefined : undefined, kcpGvr ?? "", { mode: "full", enabled: !!kcpGvr });
  const kyvernoPolicies = useResourceStream(kpGvr ? effectiveCluster || undefined : undefined, kpGvr ?? "", { mode: "full", enabled: !!kpGvr });
  const sigstorePolicies = useResourceStream(cipGvr ? effectiveCluster || undefined : undefined, cipGvr ?? "", { mode: "full", enabled: !!cipGvr });
  // Namespace labels: Sigstore policy scope and attack-path NetworkPolicy namespaceSelectors.
  const namespaces = useResourceStream(effectiveCluster || undefined, "v1/namespaces");
  const ratifyGvr = sigEngines.ratifyConstraintGvr;
  const ratifyConstraints = useResourceStream(ratifyGvr ? effectiveCluster || undefined : undefined, ratifyGvr ?? "", { mode: "full", enabled: !!ratifyGvr });
  // Connaisseur has no CRD; its validating webhook is how it shows up.
  const validatingWebhooks = useResourceStream(effectiveCluster || undefined, "admissionregistration.k8s.io/v1/validatingwebhookconfigurations", { mode: "full" });
  const imageSignatureReport = useMemo(
    () =>
      summarizeImageSignaturePolicies({
        kyverno: [...kyvernoClusterPolicies.rows, ...kyvernoPolicies.rows],
        sigstore: sigstorePolicies.rows,
        namespaces: namespaces.rows,
        ratifyConstraints: ratifyConstraints.rows,
        validatingWebhooks: validatingWebhooks.rows,
      }),
    [kyvernoClusterPolicies.rows, kyvernoPolicies.rows, sigstorePolicies.rows, namespaces.rows, ratifyConstraints.rows, validatingWebhooks.rows],
  );
  const sigEnginesInstalled =
    !!(sigEngines.kyvernoClusterPolicyGvr || sigEngines.kyvernoPolicyGvr || sigEngines.sigstoreClusterImagePolicyGvr || sigEngines.ratifyInstalled) ||
    imageSignatureReport.policies.some((p) => p.engine === "connaisseur");

  // Backlog #35: unreferenced Secret finder. Secrets stay in metadata mode —
  // the finder needs names/labels/annotations only, not values.
  const secrets = useResourceStream(effectiveCluster || undefined, "v1/secrets", { mode: "metadata" });
  const ingresses = useResourceStream(effectiveCluster || undefined, "networking.k8s.io/v1/ingresses", { mode: "full" });
  const deployments = useResourceStream(effectiveCluster || undefined, "apps/v1/deployments", { mode: "full" });
  const statefulSets = useResourceStream(effectiveCluster || undefined, "apps/v1/statefulsets", { mode: "full" });
  const cronJobs = useResourceStream(effectiveCluster || undefined, "batch/v1/cronjobs", { mode: "full" });
  const orphanedSecrets = useMemo(
    () =>
      findOrphanedSecrets({
        secrets: secrets.rows,
        pods: automountPods.rows,
        workloads: [...deployments.rows, ...statefulSets.rows, ...cronJobs.rows],
        serviceAccounts: automountSAs.rows,
        ingresses: ingresses.rows,
      }),
    [secrets.rows, automountPods.rows, deployments.rows, statefulSets.rows, cronJobs.rows, automountSAs.rows, ingresses.rows],
  );

  // Roadmap Tier 3 #24: the findings above joined into chains from outside traffic.
  const services = useResourceStream(effectiveCluster || undefined, "v1/services", { mode: "full" });
  const networkPolicies = useResourceStream(effectiveCluster || undefined, "networking.k8s.io/v1/networkpolicies", { mode: "full" });
  const trivy = useMemo(() => detectTrivyOperator(crds.data ?? []), [crds.data]);
  const gatewayApi = useMemo(() => detectGatewayApi(crds.data ?? []), [crds.data]);
  const httpRoutes = useResourceStream(
    gatewayApi.httpRouteGvr ? effectiveCluster || undefined : undefined,
    gatewayApi.httpRouteGvr ?? "",
    { mode: "full", enabled: !!gatewayApi.httpRouteGvr },
  );
  const vulnReports = useResourceStream(
    trivy.vulnerabilityReportGvr ? effectiveCluster || undefined : undefined,
    trivy.vulnerabilityReportGvr ?? "",
    { mode: "full", enabled: !!trivy.vulnerabilityReportGvr },
  );
  const attackPaths = useMemo(
    () =>
      findAttackPaths({
        pods: automountPods.rows,
        services: services.rows,
        ingresses: ingresses.rows,
        networkPolicies: networkPolicies.rows,
        vulnReports: vulnReports.rows,
        rbacFindings: data?.findings ?? [],
        namespaces: namespaces.rows,
        httpRoutes: httpRoutes.rows,
        ...(data ? { rbac: data } : {}),
      }),
    [automountPods.rows, services.rows, ingresses.rows, networkPolicies.rows, vulnReports.rows, data, namespaces.rows, httpRoutes.rows],
  );

  function runWhoCan(override?: FindingQuery) {
    if (!data) return;
    const meta = override
      ? { group: override.group, resource: override.resource, scoped: true }
      : (KIND_MAP[kindSel] ?? { group: "", resource: kindSel, scoped: true });
    const effectiveVerb = override?.verb ?? verb;
    const grants = new Map<string, string[]>();
    const considerBinding = (b: BindingSummary, roleNS: string | undefined) => {
      const [refKind, refName] = b.roleRef.split(":");
      const role: RoleSummary | undefined =
        refKind === "ClusterRole"
          ? data.clusterRoles.find((r) => r.name === refName)
          : data.roles.find((r) => r.name === refName && r.ns === b.ns);
      if (!role) return;
      const applies = meta.scoped ? true : !b.ns;
      if (meta.scoped && nsQuery && b.ns && b.ns !== nsQuery) return;
      if (!meta.scoped && roleNS !== "cluster") return;
      if (!applies) return;
      for (const rule of role.rules) {
        if (!ruleAllows(rule, effectiveVerb === "*" ? "*" : effectiveVerb, meta.group, meta.resource)) continue;
        for (const s of b.subjects) {
          const k = subjectKey(s);
          grants.set(k, [...(grants.get(k) ?? []), `${b.kind} ${b.ns ? b.ns + "/" : ""}${b.name}`]);
        }
        break;
      }
    };
    for (const b of data.clusterRoleBindings) considerBinding(b, "cluster");
    for (const b of data.roleBindings) considerBinding(b, b.ns);
    setResults(grants);
    setSearched(true);
  }

  // A finding's resource is the real Kubernetes resource name, which for a
  // subresource like "pods/exec" isn't one of the dropdown's selectable
  // kinds — the query itself still runs correctly via the override, only
  // the dropdown's own display falls back to the closest real kind.
  function applyFindingQuery(q: FindingQuery) {
    const displayKind = q.resource === "pods/exec" ? "pods" : KIND_OPTIONS.includes(q.resource) ? q.resource : kindSel;
    setVerb(q.verb);
    setKindSel(displayKind);
    setNsQuery("");
    runWhoCan(q);
  }

  interface CheckResult {
    allowed?: boolean;
    denied?: boolean;
    reason?: string;
  }
  const [selfResults, setSelfResults] = useState<Record<string, CheckResult> | null>(null);
  const [selfBusy, setSelfBusy] = useState(false);

  async function runSelfChecks() {
    if (!effectiveCluster) return;
    setSelfBusy(true);
    const out: Record<string, CheckResult> = {};
    const checks: [string, string, string][] = [
      ["pods:list", "", "pods"],
      ["pods:create", "", "pods"],
      ["pods:delete", "", "pods"],
      ["deployments:update", "apps", "deployments"],
      ["secrets:get", "", "secrets"],
      ["nodes:list", "", "nodes"],
    ];
    for (const [key, group, resource] of checks) {
      const verbPart = key.split(":")[1] ?? verb;
      try {
        out[key] = await rbacApi.self({
          cluster: effectiveCluster,
          verb: verbPart,
          group,
          resource,
          ns: "",
        });
      } catch (e) {
        out[key] = { reason: String(e instanceof Error ? e.message : e) };
      }
    }
    setSelfResults(out);
    setSelfBusy(false);
  }

  if (snap.isLoading) {
    return (
      <div className="page">
        <PageHeader level={2} title="RBAC explorer" />
        <PageLoader message="Loading RBAC data…" />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        level={2}
        title="RBAC explorer"
        count={data && `· ${(data.clusterRoleBindings?.length ?? 0) + (data.roleBindings?.length ?? 0)} bindings`}
      />

      <div className="page-body">
      <Card style={{ marginBottom: 16 }}>
        <div className="rbac-section-title">Who can …</div>
        <div className="pf-form">
          <Select value={verb} onChange={(e) => setVerb(e.target.value)} aria-label="verb">
            {VERBS.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </Select>
          <Select value={kindSel} onChange={(e) => setKindSel(e.target.value)} aria-label="resource">
            {KIND_OPTIONS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </Select>
          <TextField
            placeholder="namespace (optional)"
            value={nsQuery}
            onChange={(e) => setNsQuery(e.target.value)}
            spellCheck={false}
            disabled={!KIND_MAP[kindSel]?.scoped}
          />
          <Button onClick={() => runWhoCan()} disabled={!data}>
            Query
          </Button>
        </div>

        {searched && results && (
          <div style={{ marginTop: 12 }}>
            {results.size === 0 ? (
              <div className="muted small">No subjects found with this access.</div>
            ) : (
              <div className="rbac-results">
                {[...results.entries()].map(([subject, bindings]) => (
                  <div key={subject} className="rbac-subject">
                    <span className="mono strong">{subject}</span>
                    <div className="rbac-bindings">
                      {bindings.map((b) => (
                        <Badge key={b}>{b}</Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      <AttackPathsCard paths={attackPaths} trivyInstalled={trivy.installed} />

      <RbacFindingsCard findings={data?.findings ?? []} onQuery={applyFindingQuery} />

      <ServiceAccountAutomountCard findings={automountFindings} />

      <SecretExposureCard findings={secretExposureFindings} />

      <ImageSignatureCard report={imageSignatureReport} enginesInstalled={sigEnginesInstalled} />

      <RunningImageSignaturesCard cluster={effectiveCluster} />

      <OrphanedSecretsCard secrets={orphanedSecrets} />

      <AuditSecurityFeedCard cluster={effectiveCluster} />

      <Card>
        <div className="rbac-section-title">My access</div>
        <Button variant="ghost" disabled={selfBusy || !effectiveCluster} onClick={() => void runSelfChecks()}>
          {selfBusy ? "Checking…" : "Run SelfSubjectAccessReviews"}
        </Button>
        {selfResults && (
          <div className="rbac-self-grid" style={{ marginTop: 14 }}>
            {Object.entries(selfResults).map(([key, res]) => {
              const allowed = res.allowed === true && res.denied !== true;
              return (
                <div key={key} className={`rbac-self-item ${allowed ? "ok" : "no"}`}>
                  <StatusDot status={allowed ? "ok" : "err"} />
                  <span className="mono small">{key}</span>
                  {!allowed && res.reason && <span className="muted small">{res.reason}</span>}
                </div>
              );
            })}
          </div>
        )}
      </Card>
      </div>
    </div>
  );
}

