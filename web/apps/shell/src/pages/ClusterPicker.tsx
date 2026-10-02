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
import { ClusterIconPicker, autoAvatar, avatarLabelColor } from "../components/ClusterIconPicker";
import { ClusterDetailDrawer } from "../components/ClusterDetailDrawer";
import { providerBadge, clusterDisplayName } from "../lib/clusterDistro";
import { useResizableColumns } from "../lib/useResizableColumns";
import { Badge, ContextMenu, EmptyState, IconButton, KubebayMark, SkeletonRows, StatusDot, StatusPill, Table, TableRow, TableWrap, TextField, type StatusTone } from "@kubebay/ui";

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

// ── Provider / status cells ───────────────────────────────────────────────────

function ProviderBadge({ id }: { id: string }) {
  const { label } = providerBadge(id);
  if (label === "–") return <span className="cell-secondary">–</span>;
  return <Badge>{label}</Badge>;
}

const STATUS: Record<ClusterInfo["status"], { label: string; tone: StatusTone; dot: string }> = {
  connected:     { label: "Healthy",      tone: "ok",         dot: "connected" },
  degraded:      { label: "Degraded",     tone: "warn",       dot: "degraded" },
  unreachable:   { label: "Disconnected", tone: "pending",    dot: "pending" },
  misconfigured: { label: "Error",        tone: "err",        dot: "unreachable" },
  checking:      { label: "Checking…",    tone: "pending",    dot: "pending" },
};

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
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const broken = cluster.status === "misconfigured";

  return (
    <div className="catalog-row-menu">
      <IconButton
        label="Row actions"
        className="row-menu-btn"
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          setAt((cur) => (cur ? null : { x: r.right - 180, y: r.bottom + 4 }));
        }}
      >
        ⋮
      </IconButton>
      {at && (
        <ContextMenu
          x={at.x}
          y={at.y}
          onClose={() => setAt(null)}
          items={[
            { label: "View details", onClick: onOpenDetails },
            { label: "Connect", onClick: onConnect, disabled: broken },
            { label: pinned ? "Unpin" : "Pin to top", onClick: onTogglePin },
            { separator: true, label: "", onClick: () => {} },
            { label: "Remove from list", onClick: onHide, danger: true },
          ]}
        />
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
          <KubebayMark className="catalog-sidebar-logo" />
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

        {/* Search */}
        <div className="toolbar">
          <TextField
            type="search"
            placeholder="Search clusters…"
            aria-label="Search clusters"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {/* Content row: table + optional drawer */}
        <div className="catalog-content-row">
          {clusters.isSuccess && sorted.length === 0 ? (
            <EmptyState
              title={query ? `No clusters match "${query}".` : "No clusters found in kubeconfig."}
              hint={query ? "Loosen the search." : "Add a kubeconfig source in Settings."}
            />
          ) : (
          <TableWrap>
            <Table>
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
                      <div className="col-resize-handle" {...getResizeHandleProps(i)} />
                    </th>
                  ))}
                  <th className="col-row-menu" />
                </tr>
              </thead>
              <tbody>
                {clusters.isLoading && <SkeletonRows columns={COLS.length + 1} rows={3} />}
                {sorted.map((c) => {
                  const m = meta[c.id] ?? {};
                  const auto = autoAvatar(c.id);
                  const icon = icons[c.id] ?? auto;
                  const displayName = clusterDisplayName(c.id, c.context, m.alias);
                  const broken = c.status === "misconfigured";
                  const isActive = c.id === activeId;
                  const st = STATUS[c.status] ?? STATUS.unreachable;

                  return (
                    <TableRow
                      key={c.id}
                      clickable
                      selected={c.id === selectedId}
                      dimmed={broken}
                      onClick={() => openDetails(c.id)}
                      onDoubleClick={() => !broken && connectCluster(c.id)}
                      title={broken ? c.error ?? "Misconfigured" : undefined}
                    >
                      {/* Name */}
                      <td className="td-name" title={c.id}>
                        <span className="catalog-name-cell">
                          <StatusDot status={st.dot} />
                          <span
                            className="catalog-row-icon"
                            style={{ background: icon.imageUrl ? "transparent" : icon.bg, color: avatarLabelColor(icon.bg) }}
                            title="Click to change icon"
                            onClick={(e) => { e.stopPropagation(); if (!broken) setIconPickerId(c.id); }}
                          >
                            {icon.imageUrl
                              ? <img src={icon.imageUrl} alt="" className="catalog-row-icon-img" />
                              : icon.label}
                          </span>
                          {displayName}
                          {m.pinned && <span className="catalog-pin-dot" title="Pinned">★</span>}
                          {isActive && <Badge tone="ok">connected</Badge>}
                        </span>
                      </td>
                      <td className="mono cell-secondary" title={c.context}>{c.context || c.id}</td>
                      <td className="mono cell-secondary" title={c.server}>{c.server || "–"}</td>
                      {/* Provider — use context (original format) not id (sanitized) */}
                      <td><ProviderBadge id={c.context || c.id} /></td>
                      <td><StatusPill tone={st.tone}>{st.label}</StatusPill></td>
                      <td className="mono cell-secondary">{c.version ?? "–"}</td>
                      {/* ⋮ menu */}
                      <td className="col-row-menu" onClick={(e) => e.stopPropagation()}>
                        <RowMenu
                          cluster={c}
                          pinned={!!m.pinned}
                          onOpenDetails={() => openDetails(c.id)}
                          onConnect={() => !broken && connectCluster(c.id)}
                          onHide={() => hide(c.id)}
                          onTogglePin={() => togglePin(c.id)}
                        />
                      </td>
                    </TableRow>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
          )}

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
          <span className="catalog-statusbar-sep" aria-hidden="true">—</span>
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
