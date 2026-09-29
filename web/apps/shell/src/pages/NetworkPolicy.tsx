import { useEffect, useMemo, useState } from "react";
import { Badge, DataTable, EmptyState, IconButton, NsPill, PageHeader, Row, SegmentedControl, Select, Stack } from "@kubebay/ui";
import { PageLoader } from "../components/PageLoader";
import { useCluster } from "../lib/useCluster";
import { useResourceStream } from "../lib/useResourceStream";
import { useSelectedNamespaces } from "../lib/namespace-store";
import { NamespaceFilter } from "../components/NamespaceFilter";

// ── Type helpers ──────────────────────────────────────────────────────────────

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? (v as string[]) : [];
}

// ── Kubernetes object shape (minimal) ────────────────────────────────────────

interface KMeta {
  name?: string;
  namespace?: string;
  labels?: Record<string, string>;
}

interface KObj {
  metadata?: KMeta;
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
}

// ── NetworkPolicy spec shapes ─────────────────────────────────────────────────

interface LabelSelector {
  matchLabels?: Record<string, string>;
  matchExpressions?: unknown[];
}

interface NetworkPolicyPeer {
  podSelector?: LabelSelector;
  namespaceSelector?: LabelSelector;
  ipBlock?: unknown;
}

interface NetworkPolicyPort {
  port?: number | string;
  protocol?: string;
}

interface NetworkPolicyIngressRule {
  from?: NetworkPolicyPeer[];
  ports?: NetworkPolicyPort[];
}

interface NetworkPolicyEgressRule {
  to?: NetworkPolicyPeer[];
  ports?: NetworkPolicyPort[];
}

interface NetworkPolicySpec {
  podSelector?: LabelSelector;
  ingress?: NetworkPolicyIngressRule[];
  egress?: NetworkPolicyEgressRule[];
  policyTypes?: string[];
}

// ── Connectivity status ───────────────────────────────────────────────────────

type ConnStatus = "open" | "allowed" | "isolated" | "unknown";

interface CellDetail {
  src: string;
  dst: string;
  status: ConnStatus;
  policies: string[];
}

// ── Label selector matching ───────────────────────────────────────────────────

function selectorMatches(sel: LabelSelector | undefined, labels: Record<string, string>): boolean {
  if (!sel) return true; // empty selector matches all
  if (sel.matchLabels) {
    for (const [k, v] of Object.entries(sel.matchLabels)) {
      if (labels[k] !== v) return false;
    }
  }
  // matchExpressions: best-effort for v0.x — skip complex expressions
  return true;
}

function podAppLabel(labels: Record<string, string> | undefined): string {
  if (!labels) return "(unlabelled)";
  return labels["app"] ?? labels["app.kubernetes.io/name"] ?? labels["k8s-app"] ?? "(unlabelled)";
}

// ── Policy evaluation ─────────────────────────────────────────────────────────

interface PodGroup {
  key: string; // "namespace/appLabel"
  namespace: string;
  appLabel: string;
  labels: Record<string, string>;
}

interface PolicyInfo {
  name: string;
  namespace: string;
  spec: NetworkPolicySpec;
}

// Returns the set of namespace names that have at least one NetworkPolicy
// restricting ingress. A policy only isolates ingress traffic if its
// policyTypes includes "Ingress" — or has no explicit policyTypes at all,
// which per k8s semantics defaults to affecting Ingress. An Egress-only
// policy (policyTypes: ["Egress"]) does not isolate ingress and must not
// count here.
function isolatedNamespaces(policies: PolicyInfo[]): Set<string> {
  const ns = new Set<string>();
  for (const p of policies) {
    const types = strArr(p.spec.policyTypes);
    const affectsIngress = types.length === 0 || types.includes("Ingress");
    if (affectsIngress) ns.add(p.namespace);
  }
  return ns;
}

// Does policy p select this pod group?
function policySelectsPodGroup(p: PolicyInfo, group: PodGroup): boolean {
  if (p.namespace !== group.namespace) return false;
  const sel = p.spec.podSelector;
  // Empty/null podSelector selects all pods in the namespace
  if (!sel || (!sel.matchLabels && (!sel.matchExpressions || sel.matchExpressions.length === 0))) {
    return true;
  }
  return selectorMatches(sel, group.labels);
}

// Check if any ingress rule allows traffic FROM srcGroup TO dstGroup
function ingressAllows(
  p: PolicyInfo,
  srcGroup: PodGroup,
  dstGroup: PodGroup,
): boolean {
  // The policy must select the dstGroup
  if (!policySelectsPodGroup(p, dstGroup)) return false;
  const policyTypes = strArr(p.spec.policyTypes);
  const hasIngressType = policyTypes.length === 0 || policyTypes.includes("Ingress");
  if (!hasIngressType) return false;

  const ingressRules = p.spec.ingress;
  // If ingress is defined as empty array [] — deny all
  if (ingressRules !== undefined && !Array.isArray(ingressRules)) return false;
  if (Array.isArray(ingressRules) && ingressRules.length === 0) return false;
  if (!ingressRules) return true; // no ingress field = allow all (only ingress type matters)

  for (const rule of ingressRules) {
    const froms = rule.from;
    if (!froms || froms.length === 0) return true; // allow all sources
    for (const peer of froms) {
      // Check podSelector within same namespace
      if (peer.podSelector !== undefined && !peer.namespaceSelector) {
        if (srcGroup.namespace === dstGroup.namespace) {
          if (selectorMatches(peer.podSelector, srcGroup.labels)) return true;
        }
      }
      // Check namespaceSelector only
      if (peer.namespaceSelector !== undefined && !peer.podSelector) {
        // Best-effort: we can't evaluate namespace labels without streaming namespaces
        // Conservative: if namespaceSelector is empty, it matches all namespaces
        const nsSelEmpty =
          !peer.namespaceSelector.matchLabels &&
          (!peer.namespaceSelector.matchExpressions || peer.namespaceSelector.matchExpressions.length === 0);
        if (nsSelEmpty) return true;
      }
      // Both podSelector + namespaceSelector
      if (peer.podSelector !== undefined && peer.namespaceSelector !== undefined) {
        if (selectorMatches(peer.podSelector, srcGroup.labels)) return true;
      }
      // ipBlock — skip for pod-to-pod matrix
    }
  }
  return false;
}

// Returns connectivity + which policy names are relevant
function computeConnectivity(
  srcGroup: PodGroup,
  dstGroup: PodGroup,
  policies: PolicyInfo[],
  isolated: Set<string>,
): CellDetail {
  const srcNsIsolated = isolated.has(srcGroup.namespace);
  const dstNsIsolated = isolated.has(dstGroup.namespace);

  // If neither namespace has any network policies — fully open
  if (!srcNsIsolated && !dstNsIsolated) {
    return { src: srcGroup.key, dst: dstGroup.key, status: "open", policies: [] };
  }

  // Find policies that explicitly allow ingress from srcGroup to dstGroup
  const matchingPolicies = policies.filter((p) => ingressAllows(p, srcGroup, dstGroup));

  if (matchingPolicies.length > 0) {
    return {
      src: srcGroup.key,
      dst: dstGroup.key,
      status: "allowed",
      policies: matchingPolicies.map((p) => `${p.namespace}/${p.name}`),
    };
  }

  // Destination namespace is isolated (has NetworkPolicy) and nothing allows it
  if (dstNsIsolated) {
    return { src: srcGroup.key, dst: dstGroup.key, status: "isolated", policies: [] };
  }

  // Source is isolated but destination isn't — best-effort unknown
  return { src: srcGroup.key, dst: dstGroup.key, status: "unknown", policies: [] };
}

// ── Cell visual ───────────────────────────────────────────────────────────────

const CELL_COLORS: Record<ConnStatus, { bg: string; text: string; symbol: string }> = {
  open: { bg: "color-mix(in srgb, var(--kb-status-ok) 12%, transparent)", text: "var(--kb-status-ok)", symbol: "○" },
  allowed: { bg: "color-mix(in srgb, var(--kb-status-ok) 20%, transparent)", text: "var(--kb-status-ok)", symbol: "✓" },
  isolated: { bg: "color-mix(in srgb, var(--kb-status-err) 15%, transparent)", text: "var(--kb-status-err)", symbol: "✗" },
  unknown: { bg: "color-mix(in srgb, var(--kb-fg-muted) 10%, transparent)", text: "var(--kb-fg-muted)", symbol: "?" },
};

// ── NetworkPolicy page ────────────────────────────────────────────────────────

export default function NetworkPolicyPage() {
  const { cluster: effectiveCluster, setCluster, list } = useCluster();

  // Namespace filter — shared, persisted, multi-select store. An empty
  // selection means "(all)", matching NamespaceFilter's own convention.
  const nsFilter = useSelectedNamespaces(effectiveCluster || undefined);

  const [activeTab, setActiveTab] = useState<"matrix" | "policies">("matrix");
  const [selectedCell, setSelectedCell] = useState<CellDetail | null>(null);

  useEffect(() => setSelectedCell(null), [nsFilter]);

  // Stream pods (full, to get labels)
  const pods = useResourceStream(effectiveCluster || undefined, "v1/pods", { mode: "full" });

  // Stream NetworkPolicies
  const netpols = useResourceStream(
    effectiveCluster || undefined,
    "networking.k8s.io/v1/networkpolicies",
    { mode: "full" },
  );

  const ready = pods.synced && netpols.synced;

  // Build pod groups (unique namespace/appLabel combos)
  const podGroups = useMemo((): PodGroup[] => {
    const seen = new Map<string, PodGroup>();
    for (const raw of pods.rows as KObj[]) {
      const meta = raw.metadata ?? {};
      const ns = meta.namespace ?? "default";
      const labels = meta.labels ?? {};
      const appLabel = podAppLabel(labels);
      const key = `${ns}/${appLabel}`;
      if (!seen.has(key)) {
        seen.set(key, { key, namespace: ns, appLabel, labels });
      } else {
        // Merge labels (last write wins — for matching we just need a representative set)
        const existing = seen.get(key)!;
        seen.set(key, { ...existing, labels: { ...existing.labels, ...labels } });
      }
    }
    return Array.from(seen.values()).sort((a, b) =>
      a.namespace === b.namespace
        ? a.appLabel.localeCompare(b.appLabel)
        : a.namespace.localeCompare(b.namespace),
    );
  }, [pods.rows]);

  // Build policy list
  const policies = useMemo((): PolicyInfo[] => {
    return (netpols.rows as KObj[]).map((raw) => ({
      name: raw.metadata?.name ?? "",
      namespace: raw.metadata?.namespace ?? "",
      spec: (raw.spec ?? {}) as NetworkPolicySpec,
    }));
  }, [netpols.rows]);

  const isolated = useMemo(() => isolatedNamespaces(policies), [policies]);

  // Filter groups by namespace — empty selection means "(all)"
  const filteredGroups = useMemo(
    () => (nsFilter.length === 0 ? podGroups : podGroups.filter((g) => nsFilter.includes(g.namespace))),
    [podGroups, nsFilter],
  );

  // Compute full matrix
  const matrix = useMemo((): Map<string, Map<string, CellDetail>> => {
    const m = new Map<string, Map<string, CellDetail>>();
    for (const src of filteredGroups) {
      const row = new Map<string, CellDetail>();
      for (const dst of filteredGroups) {
        row.set(dst.key, computeConnectivity(src, dst, policies, isolated));
      }
      m.set(src.key, row);
    }
    return m;
  }, [filteredGroups, policies, isolated]);

  // Policy list filter — empty selection means "(all)"
  const filteredPolicies = useMemo(
    () => (nsFilter.length === 0 ? policies : policies.filter((p) => nsFilter.includes(p.namespace))),
    [policies, nsFilter],
  );

  return (
    <div className="page">
      {/* ── Header ── */}
      <PageHeader
        level={2}
        title="Network Policy"
        live={ready}
        actions={
          <>
            <Badge>{policies.length} policies</Badge>
            <Badge>{podGroups.length} pod groups</Badge>
          </>
        }
      />

      {/* ── Toolbar ── */}
      <div className="toolbar">
        <Select
          value={effectiveCluster}
          onChange={(e) => setCluster(e.target.value)}
          aria-label="cluster"
        >
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {c.id}
            </option>
          ))}
        </Select>
        <NamespaceFilter cluster={effectiveCluster || undefined} />

        <SegmentedControl
          label="View"
          className="toolbar-end"
          options={[
            { value: "matrix", label: "Connectivity matrix" },
            { value: "policies", label: "Policy list" },
          ]}
          value={activeTab}
          onChange={setActiveTab}
        />
      </div>

      {/* ── Body ── */}
      {!effectiveCluster ? (
        <PageLoader message="Waiting for cluster…" />
      ) : !ready && podGroups.length === 0 ? (
        <PageLoader message="Loading network policies…" />
      ) : activeTab === "matrix" ? (
        <MatrixView
          groups={filteredGroups}
          matrix={matrix}
          selectedCell={selectedCell}
          onSelectCell={setSelectedCell}
          policies={filteredPolicies}
        />
      ) : (
        <PolicyListView policies={filteredPolicies} />
      )}
    </div>
  );
}

// ── Matrix view ───────────────────────────────────────────────────────────────

interface MatrixViewProps {
  groups: PodGroup[];
  matrix: Map<string, Map<string, CellDetail>>;
  selectedCell: CellDetail | null;
  onSelectCell: (cell: CellDetail | null) => void;
  policies: PolicyInfo[];
}

function MatrixView({ groups, matrix, selectedCell, onSelectCell }: MatrixViewProps) {
  if (groups.length === 0) {
    return (
      <EmptyState style={{ margin: "var(--kb-gutter)" }}>
        <p>No pods found in this namespace.</p>
        <p className="muted small">Select a different namespace or check your cluster connection.</p>
      </EmptyState>
    );
  }

  return (
    <Stack style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
      {/* Legend */}
      <div className="np-legend">
        <span className="np-legend-title">Legend:</span>
        {(Object.entries(CELL_COLORS) as [ConnStatus, typeof CELL_COLORS[ConnStatus]][]).map(([status, cfg]) => (
          <span key={status} className="np-legend-item">
            <span
              className="np-cell-dot"
              style={{ background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.text}` }}
            >
              {cfg.symbol}
            </span>
            <span className="np-legend-label">{status}</span>
          </span>
        ))}
        <span className="np-legend-hint muted small" style={{ marginLeft: "auto" }}>
          Rows = source · Cols = destination
        </span>
      </div>

      {/* Matrix table */}
      <div className="np-matrix-wrap">
        <table className="np-matrix">
          <thead>
            <tr>
              <th className="np-corner">src \ dst</th>
              {groups.map((g) => (
                <th key={g.key} className="np-col-header" title={g.key}>
                  <div className="np-group-label">
                    <NsPill>{g.namespace}</NsPill>
                    <span className="np-app-label">{g.appLabel}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((src) => (
              <tr key={src.key}>
                <td className="np-row-header" title={src.key}>
                  <div className="np-group-label">
                    <NsPill>{src.namespace}</NsPill>
                    <span className="np-app-label">{src.appLabel}</span>
                  </div>
                </td>
                {groups.map((dst) => {
                  const cell = matrix.get(src.key)?.get(dst.key);
                  if (!cell) return <td key={dst.key} className="np-cell" />;
                  const cfg = CELL_COLORS[cell.status];
                  const isSelected =
                    selectedCell?.src === src.key && selectedCell?.dst === dst.key;
                  const isSelf = src.key === dst.key;
                  return (
                    <td
                      key={dst.key}
                      className={`np-cell${isSelected ? " selected" : ""}${isSelf ? " self" : ""}`}
                      style={{
                        background: isSelf
                          ? "var(--kb-bg-inset)"
                          : cfg.bg,
                        color: cfg.text,
                        cursor: isSelf ? "default" : "pointer",
                      }}
                      title={`${src.appLabel} → ${dst.appLabel}: ${cell.status}`}
                      onClick={() => {
                        if (isSelf) return;
                        onSelectCell(isSelected ? null : cell);
                      }}
                    >
                      {isSelf ? "—" : cfg.symbol}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detail panel */}
      {selectedCell && (
        <CellDetailPanel cell={selectedCell} onClose={() => onSelectCell(null)} />
      )}
    </Stack>
  );
}

// ── Cell detail panel ─────────────────────────────────────────────────────────

function CellDetailPanel({ cell, onClose }: { cell: CellDetail; onClose: () => void }) {
  const cfg = CELL_COLORS[cell.status];
  const [srcNs, srcApp] = cell.src.split("/");
  const [dstNs, dstApp] = cell.dst.split("/");
  return (
    <div className="np-detail-panel">
      <div className="np-detail-header">
        <div className="np-detail-title">
          <span className="np-ns-badge">{srcNs}</span>
          <span className="np-app-label">{srcApp}</span>
          <span className="np-arrow">→</span>
          <span className="np-ns-badge">{dstNs}</span>
          <span className="np-app-label">{dstApp}</span>
          <span
            className="np-status-chip"
            style={{ background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.text}` }}
          >
            {cfg.symbol} {cell.status}
          </span>
        </div>
        <IconButton label="Close" onClick={onClose}>
          ×
        </IconButton>
      </div>
      <div className="np-detail-body">
        {cell.status === "open" && (
          <p className="muted small">No NetworkPolicies in either namespace — traffic is unrestricted.</p>
        )}
        {cell.status === "isolated" && (
          <p className="muted small">
            Destination namespace has NetworkPolicy isolation and no policy explicitly allows this traffic.
          </p>
        )}
        {cell.status === "unknown" && (
          <p className="muted small">
            Source namespace is isolated but destination is open — cannot determine egress rules without egress policy evaluation.
          </p>
        )}
        {cell.status === "allowed" && cell.policies.length > 0 && (
          <div>
            <p className="small" style={{ marginBottom: 6 }}>Allowed by:</p>
            <div className="np-policy-chips">
              {cell.policies.map((p) => (
                <Badge key={p} tone="ok">{p}</Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Policy list view ──────────────────────────────────────────────────────────

function PolicyListView({ policies }: { policies: PolicyInfo[] }) {
  if (policies.length === 0) {
    return (
      <EmptyState style={{ margin: "var(--kb-gutter)" }}>
        <p>No NetworkPolicies found.</p>
        <p className="muted small">All traffic is unrestricted in this namespace.</p>
      </EmptyState>
    );
  }

  const selectorOf = (p: PolicyInfo) =>
    p.spec.podSelector?.matchLabels
      ? Object.entries(p.spec.podSelector.matchLabels)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")
      : "(all pods)";

  return (
    <DataTable
      rows={policies}
      rowKey={(p) => `${p.namespace}/${p.name}`}
      style={{ flex: 1 }}
      columns={[
        { key: "ns", header: "Namespace", width: "20%", render: (p) => <NsPill>{p.namespace}</NsPill> },
        { key: "name", header: "Name", width: "25%", className: "mono td-name", title: (p) => p.name, render: (p) => p.name },
        {
          key: "types",
          header: "Types",
          width: "15%",
          render: (p) => {
            const types = strArr(p.spec.policyTypes);
            return types.length === 0 ? (
              <Badge>Ingress</Badge>
            ) : (
              <Row gap={1} wrap>
                {types.map((t) => (
                  <Badge key={t}>{t}</Badge>
                ))}
              </Row>
            );
          },
        },
        { key: "sel", header: "Pod selector", width: "20%", className: "mono small", title: selectorOf, render: selectorOf },
        {
          key: "in",
          header: "Ingress rules",
          width: "10%",
          className: "cell-secondary",
          render: (p) => (Array.isArray(p.spec.ingress) ? p.spec.ingress.length : "–"),
        },
        {
          key: "out",
          header: "Egress rules",
          width: "10%",
          className: "cell-secondary",
          render: (p) => (Array.isArray(p.spec.egress) ? p.spec.egress.length : "–"),
        },
      ]}
    />
  );
}
