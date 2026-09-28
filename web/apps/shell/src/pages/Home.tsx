import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Badge, DataTable, KubebayMark, PageHeader, StatusDot } from "@kubebay/ui";
import { api } from "../lib/api";
import { useActiveCluster } from "../App";
import { useClusterIcons } from "../lib/useClusterIcons";
import { autoAvatar, avatarLabelColor } from "../components/ClusterIconPicker";

// ──── Zero-state onboarding ───────────────────────────────────────────────────

function OnboardingCard({ onGoToSettings }: { onGoToSettings: () => void }) {
  return (
    <div className="onboarding-wrap">
      <div className="onboarding-card">
        {/* Logo mark */}
        <div className="onboarding-logo">
          <KubebayMark size={48} />
        </div>

        <h2 className="onboarding-title">Connect your first cluster</h2>
        <p className="onboarding-subtitle">
          Pick one of the paths below to get started — Kubebay hot-reloads any changes automatically.
        </p>

        {/* Three path cards */}
        <div className="onboarding-paths">

          {/* Path 1: Import kubeconfig */}
          <button className="onboarding-path" onClick={onGoToSettings}>
            <div className="onboarding-path-icon" style={{ background: "color-mix(in srgb, var(--kb-accent) 14%, transparent)" }}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="var(--kb-accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
            </div>
            <div className="onboarding-path-body">
              <div className="onboarding-path-title">Import kubeconfig</div>
              <div className="onboarding-path-desc">
                Point Kubebay to an existing kubeconfig file — default <code>~/.kube/config</code> is loaded automatically, or add extra paths in Settings.
              </div>
            </div>
            <div className="onboarding-path-arrow">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8h10M9 4l4 4-4 4" />
              </svg>
            </div>
          </button>

          {/* Path 2: Cloud cluster */}
          <button className="onboarding-path" onClick={onGoToSettings}>
            <div className="onboarding-path-icon" style={{ background: "color-mix(in srgb, var(--kb-status-warn) 14%, transparent)" }}>
              {/* Cloud icon with provider logos hint */}
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="var(--kb-status-warn)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
              </svg>
            </div>
            <div className="onboarding-path-body">
              <div className="onboarding-path-title">Cloud cluster</div>
              <div className="onboarding-path-desc">
                Connect to <Badge>EKS</Badge>{" "}
                <Badge>GKE</Badge>{" "}
                <Badge>AKS</Badge>{" "}
                — run <code>aws/gcloud/az</code> CLI to generate a kubeconfig, then add it in Settings.
              </div>
            </div>
            <div className="onboarding-path-arrow">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8h10M9 4l4 4-4 4" />
              </svg>
            </div>
          </button>

          {/* Path 3: Local cluster */}
          <button className="onboarding-path" onClick={onGoToSettings}>
            <div className="onboarding-path-icon" style={{ background: "color-mix(in srgb, var(--kb-status-ok) 14%, transparent)" }}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="var(--kb-status-ok)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>
            <div className="onboarding-path-body">
              <div className="onboarding-path-title">Local cluster</div>
              <div className="onboarding-path-desc">
                Spin up <Badge>kind</Badge>{" "}
                or <Badge>minikube</Badge>{" "}
                for local development. Both write to <code>~/.kube/config</code> automatically after creation.
              </div>
            </div>
            <div className="onboarding-path-arrow">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8h10M9 4l4 4-4 4" />
              </svg>
            </div>
          </button>
        </div>

        {/* Footer hint */}
        <p className="onboarding-hint">
          Or{" "}
          <button className="onboarding-settings-link" onClick={onGoToSettings}>
            open Settings
          </button>{" "}
          to add a kubeconfig path manually.
        </p>
      </div>
    </div>
  );
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
      <PageHeader title="Clusters" count={!clusters.isLoading && list.length > 0 && `${list.length} configured`} />

      <div className="page-body">
        {!clusters.isLoading && list.length === 0 ? (
          <OnboardingCard onGoToSettings={() => nav("/settings#kubeconfig-sources")} />
        ) : (
          <DataTable
            loading={clusters.isLoading}
            rows={list}
            rowKey={(c) => c.id}
            onRowClick={(c) => {
              if (c.status === "connected") handleSelect(c.id);
            }}
            isDimmed={(c) => c.status !== "connected"}
            columns={[
              {
                key: "name",
                header: "Cluster",
                className: "td-name",
                title: (c) => c.id,
                render: (c) => {
                  const { bg, label, imageUrl } = icons[c.id] ?? autoAvatar(c.id);
                  return (
                    <span className="home-cluster-name-cell">
                      <span
                        className="home-cluster-avatar"
                        style={{ background: imageUrl ? "transparent" : bg, color: avatarLabelColor(bg) }}
                      >
                        {imageUrl ? <img src={imageUrl} alt={label} /> : label}
                      </span>
                      {c.id}
                      {c.id === effectiveActive && c.status === "connected" && <Badge tone="ok">active</Badge>}
                    </span>
                  );
                },
              },
              {
                key: "server",
                header: "Server",
                className: "mono cell-secondary",
                title: (c) => c.server,
                render: (c) => c.server.replace(/^https?:\/\//, ""),
              },
              {
                key: "version",
                header: "Version",
                width: 110,
                className: "mono cell-secondary",
                render: (c) => (c.status === "connected" && c.version) || "–",
              },
              {
                key: "status",
                header: "Status",
                width: 220,
                title: (c) => c.error,
                render: (c) => (
                  <span className="home-cluster-status">
                    <StatusDot status={c.status === "connected" ? "connected" : "unreachable"} pulse={c.status === "connected"} />
                    {c.status === "connected" ? "Connected" : c.error ? c.error : "Unreachable"}
                  </span>
                ),
              },
            ]}
          />
        )}
      </div>
    </div>
  );
}
