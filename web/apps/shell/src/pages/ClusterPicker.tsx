import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { StatusDot } from "@kubebay/ui";
import { api } from "../lib/api";
import type { ClusterInfo } from "../lib/api";
import { useClusterMeta } from "../lib/cluster-meta-store";
import { useClusterIcons } from "../lib/useClusterIcons";
import { useClusterStore } from "../lib/cluster-store";
import { sortClusters, filterClusters } from "../lib/clusterSort";
import { ClusterIconPicker, autoAvatar } from "../components/ClusterIconPicker";
import { detectDistro } from "../lib/clusterDistro";

// ── Status cell ───────────────────────────────────────────────────────────────

function StatusCell({ status }: { status: ClusterInfo["status"] }) {
  const map: Record<ClusterInfo["status"], { dot: "connected" | "unreachable" | "pending" | "degraded"; label: string }> = {
    connected:     { dot: "connected",   label: "Connected"     },
    unreachable:   { dot: "unreachable", label: "Disconnected"  },
    degraded:      { dot: "degraded",    label: "Degraded"      },
    misconfigured: { dot: "pending",     label: "Misconfigured" },
  };
  const cfg = map[status] ?? map.unreachable;
  return (
    <span className="catalog-status-cell">
      <StatusDot status={cfg.dot} />
      <span className={cfg.dot === "unreachable" || cfg.dot === "pending" ? "muted" : ""}>{cfg.label}</span>
    </span>
  );
}

// ── Row context menu ──────────────────────────────────────────────────────────

interface RowMenuProps {
  cluster: ClusterInfo;
  pinned: boolean;
  onConnect: () => void;
  onRename: () => void;
  onHide: () => void;
  onChangeIcon: () => void;
  onTogglePin: () => void;
}

function RowMenu({ cluster, pinned, onConnect, onRename, onHide, onChangeIcon, onTogglePin }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const broken = cluster.status === "misconfigured";

  function close() { setOpen(false); }

  return (
    <div className="catalog-row-menu" ref={ref}>
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
            <button disabled={broken} onClick={onConnect}>Connect</button>
            <button onClick={onRename}>Rename</button>
            <button onClick={onChangeIcon}>Change Icon</button>
            <button onClick={onTogglePin}>{pinned ? "Unpin" : "Pin to top"}</button>
            <div className="catalog-menu-sep" />
            <button className="danger" onClick={onHide}>Remove from list</button>
          </div>
        </>
      )}
    </div>
  );
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
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftAlias, setDraftAlias] = useState("");
  const [iconPickerId, setIconPickerId] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const hiddenClusters = list.filter((c) => meta[c.id]?.hidden);
  const visible = filterClusters(list, meta, query);
  const sorted = sortClusters(visible, meta);

  /** Highlight a row for preview — does NOT navigate or connect. */
  function highlightCluster(id: string) {
    setSelected(id);
  }

  /** Connect to a cluster — sets active and navigates to the workloads view. */
  function connectCluster(id: string) {
    setActive(id);
    setSelected(id);
    useClusterMeta.getState().touchLastUsed(id);
    const sp = new URLSearchParams();
    sp.set("cluster", id);
    navigate({ pathname: "/", search: sp.toString() });
  }

  function startRename(cluster: ClusterInfo) {
    setDraftAlias(meta[cluster.id]?.alias ?? "");
    setRenamingId(cluster.id);
    setTimeout(() => renameInputRef.current?.focus(), 0);
  }

  function commitRename() {
    if (renamingId) setAlias(renamingId, draftAlias);
    setRenamingId(null);
  }

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
          <span className="catalog-sidebar-title">Catalog</span>
        </div>

        <nav className="catalog-sidebar-nav">
          <div className="catalog-nav-section">BROWSE</div>
          <div className="catalog-nav-section">CATEGORIES</div>
          <span className="catalog-nav-item active">Clusters</span>
        </nav>
      </aside>

      {/* ── Main area ── */}
      <div className="catalog-main">
        {/* Header bar */}
        <div className="catalog-main-header">
          <h2 className="catalog-main-title">Clusters</h2>
          <span className="catalog-item-count muted">{sorted.length} item{sorted.length !== 1 ? "s" : ""}</span>
          <div className="catalog-search-wrap">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" className="catalog-search-icon">
              <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <input
              className="catalog-search"
              type="search"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Table */}
        <div className="catalog-table-wrap">
          <table className="catalog-table kb-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Context</th>
                <th>Server</th>
                <th>Version</th>
                <th>Distro</th>
                <th>Status</th>
                <th style={{ width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {clusters.isLoading && (
                <tr><td colSpan={7} className="catalog-empty muted">Loading clusters…</td></tr>
              )}
              {clusters.isSuccess && sorted.length === 0 && (
                <tr><td colSpan={7} className="catalog-empty muted">
                  {query ? `No clusters match "${query}"` : "No clusters found in kubeconfig."}
                </td></tr>
              )}
              {sorted.map((c) => {
                const m = meta[c.id] ?? {};
                const auto = autoAvatar(c.id);
                const icon = icons[c.id] ?? auto;
                const displayName = m.alias || c.context || c.id;
                const broken = c.status === "misconfigured";
                const isActive = c.id === activeId;
                const isSelected = c.id === selectedId;
                const distro = detectDistro(c.id || c.context);
                const isRenaming = renamingId === c.id;

                return (
                  <tr
                    key={c.id}
                    className={`catalog-row row-clickable${isActive ? " active" : ""}${isSelected && !isActive ? " selected" : ""}${broken ? " broken" : ""}`}
                    onClick={() => !broken && highlightCluster(c.id)}
                    onDoubleClick={() => !broken && connectCluster(c.id)}
                    title={broken ? c.error ?? "Misconfigured" : undefined}
                  >
                    {/* Name */}
                    <td className="catalog-name-cell">
                      <span
                        className="catalog-row-icon"
                        style={{ background: icon.bg }}
                        title="Click to change icon"
                        onClick={(e) => { e.stopPropagation(); if (!broken) setIconPickerId(c.id); }}
                      >
                        {icon.label}
                      </span>
                      {isRenaming ? (
                        <input
                          ref={renameInputRef}
                          className="catalog-rename-input"
                          value={draftAlias}
                          placeholder={c.context || c.id}
                          onChange={(e) => setDraftAlias(e.target.value)}
                          onBlur={commitRename}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename();
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          maxLength={64}
                        />
                      ) : (
                        <span className="mono strong catalog-row-name" title={c.id}>
                          {displayName}
                          {m.pinned && <span className="catalog-pin-dot" title="Pinned">★</span>}
                          {isActive && <span className="catalog-connected-badge">connected</span>}
                        </span>
                      )}
                    </td>

                    {/* Context */}
                    <td className="mono muted small" title={c.context}>{c.context || c.id}</td>

                    {/* Server */}
                    <td className="mono muted small catalog-server-cell" title={c.server}>{c.server}</td>

                    {/* Version */}
                    <td className="mono muted small">{c.version ?? "–"}</td>

                    {/* Distro */}
                    <td className="mono muted small">{distro || "–"}</td>

                    {/* Status */}
                    <td><StatusCell status={c.status} /></td>

                    {/* ⋮ menu */}
                    <td onClick={(e) => e.stopPropagation()}>
                      <RowMenu
                        cluster={c}
                        pinned={!!m.pinned}
                        onConnect={() => !broken && connectCluster(c.id)}
                        onRename={() => startRename(c)}
                        onHide={() => hide(c.id)}
                        onChangeIcon={() => setIconPickerId(c.id)}
                        onTogglePin={() => togglePin(c.id)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Hidden clusters footer */}
        {hiddenClusters.length > 0 && (
          <details className="catalog-hidden-section">
            <summary className="muted small">
              {hiddenClusters.length} hidden cluster{hiddenClusters.length !== 1 ? "s" : ""}
            </summary>
            <div className="catalog-hidden-list">
              {hiddenClusters.map((c) => (
                <div key={c.id} className="catalog-hidden-row">
                  <span className="muted small">{meta[c.id]?.alias || c.context || c.id}</span>
                  <button className="cp-show-btn small" onClick={() => show(c.id)}>
                    Show
                  </button>
                </div>
              ))}
            </div>
          </details>
        )}
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

      {/* FAB — add cluster (coming soon) */}
      <button
        className="catalog-fab"
        title="Add cluster (coming soon)"
        aria-label="Add cluster"
        disabled
        style={{ opacity: 0.4, cursor: "not-allowed" }}
      >
        +
      </button>
    </div>
  );
}
