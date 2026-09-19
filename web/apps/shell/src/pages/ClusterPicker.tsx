import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { ClusterInfo } from "../lib/api";
import { useClusterMeta } from "../lib/cluster-meta-store";
import { useClusterIcons } from "../lib/useClusterIcons";
import { useClusterStore } from "../lib/cluster-store";
import { sortClusters, filterClusters } from "../lib/clusterSort";
import { ClusterIconPicker, autoAvatar } from "../components/ClusterIconPicker";

// ── Status dot ───────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: ClusterInfo["status"] }) {
  const cfg: Record<ClusterInfo["status"], { color: string; label: string }> = {
    connected:     { color: "var(--kb-status-ok)",      label: "Connected"      },
    unreachable:   { color: "var(--kb-status-err)",     label: "Unreachable"    },
    degraded:      { color: "var(--kb-status-warn)",    label: "Degraded"       },
    misconfigured: { color: "var(--kb-fg-subtle)",      label: "Misconfigured"  },
  };
  const { color, label } = cfg[status] ?? cfg.unreachable;
  return (
    <span className="cp-status-pill" style={{ "--pill-color": color } as React.CSSProperties}>
      <span className="cp-status-dot" />
      {label}
    </span>
  );
}

// ── Cluster card ─────────────────────────────────────────────────────────────

interface CardProps {
  cluster: ClusterInfo;
  isActive: boolean;
  onSelect: () => void;
}

function ClusterCard({ cluster, isActive, onSelect }: CardProps) {
  const { meta, setAlias, togglePin, hide } = useClusterMeta();
  const { icons, setIcon, resetIcon } = useClusterIcons();
  const m = meta[cluster.id] ?? {};
  const auto = autoAvatar(cluster.id);
  const icon = icons[cluster.id] ?? auto;
  const displayName = m.alias || cluster.context || cluster.id;
  const showContext = !!m.alias && m.alias !== cluster.context;

  const [renaming, setRenaming] = useState(false);
  const [draftAlias, setDraftAlias] = useState("");
  const [showIconPicker, setShowIconPicker] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function startRename(e: React.MouseEvent) {
    e.stopPropagation();
    setDraftAlias(m.alias ?? "");
    setRenaming(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function commitRename() {
    setAlias(cluster.id, draftAlias);
    setRenaming(false);
  }

  function onRenameKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") commitRename();
    if (e.key === "Escape") setRenaming(false);
  }

  const broken = cluster.status === "misconfigured";

  return (
    <div
      className={`cp-card${isActive ? " active" : ""}${broken ? " broken" : ""}`}
      onClick={() => !broken && onSelect()}
      role="button"
      tabIndex={broken ? -1 : 0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!broken) onSelect(); } }}
    >
      {/* Icon */}
      <div
        className="cp-card-icon"
        style={{ background: icon.bg }}
        onClick={(e) => { e.stopPropagation(); if (!broken) setShowIconPicker(true); }}
        title="Click to change icon"
      >
        {icon.label}
      </div>

      {/* Info */}
      <div className="cp-card-info">
        <div className="cp-card-name-row">
          {renaming ? (
            <input
              ref={inputRef}
              className="cp-rename-input"
              value={draftAlias}
              onChange={(e) => setDraftAlias(e.target.value)}
              onBlur={commitRename}
              onKeyDown={onRenameKey}
              onClick={(e) => e.stopPropagation()}
              placeholder={cluster.context || cluster.id}
              maxLength={64}
            />
          ) : (
            <span className="cp-card-name" title={cluster.id}>
              {displayName}
            </span>
          )}
          {m.pinned && <span className="cp-pin-badge" title="Pinned">★</span>}
        </div>
        {showContext && (
          <div className="cp-card-context muted small">{cluster.context || cluster.id}</div>
        )}
        <div className="cp-card-server muted small" title={cluster.server}>
          {cluster.server}
        </div>
        {cluster.version && (
          <div className="cp-card-version muted small">{cluster.version}</div>
        )}
      </div>

      {/* Right: status + actions */}
      <div className="cp-card-right">
        <StatusPill status={cluster.status} />
        <div className="cp-card-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className={`cp-action-btn${m.pinned ? " active" : ""}`}
            title={m.pinned ? "Unpin" : "Pin"}
            onClick={() => togglePin(cluster.id)}
          >
            {m.pinned ? "★" : "☆"}
          </button>
          <button
            className="cp-action-btn"
            title="Rename"
            onClick={startRename}
          >
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none">
              <path d="M11 2l3 3-8 8H3v-3l8-8z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
            </svg>
          </button>
          <button
            className="cp-action-btn"
            title="Change icon"
            onClick={() => setShowIconPicker(true)}
          >
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4"/>
              <circle cx="8" cy="8" r="2.5" fill="currentColor" opacity=".5"/>
            </svg>
          </button>
          <button
            className="cp-action-btn danger"
            title="Hide from list"
            onClick={() => hide(cluster.id)}
          >
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none">
              <path d="M2 2l12 12M6.5 4.3A6 6 0 0 1 8 4c3 0 5.5 2.5 6 4-.3.8-.9 1.8-1.7 2.6M3.7 5.4C2.8 6.3 2.2 7.2 2 8c.5 1.5 3 4 6 4a6 6 0 0 0 2.5-.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      {showIconPicker && (
        <ClusterIconPicker
          clusterId={cluster.id}
          current={icons[cluster.id] ?? auto}
          onSave={(ic) => setIcon(cluster.id, ic)}
          onReset={() => resetIcon(cluster.id)}
          onClose={() => setShowIconPicker(false)}
        />
      )}
    </div>
  );
}

// ── Main ClusterPicker ────────────────────────────────────────────────────────

export default function ClusterPicker() {
  const navigate = useNavigate();
  const { setActive } = useClusterStore();
  const { meta, show } = useClusterMeta();
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters, refetchInterval: 4_000 });
  const list = clusters.data ?? [];
  const activeId = useClusterStore((s) => s.active);

  const [query, setQuery] = useState("");
  const showSearch = list.length >= 6;

  const hiddenClusters = list.filter((c) => meta[c.id]?.hidden);
  const visible = filterClusters(list, meta, query);
  const sorted = sortClusters(visible, meta);

  function selectCluster(id: string) {
    setActive(id);
    const sp = new URLSearchParams();
    sp.set("cluster", id);
    // touch lastUsed
    useClusterMeta.getState().touchLastUsed(id);
    navigate({ pathname: "/", search: sp.toString() });
  }

  return (
    <div className="cp-root">
      {/* Header */}
      <header className="cp-header">
        <svg className="cp-logo" viewBox="0 0 32 32" aria-hidden>
          <defs>
            <linearGradient id="cp-g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#22d3ee" />
              <stop offset="100%" stopColor="#41c98e" />
            </linearGradient>
          </defs>
          <rect width="32" height="32" rx="9" fill="url(#cp-g)" />
          <circle cx="16" cy="14.5" r="5.4" fill="none" stroke="#fff" strokeWidth="2" />
          <path d="M7.5 22.5c2.6 2.3 5.4 3.4 8.5 3.4s5.9-1.1 8.5-3.4" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
          <path d="M16 9v11M10 13.5h12" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".85" />
        </svg>
        <div>
          <h1 className="cp-title">Kubebay</h1>
          <p className="cp-subtitle muted">Select a cluster to continue</p>
        </div>
      </header>

      {/* Search */}
      {showSearch && (
        <div className="cp-search-wrap">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" className="cp-search-icon">
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <input
            className="cp-search"
            type="search"
            placeholder="Search clusters…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>
      )}

      {/* Cluster list */}
      <div className="cp-list">
        {clusters.isLoading && (
          <div className="cp-empty muted">Loading clusters…</div>
        )}
        {clusters.isSuccess && sorted.length === 0 && (
          <div className="cp-empty muted">
            {query ? `No clusters match "${query}"` : "No clusters found in kubeconfig."}
          </div>
        )}
        {sorted.map((c) => (
          <ClusterCard
            key={c.id}
            cluster={c}
            isActive={c.id === activeId}
            onSelect={() => selectCluster(c.id)}
          />
        ))}
      </div>

      {/* Hidden clusters section */}
      {hiddenClusters.length > 0 && (
        <details className="cp-hidden-section">
          <summary className="cp-hidden-summary muted small">
            {hiddenClusters.length} hidden cluster{hiddenClusters.length !== 1 ? "s" : ""}
          </summary>
          <div className="cp-hidden-list">
            {hiddenClusters.map((c) => (
              <div key={c.id} className="cp-hidden-row">
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
  );
}
