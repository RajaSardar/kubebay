import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Skeleton, StatusDot } from "@kubebay/ui";
import { api } from "../lib/api";
import { useResourceStream } from "../lib/useResourceStream";
import PodPanel, { type SelectedPod } from "./PodPanel";

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

const STATUS_TONE: Record<PodRow["status"], { color: string; badge?: "ok" | "err" }> = {
  running: { color: "var(--kb-status-ok)", badge: "ok" },
  succeeded: { color: "var(--kb-status-pending)" },
  pending: { color: "var(--kb-status-warn)" },
  failed: { color: "var(--kb-status-err)", badge: "err" },
  warning: { color: "var(--kb-status-err)", badge: "err" },
};

export default function Workloads() {
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters });
  const [clusterId, setClusterId] = useState<string>(() => new URLSearchParams(window.location.search).get("cluster") ?? "");
  const [filter, setFilter] = useState("");

  const list = clusters.data ?? [];
  const effectiveCluster = clusterId || list.find((c) => c.status === "connected")?.id || list[0]?.id || "";

  const { rows, synced, connected } = useResourceStream(effectiveCluster || undefined, "v1/pods", { mode: "full" });

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

  const pods = useMemo(
    () =>
      rows
        .map(derivePod)
        .filter((p): p is PodRow => p !== null)
        .filter((p) => !filter || p.name.includes(filter) || p.namespace.includes(filter))
        .sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name)),
    [rows, filter],
  );

  return (
    <div className="page">
      <div className="page-header">
        <h2>
          Workloads <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· Pods</span>
          {synced && connected && (
            <span className="live-pill">
              <StatusDot status="connected" pulse /> live
            </span>
          )}
        </h2>
      </div>

      <div className="toolbar">
        <select
          className="toolbar-select"
          value={effectiveCluster}
          onChange={(e) => setClusterId(e.target.value)}
        >
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {c.id}
            </option>
          ))}
          {list.length === 0 && <option>no clusters</option>}
        </select>
        <input
          className="toolbar-input"
          placeholder="Filter by name or namespace…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          spellCheck={false}
        />
        <Badge>{pods.length}</Badge>
      </div>

      {!effectiveCluster && <p className="muted">Waiting for cluster…</p>}

      {effectiveCluster && !synced && (
        <div className="table-wrap">
          <table className="kb-table">
            <thead>
              <tr>{["Name", "Namespace", "Ready", "Status", "Restarts", "Age"].map((h) => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <tr key={i}>
                  {[140, 80, 40, 70, 30, 50, 60, 30].map((w, j) => (
                    <td key={j}>
                      <Skeleton w={w} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {effectiveCluster && synced && pods.length === 0 && (
        <div className="empty-state">
          <p>No pods match.</p>
          <p className="muted small">{filter ? "Try clearing the filter." : "This cluster looks quiet."}</p>
        </div>
      )}

      {synced && pods.length > 0 && (
        <div className="table-wrap">
          <table className="kb-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Namespace</th>
                <th>Ready</th>
                <th>Status</th>
                <th>Restarts</th>
                <th>CPU</th>
                <th>Memory</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {pods.map((p) => {
                const tone = STATUS_TONE[p.status];
                return (
                  <tr key={p.key} className="row-clickable" onClick={() =>
                    setSelected({
                      cluster: effectiveCluster,
                      namespace: p.namespace,
                      pod: p.name,
                      containers: p.containers.length ? p.containers : [""],
                    })
                  }>
                    <td className="mono strong">{p.name}</td>
                    <td className="mono muted">{p.namespace}</td>
                    <td className="mono">{p.ready}</td>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                        <StatusDot status={tone.badge === "ok" ? "connected" : tone.badge === "err" ? "unreachable" : "degraded"} />
                        <span style={{ color: tone.color }}>{p.statusLabel}</span>
                      </span>
                    </td>
                    <td className={`mono${p.restarts > 0 ? " restart-warn" : ""}`}>{p.restarts}</td>
                    <td className="mono muted">{usage.get(p.key)?.cpuMillis != null ? fmtCpu(usage.get(p.key)!.cpuMillis) : "–"}</td>
                    <td className="mono muted">{usage.get(p.key)?.memBytes != null ? fmtBytes(usage.get(p.key)!.memBytes) : "–"}</td>
                    <td className="mono muted">{fmtAge(p.ageMs)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && <PodPanel pod={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
