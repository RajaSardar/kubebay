import { avatarLabelColor } from "./ClusterIconPicker";
import { useState, useRef, useEffect, useId } from "react";
import { Badge, Button, IconButton, Stack, StatusDot } from "@kubebay/ui";
import type { ClusterInfo } from "../lib/api";
import type { ClusterMeta } from "../lib/cluster-meta-store";
import { detectDistro } from "../lib/clusterDistro";

interface Props {
  cluster: ClusterInfo;
  meta: ClusterMeta;
  icon: { bg: string; label: string };
  isActive: boolean;
  onConnect: () => void;
  onClose: () => void;
  onRename: (alias: string) => void;
  onChangeIcon: () => void;
  onTogglePin: () => void;
  onRemove: () => void;
  /** This cluster's own Prometheus URL, and the default it falls back to. */
  prometheus?: { url?: string; fallback?: string };
  /** Opens the Prometheus set-up for this cluster; the section shows only with it. */
  onConfigurePrometheus?: () => void;
}

export function ClusterDetailDrawer({
  cluster, meta, icon, isActive,
  onConnect, onClose, onRename, onChangeIcon, onTogglePin, onRemove,
  prometheus, onConfigurePrometheus,
}: Props) {
  const settingsId = useId();
  const [editingName, setEditingName] = useState(false);
  const [draftAlias, setDraftAlias] = useState(meta.alias ?? "");
  const [confirming, setConfirming] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const displayName = meta.alias || cluster.context || cluster.id;
  const broken = cluster.status === "misconfigured";
  const distro = detectDistro(cluster.id || cluster.context);

  // Sync draft when meta changes externally
  useEffect(() => {
    if (!editingName) setDraftAlias(meta.alias ?? "");
  }, [meta.alias, editingName]);

  function commitRename() {
    onRename(draftAlias);
    setEditingName(false);
  }

  function startEditing() {
    setDraftAlias(meta.alias ?? "");
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.focus(), 0);
  }

  return (
    <div className="cluster-drawer">
      {/* Header */}
      <div className="cluster-drawer-header">
        <span className="cluster-drawer-header-title">Cluster Details</span>
        <IconButton label="Close" onClick={onClose}>
          ×
        </IconButton>
      </div>

      {/* Body */}
      <div className="cluster-drawer-body">
        {/* Large icon */}
        <div className="cluster-drawer-icon-wrap">
          <button
            className="cluster-drawer-icon"
            style={{ background: icon.bg, color: avatarLabelColor(icon.bg) }}
            onClick={onChangeIcon}
            title="Click to change icon"
            aria-label="Change cluster icon"
          >
            {icon.label}
          </button>
          <span className="cluster-drawer-icon-hint muted small">click to change</span>
        </div>

        {/* Name / alias */}
        <div className="cluster-drawer-name-row">
          {editingName ? (
            <input
              ref={nameInputRef}
              className="cluster-drawer-name-input"
              value={draftAlias}
              placeholder={cluster.context || cluster.id}
              onChange={(e) => setDraftAlias(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setEditingName(false);
              }}
              maxLength={64}
            />
          ) : (
            <button className="cluster-drawer-name" onClick={startEditing} title="Click to rename">
              <span className="cluster-drawer-name-text">{displayName}</span>
              <svg className="cluster-drawer-edit-icon" viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden>
                <path d="M11 2l3 3-8.5 8.5L2 14l.5-3.5L11 2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
          {meta.pinned && <span className="catalog-pin-dot" title="Pinned">★</span>}
          {isActive && <Badge tone="ok">connected</Badge>}
        </div>

        {/* Metadata table */}
        <dl className="cluster-drawer-meta">
          <dt>Context</dt>
          <dd className="mono small" title={cluster.context}>{cluster.context || cluster.id}</dd>

          <dt>Server</dt>
          <dd className="mono small cluster-drawer-server" title={cluster.server}>{cluster.server}</dd>

          {cluster.version && (
            <>
              <dt>Version</dt>
              <dd className="mono small">{cluster.version}</dd>
            </>
          )}

          {distro && (
            <>
              <dt>Distro</dt>
              <dd className="mono small">{distro}</dd>
            </>
          )}

          <dt>Status</dt>
          <dd>
            <span className="catalog-status-cell">
              <StatusDot status={
                cluster.status === "connected" ? "connected"
                : cluster.status === "degraded" ? "degraded"
                : "unreachable"
              } />
              <span className={cluster.status === "connected" ? "" : "muted"}>
                {cluster.status === "connected" ? "Connected"
                  : cluster.status === "degraded" ? "Degraded"
                  : cluster.status === "misconfigured" ? "Misconfigured"
                  : "Disconnected"}
              </span>
            </span>
          </dd>
        </dl>

        {/* Primary actions */}
        <div className="cluster-drawer-actions">
          <Button className="cluster-drawer-btn" disabled={broken} onClick={onConnect}>
            {isActive ? "Reconnect" : "Connect"}
          </Button>
          <Button
            variant="ghost"
            className="cluster-drawer-btn"
            onClick={onTogglePin}
            title={meta.pinned ? "Remove from pinned" : "Pin to top of list"}
          >
            {meta.pinned ? "★ Unpin" : "☆ Pin to top"}
          </Button>
        </div>

        {/* This cluster's own settings */}
        {onConfigurePrometheus && (
          <section aria-labelledby={settingsId}>
            <Stack gap={2}>
              <strong id={settingsId} className="small">Settings for this cluster</strong>
              <dl className="cluster-drawer-meta">
                <dt>Prometheus</dt>
                <dd className="mono small" title={prometheus?.url || prometheus?.fallback || undefined}>
                  {prometheus?.url
                    ? prometheus.url
                    : prometheus?.fallback
                      ? `Default · ${prometheus.fallback}`
                      : "Not set"}
                </dd>
              </dl>
              <Button variant="ghost" onClick={onConfigurePrometheus}>
                Configure Prometheus
              </Button>
            </Stack>
          </section>
        )}

        {/* Danger zone */}
        <div className="cluster-drawer-danger-zone">
          {confirming ? (
            <div className="cluster-drawer-confirm">
              <p className="small">Are you sure you want to remove <strong>{displayName}</strong> from the list?</p>
              <p className="muted small">Your kubeconfig is unchanged. You can restore it from the hidden section below the table.</p>
              <div className="cluster-drawer-confirm-btns">
                <Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
                <Button variant="danger" onClick={onRemove}>Remove</Button>
              </div>
            </div>
          ) : (
            <button
              className="cluster-drawer-remove-btn"
              onClick={() => setConfirming(true)}
              aria-label="Remove from list"
            >
              Remove from list
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
