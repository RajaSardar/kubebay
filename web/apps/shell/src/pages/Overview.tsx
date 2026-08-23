import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, Skeleton, StatusDot } from "@kubebay/ui";
import { IconAlert, IconRefresh } from "@kubebay/ui/src/icons";
import { api, type ClusterInfo } from "../lib/api";

function ClusterCard({ c }: { c: ClusterInfo }) {
  return (
    <Card interactive className="cluster-card">
      <div className="cluster-row">
        <StatusDot status={c.status} pulse={c.status === "connected"} />
        <span className="cluster-name" title={c.context}>
          {c.id}
        </span>
      </div>
      <div className="server-line">{c.server.replace(/^https:\/\//, "")}</div>
      <div className="cluster-meta">
        <Badge tone={c.status === "connected" ? "ok" : c.status === "unreachable" ? "err" : undefined}>
          {c.status}
        </Badge>
        {c.version && <Badge>{c.version.split("+")[0]?.replace(/^v/, "")}</Badge>}
      </div>
    </Card>
  );
}

function ClusterSkeleton() {
  return (
    <Card style={{ minHeight: 118 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
        <Skeleton w={8} h={8} r={999} />
        <Skeleton w={180} h={13} />
      </div>
      <Skeleton w={140} h={10} />
      <div style={{ marginTop: 14 }}>
        <Skeleton w={90} h={18} r={5} />
      </div>
    </Card>
  );
}

export default function Overview() {
  const qc = useQueryClient();
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters });
  const list = clusters.data ?? [];

  return (
    <div className="page">
      <div className="page-header">
        <h2>
          Clusters{" "}
          {!clusters.isLoading && (
            <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
              · {list.length}
            </span>
          )}
        </h2>
        <Button variant="ghost" onClick={() => qc.invalidateQueries({ queryKey: ["clusters"] })}>
          <IconRefresh size={13} />
          Refresh
        </Button>
      </div>

      {clusters.isError && (
        <div className="error-banner">
          <IconAlert size={15} />
          <span>Engine unreachable — start it with the token from its log output (?token=…).</span>
        </div>
      )}

      <div className="cluster-grid">
        {clusters.isLoading && [0, 1, 2].map((i) => <ClusterSkeleton key={i} />)}
        {!clusters.isLoading && list.map((c) => <ClusterCard key={c.id} c={c} />)}
      </div>

      {!clusters.isLoading && !clusters.isError && list.length === 0 && (
        <div className="empty-state">
          <p>No contexts found in your kubeconfig.</p>
          <p className="muted small">Add one to ~/.kube/config — it hot-reloads automatically.</p>
        </div>
      )}
    </div>
  );
}
