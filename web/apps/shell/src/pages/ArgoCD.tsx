import { Fragment, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArmedButton, Button, EmptyState, PageHeader, Row, Skeleton, Stack, StatusPill, Table, TableRow, TableWrap, type StatusTone } from "@kubebay/ui";
import { argoCDApi, type ArgoCDApp } from "../lib/api";
import { useCluster } from "../lib/useCluster";
import { ArgoDriftList } from "../components/ArgoDriftList";
import { driftCount } from "../lib/argoDrift";

// ── Status badge helpers ──────────────────────────────────────────────────────

type SyncState = "Synced" | "OutOfSync" | "Unknown";
type HealthState = "Healthy" | "Degraded" | "Progressing" | "Suspended" | "Missing" | "Unknown";

function syncTone(status: string): StatusTone {
  switch (status as SyncState) {
    case "Synced":     return "ok";
    case "OutOfSync":  return "warn";
    default:           return "terminated";
  }
}

function healthTone(status: string): StatusTone {
  switch (status as HealthState) {
    case "Healthy":     return "ok";
    case "Degraded":    return "err";
    case "Progressing": return "pending";
    case "Suspended":   return "warn";
    case "Missing":     return "warn";
    default:            return "terminated";
  }
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
    <Row align="center" gap={2}>
      <ArmedButton
        label="Hard Sync"
        confirmLabel="Confirm hard sync?"
        busy={busy}
        onGo={() => void handleSync()}
      />
      {err && (
        <span style={{ color: "var(--kb-status-err)", fontSize: "var(--kb-text-xs)" }} title={err}>
          failed
        </span>
      )}
    </Row>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ArgoCD() {
  const { cluster } = useCluster();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

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
      <PageHeader
        title="ArgoCD"
        count={data && (installed ? `${apps.length} application${apps.length !== 1 ? "s" : ""}` : "not installed")}
        actions={
          dataUpdatedAt > 0 && (
            <span className="page-header-count">updated {fmtTime(new Date(dataUpdatedAt).toISOString())}</span>
          )
        }
      />

      <div className="page-body" style={{ padding: "0 16px 16px" }}>
        {isLoading && (
          <Stack gap={2} style={{ paddingTop: 12 }}>
            {[0, 1, 2].map((i) => <Skeleton key={i} w="100%" h={44} r={8} />)}
          </Stack>
        )}

        {isError && (
          <EmptyState>
            <p style={{ color: "var(--kb-status-err)" }}>Failed to load ArgoCD applications</p>
            <p className="muted small">{error instanceof Error ? error.message : String(error)}</p>
          </EmptyState>
        )}

        {!isLoading && !isError && !installed && (
          <EmptyState>
            <svg viewBox="0 0 48 48" width="40" height="40" fill="none" style={{ opacity: 0.3, marginBottom: 12 }}>
              <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="2" />
              <path d="M24 4v8M24 36v8M4 24h8M36 24h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="24" cy="24" r="6" stroke="currentColor" strokeWidth="2" />
            </svg>
            <p style={{ fontWeight: 600 }}>ArgoCD not detected in this cluster</p>
            <p className="muted small">
              Install ArgoCD to see GitOps Application sync status here.
            </p>
          </EmptyState>
        )}

        {!isLoading && !isError && installed && apps.length === 0 && (
          <EmptyState>
            <p>No ArgoCD Applications found.</p>
            <p className="muted small">Create an Application resource to manage GitOps deployments.</p>
          </EmptyState>
        )}

        {!isLoading && !isError && installed && apps.length > 0 && (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th style={{ width: 110 }}>Project</th>
                  <th>Repo</th>
                  <th style={{ width: 100 }}>Target</th>
                  <th style={{ width: 110 }}>Sync status</th>
                  <th style={{ width: 120 }}>Drift</th>
                  <th style={{ width: 110 }}>Health</th>
                  <th style={{ width: 150 }}>Last sync</th>
                  <th style={{ width: 110 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {apps.map((app) => {
                  const key = `${app.namespace}/${app.name}`;
                  const drift = driftCount(app.resources);
                  const isOpen = expanded.has(key);
                  return (
                    <Fragment key={key}>
                      <TableRow selected={isOpen}>
                        <td className="td-name" title={app.name}>
                          <div>{app.name}</div>
                          {app.namespace && <div className="muted small mono">{app.namespace}</div>}
                        </td>
                        <td className="cell-secondary">{app.project || "–"}</td>
                        <td className="cell-secondary" title={app.repoURL}>
                          {app.repoURL ? app.repoURL.replace(/^https?:\/\//, "").replace(/\.git$/, "") : "–"}
                        </td>
                        <td className="mono cell-secondary">{app.targetRevision || "HEAD"}</td>
                        <td>
                          <StatusPill tone={syncTone(app.syncStatus)}>{app.syncStatus || "Unknown"}</StatusPill>
                        </td>
                        <td>
                          {app.resources.length === 0 ? (
                            <span className="muted small">–</span>
                          ) : (
                            <Button variant="ghost" onClick={() => toggleExpanded(key)} aria-expanded={isOpen}>
                              {drift > 0 ? `${drift} drifted` : "in sync"} {isOpen ? "▲" : "▼"}
                            </Button>
                          )}
                        </td>
                        <td>
                          <StatusPill tone={healthTone(app.healthStatus)}>{app.healthStatus || "Unknown"}</StatusPill>
                        </td>
                        <td className="cell-secondary">{fmtTime(app.lastSyncTime)}</td>
                        <td>
                          <SyncButton cluster={cluster} app={app} />
                        </td>
                      </TableRow>
                      {isOpen && (
                        <tr>
                          <td colSpan={9} style={{ maxWidth: "none", whiteSpace: "normal", background: "var(--kb-bg-inset)" }}>
                            <ArgoDriftList resources={app.resources} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </div>
    </div>
  );
}
