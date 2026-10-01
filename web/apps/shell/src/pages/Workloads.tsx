import { useCallback, useMemo, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Badge, IconButton, Row, StatusPill, type StatusTone } from "@kubebay/ui";
import { api } from "../lib/api";
import { useResourceStream } from "../lib/useResourceStream";
import PodPanel, { type SelectedPod } from "./PodPanel";
import { useActiveCluster } from "../App";
import { NamespaceFilter } from "../components/NamespaceFilter";
import { useSelectedNamespaces } from "../lib/namespace-store";
import { compareValues } from "../lib/tableUx";
import { WorkloadTabBar } from "../components/WorkloadTabBar";
import { usageBar, type UsageBar } from "../lib/podUsage";
import { derivePod, type PodRow } from "../lib/pods";
import { ResourceListView, type ListColumn } from "../components/ResourceListView";
import { fmtBytes, fmtCpu } from "../lib/format";

function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}

const METER_FILL: Record<UsageBar["tone"], string> = {
  accent: "var(--kb-accent)",
  warn: "var(--kb-status-warn)",
  err: "var(--kb-status-err)",
};

/** A CPU or memory cell: a bar against the pod's limit (or request) and the amount. */
function UsageMeter({ bar, text }: { bar: UsageBar; text: string }) {
  return (
    <Row align="center" gap={2} title={bar.title}>
      <div className="line-progress" style={{ width: 44, visibility: bar.pct == null ? "hidden" : undefined }}>
        <div className="line-progress-fill" style={{ width: `${bar.pct ?? 0}%`, background: METER_FILL[bar.tone] }} />
      </div>
      <span className="mono muted small">{text}</span>
    </Row>
  );
}

const STATUS_TONE: Record<PodRow["status"], { pill: StatusTone }> = {
  running: { pill: "ok" },
  succeeded: { pill: "terminated" },
  pending: { pill: "pending" },
  failed: { pill: "err" },
  warning: { pill: "err" },
};


const nameOf = (p: PodRow) => p.name;
const nsOf = (p: PodRow) => p.namespace;
const createdOf = (p: PodRow) => p.created;
const isTerminating = (p: PodRow) => p.statusLabel === "Terminating";
const byNsThenName = (a: PodRow, b: PodRow) => compareValues(a.namespace, b.namespace) || compareValues(a.name, b.name);

type Usage = Map<string, { cpuMillis: number; memBytes: number }>;

/** The Pods table's own columns, between Namespace and Age. */
function podColumns(usage: Usage): ListColumn<PodRow>[] {
  return [
    { id: "Ready", header: "Ready", width: 70, className: "mono", cell: (p) => p.ready, sortValue: (p) => p.ready },
    {
      id: "Status",
      header: "Status",
      width: 150,
      className: "",
      cell: (p) => (
        <span title={p.statusDetail || undefined}>
          <StatusPill tone={STATUS_TONE[p.status].pill}>{p.statusLabel}</StatusPill>
        </span>
      ),
      sortValue: (p) => p.statusLabel,
      filterText: (p) => p.statusLabel,
    },
    {
      id: "Restarts",
      header: "Restarts",
      width: 75,
      className: (p) => `mono${p.restarts > 0 ? " restart-warn" : ""}`,
      cell: (p) => p.restarts,
      sortValue: (p) => p.restarts,
    },
    {
      id: "Node",
      header: "Node",
      width: 160,
      className: "mono muted small",
      title: (p) => p.node,
      cell: (p) => p.node || "–",
      sortValue: (p) => p.node,
      filterText: (p) => p.node,
    },
    {
      id: "IP",
      header: "IP",
      width: 120,
      className: "mono muted small",
      cell: (p) => p.podIP || "–",
      sortValue: (p) => p.podIP,
      filterText: (p) => p.podIP,
    },
    {
      id: "CPU",
      header: "CPU",
      width: 110,
      className: "",
      cell: (p) => {
        const u = usage.get(p.key)?.cpuMillis;
        return u != null ? (
          <UsageMeter bar={usageBar(u, p.resources.cpuRequest, p.resources.cpuLimit, fmtCpu)} text={fmtCpu(u)} />
        ) : <span className="mono muted">–</span>;
      },
      sortValue: (p) => usage.get(p.key)?.cpuMillis ?? -1,
    },
    {
      id: "Memory",
      header: "Memory",
      width: 110,
      className: "",
      cell: (p) => {
        const u = usage.get(p.key)?.memBytes;
        return u != null ? (
          <UsageMeter bar={usageBar(u, p.resources.memRequest, p.resources.memLimit, fmtBytes)} text={fmtBytes(u)} />
        ) : <span className="mono muted">–</span>;
      },
      sortValue: (p) => usage.get(p.key)?.memBytes ?? -1,
    },
  ];
}

export default function Workloads() {
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters });
  const { active: activeCluster } = useActiveCluster();

  // Use only the explicitly selected cluster — never fall back to list[0].
  // The fallback produced an unstable value that changed on every 4-second
  // clusters refetch, causing useResourceStream to restart and wipe rows.
  const effectiveCluster = activeCluster;

  const nsFilter = useSelectedNamespaces(effectiveCluster || undefined);
  // "Show pods" from a workload: /workloads?ns=…&selector=…&of=Kind/name streams
  // just its pods. The global namespace filter is left as it was.
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const scope = sp.get("selector") ? { ns: sp.get("ns") ?? "", selector: sp.get("selector")!, of: sp.get("of") ?? "" } : null;
  const { rows, synced, connected } = useResourceStream(effectiveCluster || undefined, "v1/pods", {
    mode: "full",
    ns: scope ? (scope.ns ? [scope.ns] : undefined) : nsFilter.length > 0 ? nsFilter : undefined,
    labelSelector: scope?.selector,
  });

  const metrics = useQuery({
    queryKey: ["podmetrics", effectiveCluster],
    queryFn: () => api.podMetrics(effectiveCluster),
    refetchInterval: 15_000,
    enabled: !!effectiveCluster && connected,
    retry: false,
  });
  const usage = useMemo(() => {
    const m: Usage = new Map();
    for (const u of metrics.data ?? []) m.set(`${u.namespace}/${u.name}`, u);
    return m;
  }, [metrics.data]);

  const [selected, setSelected] = useState<SelectedPod | null>(null);

  const pods = useMemo(() => rows.map(derivePod).filter((p): p is PodRow => p !== null), [rows]);
  const columns = useMemo(() => podColumns(usage), [usage]);

  const openPod = useCallback(
    (p: PodRow, tab?: SelectedPod["tab"]) => {
      const rawObj = rows.find((r) => {
        const m = rec((r ?? {}) as Record<string, unknown>).metadata as Record<string, unknown> | undefined;
        return (m?.name as string) === p.name && (m?.namespace as string) === p.namespace;
      });
      setSelected({
        cluster: effectiveCluster,
        namespace: p.namespace,
        pod: p.name,
        containers: p.containers.length ? p.containers : [""],
        obj: rawObj,
        tab,
      });
    },
    [rows, effectiveCluster],
  );
  const onOpen = useCallback((p: PodRow) => openPod(p), [openPod]);

  // If no cluster is selected and we're done loading, send user to cluster picker.
  // This handles direct navigation (e.g. deep link to /workloads) without going
  // through ClusterPicker, which is the only place that sets the active cluster.
  if (!effectiveCluster && !clusters.isLoading) {
    return <Navigate to="/clusters" replace />;
  }

  return (
    <div className="page">
      <WorkloadTabBar />
      <ResourceListView<PodRow>
        title="Workloads"
        titleCount="· Pods"
        label="Pods"
        rows={pods}
        objects={rows as Record<string, unknown>[]}
        synced={synced}
        busy={!synced || !connected}
        live={synced && connected}
        cluster={effectiveCluster}
        nsFiltered={nsFilter.length > 0}
        nameOf={nameOf}
        nsOf={nsOf}
        createdOf={createdOf}
        isDimmed={isTerminating}
        columns={columns}
        sortKey="pods"
        defaultSort={byNsThenName}
        filterPlaceholder="Filter by name, namespace, node, IP or status…  /"
        onOpen={onOpen}
        toolbar={
          scope ? (
            <>
              <Badge title={`Label selector: ${scope.selector}`}>
                Pods of {scope.of.split("/")[0]} <strong>{scope.of.split("/").slice(1).join("/")}</strong>
                {scope.ns ? ` · ${scope.ns}` : ""}
              </Badge>
              <IconButton label="Show all pods" onClick={() => navigate("/workloads")}>
                ×
              </IconButton>
            </>
          ) : (
            <NamespaceFilter cluster={effectiveCluster || undefined} />
          )
        }
        onDelete={(t, gitopsOwner) =>
          api.deleteResource({ cluster: effectiveCluster, gvr: "v1/pods", ns: t.ns, name: t.name, gitopsOwner })
        }
        menuItems={(p, { requestDelete }) => [
          { label: "View details", onClick: () => openPod(p) },
          { label: "Logs", onClick: () => openPod(p, "logs") },
          { label: "Shell", onClick: () => openPod(p, "shell") },
          { label: "Edit YAML", onClick: () => openPod(p, "yaml") },
          { label: "Copy name", onClick: () => void navigator.clipboard?.writeText(p.name) },
          { separator: true, label: "", onClick: () => {} },
          { label: "Delete", danger: true, onClick: requestDelete },
        ]}
      />

      {selected && <PodPanel key={`${selected.namespace}/${selected.pod}/${selected.tab ?? ""}`} pod={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
