import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { ClusterInfo } from "../lib/api";
import { useClusterMeta } from "../lib/cluster-meta-store";
import { useClusterIcons } from "../lib/useClusterIcons";
import { useClusterStore } from "../lib/cluster-store";
import { sortClusters, filterClusters } from "../lib/clusterSort";
import { connectCluster as bgConnect } from "../lib/clusterConnections";
import { ClusterIconPicker, autoAvatar } from "../components/ClusterIconPicker";
import { ClusterDetailDrawer } from "../components/ClusterDetailDrawer";
import { providerBadge, clusterDisplayName } from "../lib/clusterDistro";
import { useResizableColumns } from "../lib/useResizableColumns";

const APP_VERSION = "v0.2.0";

// Column definitions — index matches useResizableColumns
const COLS = [
  { key: "name",     label: "Name",     init: 210 },
  { key: "context",  label: "Context",  init: 175 },
  { key: "server",   label: "Server",   init: 210 },
  { key: "provider", label: "Provider", init: 120 },
  { key: "status",   label: "Status",   init: 120 },
  { key: "version",  label: "Version",  init: 90  },
] as const;

// ── Provider badge ────────────────────────────────────────────────────────────

function ProviderBadge({ id }: { id: string }) {
  const { label, cls } = providerBadge(id);
  if (label === "–") return <span className="catalog-cell-muted">–</span>;
  return <span className={`catalog-provider-badge ${cls}`}>{label}</span>;
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ClusterInfo["status"] }) {
  const cfg: Record<ClusterInfo["status"], { label: string; cls: string }> = {
    connected:     { label: "Healthy",       cls: "badge-healthy" },
    degraded:      { label: "Degraded",      cls: "badge-degraded" },
    unreachable:   { label: "Disconnected",  cls: "badge-disconnected" },
    misconfigured: { label: "Error",         cls: "badge-error" },
  };
  const { label, cls } = cfg[status] ?? cfg.unreachable;
  return <span className={`catalog-status-badge ${cls}`}>{label}</span>;
}

// ── Name dot ──────────────────────────────────────────────────────────────────

function NameDot({ status }: { status: ClusterInfo["status"] }) {
  const cls: Record<ClusterInfo["status"], string> = {
    connected:     "dot-green",
    degraded:      "dot-yellow",
    unreachable:   "dot-dim",
    misconfigured: "dot-red",
  };
  return <span className={`catalog-name-dot ${cls[status] ?? "dot-dim"}`} />;
}

// ── Row context menu ──────────────────────────────────────────────────────────

interface RowMenuProps {
  cluster: ClusterInfo;
  pinned: boolean;
  onOpenDetails: () => void;
  onConnect: () => void;
  onHide: () => void;
  onTogglePin: () => void;
}

function RowMenu({ cluster, pinned, onOpenDetails, onConnect, onHide, onTogglePin }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const broken = cluster.status === "misconfigured";

  function close() { setOpen(false); }

  return (
    <div className="catalog-row-menu">
      <button
        className="catalog-kebab-btn"
        aria-label="Row actions"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >
        ⋮
      </button>
      {open && (
        <>
          <div className="catalog-menu-backdrop" onClick={close} />
          <div className="catalog-menu-popup" onClick={close}>
            <button onClick={onOpenDetails}>View Details</button>
            <button disabled={broken} onClick={onConnect}>Connect</button>
            <button onClick={onTogglePin}>{pinned ? "Unpin" : "Pin to top"}</button>
            <div className="catalog-menu-sep" />
            <button className="danger" onClick={onHide}>Remove from list</button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Resize handle ──────────────────────────────────────────────────────────────

function ResizeHandle(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div className="catalog-col-resize" {...props} />;
}

// ── Main ClusterPicker ────────────────────────────────────────────────────────

export default function ClusterPicker() {
  const navigate = useNavigate();
  const { setActive, setSelected } = useClusterStore();
  const activeId = useClusterStore((s) => s.active);
  const selectedId = useClusterStore((s) => s.selected);
  const { meta, setAlias, togglePin, hide, show } = useClusterMeta();
  const { icons, setIcon, resetIcon } = useClusterIcons();
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters, refetchInterval: 4_000 });
  const list = clusters.data ?? [];

  const [query, setQuery] = useState("");
  const [iconPickerId, setIconPickerId] = useState<string | null>(null);

  const { widths, getResizeHandleProps } = useResizableColumns(
    COLS.length,
    COLS.map((c) => c.init)
  );

  const hiddenClusters = list.filter((c) => meta[c.id]?.hidden);
  const visible = filterClusters(list, meta, query);
  const sorted = sortClusters(visible, meta);
  const connectedCount = list.filter((c) => c.status === "connected").length;
  const drawerCluster = selectedId ? list.find((c) => c.id === selectedId) ?? null : null;

  function connectCluster(id: string) {
    bgConnect(id); // start background stream immediately
    setActive(id);
    setSelected(id);
    useClusterMeta.getState().touchLastUsed(id);
    const sp = new URLSearchParams();
    sp.set("cluster", id);
    navigate({ pathname: "/", search: sp.toString() });
  }

  function openDetails(id: string) { setSelected(id); }
  function closeDrawer() { setSelected(""); }

  return (
    <div className="catalog-root">

      {/* ── Left sidebar ── */}
      <aside className="catalog-sidebar">
        <div className="catalog-sidebar-header">
          <svg className="catalog-sidebar-logo" viewBox="0 0 32 32" aria-hidden>
            <defs>
              <linearGradient id="cat-g" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#22d3ee" />
                <stop offset="100%" stopColor="#41c98e" />
              </linearGradient>
            </defs>
            <rect width="32" height="32" rx="9" fill="url(#cat-g)" />
            <circle cx="16" cy="14.5" r="5.4" fill="none" stroke="#fff" strokeWidth="2" />
            <path d="M7.5 22.5c2.6 2.3 5.4 3.4 8.5 3.4s5.9-1.1 8.5-3.4" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
            <path d="M16 9v11M10 13.5h12" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".85" />
          </svg>
          <span className="catalog-sidebar-title">Kubebay</span>
        </div>

        <nav className="catalog-sidebar-nav">
          <div className="catalog-nav-item active">
            <svg className="catalog-nav-icon" viewBox="0 0 16 16" fill="none" aria-hidden>
              <rect x="1" y="1" width="6" height="6" rx="1.5" fill="currentColor" opacity=".9" />
              <rect x="9" y="1" width="6" height="6" rx="1.5" fill="currentColor" opacity=".9" />
              <rect x="1" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity=".9" />
              <rect x="9" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity=".9" />
            </svg>
            Clusters
          </div>
          <div className="catalog-nav-item">
            <svg className="catalog-nav-icon" viewBox="0 0 16 16" fill="none" aria-hidden>
              <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M8 5v3.5l2.2 1.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            History
          </div>
          <div className="catalog-nav-item">
            <svg className="catalog-nav-icon" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 2.5l1.5 3.1 3.5.5-2.5 2.4.6 3.5L8 10.5l-3.1 1.5.6-3.5L3 6.1l3.5-.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
            Favorites
          </div>
        </nav>
      </aside>

      {/* ── Main area ── */}
      <div className="catalog-main">

        {/* Title bar */}
        <div className="catalog-titlebar">
          <span className="catalog-titlebar-text">
            Cluster Catalog
            <span className="catalog-titlebar-count">· {list.length} cluster{list.length !== 1 ? "s" : ""}</span>
          </span>
        </div>

        {/* Search bar */}
        <div className="catalog-search-bar">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" className="catalog-search-icon" aria-hidden>
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            className="catalog-search"
            type="search"
            placeholder="Search clusters..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {/* Content row: table + optional drawer */}
        <div className="catalog-content-row">
          <div className="catalog-table-wrap">
            <table className="catalog-table kb-table" style={{ tableLayout: "fixed", width: "100%" }}>
              <colgroup>
                {COLS.map((col, i) => (
                  <col key={col.key} style={{ width: widths[i] }} />
                ))}
                <col style={{ width: 36 }} />
              </colgroup>
              <thead>
                <tr>
                  {COLS.map((col, i) => (
                    <th key={col.key} style={{ position: "relative" }}>
                      {col.label}
                      <ResizeHandle {...getResizeHandleProps(i)} />
                    </th>
                  ))}
                  <th style={{ width: 36 }} />
                </tr>
              </thead>
              <tbody>
                {clusters.isLoading && (
                  <tr><td colSpan={COLS.length + 1} className="catalog-empty muted">Loading clusters…</td></tr>
                )}
                {clusters.isSuccess && sorted.length === 0 && (
                  <tr><td colSpan={COLS.length + 1} className="catalog-empty muted">
                    {query ? `No clusters match "${query}"` : "No clusters found in kubeconfig."}
                  </td></tr>
                )}
                {sorted.map((c) => {
                  const m = meta[c.id] ?? {};
                  const auto = autoAvatar(c.id);
                  const icon = icons[c.id] ?? auto;
                  const displayName = clusterDisplayName(c.id, c.context, m.alias);
                  const broken = c.status === "misconfigured";
                  const isActive = c.id === activeId;
                  const isSelected = c.id === selectedId;

                  return (
                    <tr
                      key={c.id}
                      className={`catalog-row row-clickable${isSelected ? " selected" : ""}${isActive ? " active" : ""}${broken ? " broken" : ""}`}
                      onClick={() => openDetails(c.id)}
                      onDoubleClick={() => !broken && connectCluster(c.id)}
                      title={broken ? c.error ?? "Misconfigured" : undefined}
                    >
                      {/* Name */}
                      <td className="catalog-name-cell">
                        <NameDot status={c.status} />
                        <span
                          className="catalog-row-icon"
                          style={{ background: icon.imageUrl ? "transparent" : icon.bg }}
                          title="Click to change icon"
                          onClick={(e) => { e.stopPropagation(); if (!broken) setIconPickerId(c.id); }}
                        >
                          {icon.imageUrl
                            ? <img src={icon.imageUrl} alt="" className="catalog-row-icon-img" />
                            : icon.label}
                        </span>
                        <span className="catalog-row-name" title={c.id}>
                          <span className="catalog-row-name-primary">{displayName}</span>
                          {m.pinned && <span className="catalog-pin-dot" title="Pinned">★</span>}
                          {isActive && <span className="catalog-connected-badge">connected</span>}
                        </span>
                      </td>

                      {/* Context */}
                      <td className="catalog-cell-overflow" title={c.context}>
                        <span className="mono small muted catalog-cell-text">{c.context || c.id}</span>
                      </td>

                      {/* Server */}
                      <td className="catalog-cell-overflow" title={c.server}>
                        <span className="mono small muted catalog-cell-text">{c.server || "–"}</span>
                      </td>

                      {/* Provider — use context (original format) not id (sanitized) */}
                      <td><ProviderBadge id={c.context || c.id} /></td>

                      {/* Status */}
                      <td><StatusBadge status={c.status} /></td>

                      {/* Version */}
                      <td className="mono small muted">{c.version ?? "–"}</td>

                      {/* ⋮ menu */}
                      <td onClick={(e) => e.stopPropagation()}>
                        <RowMenu
                          cluster={c}
                          pinned={!!m.pinned}
                          onOpenDetails={() => openDetails(c.id)}
                          onConnect={() => !broken && connectCluster(c.id)}
                          onHide={() => hide(c.id)}
                          onTogglePin={() => togglePin(c.id)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Detail drawer */}
          {drawerCluster && (() => {
            const m = meta[drawerCluster.id] ?? {};
            const auto = autoAvatar(drawerCluster.id);
            const icon = icons[drawerCluster.id] ?? auto;
            return (
              <ClusterDetailDrawer
                cluster={drawerCluster}
                meta={m}
                icon={icon}
                isActive={drawerCluster.id === activeId}
                onConnect={() => connectCluster(drawerCluster.id)}
                onClose={closeDrawer}
                onRename={(alias) => setAlias(drawerCluster.id, alias)}
                onChangeIcon={() => setIconPickerId(drawerCluster.id)}
                onTogglePin={() => togglePin(drawerCluster.id)}
                onRemove={() => { hide(drawerCluster.id); closeDrawer(); }}
              />
            );
          })()}
        </div>

        {/* Hidden clusters */}
        {hiddenClusters.length > 0 && (
          <details className="catalog-hidden-section">
            <summary className="muted small">
              {hiddenClusters.length} hidden cluster{hiddenClusters.length !== 1 ? "s" : ""}
            </summary>
            <div className="catalog-hidden-list">
              {hiddenClusters.map((c) => (
                <div key={c.id} className="catalog-hidden-row">
                  <span className="muted small">{meta[c.id]?.alias || c.context || c.id}</span>
                  <button className="cp-show-btn small" onClick={() => show(c.id)}>Show</button>
                </div>
              ))}
            </div>
          </details>
        )}

        {/* Bottom status bar */}
        <div className="catalog-statusbar">
          <span className="catalog-statusbar-engine">
            <span className="catalog-engine-dot" />
            Engine running
          </span>
          <span className="catalog-statusbar-sep">—</span>
          <span className="catalog-statusbar-clusters">
            {connectedCount} / {list.length} cluster{list.length !== 1 ? "s" : ""} connected
          </span>
          <span className="catalog-statusbar-version">{APP_VERSION}</span>
        </div>
      </div>

      {/* Icon picker overlay */}
      {iconPickerId && (() => {
        const auto = autoAvatar(iconPickerId);
        return (
          <ClusterIconPicker
            clusterId={iconPickerId}
            current={icons[iconPickerId] ?? auto}
            onSave={(ic) => setIcon(iconPickerId, ic)}
            onReset={() => resetIcon(iconPickerId)}
            onClose={() => setIconPickerId(null)}
          />
        );
      })()}
    </div>
  );
}
