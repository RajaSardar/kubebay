import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Badge, Card, EmptyState, PageHeader, Row, SkeletonLines, StatusDot } from "@kubebay/ui";
import { api } from "../lib/api";
import { useCluster } from "../lib/useCluster";
import { useFleetWaste } from "../lib/useFleetWaste";
import { sortClustersByHealth } from "../lib/fleetHealthOrder";
import { formatCpuMillis, formatMemBytes } from "../lib/rightsizing";
import { FleetClusterHealthCard, type ClusterHealthSummary } from "../components/FleetClusterHealthCard";
import { FleetShowbackTable } from "../components/FleetShowbackTable";
import { FleetConsistencyCard } from "../components/FleetConsistencyCard";

const STAGGER_CONCURRENCY = 3;
const STAGGER_INTERVAL_MS = 500;

/**
 * Backlog #15: a single pane across every configured cluster, not just the
 * per-cluster WorkloadsOverview. Scopes shape (1) only — cluster-level
 * health cards, worst-first — never the Aptakube-shape merged cross-cluster
 * resource table (shape 2), which this entry deliberately named and
 * deferred as real ResourceTable/useBulkDelete framework surgery.
 */
export default function Fleet() {
  const navigate = useNavigate();
  const { setCluster } = useCluster();

  const clustersQ = useQuery({ queryKey: ["clusters"], queryFn: api.clusters, refetchInterval: 4_000 });
  const clusters = useMemo(() => clustersQ.data ?? [], [clustersQ.data]);

  const connected = useMemo(() => clusters.filter((c) => c.status === "connected"), [clusters]);
  const attention = useMemo(() => clusters.filter((c) => c.status !== "connected"), [clusters]);

  const [health, setHealth] = useState<Record<string, ClusterHealthSummary>>({});
  const onHealthComputed = useCallback((cluster: string, summary: ClusterHealthSummary) => {
    setHealth((prev) => (prev[cluster]?.unhealthy === summary.unhealthy && prev[cluster]?.total === summary.total && prev[cluster]?.synced === summary.synced
      ? prev
      : { ...prev, [cluster]: summary }));
  }, []);

  const order = useMemo(
    () => sortClustersByHealth(connected.map((c) => ({ cluster: c.id, unhealthy: health[c.id]?.unhealthy ?? 0 }))),
    [connected, health],
  );
  const orderedConnected = useMemo(() => {
    const byId = new Map(connected.map((c) => [c.id, c]));
    return order.map((id) => byId.get(id)!).filter(Boolean);
  }, [order, connected]);

  const connectedIds = useMemo(() => connected.map((c) => c.id), [connected]);
  const { summary: waste, showback } = useFleetWaste(connectedIds);

  function openCluster(id: string, path = "/workloads") {
    setCluster(id);
    navigate(path);
  }

  if (clustersQ.isLoading) {
    return (
      <div className="page">
        <PageHeader level={1} title="Fleet" />
        <div className="page-body">
          <div className="cluster-grid" role="status" aria-label="Loading clusters…" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <Card key={i}>
                <SkeletonLines lines={3} label="Loading cluster…" />
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader level={1} title="Fleet" count={`· ${clusters.length} cluster${clusters.length === 1 ? "" : "s"}`} />

      <div className="page-body">
        {clusters.length === 0 && (
          <EmptyState title="No clusters configured." />
        )}

        {attention.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div className="muted small" style={{ marginBottom: 8 }}>Needs attention</div>
            <div className="cluster-grid">
              {attention.map((c) => (
                <Card key={c.id}>
                  <Row align="center" gap={2}>
                    <StatusDot status={c.status} />
                    <strong className="mono">{c.id}</strong>
                    <span style={{ marginLeft: "auto" }}>
                      <Badge tone="err">{c.status}</Badge>
                    </span>
                  </Row>
                  {c.error && <div className="error-text small" style={{ marginTop: 6 }}>{c.error}</div>}
                </Card>
              ))}
            </div>
          </div>
        )}

        {connected.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div className="muted small" style={{ marginBottom: 8 }}>Cluster health, worst first</div>
            <div className="cluster-grid">
              {orderedConnected.map((c, i) => (
                <FleetClusterHealthCard
                  key={c.id}
                  cluster={c.id}
                  index={i}
                  concurrency={STAGGER_CONCURRENCY}
                  intervalMs={STAGGER_INTERVAL_MS}
                  onOpen={(id) => openCluster(id)}
                  onHealthComputed={onHealthComputed}
                />
              ))}
            </div>
          </div>
        )}

        {connected.length > 0 && (
          <div>
            <div className="muted small" style={{ marginBottom: 8 }}>
              Waste, fleet-wide — {formatCpuMillis(waste.totalWastedCpuMillis)} / {formatMemBytes(waste.totalWastedMemBytes)} reserved but unused
            </div>
            <div className="cluster-grid">
              {waste.perCluster.map((c) => (
                <Card key={c.cluster} interactive>
                  <div onClick={() => openCluster(c.cluster, "/cost-waste")} style={{ cursor: "pointer" }}>
                    <Row align="center" gap={2} style={{ marginBottom: 6 }}>
                      <strong className="mono">{c.cluster}</strong>
                      <span style={{ marginLeft: "auto" }}>
                        <Badge>{c.opportunities} opportunit{c.opportunities === 1 ? "y" : "ies"}</Badge>
                      </span>
                    </Row>
                    <div className="muted small">
                      {formatCpuMillis(c.wastedCpuMillis)} / {formatMemBytes(c.wastedMemBytes)} wasted
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {connected.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div className="muted small" style={{ marginBottom: 8 }}>
              Showback by namespace, fleet-wide — measured workloads only, no dollar figures
            </div>
            <FleetShowbackTable rows={showback} />
          </div>
        )}

        {connected.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <FleetConsistencyCard clusters={connectedIds} />
          </div>
        )}
      </div>
    </div>
  );
}
