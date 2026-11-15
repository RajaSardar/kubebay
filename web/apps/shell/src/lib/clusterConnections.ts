/**
 * Background connection manager — keeps WebSocket subscriptions alive for
 * connected clusters independent of React component lifecycle.
 *
 * When a cluster is "connected", we open background subs for the 7 core GVRs
 * that the Workloads Overview page needs. These subs pump deltas straight into
 * the module-level streamCache so that navigating back to any connected cluster
 * shows fresh data immediately with no skeleton flash or re-sync wait.
 */

import { subscribe, unsubscribe, attach, type Op } from "./ws";
import { clearStreamCacheForCluster, getStreamCache, setStreamCache } from "./streamCache";
import { derivePod } from "./pods";
import { isHidden, onVisible } from "./visibility";

// The 7 GVRs always subscribed in the background for every connected cluster.
const CORE_GVRS: Array<{ gvr: string; mode: "metadata" | "full" }> = [
  { gvr: "v1/pods",                   mode: "full"     },
  { gvr: "apps/v1/deployments",       mode: "full"     },
  { gvr: "apps/v1/statefulsets",      mode: "full"     },
  { gvr: "apps/v1/daemonsets",        mode: "full"     },
  { gvr: "batch/v1/jobs",             mode: "full"     },
  { gvr: "v1/nodes",                  mode: "metadata" },
  { gvr: "v1/namespaces",             mode: "metadata" },
];

// Sub ID → cluster+gvr so we can unsubscribe cleanly.
interface ActiveSub {
  id: string;
  cluster: string;
  gvr: string;
  mode: "metadata" | "full";
}

// Per-cluster state: subscription IDs + in-flight data stores.
interface ClusterConn {
  subs: ActiveSub[];
  // Map from specKey → live store (mirrors what useResourceStream would hold)
  stores: Map<string, Map<string, Record<string, unknown>>>;
  // Map from specKey → whether first sync has arrived
  synced: Map<string, boolean>;
  // Map from subId → specKey
  subToSpec: Map<string, string>;
  // Map from specKey → resync buffer (while re-listing)
  resync: Map<string, Map<string, Record<string, unknown>> | null>;
  // The engine refused or ended a subscription ("cluster disconnected").
  error: string;
}

const connections = new Map<string, ClusterConn>();

// ── Observability: React reads connections through useSyncExternalStore. ──
const listeners = new Set<() => void>();
let version = 0;
let dataTimer: ReturnType<typeof setTimeout> | null = null;

function notify() {
  version++;
  for (const l of listeners) l();
}

// Row data changes many times a second; listeners hear about it at most 1 Hz,
// and not at all while the window is hidden: nobody can see what they would
// draw, so they hear once, when it is shown.
let notifyWhenVisible = false;
let stopWatchingVisibility: (() => void) | null = null;

function deferUntilVisible() {
  notifyWhenVisible = true;
  stopWatchingVisibility ??= onVisible(() => {
    if (notifyWhenVisible) {
      notifyWhenVisible = false;
      notify();
    }
  });
}

function notifyData() {
  if (isHidden()) return deferUntilVisible();
  if (dataTimer) return;
  dataTimer = setTimeout(() => {
    dataTimer = null;
    // The window may have been hidden while the timer ran.
    if (isHidden()) deferUntilVisible();
    else notify();
  }, 1000);
}

// A stream's rows are copied into the stream cache (for the next page that
// opens it) at most once every two seconds. Copying a whole store, thousands
// of pods, on every update batch was O(rows) of allocation for something read
// only when a page opens.
const CACHE_WRITE_MS = 2000;
const cacheDirty = new Map<string, string>(); // stream key -> cluster
let cacheTimer: ReturnType<typeof setTimeout> | null = null;

function writeCacheSoon(cluster: string, key: string) {
  cacheDirty.set(key, cluster);
  if (cacheTimer) return;
  cacheTimer = setTimeout(flushCache, CACHE_WRITE_MS);
}

function flushCache() {
  cacheTimer = null;
  for (const [key, cluster] of cacheDirty) {
    const conn = connections.get(cluster);
    const store = conn?.stores.get(key);
    if (conn && store) setStreamCache(key, Array.from(store.entries()), conn.synced.get(key) ?? false);
  }
  cacheDirty.clear();
}

/** Subscribe to connection and data changes; returns the unsubscribe. */
export function subscribeConnections(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Changes whenever a connection, error or (throttled) row data changes. */
export function getConnectionsVersion(): number {
  return version;
}

/** The engine's reason a cluster's streams stopped, or "". */
export function connectionError(cluster: string): string {
  return connections.get(cluster)?.error ?? "";
}

export interface ClusterSummary {
  synced: boolean;
  pods: { healthy: number; pending: number; failing: number; total: number };
  nodes: number;
}

/** Pod health and node count from a connected cluster's background streams. */
export function clusterSummary(cluster: string): ClusterSummary | null {
  const conn = connections.get(cluster);
  if (!conn) return null;
  const podsKey = specKey(cluster, "v1/pods", "full");
  const nodesKey = specKey(cluster, "v1/nodes", "metadata");
  const pods = { healthy: 0, pending: 0, failing: 0, total: 0 };
  for (const obj of conn.stores.get(podsKey)?.values() ?? []) {
    const row = derivePod(obj);
    if (!row) continue;
    pods.total++;
    if (row.status === "running" || row.status === "succeeded") pods.healthy++;
    else if (row.status === "pending") pods.pending++;
    else pods.failing++;
  }
  return {
    synced: !!conn.synced.get(podsKey) && !!conn.synced.get(nodesKey),
    pods,
    nodes: conn.stores.get(nodesKey)?.size ?? 0,
  };
}

/**
 * The rows a connected cluster's background stream holds right now, read from
 * the live store. It opens nothing: callers such as the palette's search read
 * what is already in memory.
 */
export function getClusterRows(cluster: string, gvr: string, mode: "metadata" | "full"): Record<string, unknown>[] {
  const store = connections.get(cluster)?.stores.get(specKey(cluster, gvr, mode));
  return store ? Array.from(store.values()) : [];
}

/**
 * Whether every stream Kubebay follows for the cluster has delivered its first
 * full list. Cheap: it reads flags, not rows (unlike clusterSummary).
 */
export function isClusterSynced(cluster: string): boolean {
  const conn = connections.get(cluster);
  if (!conn || conn.subs.length === 0) return false;
  return conn.subs.every((s) => conn.synced.get(specKey(cluster, s.gvr, s.mode)) === true);
}

// Single shared WS listener that dispatches to all active connections.
let detach: (() => void) | null = null;

function specKey(cluster: string, gvr: string, mode: string): string {
  return `${cluster}|${gvr}|*||${mode}`;
}

function ensureListener() {
  if (detach) return;
  detach = attach({
    onBegin: (id) => {
      for (const conn of connections.values()) {
        const key = conn.subToSpec.get(id);
        if (!key) continue;
        conn.resync.set(key, new Map());
        conn.synced.set(key, false);
        // Persist current (pre-resync) data so navigating during re-sync still shows rows
        const existing = conn.stores.get(key);
        if (existing) {
          setStreamCache(key, Array.from(existing.entries()), false);
        }
      }
    },
    onItems: (id, ops) => {
      for (const conn of connections.values()) {
        const key = conn.subToSpec.get(id);
        if (!key) continue;
        const target = conn.resync.get(key) ?? conn.stores.get(key) ?? new Map();
        applyOps(ops, target);
        if (!conn.stores.has(key)) conn.stores.set(key, target);
        notifyData();
      }
    },
    onDelta: (id, ops) => {
      for (const conn of connections.values()) {
        const key = conn.subToSpec.get(id);
        if (!key) continue;
        const store = conn.stores.get(key) ?? new Map();
        applyOps(ops, store);
        conn.stores.set(key, store);
        // So a page opened later sees live data (at most a moment old).
        writeCacheSoon(conn.subs[0]?.cluster ?? "", key);
        notifyData();
      }
    },
    onSync: (id) => {
      for (const conn of connections.values()) {
        const key = conn.subToSpec.get(id);
        if (!key) continue;
        const buf = conn.resync.get(key);
        if (buf !== null && buf !== undefined) {
          conn.stores.set(key, buf);
          conn.resync.set(key, null);
        }
        conn.synced.set(key, true);
        const store = conn.stores.get(key) ?? new Map();
        setStreamCache(key, Array.from(store.entries()), true);
        notifyData();
      }
    },
    onError: (id, message) => {
      for (const conn of connections.values()) {
        if (!conn.subToSpec.has(id)) continue;
        conn.error = message;
        notify();
      }
    },
  });
}

function applyOps(ops: Op[], target: Map<string, Record<string, unknown>>) {
  for (const op of ops) {
    if (op.op === "d") target.delete(op.key);
    else if (op.obj) target.set(op.key, op.obj);
  }
}

function makeSubId(): string {
  return `bg-${Math.random().toString(36).slice(2, 10)}`;
}

/** Start background subscriptions for a cluster. Idempotent. */
export function connectCluster(cluster: string): void {
  if (connections.has(cluster)) return; // already connected

  ensureListener();

  const conn: ClusterConn = {
    subs: [],
    stores: new Map(),
    synced: new Map(),
    subToSpec: new Map(),
    resync: new Map(),
    error: "",
  };

  for (const { gvr, mode } of CORE_GVRS) {
    const id = makeSubId();
    const key = specKey(cluster, gvr, mode);

    // Pre-warm from existing cache if available
    const cached = getStreamCache(key);
    if (cached) {
      conn.stores.set(key, new Map(cached.entries));
      conn.synced.set(key, cached.synced);
    }

    conn.subs.push({ id, cluster, gvr, mode });
    conn.subToSpec.set(id, key);
    conn.resync.set(key, null);

    subscribe({ id, cluster, gvr, mode });
  }

  connections.set(cluster, conn);
  notify();
}

/** Stop background subscriptions for a cluster. */
export function disconnectCluster(cluster: string): void {
  const conn = connections.get(cluster);
  if (!conn) return;

  for (const sub of conn.subs) {
    unsubscribe(sub.id);
  }

  connections.delete(cluster);
  clearStreamCacheForCluster(cluster);

  // If no more connections, detach the shared listener
  if (connections.size === 0 && detach) {
    detach();
    detach = null;
  }
  notify();
}

/** Returns a snapshot of all currently-connected cluster IDs. */
export function getConnectedClusters(): Set<string> {
  return new Set(connections.keys());
}

export function isClusterConnected(cluster: string): boolean {
  return connections.has(cluster);
}

/** Reset all connections — used in tests. */
export function resetConnections(): void {
  for (const cluster of connections.keys()) {
    disconnectCluster(cluster);
  }
  connections.clear();
  if (detach) { detach(); detach = null; }
  // Pending timers belong to the connections just dropped.
  if (dataTimer) { clearTimeout(dataTimer); dataTimer = null; }
  if (cacheTimer) { clearTimeout(cacheTimer); cacheTimer = null; }
  cacheDirty.clear();
  notifyWhenVisible = false;
  if (stopWatchingVisibility) { stopWatchingVisibility(); stopWatchingVisibility = null; }
}
