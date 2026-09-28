import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, EmptyState, InlineBanner, NsPill, PageHeader, Select, SelectAllHeader, SelectCell, SkeletonRows, SortHeader, StatusPill, Table, TableRow, TableWrap, TextField, type StatusTone } from "@kubebay/ui";
import { api } from "../lib/api";
import { useResourceStream, shouldShowSkeleton } from "../lib/useResourceStream";
import PodPanel, { type SelectedPod } from "./PodPanel";
import { useActiveCluster } from "../App";
import { useResizableColumns } from "../lib/useResizableColumns";
import { useRowSelection } from "../lib/useRowSelection";
import { useBulkDelete } from "../lib/useBulkDelete";
import { NamespaceFilter } from "../components/NamespaceFilter";
import { useSelectedNamespaces } from "../lib/namespace-store";
import { WorkloadTabBar } from "../components/WorkloadTabBar";
import { PageLoader } from "../components/PageLoader";
import { ownerAmongTargets, ownerLabel, ownerWarning } from "../lib/gitops";

function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}

export function fmtCpu(millis: number): string {
  if (millis >= 1000) return `${(millis / 1000).toFixed(2)} core`;
  return `${Math.max(1, Math.round(millis))}m`;
}

export function fmtBytes(bytes: number): string {
  if (bytes <= 0) return "0";
  const units = ["B", "Ki", "Mi", "Gi"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)}${units[i]}`;
}

interface PodRow {
  key: string;
  name: string;
  namespace: string;
  ready: string;
  status: "running" | "succeeded" | "pending" | "failed" | "warning";
  statusLabel: string;
  restarts: number;
  ageMs: number;
  containers: string[];
  node: string;
  podIP: string;
}

function asRecord(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}

function derivePod(obj: Record<string, unknown>): PodRow | null {
  const meta = asRecord(obj.metadata);
  const name = meta.name as string | undefined;
  const namespace = (meta.namespace as string) ?? "default";
  if (!name) return null;

  const spec = asRecord(obj.spec);
  const status = asRecord(obj.status);
  const containers = (spec.containers ?? []) as unknown[];
  const containerStatuses = (status.containerStatuses ?? []) as Record<string, unknown>[];

  const readyCount = containerStatuses.filter((cs) => cs.ready === true).length;
  const restarts = containerStatuses.reduce((acc, cs) => acc + ((cs.restartCount as number) ?? 0), 0);

  const phase = (status.phase as string) ?? "Unknown";
  let state: PodRow["status"] = "pending";
  let label = phase;

  if (meta.deletionTimestamp) {
    state = "pending";
    label = "Terminating";
  } else {
    for (const cs of containerStatuses) {
      const waiting = asRecord(asRecord(cs.state).waiting);
      const reason = waiting.reason as string | undefined;
      if (reason && reason !== "ContainerCreating") {
        state = "failed";
        label = reason;
        break;
      }
    }
    if (state !== "failed") {
      if (phase === "Running" && containers.length > 0 && readyCount === containers.length) {
        state = "running";
        label = "Running";
      } else if (phase === "Succeeded") {
        state = "succeeded";
      } else if (phase === "Failed") {
        state = "failed";
      }
    }
  }

  const containerNames = [
    ...new Set([
      ...containerStatuses.map((cs) => cs.name as string).filter(Boolean),
      ...((spec.containers ?? []) as Record<string, unknown>[]).map((c) => asRecord(c).name as string).filter(Boolean),
    ]),
  ];

  const created = meta.creationTimestamp ? Date.parse(meta.creationTimestamp as string) : Date.now();

  return {
    key: `${namespace}/${name}`,
    name,
    namespace,
    ready: `${readyCount}/${containerNames.length || "?"}`,
    status: state,
    statusLabel: label,
    restarts,
    ageMs: Math.max(0, Date.now() - created),
    containers: containerNames,
    node: (spec.nodeName as string) ?? "",
    podIP: (status.podIP as string) ?? "",
  };
}

function fmtAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const STATUS_TONE: Record<PodRow["status"], { pill: StatusTone }> = {
  running: { pill: "ok" },
  succeeded: { pill: "terminated" },
  pending: { pill: "pending" },
  failed: { pill: "err" },
  warning: { pill: "err" },
};


// Column order: checkbox(0), Name(1), Namespace(2), Ready(3), Status(4), Restarts(5), Node(6), IP(7), CPU(8), Memory(9), Age(10)
const HEADERS = ["Name", "Namespace", "Ready", "Status", "Restarts", "Node", "IP", "CPU", "Memory", "Age"] as const;
const INITIAL_WIDTHS = [240, 120, 70, 150, 75, 160, 120, 110, 110, 75];

type SortCol = typeof HEADERS[number] | null;

export default function Workloads() {
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters });
  const { active: activeCluster, setActive: setActiveCluster } = useActiveCluster();
  const [filter, setFilter] = useState("");
  const [sortCol, setSortCol] = useState<SortCol>(null);
  const [sortAsc, setSortAsc] = useState(true);

  const list = clusters.data ?? [];
  // Use only the explicitly selected cluster — never fall back to list[0].
  // The fallback produced an unstable value that changed on every 4-second
  // clusters refetch, causing useResourceStream to restart and wipe rows.
  const effectiveCluster = activeCluster;

  const nsFilter = useSelectedNamespaces(effectiveCluster || undefined);
  const { rows, synced, connected } = useResourceStream(effectiveCluster || undefined, "v1/pods", {
    mode: "full",
    ns: nsFilter.length > 0 ? nsFilter : undefined,
  });

  const metrics = useQuery({
    queryKey: ["podmetrics", effectiveCluster],
    queryFn: () => api.podMetrics(effectiveCluster),
    refetchInterval: 15_000,
    enabled: !!effectiveCluster && connected,
    retry: false,
  });
  const usage = useMemo(() => {
    const m = new Map<string, { cpuMillis: number; memBytes: number }>();
    for (const u of metrics.data ?? []) m.set(`${u.namespace}/${u.name}`, u);
    return m;
  }, [metrics.data]);

  const [selected, setSelected] = useState<SelectedPod | null>(null);
  const { widths, getResizeHandleProps } = useResizableColumns(HEADERS.length, INITIAL_WIDTHS);
  const { selectedKeys, toggleRow, selectAll, clearAll, deselect, isAllSelected, isIndeterminate } = useRowSelection();
  const bulkDelete = useBulkDelete((t) => {
    const owner = ownerAmongTargets([t], rows);
    return api.deleteResource({
      cluster: effectiveCluster,
      gvr: "v1/pods",
      ns: t.ns,
      name: t.name,
      gitopsOwner: owner ? ownerLabel(owner) : undefined,
    });
  });

  // If no cluster is selected and we're done loading, send user to cluster picker.
  // This handles direct navigation (e.g. deep link to /workloads) without going
  // through ClusterPicker, which is the only place that sets the active cluster.
  if (!effectiveCluster && !clusters.isLoading) {
    return <Navigate to="/clusters" replace />;
  }

  async function confirmDeletePods() {
    const succeeded = await bulkDelete.confirm();
    deselect(succeeded.map((t) => `${t.ns}/${t.name}`));
  }

  function toggleSort(col: SortCol) {
    if (sortCol === col) setSortAsc((a) => !a);
    else { setSortCol(col); setSortAsc(true); }
  }

  const pods = useMemo(() => {
    let out = rows
      .map(derivePod)
      .filter((p): p is PodRow => p !== null)
      .filter((p) => !filter || p.name.includes(filter) || p.namespace.includes(filter));

    if (sortCol) {
      out.sort((a, b) => {
        let av: string | number, bv: string | number;
        switch (sortCol) {
          case "Name":      av = a.name;      bv = b.name;      break;
          case "Namespace": av = a.namespace; bv = b.namespace; break;
          case "Ready":     av = a.ready;     bv = b.ready;     break;
          case "Status":    av = a.statusLabel; bv = b.statusLabel; break;
          case "Restarts":  av = a.restarts;  bv = b.restarts;  break;
          case "Node":      av = a.node;      bv = b.node;      break;
          case "IP":        av = a.podIP;     bv = b.podIP;     break;
          case "CPU":       av = usage.get(a.key)?.cpuMillis ?? -1; bv = usage.get(b.key)?.cpuMillis ?? -1; break;
          case "Memory":    av = usage.get(a.key)?.memBytes   ?? -1; bv = usage.get(b.key)?.memBytes   ?? -1; break;
          case "Age":       av = a.ageMs;     bv = b.ageMs;     break;
          default:          av = ""; bv = "";
        }
        if (typeof av === "number" && typeof bv === "number") return sortAsc ? av - bv : bv - av;
        return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      });
    } else {
      out.sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));
    }
    return out;
  }, [rows, filter, sortCol, sortAsc, usage]);

  const allKeys = useMemo(() => pods.map((p) => p.key), [pods]);

  function handleSelectAll(checked: boolean) {
    if (checked) selectAll(allKeys);
    else clearAll();
  }

  return (
    <div className="page">
      <WorkloadTabBar />
      <PageHeader
        level={2}
        title="Workloads"
        count="· Pods"
        live={synced && connected}
        actions={
          selectedKeys.size > 0 && (
            <>
              <span className="muted small">{selectedKeys.size} selected</span>
              <Button
                variant="danger"
                onClick={() => {
                  bulkDelete.request(
                    [...selectedKeys].map((key) => {
                      const i = key.indexOf("/");
                      return { ns: key.slice(0, i), name: key.slice(i + 1) };
                    }),
                  );
                }}
              >
                Delete {selectedKeys.size} selected
              </Button>
            </>
          )
        }
      />

      {bulkDelete.pending && (
        <InlineBanner>
          <span>
            {bulkDelete.pending.length === 1 ? (
              <>
                Delete pod <strong className="mono">{bulkDelete.pending[0]!.name}</strong>
                {bulkDelete.pending[0]!.ns ? ` in ${bulkDelete.pending[0]!.ns}` : ""}? This can&apos;t be undone.
              </>
            ) : (
              <>Delete {bulkDelete.pending.length} selected pods? This can&apos;t be undone.</>
            )}
            {(() => {
              const owner = ownerAmongTargets(bulkDelete.pending, rows);
              return owner && <div className="small">{ownerWarning(owner)}</div>;
            })()}
          </span>
          <div className="inline-banner-actions">
            <Button variant="ghost" disabled={bulkDelete.busy} onClick={bulkDelete.cancel}>
              Cancel
            </Button>
            <Button variant="danger" disabled={bulkDelete.busy} onClick={() => void confirmDeletePods()}>
              {bulkDelete.busy ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </InlineBanner>
      )}
      {bulkDelete.error && <InlineBanner>{bulkDelete.error}</InlineBanner>}

      <div className="toolbar">
        <Select
          value={effectiveCluster}
          onChange={(e) => setActiveCluster(e.target.value)}
        >
          {list.map((c) => (
            <option key={c.id} value={c.id}>{c.id}</option>
          ))}
          {list.length === 0 && <option>no clusters</option>}
        </Select>
        <NamespaceFilter cluster={effectiveCluster || undefined} />
        <TextField
          placeholder="Filter by name or namespace…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          spellCheck={false}
        />
        <Badge>{pods.length}</Badge>
      </div>

      {!effectiveCluster && (
        <PageLoader message="Waiting for cluster…" />
      )}

      {effectiveCluster && shouldShowSkeleton(synced, pods.length) && (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <th style={{ width: 40 }} />
                {HEADERS.map((h, i) => <th key={h} style={{ width: widths[i] }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              <SkeletonRows columns={HEADERS.length} rows={6} leadingBlank />
            </tbody>
          </Table>
        </TableWrap>
      )}

      {effectiveCluster && !shouldShowSkeleton(synced, pods.length) && pods.length === 0 && (
        <EmptyState>
          <p>No pods match.</p>
          <p className="muted small">{filter || nsFilter.length ? "Try clearing the filters." : "This cluster looks quiet."}</p>
        </EmptyState>
      )}

      {pods.length > 0 && (
        <TableWrap>
          <Table>
            <colgroup>
              <col style={{ width: 40 }} />
              {HEADERS.map((h, i) => <col key={h} style={{ width: widths[i] }} />)}
            </colgroup>
            <thead>
              <tr>
                <SelectAllHeader
                  checked={isAllSelected(allKeys)}
                  indeterminate={isIndeterminate(allKeys)}
                  onChange={handleSelectAll}
                />
                {HEADERS.map((h, i) => (
                  <SortHeader
                    key={h}
                    label={h}
                    active={sortCol === h}
                    asc={sortAsc}
                    onSort={() => toggleSort(h)}
                    width={widths[i]}
                    style={{ position: "relative" }}
                  >
                    <div className="col-resize-handle" {...getResizeHandleProps(i)} />
                  </SortHeader>
                ))}
              </tr>
            </thead>
            <tbody>
              {pods.map((p) => {
                const tone = STATUS_TONE[p.status];
                const isSelected = selectedKeys.has(p.key);
                return (
                  <TableRow
                    key={p.key}
                    clickable
                    selected={isSelected}
                    onClick={() => {
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
                      });
                    }}
                  >
                    <SelectCell checked={isSelected} onChange={() => toggleRow(p.key)} label={`Select ${p.name}`} />
                    <td className="mono td-name" title={p.name}>{p.name}</td>
                    <td className="mono"><NsPill>{p.namespace}</NsPill></td>
                    <td className="mono">{p.ready}</td>
                    <td>
                      <StatusPill tone={tone.pill}>{p.statusLabel}</StatusPill>
                    </td>
                    <td className={`mono${p.restarts > 0 ? " restart-warn" : ""}`}>{p.restarts}</td>
                    <td className="mono muted small" title={p.node}>{p.node || "–"}</td>
                    <td className="mono muted small">{p.podIP || "–"}</td>
                    <td>
                      {usage.get(p.key)?.cpuMillis != null ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div className="line-progress" style={{ width: 44 }}>
                            <div className="line-progress-fill" style={{ width: `${Math.min(100, (usage.get(p.key)!.cpuMillis / 1000) * 100)}%`, background: "var(--kb-accent)" }} />
                          </div>
                          <span className="mono muted small">{fmtCpu(usage.get(p.key)!.cpuMillis)}</span>
                        </div>
                      ) : <span className="mono muted">–</span>}
                    </td>
                    <td>
                      {usage.get(p.key)?.memBytes != null ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div className="line-progress" style={{ width: 44 }}>
                            <div className="line-progress-fill" style={{ width: `${Math.min(100, (usage.get(p.key)!.memBytes / (1024 * 1024 * 1024)) * 100)}%`, background: "var(--kb-status-warn)" }} />
                          </div>
                          <span className="mono muted small">{fmtBytes(usage.get(p.key)!.memBytes)}</span>
                        </div>
                      ) : <span className="mono muted">–</span>}
                    </td>
                    <td className="mono muted">{fmtAge(p.ageMs)}</td>
                  </TableRow>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      )}

      {selected && <PodPanel pod={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
