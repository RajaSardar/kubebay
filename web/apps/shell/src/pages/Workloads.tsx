import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, EmptyState, IconButton, InlineBanner, NsPill, PageHeader, Row, Select, SelectAllHeader, SelectCell, SkeletonTable, SortHeader, StatusPill, Table, TableRow, TableWrap, TextField, type StatusTone } from "@kubebay/ui";
import { api } from "../lib/api";
import { useResourceStream, shouldShowSkeleton } from "../lib/useResourceStream";
import PodPanel, { type SelectedPod } from "./PodPanel";
import { useActiveCluster } from "../App";
import { useResizableColumns } from "../lib/useResizableColumns";
import { useRowSelection } from "../lib/useRowSelection";
import { useBulkDelete } from "../lib/useBulkDelete";
import { NamespaceFilter } from "../components/NamespaceFilter";
import { PolicyRejectionCard } from "../components/PolicyRejectionCard";
import { useNamespaceStore, useSelectedNamespaces } from "../lib/namespace-store";
import { ContextMenu } from "../components/ContextMenu";
import { absoluteTime, countLabel, matchesFilter, useSortPref, useTableKeyboard } from "../lib/tableUx";
import { LiveAge } from "../components/LiveAge";
import { WorkloadTabBar } from "../components/WorkloadTabBar";
import { podResources, usageBar, type PodResources, type UsageBar } from "../lib/podUsage";
import { VirtualSpacer } from "../components/VirtualSpacer";
import { useTableVirtualizer } from "../lib/useTableVirtualizer";
import { ROW_HEIGHT, useDisplay } from "../lib/display";
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
  /** Creation time, for the age tooltip. */
  created: string;
  /** The waiting reason's message (why it is CrashLoopBackOff), for the status tooltip. */
  statusDetail: string;
  /** Requests and limits, which the CPU and memory bars measure against. */
  resources: PodResources;
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
  let detail = (status.message as string) ?? "";

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
        detail = (waiting.message as string) ?? detail;
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
    created: (meta.creationTimestamp as string) ?? "",
    statusDetail: detail,
    resources: podResources(obj),
  };
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


// Column order: checkbox(0), Name(1), Namespace(2), Ready(3), Status(4), Restarts(5), Node(6), IP(7), CPU(8), Memory(9), Age(10)
const HEADERS = ["Name", "Namespace", "Ready", "Status", "Restarts", "Node", "IP", "CPU", "Memory", "Age"] as const;
const INITIAL_WIDTHS = [240, 120, 70, 150, 75, 160, 120, 110, 110, 75];

type SortCol = typeof HEADERS[number] | null;

export default function Workloads() {
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters });
  const { active: activeCluster, setActive: setActiveCluster } = useActiveCluster();
  const [filter, setFilter] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);
  const sort = useSortPref("pods");
  const sortCol = sort.col as SortCol;
  const sortAsc = sort.asc;
  const [ctx, setCtx] = useState<{ x: number; y: number; key: string } | null>(null);
  const { setNamespaces } = useNamespaceStore();

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

  async function confirmDeletePods() {
    const succeeded = await bulkDelete.confirm();
    deselect(succeeded.map((t) => `${t.ns}/${t.name}`));
  }

  function toggleSort(col: SortCol) {
    if (col) sort.toggle(col);
  }

  const pods = useMemo(() => {
    let out = rows
      .map(derivePod)
      .filter((p): p is PodRow => p !== null)
      .filter((p) => matchesFilter([p.name, p.namespace, p.node, p.podIP, p.statusLabel], filter));

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
  const { active: activeRow } = useTableKeyboard({
    count: pods.length,
    onOpen: useCallback((i: number) => { const p = pods[i]; if (p) openPod(p); }, [pods, openPod]),
    onToggle: useCallback((i: number) => { const p = pods[i]; if (p) toggleRow(p.key); }, [pods, toggleRow]),
    filterRef,
    onClearFilter: useCallback(() => setFilter(""), []),
  });
  // Only the rows in view are mounted: 5,000 pods would otherwise be 5,000
  // rows, each re-rendered on every stream delta.
  const scrollRef = useRef<HTMLDivElement>(null);
  const { density } = useDisplay();
  const headerRef = useRef<HTMLTableSectionElement>(null);
  const { virtualizer: rowVirtualizer, items: virtualRows, topSpace, bottomSpace } = useTableVirtualizer({
    count: pods.length,
    estimate: ROW_HEIGHT[density],
    scrollRef,
    headerRef,
  });
  useEffect(() => {
    if (activeRow >= 0) rowVirtualizer.scrollToIndex(activeRow, { align: "auto" });
  }, [activeRow, rowVirtualizer]);

  // If no cluster is selected and we're done loading, send user to cluster picker.
  // This handles direct navigation (e.g. deep link to /workloads) without going
  // through ClusterPicker, which is the only place that sets the active cluster.
  if (!effectiveCluster && !clusters.isLoading) {
    return <Navigate to="/clusters" replace />;
  }

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
      {bulkDelete.rejection && <PolicyRejectionCard flush={false} rejection={bulkDelete.rejection} />}
      {!bulkDelete.rejection && bulkDelete.error && <InlineBanner>{bulkDelete.error}</InlineBanner>}

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
          ref={filterRef}
          placeholder="Filter by name, namespace, node, IP or status…  /"
          aria-label="Filter pods"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          spellCheck={false}
        />
        <Badge title={pods.length === rows.length ? undefined : "Shown of total"}>{countLabel(pods.length, rows.length)}</Badge>
      </div>

      {(!effectiveCluster || shouldShowSkeleton(synced, pods.length)) && (
        <SkeletonTable headers={HEADERS} widths={widths} rows={10} leadingBlank label="Loading pods…" />
      )}

      {effectiveCluster && !shouldShowSkeleton(synced, pods.length) && pods.length === 0 && (
        <EmptyState>
          <p>No pods match.</p>
          <p className="muted small">{filter || nsFilter.length ? "Try clearing the filters." : "This cluster looks quiet."}</p>
        </EmptyState>
      )}

      {pods.length > 0 && (
        <TableWrap ref={scrollRef} busy={!synced || !connected}>
          <Table>
            <colgroup>
              <col style={{ width: 40 }} />
              {HEADERS.map((h, i) => <col key={h} style={{ width: widths[i] }} />)}
              <col style={{ width: 36 }} />
            </colgroup>
            <thead ref={headerRef}>
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
                <th className="col-row-menu" style={{ width: 36 }} />
              </tr>
            </thead>
            <tbody>
              <VirtualSpacer height={topSpace} colSpan={HEADERS.length + 2} />
              {virtualRows.map((virtualRow) => {
                const index = virtualRow.index;
                const p = pods[index]!;
                const tone = STATUS_TONE[p.status];
                const isSelected = selectedKeys.has(p.key);
                return (
                  <TableRow
                    key={p.key}
                    data-index={index}
                    ref={rowVirtualizer.measureElement}
                    clickable
                    selected={isSelected}
                    hovered={activeRow === index}
                    aria-current={activeRow === index ? "true" : undefined}
                    onClick={() => openPod(p)}
                    onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, key: p.key }); }}
                  >
                    <SelectCell checked={isSelected} onChange={() => toggleRow(p.key)} label={`Select ${p.name}`} />
                    <td className="mono td-name" title={p.name}>{p.name}</td>
                    <td className="mono">
                      <NsPill
                        title={`Filter by namespace: ${p.namespace}`}
                        onClick={() => { if (effectiveCluster) setNamespaces(effectiveCluster, [p.namespace]); }}
                      >
                        {p.namespace}
                      </NsPill>
                    </td>
                    <td className="mono">{p.ready}</td>
                    <td>
                      <span title={p.statusDetail || undefined}>
                        <StatusPill tone={tone.pill}>{p.statusLabel}</StatusPill>
                      </span>
                    </td>
                    <td className={`mono${p.restarts > 0 ? " restart-warn" : ""}`}>{p.restarts}</td>
                    <td className="mono muted small" title={p.node}>{p.node || "–"}</td>
                    <td className="mono muted small">{p.podIP || "–"}</td>
                    <td>
                      {usage.get(p.key)?.cpuMillis != null ? (
                        <UsageMeter bar={usageBar(usage.get(p.key)!.cpuMillis, p.resources.cpuRequest, p.resources.cpuLimit, fmtCpu)} text={fmtCpu(usage.get(p.key)!.cpuMillis)} />
                      ) : <span className="mono muted">–</span>}
                    </td>
                    <td>
                      {usage.get(p.key)?.memBytes != null ? (
                        <UsageMeter bar={usageBar(usage.get(p.key)!.memBytes, p.resources.memRequest, p.resources.memLimit, fmtBytes)} text={fmtBytes(usage.get(p.key)!.memBytes)} />
                      ) : <span className="mono muted">–</span>}
                    </td>
                    <td className="mono muted" title={absoluteTime(p.created)}><LiveAge ts={p.created} /></td>
                    <td className="col-row-menu" onClick={(e) => e.stopPropagation()}>
                      <IconButton
                        label={`Actions for ${p.name}`}
                        className="row-menu-btn"
                        onClick={(e) => setCtx({ x: e.clientX, y: e.clientY, key: p.key })}
                      >
                        ⋮
                      </IconButton>
                    </td>
                  </TableRow>
                );
              })}
              <VirtualSpacer
                height={bottomSpace}
                colSpan={HEADERS.length + 2}
              />
            </tbody>
          </Table>
        </TableWrap>
      )}

      {ctx && (() => {
        const p = pods.find((x) => x.key === ctx.key);
        if (!p) return null;
        return (
          <ContextMenu
            x={ctx.x}
            y={ctx.y}
            onClose={() => setCtx(null)}
            items={[
              { label: "View details", onClick: () => openPod(p) },
              { label: "Logs", onClick: () => openPod(p, "logs") },
              { label: "Shell", onClick: () => openPod(p, "shell") },
              { label: "Edit YAML", onClick: () => openPod(p, "yaml") },
              { label: "Copy name", onClick: () => void navigator.clipboard?.writeText(p.name) },
              { separator: true, label: "", onClick: () => {} },
              { label: "Delete", danger: true, onClick: () => bulkDelete.request([{ ns: p.namespace, name: p.name }]) },
            ]}
          />
        );
      })()}

      {selected && <PodPanel key={`${selected.namespace}/${selected.pod}/${selected.tab ?? ""}`} pod={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
