import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@kubebay/ui";
import { argoCDApi, type ArgoCDApp } from "../lib/api";
import { useCluster } from "../lib/useCluster";

// ── Status badge helpers ──────────────────────────────────────────────────────

type SyncState = "Synced" | "OutOfSync" | "Unknown";
type HealthState = "Healthy" | "Degraded" | "Progressing" | "Suspended" | "Missing" | "Unknown";

function syncColor(status: string): string {
  switch (status as SyncState) {
    case "Synced":     return "var(--kb-status-ok)";
    case "OutOfSync":  return "#f59e0b";
    default:           return "var(--kb-text-muted)";
  }
}

function healthColor(status: string): string {
  switch (status as HealthState) {
    case "Healthy":     return "var(--kb-status-ok)";
    case "Degraded":    return "var(--kb-status-err)";
    case "Progressing": return "#3b82f6";
    case "Suspended":   return "#f59e0b";
    case "Missing":     return "#f59e0b";
    default:            return "var(--kb-text-muted)";
  }
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 8px",
        borderRadius: 99,
        fontSize: 11,
        fontWeight: 600,
        background: `${color}22`,
        color,
        border: `1px solid ${color}55`,
        letterSpacing: "0.01em",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
        }}
      />
      {label || "Unknown"}
    </span>
  );
}

// ── Time formatter ────────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  if (!iso) return "–";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const m = Math.floor((Date.now() - t) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Sync button ───────────────────────────────────────────────────────────────

function SyncButton({ cluster, app }: { cluster: string; app: ArgoCDApp }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function handleSync() {
    setBusy(true);
    setErr("");
    try {
      await argoCDApi.sync({ cluster, namespace: app.namespace, name: app.name });
      // Refetch after a short delay to pick up annotation-triggered state change
      setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ["argocd-apps", cluster] });
      }, 1500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "sync failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <button
        className="btn-ghost"
        disabled={busy}
        onClick={handleSync}
        style={{
          fontSize: 11,
          padding: "3px 10px",
          borderRadius: 6,
          border: "1px solid var(--kb-border)",
          background: busy ? "var(--kb-bg-hover)" : "transparent",
          color: "var(--kb-text)",
          cursor: busy ? "not-allowed" : "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? (
          <svg viewBox="0 0 16 16" width="11" height="11" fill="none" style={{ animation: "spin 1.4s linear infinite" }}>
            <path d="M8 2a6 6 0 0 1 5.66 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M13.66 10 l-2 2 2 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" width="11" height="11" fill="none">
            <path d="M14 8A6 6 0 1 1 8 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M8 2l3-3v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        Hard Sync
      </button>
      {err && (
        <span style={{ color: "var(--kb-status-err)", fontSize: 11 }} title={err}>
          failed
        </span>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ArgoCD() {
  const { cluster } = useCluster();

  const { data, isLoading, isError, error, dataUpdatedAt } = useQuery({
    queryKey: ["argocd-apps", cluster],
    queryFn: () => argoCDApi.apps(cluster),
    enabled: !!cluster,
    refetchInterval: 15_000,
  });

  const apps = data?.apps ?? [];
  const installed = data?.installed ?? true; // optimistically true until we know

  return (
    <div className="page">
      <div className="page-header">
        <h1>ArgoCD</h1>
        {data && (
          <span className="muted small">
            {installed
              ? `${apps.length} application${apps.length !== 1 ? "s" : ""}`
              : "not installed"}
          </span>
        )}
        {dataUpdatedAt > 0 && (
          <span className="muted small" style={{ marginLeft: "auto" }}>
            updated {fmtTime(new Date(dataUpdatedAt).toISOString())}
          </span>
        )}
      </div>

      <div className="page-body" style={{ padding: "0 16px 16px" }}>
        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 12 }}>
            {[0, 1, 2].map((i) => <Skeleton key={i} w="100%" h={44} r={8} />)}
          </div>
        )}

        {isError && (
          <div className="empty-state" style={{ paddingTop: 48 }}>
            <p style={{ color: "var(--kb-status-err)" }}>Failed to load ArgoCD applications</p>
            <p className="muted small">{error instanceof Error ? error.message : String(error)}</p>
          </div>
        )}

        {!isLoading && !isError && !installed && (
          <div className="empty-state" style={{ paddingTop: 48 }}>
            <svg viewBox="0 0 48 48" width="40" height="40" fill="none" style={{ opacity: 0.3, marginBottom: 12 }}>
              <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="2" />
              <path d="M24 4v8M24 36v8M4 24h8M36 24h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="24" cy="24" r="6" stroke="currentColor" strokeWidth="2" />
            </svg>
            <p style={{ fontWeight: 600 }}>ArgoCD not detected in this cluster</p>
            <p className="muted small">
              Install ArgoCD to see GitOps Application sync status here.
            </p>
          </div>
        )}

        {!isLoading && !isError && installed && apps.length === 0 && (
          <div className="empty-state" style={{ paddingTop: 48 }}>
            <p>No ArgoCD Applications found.</p>
            <p className="muted small">Create an Application resource to manage GitOps deployments.</p>
          </div>
        )}

        {!isLoading && !isError && installed && apps.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12,
              }}
            >
              <thead>
                <tr style={{ borderBottom: "1px solid var(--kb-border)" }}>
                  {["Name", "Project", "Repo", "Target", "Sync Status", "Health", "Last Sync", "Actions"].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left",
                        padding: "8px 10px",
                        fontWeight: 600,
                        color: "var(--kb-text-muted)",
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {apps.map((app) => (
                  <tr
                    key={`${app.namespace}/${app.name}`}
                    style={{
                      borderBottom: "1px solid var(--kb-border-subtle, var(--kb-border))",
                      transition: "background 120ms",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.background = "var(--kb-bg-hover)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.background = "";
                    }}
                  >
                    <td style={{ padding: "9px 10px", fontWeight: 600 }}>
                      <div>{app.name}</div>
                      {app.namespace && (
                        <div style={{ fontSize: 10, color: "var(--kb-text-muted)", marginTop: 1 }}>
                          {app.namespace}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "9px 10px", color: "var(--kb-text-muted)" }}>
                      {app.project || "–"}
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        maxWidth: 180,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        color: "var(--kb-text-muted)",
                      }}
                      title={app.repoURL}
                    >
                      {app.repoURL
                        ? app.repoURL.replace(/^https?:\/\//, "").replace(/\.git$/, "")
                        : "–"}
                    </td>
                    <td style={{ padding: "9px 10px", color: "var(--kb-text-muted)", fontFamily: "var(--kb-font-mono, monospace)", fontSize: 11 }}>
                      {app.targetRevision || "HEAD"}
                    </td>
                    <td style={{ padding: "9px 10px" }}>
                      <Badge label={app.syncStatus} color={syncColor(app.syncStatus)} />
                    </td>
                    <td style={{ padding: "9px 10px" }}>
                      <Badge label={app.healthStatus} color={healthColor(app.healthStatus)} />
                    </td>
                    <td style={{ padding: "9px 10px", color: "var(--kb-text-muted)", whiteSpace: "nowrap" }}>
                      {fmtTime(app.lastSyncTime)}
                    </td>
                    <td style={{ padding: "9px 10px" }}>
                      <SyncButton cluster={cluster} app={app} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
