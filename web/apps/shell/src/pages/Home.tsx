import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Skeleton, StatusDot } from "@kubebay/ui";
import { api } from "../lib/api";
import { useActiveCluster } from "../App";
import { useClusterIcons } from "../lib/useClusterIcons";
import { autoAvatar } from "../components/ClusterIconPicker";

// ──── Zero-state onboarding ───────────────────────────────────────────────────

function OnboardingCard({ onGoToSettings }: { onGoToSettings: () => void }) {
  return (
    <div className="onboarding-wrap">
      <div className="onboarding-card">
        {/* Logo mark */}
        <div className="onboarding-logo">
          <svg viewBox="0 0 48 48" aria-hidden>
            <defs>
              <linearGradient id="ob-g" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#22d3ee" />
                <stop offset="100%" stopColor="#41c98e" />
              </linearGradient>
            </defs>
            <rect width="48" height="48" rx="13" fill="url(#ob-g)" />
            <circle cx="24" cy="21" r="8" fill="none" stroke="#fff" strokeWidth="2.5" />
            <path d="M11 34c4 3.4 8.2 5 13 5s9-1.6 13-5" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M24 13v16M16 20h16" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" opacity=".85" />
          </svg>
        </div>

        <h2 className="onboarding-title">Connect your first cluster</h2>
        <p className="onboarding-subtitle">
          Pick one of the paths below to get started — Kubebay hot-reloads any changes automatically.
        </p>

        {/* Three path cards */}
        <div className="onboarding-paths">

          {/* Path 1: Import kubeconfig */}
          <button className="onboarding-path" onClick={onGoToSettings}>
            <div className="onboarding-path-icon" style={{ background: "color-mix(in srgb, #32ade6 14%, transparent)" }}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#32ade6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
            <div className="onboarding-path-icon" style={{ background: "color-mix(in srgb, #ff9f0a 14%, transparent)" }}>
              {/* Cloud icon with provider logos hint */}
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#ff9f0a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
              </svg>
            </div>
            <div className="onboarding-path-body">
              <div className="onboarding-path-title">Cloud cluster</div>
              <div className="onboarding-path-desc">
                Connect to <span className="onboarding-provider onboarding-provider--aws">EKS</span>{" "}
                <span className="onboarding-provider onboarding-provider--gcp">GKE</span>{" "}
                <span className="onboarding-provider onboarding-provider--az">AKS</span>{" "}
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
            <div className="onboarding-path-icon" style={{ background: "color-mix(in srgb, #7C3AED 14%, transparent)" }}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#7C3AED" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>
            <div className="onboarding-path-body">
              <div className="onboarding-path-title">Local cluster</div>
              <div className="onboarding-path-desc">
                Spin up <span className="onboarding-provider onboarding-provider--kind">kind</span>{" "}
                or <span className="onboarding-provider onboarding-provider--mk">minikube</span>{" "}
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
      <div className="page-header">
        <h1>
          Clusters
          {!clusters.isLoading && list.length > 0 && (
            <span className="page-header-count">{list.length} configured</span>
          )}
        </h1>
      </div>

      <div className="page-body">
        {clusters.isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[0, 1, 2].map((i) => <Skeleton key={i} w="100%" h={56} r={10} />)}
          </div>
        )}

        {!clusters.isLoading && list.length === 0 && (
          <OnboardingCard onGoToSettings={() => nav("/settings#kubeconfig-sources")} />
        )}

        {list.length > 0 && (
          <div className="home-cluster-list">
            {list.map((c) => {
              const auto = autoAvatar(c.id);
              const { bg, label, imageUrl } = icons[c.id] ?? auto;
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
                    style={{ background: imageUrl ? "transparent" : bg, opacity: reachable ? 1 : 0.45 }}
                  >
                    {imageUrl
                      ? <img src={imageUrl} alt={label} style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: "inherit" }} />
                      : label}
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
