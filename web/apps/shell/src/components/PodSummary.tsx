import { useMemo } from "react";
import { Badge, StatusDot } from "@kubebay/ui";

function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}

function arr(v: unknown): Record<string, unknown>[] {
  return (v ?? []) as Record<string, unknown>[];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  if (!children) return null;
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

function Probe({ probe }: { probe?: Record<string, unknown> }) {
  if (!probe || Object.keys(probe).length === 0) return <span className="muted small">none</span>;
  const parts: string[] = [];
  if (probe.httpGet) {
    const hg = rec(probe.httpGet);
    parts.push(`HTTP ${str(hg.path) || "/"}:${str(hg.port)}`);
  } else if (probe.tcpSocket) parts.push(`TCP :${str(rec(probe.tcpSocket).port)}`);
  else if (probe.exec) parts.push(`exec ${str(rec(rec(probe.exec).command))}`);
  else if (probe.grpc) parts.push(`gRPC :${str(rec(probe.grpc).port)}`);
  if (probe.initialDelaySeconds) parts.push(`delay=${probe.initialDelaySeconds}s`);
  if (probe.periodSeconds) parts.push(`every=${probe.periodSeconds}s`);
  if (probe.failureThreshold) parts.push(`fail=${probe.failureThreshold}`);
  return <span className="mono small">{parts.join(" · ")}</span>;
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.join(" ");
  return JSON.stringify(v);
}

export function PodSummary({
  obj,
  onNavigate,
}: {
  obj: Record<string, unknown>;
  onNavigate?: (to: string) => void;
}) {
  const data = useMemo(() => {
    const meta = rec(obj.metadata);
    const spec = rec(obj.spec);
    const status = rec(obj.status);
    const containers = arr(spec.containers);
    const cs = arr(status.containerStatuses);
    const conditions = arr(status.conditions);
    const volumes = arr(spec.volumes);
    const nodeName = str(spec.nodeName);
    const phase = str(status.phase);
    const podIP = str(status.podIP);
    const qos = str(status.qosClass);
    const scheduler = str(spec.schedulerName) || "default-scheduler";
    const sa = str(spec.serviceAccountName) || "default";
    const priority = Number(spec.priority ?? 0);
    const restartPolicy = str(spec.restartPolicy) || "Always";
    const dnsPolicy = str(spec.dnsPolicy) || "ClusterFirst";

    const containerDetails = containers.map((c) => {
      const name = str(c.name);
      const cst = cs.find((s) => s.name === name);
      const state = rec(rec(cst?.state).running) || rec(rec(cst?.state).waiting) || rec(rec(cst?.state).terminated);
      const stateType = rec(cst?.state).running
        ? "running"
        : rec(cst?.state).waiting
          ? "waiting"
          : rec(cst?.state).terminated
            ? "terminated"
            : "unknown";
      const resources = rec(c.resources);
      const requests = rec(resources.requests);
      const limits = rec(resources.limits);
      const env = arr(c.env);
      const ports = arr(c.ports);
      const mounts = arr(c.volumeMounts);
      const liveness = rec(c.livenessProbe);
      const readiness = rec(c.readinessProbe);
      const startup = rec(c.startupProbe);
      return {
        name,
        image: str(c.image),
        ready: cst?.ready === true,
        restarts: Number(cst?.restartCount ?? 0),
        stateType,
        stateReason: str(state.reason) || str(state.exitCode ? `exit ${state.exitCode}` : ""),
        startedAt: str(rec(cst?.state).running?.startedAt),
        requests,
        limits,
        env,
        ports,
        mounts,
        liveness,
        readiness,
        startup,
      };
    });

    return {
      name: str(meta.name),
      namespace: str(meta.namespace),
      uid: str(meta.uid),
      phase,
      podIP,
      nodeName,
      qos,
      scheduler,
      sa,
      priority,
      restartPolicy,
      dnsPolicy,
      conditions,
      volumes,
      containerDetails,
      deletionTimestamp: meta.deletionTimestamp ? str(meta.deletionTimestamp) : "",
    };
  }, [obj]);

  function fmtConditionType(t: string): string {
    return t.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
  }

  return (
    <div className="pod-summary" style={{ padding: 14, overflowY: "auto", flex: 1 }}>
      <div className="pod-section" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <StatusDot status={data.phase === "Running" ? "connected" : data.phase === "Succeeded" ? "pending" : data.phase === "Failed" ? "unreachable" : "degraded"} />
          <strong>{data.phase}</strong>
          {data.podIP && <Badge>{data.podIP}</Badge>}
          {data.qos && <Badge>{data.qos}</Badge>}
          {data.deletionTimestamp && <Badge tone="err">terminating</Badge>}
        </div>
      </div>

      <Section title="Metadata">
        <KV k="Node" v={data.nodeName ? <span className="mono">{data.nodeName}</span> : null} />
        <KV k="Service Account" v={<span className="mono">{data.sa}</span>} />
        <KV k="Scheduler" v={<span className="mono">{data.scheduler}</span>} />
        <KV k="Restart Policy" v={data.restartPolicy} />
        <KV k="DNS Policy" v={data.dnsPolicy} />
        <KV k="Priority" v={String(data.priority)} />
        <KV k="UID" v={<span className="mono subtle" style={{ fontSize: 10 }}>{data.uid}</span>} />
      </Section>

      <Section title={`Conditions (${data.conditions.length})`}>
        <div className="pod-conditions">
          {data.conditions.map((c, i) => {
            const type = str(c.type);
            const st = str(c.status);
            const ok = st === "True";
            const reason = str(c.reason);
            return (
              <div key={i} className="pod-condition">
                <StatusDot status={ok ? "connected" : st === "False" ? "unreachable" : "pending"} />
                <span className="small">{fmtConditionType(type)}</span>
                {reason && <span className="muted small">{reason}</span>}
              </div>
            );
          })}
        </div>
      </Section>

      {data.containerDetails.map((c) => (
        <Section key={c.name} title={`Container: ${c.name}`}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <StatusDot status={c.ready ? "connected" : "unreachable"} />
            <span className="small">{c.ready ? "Ready" : "Not ready"}</span>
            {c.restarts > 0 && <Badge tone="err">{c.restarts} restarts</Badge>}
            {c.stateReason && <Badge tone={c.stateType === "running" ? "ok" : "err"}>{c.stateReason || c.stateType}</Badge>}
          </div>
          <KV k="Image" v={<span className="mono small">{c.image}</span>} />
          {c.ports.length > 0 && (
            <KV
              k="Ports"
              v={
                <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {c.ports.map((p, i) => (
                    <Badge key={i}>
                      {str(p.containerPort)}/{str(p.protocol) || "TCP"}
                      {p.name ? ` (${str(p.name)})` : ""}
                    </Badge>
                  ))}
                </span>
              }
            />
          )}
          {(Object.keys(c.requests).length > 0 || Object.keys(c.limits).length > 0) && (
            <KV
              k="Resources"
              v={
                <span className="mono small">
                  {Object.entries(c.requests).map(([k, v]) => `${k}=${v}`).join(" ")}
                  {Object.keys(c.limits).length > 0 && " | "}
                  {Object.entries(c.limits).map(([k, v]) => `lim:${k}=${v}`).join(" ")}
                </span>
              }
            />
          )}
          <KV k="Liveness" v={<Probe probe={c.liveness} />} />
          <KV k="Readiness" v={<Probe probe={c.readiness} />} />
          <KV k="Startup" v={<Probe probe={c.startup} />} />
          {c.env.length > 0 && (
            <KV
              k={`Environment (${c.env.length})`}
              v={
                <div className="pod-env-list">
                  {c.env.slice(0, 20).map((e, i) => {
                    const name = str(e.name);
                    const value = str(e.value) || (e.valueFrom ? "← ref" : "");
                    return (
                      <div key={i} className="pod-env-item">
                        <span className="mono">{name}</span>
                        <span className="muted mono small">{value}</span>
                      </div>
                    );
                  })}
                  {c.env.length > 20 && <span className="muted small">+{c.env.length - 20} more</span>}
                </div>
              }
            />
          )}
          {c.mounts.length > 0 && (
            <KV
              k={`Mounts (${c.mounts.length})`}
              v={
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {c.mounts.map((m, i) => (
                    <span key={i} className="mono small">
                      {str(m.mountPath)} ← {str(m.name)}
                      {m.readOnly ? " (ro)" : ""}
                    </span>
                  ))}
                </div>
              }
            />
          )}
        </Section>
      ))}

      {data.volumes.length > 0 && (
        <Section title={`Volumes (${data.volumes.length})`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {data.volumes.map((v, i) => {
              const name = str(v.name);
              const keys = Object.keys(v).filter((k) => k !== "name");
              const type = keys[0] ?? "unknown";
              const detail = rec(v[type]);
              const detailStr =
                str(detail.claimName) || str(detail.configMap?.name) || str(detail.secret?.secretName) || str(detail.hostPath?.path) || type;
              return (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="mono small">{name}</span>
                  <Badge>{type}</Badge>
                  <span className="muted small mono">{detailStr}</span>
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}
