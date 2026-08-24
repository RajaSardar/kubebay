import { useMemo } from "react";
import { Badge } from "@kubebay/ui";

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

export function ServiceSummary({ obj }: { obj: Record<string, unknown> }) {
  const data = useMemo(() => {
    const spec = rec(obj.spec);
    const status = rec(obj.status);
    const meta = rec(obj.metadata);
    const ports = arr(spec.ports);
    const selector = rec(spec.selector);
    const externalIPs = arr(spec.externalIPs);
    const lbIngress = arr(rec(status.loadBalancer).ingress);
    return {
      type: str(spec.type) || "ClusterIP",
      clusterIP: str(spec.clusterIP),
      clusterIPs: arr(spec.clusterIPs).map(str).filter(Boolean),
      externalIPs: externalIPs.map((e) => str(e)),
      lbIngress: lbIngress.map((e) => str(rec(e).ip) || str(rec(e).hostname)),
      sessionAffinity: str(spec.sessionAffinity) || "None",
      internalTrafficPolicy: str(spec.internalTrafficPolicy) || "Cluster",
      externalTrafficPolicy: str(spec.externalTrafficPolicy),
      selector,
      ports,
      labels: rec(meta.labels),
    };
  }, [obj]);

  return (
    <div className="pod-summary" style={{ padding: 14, overflowY: "auto", flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <Badge>{data.type}</Badge>
        {data.clusterIP && data.clusterIP !== "None" && <Badge>{data.clusterIP}</Badge>}
        {data.sessionAffinity !== "None" && <Badge>{data.sessionAffinity}</Badge>}
      </div>

      <Section title="Ports">
        {data.ports.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {data.ports.map((p, i) => {
              const port = str(p.port);
              const target = str(p.targetPort);
              const nodePort = str(p.nodePort);
              const proto = str(p.protocol) || "TCP";
              const name = str(p.name);
              return (
                <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {name && <span className="mono small" style={{ color: "var(--kb-accent)" }}>{name}</span>}
                  <span className="mono small">{port}/{proto}</span>
                  {target && target !== port && <span className="muted small">→ {target}</span>}
                  {nodePort && <Badge>node:{nodePort}</Badge>}
                </div>
              );
            })}
          </div>
        ) : (
          <span className="muted small">No ports exposed</span>
        )}
      </Section>

      <Section title="Selector">
        {Object.keys(data.selector).length > 0 ? (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {Object.entries(data.selector).map(([k, v]) => (
              <Badge key={k}>{k}={str(v)}</Badge>
            ))}
          </div>
        ) : (
          <span className="muted small">No selector (manual endpoints)</span>
        )}
      </Section>

      <Section title="Traffic">
        <KV k="Internal Traffic Policy" v={data.internalTrafficPolicy} />
        {data.externalTrafficPolicy && <KV k="External Traffic Policy" v={data.externalTrafficPolicy} />}
        {data.clusterIPs.length > 1 && <KV k="Cluster IPs" v={<span className="mono small">{data.clusterIPs.join(", ")}</span>} />}
        {data.externalIPs.length > 0 && <KV k="External IPs" v={<span className="mono small">{data.externalIPs.join(", ")}</span>} />}
        {data.lbIngress.length > 0 && <KV k="Load Balancer" v={<span className="mono small">{data.lbIngress.join(", ")}</span>} />}
      </Section>

      {Object.keys(data.labels).length > 0 && (
        <Section title="Labels">
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {Object.entries(data.labels).map(([k, v]) => (
              <Badge key={k}>{k}={str(v)}</Badge>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
