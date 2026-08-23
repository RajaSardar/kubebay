import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Card } from "@kubebay/ui";
import { api } from "../lib/api";
import { rbacApi as api2 } from "../lib/api";

interface Rule {
  verbs: string[];
  apiGroups: string[];
  resources: string[];
}
interface RoleSummary {
  name: string;
  ns?: string;
  kind: string;
  rules: Rule[];
}
interface Subject {
  kind: string;
  name: string;
  ns?: string;
}
interface BindingSummary {
  name: string;
  ns?: string;
  kind: string;
  roleRef: string;
  subjects: Subject[];
}
interface RBACSnapshot {
  roles: RoleSummary[];
  clusterRoles: RoleSummary[];
  roleBindings: BindingSummary[];
  clusterRoleBindings: BindingSummary[];
}

const VERBS = ["get", "list", "watch", "create", "update", "patch", "delete", "*"];
const KIND_MAP: Record<string, { group: string; resource: string; scoped: boolean }> = {
  pods: { group: "", resource: "pods", scoped: true },
  deployments: { group: "apps", resource: "deployments", scoped: true },
  statefulsets: { group: "apps", resource: "statefulsets", scoped: true },
  services: { group: "", resource: "services", scoped: true },
  configmaps: { group: "", resource: "configmaps", scoped: true },
  secrets: { group: "", resource: "secrets", scoped: true },
  jobs: { group: "batch", resource: "jobs", scoped: true },
  nodes: { group: "", resource: "nodes", scoped: false },
  namespaces: { group: "", resource: "namespaces", scoped: false },
};

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
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters });
  const list = clusters.data ?? [];
  const effectiveCluster = list.find((c) => c.status === "connected")?.id || list[0]?.id || "";

  const snap = useQuery({
    queryKey: ["rbac", effectiveCluster],
    queryFn: () =>
      fetch(`/api/rbac/all?cluster=${encodeURIComponent(effectiveCluster)}&token=${encodeURIComponent(localStorage.getItem("kb.token") ?? "")}`).then(
        (r) => r.json() as Promise<RBACSnapshot>,
      ),
    enabled: !!effectiveCluster,
  });

  const [verb, setVerb] = useState("list");
  const [kindSel, setKindSel] = useState("pods");
  const [nsQuery, setNsQuery] = useState("");
  const [results, setResults] = useState<Map<string, string[]> | null>(null);
  const [searched, setSearched] = useState(false);

  const data = snap.data;

  function runWhoCan() {
    if (!data) return;
    const meta = KIND_MAP[kindSel] ?? {
      group: "",
      resource: kindSel,
      scoped: true,
    };
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
        if (!ruleAllows(rule, verb === "*" ? "*" : verb, meta.group, meta.resource)) continue;
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
        out[key] = await api2.self({
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

  return (
    <div className="page">
      <div className="page-header">
        <h2>
          RBAC explorer
          {data && (
            <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
              · {(data.clusterRoleBindings?.length ?? 0) + (data.roleBindings?.length ?? 0)} bindings
            </span>
          )}
        </h2>
        <div style={{ display: "flex", gap: 10 }}>
          <select className="toolbar-select" value={effectiveCluster} onChange={() => undefined}>
            {list.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <div className="rbac-section-title">Who can …</div>
        <div className="pf-form">
          <select className="toolbar-select" value={verb} onChange={(e) => setVerb(e.target.value)} aria-label="verb">
            {VERBS.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
          <select className="toolbar-select" value={kindSel} onChange={(e) => setKindSel(e.target.value)} aria-label="resource">
            {Object.keys(KIND_MAP).map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          <input
            className="toolbar-input"
            placeholder="namespace (optional)"
            value={nsQuery}
            onChange={(e) => setNsQuery(e.target.value)}
            spellCheck={false}
            disabled={!KIND_MAP[kindSel]?.scoped}
          />
          <Button onClick={runWhoCan} disabled={!data}>
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
                  <StatusDotInline ok={allowed} />
                  <span className="mono small">{key}</span>
                  {!allowed && res.reason && <span className="muted small">{res.reason}</span>}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function StatusDotInline({ ok }: { ok: boolean }) {
  return (
    <span
      className="kb-dot"
      style={{
        background: ok ? "var(--kb-status-ok)" : "var(--kb-status-err)",
        boxShadow: `0 0 0 3px color-mix(in srgb, ${ok ? "var(--kb-status-ok)" : "var(--kb-status-err)"} 18%, transparent)`,
      }}
    />
  );
}
