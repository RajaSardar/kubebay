import { Badge, Card, DataTable } from "@kubebay/ui";
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
          <div className="mono strong" style={{ fontSize: "var(--kb-text-lg)", marginTop: 6 }}>
            {formatCpuMillis(waste.totalIdleCpuMillis)} cores / {formatMemBytes(waste.totalIdleMemBytes)}
          </div>
          <div className="muted small" style={{ marginTop: 4 }}>
            Allocatable minus requests — never attributed to a namespace.
          </div>
        </Card>
        <Card style={{ flex: "1 1 220px" }}>
          <div className="muted small">System overhead (DaemonSets)</div>
          <div className="mono strong" style={{ fontSize: "var(--kb-text-lg)", marginTop: 6 }}>
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
          <DataTable
            rows={waste.unrequestedContainers}
            rowKey={(c) => `${c.ns}/${c.pod}/${c.container}`}
            columns={[
              { key: "ns", header: "Namespace", className: "mono small", render: (c) => c.ns },
              { key: "pod", header: "Pod", className: "mono small", render: (c) => c.pod },
              { key: "container", header: "Container", className: "mono small strong", render: (c) => c.container },
              { key: "node", header: "Node", className: "mono small", render: (c) => c.node },
            ]}
          />
        </Card>
      )}

      <Card>
        <div className="rbac-section-title">Requested by namespace</div>
        <DataTable
          rows={byNamespace}
          rowKey={(n) => n.ns}
          columns={[
            { key: "ns", header: "Namespace", className: "mono small", render: (n) => n.ns },
            { key: "cpu", header: "CPU requested", className: "mono small", render: (n) => formatCpuMillis(n.cpuMillis) },
            { key: "mem", header: "Memory requested", className: "mono small", render: (n) => formatMemBytes(n.memBytes) },
          ]}
        />
      </Card>

      <Card>
        <div className="rbac-section-title">By node</div>
        <DataTable
          rows={byNode}
          rowKey={(n) => n.name}
          columns={[
            { key: "node", header: "Node", className: "mono small", render: (n) => n.name },
            {
              key: "alloc",
              header: "Allocatable",
              className: "mono small",
              render: (n) => `${formatCpuMillis(n.allocatableCpuMillis)} / ${formatMemBytes(n.allocatableMemBytes)}`,
            },
            {
              key: "req",
              header: "Requested",
              className: "mono small",
              render: (n) => `${formatCpuMillis(n.requestedCpuMillis)} / ${formatMemBytes(n.requestedMemBytes)}`,
            },
            {
              key: "sys",
              header: "System overhead",
              className: "mono small",
              render: (n) => `${formatCpuMillis(n.systemOverheadCpuMillis)} / ${formatMemBytes(n.systemOverheadMemBytes)}`,
            },
            {
              key: "idle",
              header: "Idle",
              className: "mono small strong",
              render: (n) => `${formatCpuMillis(n.idleCpuMillis)} / ${formatMemBytes(n.idleMemBytes)}`,
            },
          ]}
        />
      </Card>
    </div>
  );
}
