import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, historyApi, type ClusterHistorySummary, type ClusterInfo } from "../lib/api";
import { announceDisconnect } from "../lib/clusterChannel";
import { headroom, lastOpenedLabel, sparkline } from "../lib/clusterUsage";
import { dropClusterLocally } from "../lib/useRemoteDisconnects";
import { useClusterMeta } from "../lib/cluster-meta-store";
import { useClusterIcons } from "../lib/useClusterIcons";
import { useClusterStore } from "../lib/cluster-store";
import { sortClusters, filterClusters } from "../lib/clusterSort";
import {
  clusterSummary,
  connectCluster as bgConnect,
  connectionError,
  getConnectionsVersion,
  subscribeConnections,
  type ClusterSummary,
} from "../lib/clusterConnections";
import { ClusterIconPicker, autoAvatar, avatarLabelColor } from "../components/ClusterIconPicker";
import { KubeconfigSources } from "../components/KubeconfigSources";
import { EksDiscovery } from "../components/EksDiscovery";
import { GkeDiscovery } from "../components/GkeDiscovery";
import ConfigurePrometheusModal from "../components/ConfigurePrometheusModal";
import { providerBadge, clusterDisplayName } from "../lib/clusterDistro";
import {
  Badge,
  Button,
  ContextMenu,
  EmptyState,
  IconButton,
  InlineBanner,
  KubebayMark,
  Modal,
  PageHeader,
  Row,
  Skeleton,
  SkeletonRows,
  Stack,
  StatusDot,
  StatusPill,
  Table,
  TableRow,
  TableWrap,
  TextField,
  type StatusTone,
} from "@kubebay/ui";

const APP_VERSION = "v0.6.0";
const HEADERS = ["Name", "Session", "API", "Version", "Pods", "Nodes", "CPU · 7 days", "Requests"] as const;

/** Reachability from the engine probe, separate from the user's session. */
const API_STATUS: Record<ClusterInfo["status"], { label: string; tone: StatusTone }> = {
  reachable: { label: "Reachable", tone: "ok" },
  degraded: { label: "Degraded", tone: "warn" },
  unreachable: { label: "Unreachable", tone: "err" },
  misconfigured: { label: "Config error", tone: "err" },
  checking: { label: "Checking…", tone: "pending" },
};

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function checkedAgo(iso?: string): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `checked ${s}s ago` : `checked ${Math.round(s / 60)}m ago`;
}

/** Re-render whenever background connections or their (throttled) data change. */
function useConnectionsVersion(): number {
  return useSyncExternalStore(subscribeConnections, getConnectionsVersion);
}

/** Stacked healthy / pending / failing bar for a connected cluster's pods. */
function PodHealthBar({ summary }: { summary: ClusterSummary }) {
  const { healthy, pending, failing, total } = summary.pods;
  const label = `${plural(total, "pod")}: ${healthy} healthy, ${pending} pending, ${failing} failing`;
  const pct = (n: number) => (total === 0 ? 0 : (n / total) * 100);
  return (
    <Row gap={2} align="center">
      <span className="cluster-podbar" role="img" aria-label={label} title={label}>
        <span className="cluster-podbar-ok" style={{ width: `${pct(healthy)}%` }} />
        <span className="cluster-podbar-pending" style={{ width: `${pct(pending)}%` }} />
        <span className="cluster-podbar-err" style={{ width: `${pct(failing)}%` }} />
      </span>
      <span className="mono cell-secondary">{total}</span>
    </Row>
  );
}

const SPARK_W = 72;
const SPARK_H = 18;

/** A week of hourly CPU peaks, scaled to allocatable when it is known. */
function UsageSparkline({ summary }: { summary: ClusterHistorySummary }) {
  const s = sparkline(summary, SPARK_W, SPARK_H);
  if (!s) return <span className="cell-secondary">—</span>;
  return (
    <svg className="cluster-spark" role="img" aria-label={s.label} width={SPARK_W} height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}>
      <title>{s.label}</title>
      <path d={s.path} />
    </svg>
  );
}

const HEADROOM_FILL: Record<string, string> = { ok: "cluster-headroom-ok", warn: "cluster-headroom-warn", err: "cluster-headroom-err" };

/** How much of allocatable the pods' requests claim, CPU over memory. */
function HeadroomBar({ summary }: { summary: ClusterHistorySummary }) {
  const h = headroom(summary);
  if (!h) return <span className="cell-secondary">—</span>;
  const w = (pct: number) => `${Math.min(100, pct)}%`;
  return (
    <Row gap={2} align="center">
      <span className="cluster-headroom" role="img" aria-label={h.label} title={h.label}>
        {[h.cpuPct, h.memPct].map((pct, i) => (
          <span key={i} className="cluster-headroom-track">
            <span className={HEADROOM_FILL[h.tone]} style={{ width: w(pct) }} />
          </span>
        ))}
      </span>
      <span className="mono cell-secondary">{`${Math.max(h.cpuPct, h.memPct)}%`}</span>
    </Row>
  );
}

interface RowMenuProps {
  cluster: ClusterInfo;
  connected: boolean;
  pinned: boolean;
  onOpen: () => void;
  onConnectInBackground: () => void;
  onDisconnect: () => void;
  onTogglePin: () => void;
  onRename: () => void;
  onChangeIcon: () => void;
  onConfigurePrometheus: () => void;
  onRemove: () => void;
}

function RowMenu({ cluster, connected, pinned, ...a }: RowMenuProps) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  // The menu closes on an outside mousedown, which the ⋮ button is; without
  // this its own click would reopen the menu it just closed.
  const closedAt = useRef(0);
  const broken = cluster.status === "misconfigured";
  const copy = (text: string) => void navigator.clipboard?.writeText(text);
  return (
    <div className="catalog-row-menu">
      <IconButton
        label={`Actions for ${cluster.id}`}
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation();
          if (Date.now() - closedAt.current < 250) return;
          const r = e.currentTarget.getBoundingClientRect();
          setAt((cur) => (cur ? null : { x: r.right - 200, y: r.bottom + 4 }));
        }}
      >
        ⋮
      </IconButton>
      {at && (
        <ContextMenu
          x={at.x}
          y={at.y}
          onClose={() => {
            closedAt.current = Date.now();
            setAt(null);
          }}
          items={[
            { label: "Open", onClick: a.onOpen, disabled: broken },
            connected
              ? { label: "Disconnect", onClick: a.onDisconnect }
              : { label: "Connect in background", onClick: a.onConnectInBackground, disabled: broken },
            { separator: true, label: "", onClick: () => {} },
            { label: pinned ? "Unpin" : "Pin to top", onClick: a.onTogglePin },
            { label: "Rename…", onClick: a.onRename },
            { label: "Change icon…", onClick: a.onChangeIcon },
            { label: "Copy context name", onClick: () => copy(cluster.context || cluster.id) },
            { label: "Copy server URL", onClick: () => copy(cluster.server), disabled: !cluster.server },
            { label: "Configure Prometheus…", onClick: a.onConfigurePrometheus, disabled: broken },
            { separator: true, label: "", onClick: () => {} },
            { label: "Remove from list…", onClick: a.onRemove, danger: true },
          ]}
        />
      )}
    </div>
  );
}

export default function ClusterPicker() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const activeId = useClusterStore((s) => s.active);
  const { meta, setAlias, togglePin, hide, show } = useClusterMeta();
  const { icons, setIcon, resetIcon } = useClusterIcons();
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters, refetchInterval: 4_000 });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 10_000, retry: false });
  // Hourly data in 4-hour buckets: nothing changes fast enough to poll harder.
  const usage = useQuery({ queryKey: ["history-summary"], queryFn: () => historyApi.summary(7), staleTime: 5 * 60_000, refetchInterval: 15 * 60_000, retry: false });
  useConnectionsVersion();

  const list = useMemo(() => clusters.data ?? [], [clusters.data]);
  const [query, setQuery] = useState("");
  const [iconPickerId, setIconPickerId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [removing, setRemoving] = useState<ClusterInfo | null>(null);
  const [errorOpen, setErrorOpen] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [actionError, setActionError] = useState("");
  const [promFor, setPromFor] = useState<string | null>(null);
  const [sp, setSp] = useSearchParams();
  const kubeconfigOpen = sp.get("kubeconfig") === "1";
  function setKubeconfigOpen(open: boolean) {
    setSp(
      (cur) => {
        const next = new URLSearchParams(cur);
        if (open) next.set("kubeconfig", "1");
        else next.delete("kubeconfig");
        return next;
      },
      { replace: true },
    );
  }

  const isConnected = (c: ClusterInfo) => !!c.connected || c.id === activeId;
  const hiddenClusters = list.filter((c) => meta[c.id]?.hidden);
  const sorted = sortClusters(filterClusters(list, meta, query), meta);
  const connected = list.filter(isConnected);
  const count = (s: ClusterInfo["status"]) => list.filter((c) => c.status === s).length;
  const summary = [
    `${connected.length} connected`,
    `${count("reachable")} reachable`,
    count("unreachable") > 0 && `${count("unreachable")} unreachable`,
    count("misconfigured") > 0 && `${count("misconfigured")} config error${count("misconfigured") === 1 ? "" : "s"}`,
    count("checking") > 0 && `${count("checking")} checking`,
  ]
    .filter(Boolean)
    .join(" · ");

  function open(c: ClusterInfo) {
    if (c.status === "misconfigured") {
      setErrorOpen((cur) => (cur === c.id ? null : c.id));
      return;
    }
    bgConnect(c.id);
    useClusterStore.getState().setActive(c.id);
    useClusterMeta.getState().touchLastUsed(c.id);
    void queryClient.invalidateQueries({ queryKey: [c.id] });
    navigate({ pathname: "/", search: `cluster=${encodeURIComponent(c.id)}` });
  }

  async function disconnect(id: string) {
    setActionError("");
    dropClusterLocally(id, queryClient);
    announceDisconnect(id);
    try {
      await api.disconnectCluster(id);
    } catch (e) {
      setActionError(`Disconnect ${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await queryClient.invalidateQueries({ queryKey: ["clusters"] });
  }

  function saveRename() {
    if (!renaming) return;
    setAlias(renaming.id, renaming.value.trim());
    setRenaming(null);
  }

  return (
    <div className="catalog-root">
      <div className="catalog-main">
        <div className="catalog-header">
          <Row gap={3} align="center">
            <KubebayMark className="catalog-header-logo" />
            <div className="catalog-header-title">
              <PageHeader
                title="Clusters"
                count={`· ${plural(list.length, "cluster")}`}
                actions={
                  <Row gap={2} align="center">
                    {connected.length > 0 && (
                      <Button variant="ghost" onClick={() => connected.forEach((c) => void disconnect(c.id))}>
                        Disconnect all
                      </Button>
                    )}
                    <Button variant="ghost" onClick={() => setKubeconfigOpen(true)}>
                      Add kubeconfig
                    </Button>
                  </Row>
                }
              />
            </div>
          </Row>
          {clusters.isSuccess && list.length > 0 && <div className="muted small">{summary}</div>}
        </div>

        <div className="toolbar">
          <TextField
            type="search"
            placeholder="Search by name, context or server…"
            aria-label="Search clusters"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {clusters.isError && (
          <InlineBanner
            actions={
              <Button variant="ghost" onClick={() => void clusters.refetch()}>
                Retry
              </Button>
            }
          >
            {`Couldn't load clusters from the engine: ${clusters.error instanceof Error ? clusters.error.message : "unknown error"}`}
          </InlineBanner>
        )}
        {actionError && <InlineBanner>{actionError}</InlineBanner>}

        <div className="catalog-content-row">
          {clusters.isSuccess && sorted.length === 0 ? (
            <EmptyState
              title={query ? `No clusters match "${query}".` : "No clusters found in your kubeconfig."}
              hint={query ? "Loosen the search." : "Add a kubeconfig file to see its clusters, or check KUBECONFIG."}
            >
              {!query && <Button onClick={() => setKubeconfigOpen(true)}>Add kubeconfig</Button>}
            </EmptyState>
          ) : (
            !clusters.isError && (
              <TableWrap>
                <Table>
                  <thead>
                    <tr>
                      {HEADERS.map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                      <th className="col-row-menu" />
                    </tr>
                  </thead>
                  <tbody>
                    {clusters.isLoading && <SkeletonRows columns={HEADERS.length + 1} rows={3} />}
                    {sorted.flatMap((c) => {
                      const m = meta[c.id] ?? {};
                      const icon = icons[c.id] ?? autoAvatar(c.id);
                      const broken = c.status === "misconfigured";
                      const unreachable = c.status === "unreachable";
                      const isActive = c.id === activeId;
                      const conn = isConnected(c);
                      const st = API_STATUS[c.status] ?? API_STATUS.unreachable;
                      const sum = conn ? clusterSummary(c.id) : null;
                      const streamErr = conn ? connectionError(c.id) : "";
                      const provider = providerBadge(c.context || c.id).label;
                      const name = clusterDisplayName(c.id, c.context, m.alias);
                      const recorded = usage.data?.clusters?.[c.id];
                      const opened = lastOpenedLabel(m.lastUsed);
                      const rows = [
                        <TableRow key={c.id} clickable onClick={() => open(c)} title={c.context}>
                          <td className="td-name">
                            <span className="catalog-name-cell">
                              <IconButton
                                label={`Change icon for ${c.id}`}
                                className="catalog-row-icon"
                                style={{ background: icon.imageUrl ? "transparent" : icon.bg, color: avatarLabelColor(icon.bg) }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setIconPickerId(c.id);
                                }}
                              >
                                {icon.imageUrl ? <img src={icon.imageUrl} alt="" className="catalog-row-icon-img" /> : icon.label}
                              </IconButton>
                              {renaming?.id === c.id ? (
                                <TextField
                                  aria-label={`Display name for ${c.id}`}
                                  value={renaming.value}
                                  autoFocus
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => setRenaming({ id: c.id, value: e.target.value })}
                                  onKeyDown={(e) => {
                                    e.stopPropagation();
                                    if (e.key === "Enter") saveRename();
                                    if (e.key === "Escape") setRenaming(null);
                                  }}
                                  onBlur={saveRename}
                                />
                              ) : (
                                <span className="mono" data-cluster-name>
                                  {name}
                                </span>
                              )}
                              {m.pinned && (
                                <span className="catalog-pin-dot" title="Pinned">
                                  ★
                                </span>
                              )}
                              {provider !== "–" && <Badge>{provider}</Badge>}
                            </span>
                          </td>
                          <td>
                            {isActive ? (
                              <Row gap={2} align="center">
                                <StatusDot status="connected" />
                                <span>Active</span>
                              </Row>
                            ) : conn ? (
                              <Row gap={2} align="center">
                                <StatusDot status={streamErr ? "unreachable" : "connected"} />
                                <span title={streamErr || undefined}>{streamErr ? "Error" : "Connected"}</span>
                              </Row>
                            ) : (
                              <span className="cell-secondary">{opened || "—"}</span>
                            )}
                          </td>
                          <td title={[c.error, checkedAgo(c.checkedAt)].filter(Boolean).join(" · ") || undefined}>
                            <StatusPill tone={st.tone}>{st.label}</StatusPill>
                          </td>
                          <td className="mono cell-secondary">{c.version ? `${c.version}${unreachable ? " (stale)" : ""}` : "–"}</td>
                          <td>
                            {sum ? sum.synced ? <PodHealthBar summary={sum} /> : <Skeleton w={60} /> : <span className="cell-secondary">—</span>}
                          </td>
                          <td className="mono cell-secondary">{sum ? sum.synced ? sum.nodes : <Skeleton w={20} /> : "—"}</td>
                          <td>{recorded ? <UsageSparkline summary={recorded} /> : <span className="cell-secondary">—</span>}</td>
                          <td>{recorded ? <HeadroomBar summary={recorded} /> : <span className="cell-secondary">—</span>}</td>
                          <td className="col-row-menu" onClick={(e) => e.stopPropagation()}>
                            <RowMenu
                              cluster={c}
                              connected={conn}
                              pinned={!!m.pinned}
                              onOpen={() => open(c)}
                              onConnectInBackground={() => {
                                bgConnect(c.id);
                                void api.connectCluster(c.id).then(() => queryClient.invalidateQueries({ queryKey: ["clusters"] }));
                              }}
                              onDisconnect={() => void disconnect(c.id)}
                              onTogglePin={() => togglePin(c.id)}
                              onRename={() => setRenaming({ id: c.id, value: m.alias ?? "" })}
                              onChangeIcon={() => setIconPickerId(c.id)}
                              onConfigurePrometheus={() => setPromFor(c.id)}
                              onRemove={() => setRemoving(c)}
                            />
                          </td>
                        </TableRow>,
                      ];
                      if (broken && errorOpen === c.id) {
                        rows.push(
                          <tr key={`${c.id}-error`}>
                            <td colSpan={HEADERS.length + 1}>
                              <InlineBanner flush>{c.error || "This context could not be used."}</InlineBanner>
                            </td>
                          </tr>,
                        );
                      }
                      return rows;
                    })}
                  </tbody>
                </Table>
              </TableWrap>
            )
          )}
        </div>

        {hiddenClusters.length > 0 && (
          <div className="catalog-hidden-section">
            <Button variant="ghost" aria-expanded={showHidden} onClick={() => setShowHidden((o) => !o)}>
              {plural(hiddenClusters.length, "hidden cluster")}
            </Button>
            {showHidden && (
              <div className="catalog-hidden-list">
                {hiddenClusters.map((c) => (
                  <div key={c.id} className="catalog-hidden-row">
                    <span className="muted small">{meta[c.id]?.alias || c.context || c.id}</span>
                    <Button variant="ghost" aria-label={`Show ${c.id}`} onClick={() => show(c.id)}>
                      Show
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="catalog-statusbar">
          <span className="catalog-statusbar-engine">
            <StatusDot status={health.data?.ok ? "connected" : health.isLoading ? "pending" : "unreachable"} />
            {health.data?.ok ? "Engine running" : health.isLoading ? "Checking engine…" : "Engine not responding"}
          </span>
          <span className="catalog-statusbar-sep" aria-hidden="true">
            —
          </span>
          <span className="catalog-statusbar-clusters">{`${connected.length} of ${plural(list.length, "cluster")} connected`}</span>
          <span className="catalog-statusbar-version">{APP_VERSION}</span>
        </div>
      </div>

      {removing && (
        <Modal label={`Remove ${removing.id}?`} title={`Remove ${removing.id}?`} placement="center" onClose={() => setRemoving(null)}>
          <div className="catalog-confirm">
            <p>{`Remove ${removing.id} from the list? It stays in your kubeconfig; show it again from the hidden clusters.`}</p>
            <Row gap={2} justify="end">
              <Button variant="ghost" onClick={() => setRemoving(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  hide(removing.id);
                  setRemoving(null);
                }}
              >
                Remove
              </Button>
            </Row>
          </div>
        </Modal>
      )}

      {kubeconfigOpen && (
        <Modal label="Kubeconfig sources" title="Kubeconfig sources" placement="center" size="wide" onClose={() => setKubeconfigOpen(false)}>
          <Stack gap={3}>
            <KubeconfigSources />
            <EksDiscovery />
            <GkeDiscovery />
          </Stack>
        </Modal>
      )}

      {promFor && (
        <ConfigurePrometheusModal
          cluster={promFor}
          connected={list.some((c) => c.id === promFor && isConnected(c))}
          onClose={() => setPromFor(null)}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: ["settings"] })}
        />
      )}

      {iconPickerId && (
        <ClusterIconPicker
          clusterId={iconPickerId}
          current={icons[iconPickerId] ?? autoAvatar(iconPickerId)}
          onSave={(ic) => setIcon(iconPickerId, ic)}
          onReset={() => resetIcon(iconPickerId)}
          onClose={() => setIconPickerId(null)}
        />
      )}
    </div>
  );
}
