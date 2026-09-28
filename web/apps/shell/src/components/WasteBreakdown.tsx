import { Badge, Card } from "@kubebay/ui";
import { formatCpuMillis, formatMemBytes } from "../lib/rightsizing";
import type { ClusterWaste } from "../lib/waste";

function scoreOf(v: { cpuMillis: number; memBytes: number }): number {
  return v.cpuMillis / 1000 + v.memBytes / 1024 ** 3;
}

/**
 * Pure Tier-0 waste presentation (innovation backlog #6, Phase 0): capacity
 * accounting only, no metrics and — deliberately — no dollars. Idle capacity
 * and system overhead are always their own lines, never folded into a
 * namespace's number (see lib/waste.ts for why).
 */
export function WasteBreakdown({ waste }: { waste: ClusterWaste }) {
  const byNamespace = [...waste.byNamespace].sort((a, b) => scoreOf(b) - scoreOf(a));
  const byNode = [...waste.nodes].sort((a, b) => b.idleCpuMillis + b.idleMemBytes / 1024 ** 3 - (a.idleCpuMillis + a.idleMemBytes / 1024 ** 3));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Card style={{ flex: "1 1 220px" }}>
          <div className="muted small">Idle capacity (cluster-wide)</div>
          <div className="mono strong" style={{ fontSize: "var(--kb-text-lg, 20px)", marginTop: 6 }}>
            {formatCpuMillis(waste.totalIdleCpuMillis)} cores / {formatMemBytes(waste.totalIdleMemBytes)}
          </div>
          <div className="muted small" style={{ marginTop: 4 }}>
            Allocatable minus requests — never attributed to a namespace.
          </div>
        </Card>
        <Card style={{ flex: "1 1 220px" }}>
          <div className="muted small">System overhead (DaemonSets)</div>
          <div className="mono strong" style={{ fontSize: "var(--kb-text-lg, 20px)", marginTop: 6 }}>
            {formatCpuMillis(waste.totalSystemOverheadCpuMillis)} cores / {formatMemBytes(waste.totalSystemOverheadMemBytes)}
          </div>
        </Card>
      </div>

      {waste.unrequestedContainers.length > 0 && (
        <Card>
          <div className="rbac-section-title">
            {waste.unrequestedContainers.length} container(s) with no resource requests
            <Badge tone="err">{waste.unrequestedContainers.length}</Badge>
          </div>
          <div className="muted small" style={{ marginBottom: 8 }}>
            Unrequested containers aren't counted in any namespace's total below — the scheduler can pack them
            anywhere, which is its own risk.
          </div>
          <div className="table-wrap">
            <table className="kb-table">
              <thead>
                <tr><th>Namespace</th><th>Pod</th><th>Container</th><th>Node</th></tr>
              </thead>
              <tbody>
                {waste.unrequestedContainers.map((c, i) => (
                  <tr key={i}>
                    <td className="mono small">{c.ns}</td>
                    <td className="mono small">{c.pod}</td>
                    <td className="mono small strong">{c.container}</td>
                    <td className="mono small">{c.node}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <div className="rbac-section-title">Requested by namespace</div>
        <div className="table-wrap">
          <table className="kb-table">
            <thead>
              <tr><th>Namespace</th><th>CPU requested</th><th>Memory requested</th></tr>
            </thead>
            <tbody>
              {byNamespace.map((n) => (
                <tr key={n.ns}>
                  <td className="mono small">{n.ns}</td>
                  <td className="mono small">{formatCpuMillis(n.cpuMillis)}</td>
                  <td className="mono small">{formatMemBytes(n.memBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <div className="rbac-section-title">By node</div>
        <div className="table-wrap">
          <table className="kb-table">
            <thead>
              <tr><th>Node</th><th>Allocatable</th><th>Requested</th><th>System overhead</th><th>Idle</th></tr>
            </thead>
            <tbody>
              {byNode.map((n) => (
                <tr key={n.name}>
                  <td className="mono small">{n.name}</td>
                  <td className="mono small">
                    {formatCpuMillis(n.allocatableCpuMillis)} / {formatMemBytes(n.allocatableMemBytes)}
                  </td>
                  <td className="mono small">
                    {formatCpuMillis(n.requestedCpuMillis)} / {formatMemBytes(n.requestedMemBytes)}
                  </td>
                  <td className="mono small">
                    {formatCpuMillis(n.systemOverheadCpuMillis)} / {formatMemBytes(n.systemOverheadMemBytes)}
                  </td>
                  <td className="mono small strong">
                    {formatCpuMillis(n.idleCpuMillis)} / {formatMemBytes(n.idleMemBytes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
