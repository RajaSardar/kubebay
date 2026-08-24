import { Badge, StatusDot } from "@kubebay/ui";

function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}
function arr(v: unknown): Record<string, unknown>[] {
  return (v ?? []) as Record<string, unknown>[];
}
function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pod-section">
      <div className="pod-section-title">{title}</div>
      {children}
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  if (v === null || v === undefined || v === "") return null;
  return (
    <div className="pod-kv">
      <span className="muted small">{k}</span>
      <span className="small">{v}</span>
    </div>
  );
}

export function NodeSummary({
  obj,
  podCount,
}: {
  obj: Record<string, unknown>;
  podCount?: number;
}) {
  const data = useMemo(() => {
    const meta = rec(obj.metadata);
    const spec = rec(obj.spec);
    const status = rec(obj.status);
    const conditions = arr(status.conditions);
    const taints = arr(spec.taints);
    const capacity = rec(status.capacity);
    const allocatable = rec(status.allocatable);
    const nodeInfo = rec(status.nodeInfo);
    const labels = rec(meta.labels);
    return {
      name: str(meta.name),
      unschedulable: spec.unschedulable === true,
      conditions,
      taints,
      capacity,
      allocatable,
      os: str(nodeInfo.operatingSystem),
      arch: str(nodeInfo.architecture),
      kernel: str(nodeInfo.kernelVersion),
      runtime: str(nodeInfo.containerRuntimeVersion),
      kubelet: str(nodeInfo.kubeletVersion),
      podCIDR: str(spec.podCIDR),
      providerID: str(spec.providerID),
      instanceType: str(labels["node.kubernetes.io/instance-type"]),
      zone: str(labels["topology.kubernetes.io/zone"]),
      region: str(labels["topology.kubernetes.io/region"]),
    };
  }, [obj]);

  function fmtBytes(v: string): string {
    if (!v) return "–";
    if (v.endsWith("Ki")) return `${(Number(v.replace("Ki", "")) / 1024).toFixed(1)}Mi`;
    if (v.endsWith("Mi")) return `${(Number(v.replace("Mi", "")) / 1024).toFixed(1)}Gi`;
    return v;
  }

  return (
    <div className="pod-summary" style={{ padding: 14, overflowY: "auto", flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <StatusDot status={data.unschedulable ? "degraded" : "connected"} />
        <strong>{data.unschedulable ? "Cordoned" : "Schedulable"}</strong>
        {podCount != null && <Badge>{podCount} pods</Badge>}
        {data.instanceType && <Badge>{data.instanceType}</Badge>}
      </div>

      <Section title="Info">
        <KV k="OS" v={data.os} />
        <KV k="Architecture" v={data.arch} />
        <KV k="Kernel" v={<span className="mono small">{data.kernel}</span>} />
        <KV k="Container Runtime" v={<span className="mono small">{data.runtime}</span>} />
        <KV k="Kubelet" v={<span className="mono small">{data.kubelet}</span>} />
        <KV k="Pod CIDR" v={<span className="mono small">{data.podCIDR}</span>} />
        {data.providerID && <KV k="Provider ID" v={<span className="mono small">{data.providerID}</span>} />}
        {data.zone && <KV k="Zone" v={data.zone} />}
        {data.region && <KV k="Region" v={data.region} />}
      </Section>

      <Section title="Capacity / Allocatable">
        <KV k="CPU" v={<span className="mono small">{str(data.capacity.cpu)} / {str(data.allocatable.cpu)}</span>} />
        <KV k="Memory" v={<span className="mono small">{fmtBytes(str(data.capacity.memory))} / {fmtBytes(str(data.allocatable.memory))}</span>} />
        <KV k="Pods" v={<span className="mono small">{str(data.capacity.pods)} / {str(data.allocatable.pods)}</span>} />
      </Section>

      <Section title={`Conditions (${data.conditions.length})`}>
        <div className="pod-conditions">
          {data.conditions.map((c, i) => {
            const type = str(c.type);
            const st = str(c.status);
            const isReady = type === "Ready";
            const ok = isReady ? st === "True" : st === "False";
            const reason = str(c.reason);
            return (
              <div key={i} className="pod-condition">
                <StatusDot status={ok ? "connected" : st === "Unknown" ? "pending" : "unreachable"} />
                <span className="small">{type}</span>
                {reason && <span className="muted small">{reason}</span>}
              </div>
            );
          })}
        </div>
      </Section>

      {data.taints.length > 0 && (
        <Section title={`Taints (${data.taints.length})`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {data.taints.map((t, i) => (
              <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span className="mono small">{str(t.key)}</span>
                {str(t.value) && <span className="muted small">={str(t.value)}</span>}
                <Badge tone={str(t.effect) === "NoSchedule" ? "err" : undefined}>{str(t.effect)}</Badge>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

import { useMemo } from "react";
