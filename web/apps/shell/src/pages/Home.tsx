import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Skeleton, StatusDot } from "@kubebay/ui";
import { api } from "../lib/api";
import { useActiveCluster } from "../App";
import { useClusterIcons } from "../lib/useClusterIcons";

function autoAvatar(id: string): { bg: string; label: string } {
  if (id.startsWith("arn:aws")) return { bg: "#F90", label: "AWS" };
  if (id.includes("gke") || id.includes("gcp")) return { bg: "#4285F4", label: "GCP" };
  if (id.includes("aks") || id.includes("azure")) return { bg: "#0078D4", label: "AZ" };
  if (id.startsWith("kind-")) return { bg: "#7C3AED", label: "K" };
  if (id.startsWith("minikube")) return { bg: "#326CE5", label: "M" };
  return { bg: "var(--kb-accent)", label: id.slice(0, 2).toUpperCase() };
}

export default function Home() {
  const { active, setActive } = useActiveCluster();
  const nav = useNavigate();
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters, refetchInterval: 6_000 });
  const list = clusters.data ?? [];
  const effectiveActive = active || list.find((c) => c.status === "connected")?.id || "";
  const { icons } = useClusterIcons();

  function handleSelect(id: string) {
    setActive(id);
    nav("/workloads-overview");
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Clusters</h1>
        {!clusters.isLoading && (
          <span className="muted small">{list.length} configured</span>
        )}
      </div>

      <div className="page-body" style={{ padding: "16px" }}>
        {clusters.isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[0, 1, 2].map((i) => <Skeleton key={i} w="100%" h={56} r={10} />)}
          </div>
        )}

        {!clusters.isLoading && list.length === 0 && (
          <div className="empty-state">
            <p>No clusters configured.</p>
            <p className="muted small">Add a context to ~/.kube/config — it hot-reloads automatically.</p>
          </div>
        )}

        {list.length > 0 && (
          <div className="home-cluster-list">
            {list.map((c) => {
              const auto = autoAvatar(c.id);
              const { bg, label } = icons[c.id] ?? auto;
              const isActive = c.id === effectiveActive;
              const reachable = c.status === "connected";

              return (
                <button
                  key={c.id}
                  className={`home-cluster-row${isActive ? " active" : ""}${!reachable ? " unreachable" : ""}`}
                  onClick={() => reachable ? handleSelect(c.id) : undefined}
                  disabled={!reachable}
                >
                  {/* Avatar */}
                  <div
                    className="home-cluster-avatar"
                    style={{ background: bg, opacity: reachable ? 1 : 0.45 }}
                  >
                    {label}
                  </div>

                  {/* Main info */}
                  <div className="home-cluster-info">
                    <div className="home-cluster-name">{c.id}</div>
                    <div className="home-cluster-server">{c.server.replace(/^https?:\/\//, "")}</div>
                  </div>

                  {/* Status + version */}
                  <div className="home-cluster-right">
                    {c.version && reachable && (
                      <span className="home-cluster-version">{c.version}</span>
                    )}
                    {c.error && !reachable && (
                      <span className="home-cluster-error" title={c.error}>
                        {c.error.slice(0, 48)}{c.error.length > 48 ? "…" : ""}
                      </span>
                    )}
                    <StatusDot status={c.status === "connected" ? "connected" : "unreachable"} pulse={reachable} />
                  </div>

                  {isActive && reachable && (
                    <span className="home-cluster-active-badge">active</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
