import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Badge, Card, Skeleton, StatusDot } from "@kubebay/ui";
import { api, type ClusterInfo } from "../lib/api";
import { useClusterSnapshot, type ClusterSnapshot } from "../lib/useClusterSnapshot";

const MAX_CARDS = 8;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="fleet-stat">
      <span className="mono strong">{value}</span>
      <span className="muted small">{label}</span>
    </div>
  );
}

function FleetCard({ c }: { c: ClusterInfo }) {
  const snap: ClusterSnapshot = useClusterSnapshot(c.status === "connected" ? c.id : undefined);
  const nav = useNavigate();
  const reachable = c.status === "connected";

  return (
    <Card
      interactive={reachable}
      className="fleet-card"
    >
      <div
        style={{ cursor: reachable ? "pointer" : "default" }}
        onClick={() => reachable && nav(`/workloads?cluster=${encodeURIComponent(c.id)}`)}
      >
        <div className="cluster-row">
          <StatusDot status={c.status} pulse={!reachable} />
          <strong title={c.context}>{c.id}</strong>
        </div>
        <div className="muted small mono server-line">{c.server.replace(/^https:\/\//, "")}</div>

        {!reachable ? (
          <p className="muted small" style={{ margin: "12px 0 2px" }}>
            {c.error ? c.error.slice(0, 90) : "unreachable"}
          </p>
        ) : !snap.synced ? (
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            {[70, 50, 60].map((w, i) => (
              <Skeleton key={i} w={w} h={26} r={6} />
            ))}
          </div>
        ) : (
          <>
            <div className="fleet-stats">
              <Stat label={`nodes ready`} value={`${snap.nodeReady}/${snap.nodeTotal}`} />
              <Stat label="pods" value={String(snap.podCount)} />
              <Stat label="issues" value={String(snap.issues.length)} />
              <Stat label="warnings" value={String(snap.warnings)} />
            </div>

            {snap.issues.length > 0 && (
              <div className="fleet-issues">
                {snap.issues.map((i) => (
                  <div key={i.key} className="fleet-issue">
                    <StatusDot status={i.severity === "err" ? "unreachable" : "degraded"} />
                    <span className="mono small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {i.key}
                    </span>
                    <Badge tone={i.severity === "err" ? "err" : undefined}>{i.label}</Badge>
                  </div>
                ))}
                {snap.issues.length >= 5 && <div className="muted small">+ more — open cluster</div>}
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

export default function Fleet() {
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters });
  const list = (clusters.data ?? []).slice(0, MAX_CARDS);

  return (
    <div className="page">
      <div className="page-header">
        <h2>Fleet</h2>
        {clusters.data && clusters.data.length > MAX_CARDS && (
          <Badge>showing first {MAX_CARDS}</Badge>
        )}
      </div>

      {clusters.isLoading && <Skeleton w={400} h={120} />}
      {!clusters.isLoading && list.length === 0 && (
        <div className="empty-state">
          <p>No clusters configured.</p>
        </div>
      )}

      <div className="cluster-grid">
        {list.map((c) => (
          <FleetCard key={c.id} c={c} />
        ))}
      </div>
    </div>
  );
}
