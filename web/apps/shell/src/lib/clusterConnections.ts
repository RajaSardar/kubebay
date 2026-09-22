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
import { getStreamCache, setStreamCache } from "./streamCache";

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
}

const connections = new Map<string, ClusterConn>();

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
      }
    },
    onDelta: (id, ops) => {
      for (const conn of connections.values()) {
        const key = conn.subToSpec.get(id);
        if (!key) continue;
        const store = conn.stores.get(key) ?? new Map();
        applyOps(ops, store);
        conn.stores.set(key, store);
        // Write through to cache so components see live deltas
        setStreamCache(key, Array.from(store.entries()), conn.synced.get(key) ?? false);
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
}

/** Stop background subscriptions for a cluster. */
export function disconnectCluster(cluster: string): void {
  const conn = connections.get(cluster);
  if (!conn) return;

  for (const sub of conn.subs) {
    unsubscribe(sub.id);
  }

  connections.delete(cluster);

  // If no more connections, detach the shared listener
  if (connections.size === 0 && detach) {
    detach();
    detach = null;
  }
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
}
