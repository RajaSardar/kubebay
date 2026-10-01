import { useEffect, useMemo, useState } from "react";
import { Badge, DataTable, EmptyState, IconButton, NsPill, PageHeader, Row, SegmentedControl, Select, Stack } from "@kubebay/ui";
import { PageLoader } from "../components/PageLoader";
import { useCluster } from "../lib/useCluster";
import { useResourceStream } from "../lib/useResourceStream";
import { useSelectedNamespaces } from "../lib/namespace-store";
import { NamespaceFilter } from "../components/NamespaceFilter";
import { NetworkPolicyCoverageList } from "../components/NetworkPolicyCoverageList";
import { findNetworkPolicyCoverageGaps } from "../lib/networkPolicyCoverage";
import { ReachabilityCheck } from "../components/ReachabilityCheck";
import { NetDiagCard } from "../components/NetDiagCard";
import { matrixCell, type MatrixCell } from "../lib/netpolMatrix";

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

type ConnStatus = MatrixCell["status"];

interface CellDetail extends MatrixCell {
  src: string;
  dst: string;
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
  /** The first pod seen for this namespace/app; the matrix evaluates policy against it. */
  pod: Record<string, unknown>;
}

interface PolicyInfo {
  name: string;
  namespace: string;
  spec: NetworkPolicySpec;
}

// ── Cell visual ───────────────────────────────────────────────────────────────

const CELL_COLORS: Record<ConnStatus, { bg: string; text: string; symbol: string }> = {
  open: { bg: "color-mix(in srgb, var(--kb-status-ok) 12%, transparent)", text: "var(--kb-status-ok)", symbol: "○" },
  allowed: { bg: "color-mix(in srgb, var(--kb-status-ok) 20%, transparent)", text: "var(--kb-status-ok)", symbol: "✓" },
  blocked: { bg: "color-mix(in srgb, var(--kb-status-err) 15%, transparent)", text: "var(--kb-status-err)", symbol: "✗" },
};

// ── NetworkPolicy page ────────────────────────────────────────────────────────

export default function NetworkPolicyPage() {
  const { cluster: effectiveCluster, setCluster, list } = useCluster();

  // Namespace filter — shared, persisted, multi-select store. An empty
  // selection means "(all)", matching NamespaceFilter's own convention.
  const nsFilter = useSelectedNamespaces(effectiveCluster || undefined);

  const [activeTab, setActiveTab] = useState<"matrix" | "policies" | "coverage" | "reach">("matrix");
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

  // Namespace labels for namespaceSelector peers; only the reachability check needs them.
  const namespaces = useResourceStream(effectiveCluster || undefined, "v1/namespaces", {
    mode: "full",
    enabled: activeTab === "reach" || activeTab === "matrix",
  });

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
      if (!seen.has(key)) seen.set(key, { key, namespace: ns, appLabel, pod: raw as Record<string, unknown> });
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
        row.set(dst.key, { src: src.key, dst: dst.key, ...matrixCell(src.pod, dst.pod, netpols.rows, namespaces.rows) });
      }
      m.set(src.key, row);
    }
    return m;
  }, [filteredGroups, netpols.rows, namespaces.rows]);

  // Policy list filter — empty selection means "(all)"
  const filteredPolicies = useMemo(
    () => (nsFilter.length === 0 ? policies : policies.filter((p) => nsFilter.includes(p.namespace))),
    [policies, nsFilter],
  );

  // Backlog #26: coverage gaps computed cluster-wide, then filtered by the
  // same namespace selection as everything else on this page.
  const coverageGaps = useMemo(
    () => findNetworkPolicyCoverageGaps(pods.rows, netpols.rows),
    [pods.rows, netpols.rows],
  );
  const filteredCoverageGaps = useMemo(
    () => (nsFilter.length === 0 ? coverageGaps : coverageGaps.filter((g) => nsFilter.includes(g.namespace))),
    [coverageGaps, nsFilter],
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
            { value: "coverage", label: "Coverage gaps" },
            { value: "reach", label: "Can A reach B?" },
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
      ) : activeTab === "policies" ? (
        <PolicyListView policies={filteredPolicies} />
      ) : activeTab === "reach" ? (
        <div className="page-body">
          <ReachabilityCheck
            pods={nsFilter.length === 0 ? pods.rows : pods.rows.filter((p) => nsFilter.includes(String((p.metadata as KMeta | undefined)?.namespace ?? "")))}
            policies={netpols.rows}
            namespaces={namespaces.rows}
          />
          <div style={{ marginTop: 16 }}>
            <NetDiagCard
              cluster={effectiveCluster}
              namespaces={namespaces.rows.map((n) => String((n.metadata as KMeta | undefined)?.name ?? "")).filter(Boolean).sort()}
            />
          </div>
        </div>
      ) : (
        <div className="page-body">
          <NetworkPolicyCoverageList gaps={filteredCoverageGaps} />
        </div>
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
          <p className="muted small">No NetworkPolicy selects either pod, so traffic is unrestricted.</p>
        )}
        {cell.status === "blocked" && (
          <div>
            <p className="small" style={{ marginBottom: 6 }}>Isolated, and no rule allows this traffic:</p>
            <div className="np-policy-chips">
              {(cell.blockedBy ?? []).map((p) => (
                <Badge key={p} tone="err">{p}</Badge>
              ))}
            </div>
          </div>
        )}
        {cell.status === "allowed" && cell.policies.length > 0 && (
          <div>
            <p className="small" style={{ marginBottom: 6 }}>Allowed by:</p>
            <div className="np-policy-chips">
              {cell.policies.map((p) => (
                <Badge key={p} tone="ok">{p}</Badge>
              ))}
            </div>
            {cell.allowedPorts && <p className="muted small" style={{ marginTop: 6 }}>Only on {cell.allowedPorts.join(", ")}.</p>}
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
