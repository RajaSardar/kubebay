import { useEffect, useMemo, useRef, useState } from "react";
import { attach, subscribe, unsubscribe, type Op } from "./ws";
import { getStreamCache, setStreamCache } from "./streamCache";

export interface StreamState {
  rows: Record<string, unknown>[];
  synced: boolean;
  connected: boolean;
}

// Pure helper — exported for unit tests.
// Computes the next { synced, connected } state on a WS status event.
// Key invariant: transitioning disconnected→connected resets synced=false so
// the stale cache value is never exposed during the 16 ms debounce window
// before the server's "begin" frame arrives.
// Pure helper — exported for unit tests.
// Skeleton should ONLY show when there is genuinely no data yet.
// Never show just because synced=false (re-syncing) when rows exist —
// that causes stuck-skeleton on large remote clusters (EKS) where
// re-sync takes 5-15 seconds.
export function shouldShowSkeleton(synced: boolean, rowCount: number): boolean {
  return !synced && rowCount === 0;
}

export function applyStatusTransition(
  current: { synced: boolean; connected: boolean },
  connected: boolean,
): { synced: boolean; connected: boolean } {
  if (connected && !current.connected) {
    // Reconnect: invalidate any cached synced state immediately.
    return { synced: false, connected: true };
  }
  return { ...current, connected };
}

export function useResourceStream(
  cluster: string | undefined,
  gvr: string,
  opts: { ns?: string[]; labelSelector?: string; mode?: "metadata" | "full"; enabled?: boolean } = {},
): StreamState {
  // The Map lives entirely outside React — never stored in useState.
  const storeRef = useRef(new Map<string, Record<string, unknown>>());

  // During re-sync, new items land here until onSync fires — then we atomically
  // swap storeRef ← resyncRef. This keeps the old cached rows visible during
  // the re-sync window (no content vanish on EKS with 5-15s re-sync time).
  const resyncRef = useRef<Map<string, Record<string, unknown>> | null>(null);

  // Stable/synced/connected scalars — stored in a single ref object so we
  // can update them without going through React state, then notify listeners
  // only when the epoch flush fires.
  const metaRef = useRef({ synced: false, connected: false });

  // Pending flush timer handle.
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Simple state counter to trigger re-renders. Replaces useSyncExternalStore
  // which caused infinite loops (React error #185) due to snapshot changes
  // detected during the commit phase.
  const [epoch, setEpoch] = useState(0);

  const specKey = `${cluster ?? ""}|${gvr}|${opts.ns?.join(",") ?? "*"}|${opts.labelSelector ?? ""}|${opts.mode ?? "metadata"}`;

  // Schedules a debounced flush (16 ms = one animation frame). All WS mutations
  // call this. Collapses rapid-fire delta bursts into a single re-render while
  // keeping live updates feeling instantaneous (vs the old 100 ms which was
  // perceptibly laggy on fast-changing clusters).
  const scheduleFlushRef = useRef<() => void>(() => {});
  scheduleFlushRef.current = () => {
    if (flushTimerRef.current !== null) return; // already pending
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      setEpoch((e) => e + 1);
    }, 16);
  };

  useEffect(() => {
    if (!cluster || opts.enabled === false) {
      storeRef.current = new Map();
      metaRef.current = { synced: false, connected: false };
      setEpoch((e) => e + 1);
      return;
    }

    // Pre-warm from module-level cache so re-navigating to a tab shows
    // the last-known rows immediately, with no skeleton flash.
    const cached = getStreamCache(specKey);
    if (cached) {
      storeRef.current = new Map(cached.entries);
      metaRef.current = { synced: cached.synced, connected: false };
    } else {
      storeRef.current = new Map();
      metaRef.current = { ...metaRef.current, synced: false };
    }
    setEpoch((e) => e + 1);

    const applyOps = (ops: Op[], target: Map<string, Record<string, unknown>>) => {
      for (const op of ops) {
        if (op.op === "d") target.delete(op.key);
        else if (op.obj) target.set(op.key, op.obj);
      }
      scheduleFlushRef.current();
    };

    let streamDetach: (() => void) | null = null;
    let subId = "";

    // The multiplexed WS connection broadcasts every frame to every attached
    // listener, so each handler MUST filter by subscription id — otherwise a
    // frame meant for one useResourceStream instance (e.g. NamespaceFilter's
    // own "v1/namespaces" stream) gets applied to every other concurrently
    // mounted instance (e.g. the main table's stream), corrupting its rows.
    const handlers = {
      onStatus: (connected: boolean) => {
        metaRef.current = applyStatusTransition(metaRef.current, connected);
        scheduleFlushRef.current();
      },
      onBegin: (id: string) => {
        if (id !== subId) return;
        // Start a fresh buffer — keep storeRef intact so cached rows remain
        // visible to the UI while re-syncing (prevents stuck-skeleton on EKS).
        resyncRef.current = new Map();
        metaRef.current = { ...metaRef.current, synced: false };
        scheduleFlushRef.current();
      },
      onItems: (id: string, ops: Op[]) => {
        if (id !== subId) return;
        // If a resync is in progress, collect into the buffer; otherwise apply
        // directly to storeRef (initial load or delta after first sync).
        applyOps(ops, resyncRef.current ?? storeRef.current);
      },
      onDelta: (id: string, ops: Op[]) => {
        if (id !== subId) return;
        applyOps(ops, storeRef.current);
      },
      onSync: (id: string) => {
        if (id !== subId) return;
        // Atomic swap: replace cached store with the fully-synced resync buffer.
        if (resyncRef.current !== null) {
          storeRef.current = resyncRef.current;
          resyncRef.current = null;
        }
        metaRef.current = { ...metaRef.current, synced: true };
        // Snapshot synced state into module-level cache for instant re-render on revisit.
        setStreamCache(specKey, Array.from(storeRef.current.entries()), true);
        scheduleFlushRef.current();
      },
      onError: (id: string, msg: string) => console.warn("[kubebay-stream]", id || "(no id)", msg),
    };
    streamDetach = attach(handlers);
    subId = `ui-${Math.random().toString(36).slice(2, 10)}`;
    subscribe({
      id: subId,
      cluster,
      gvr,
      ns: opts.ns,
      labelSelector: opts.labelSelector,
      mode: opts.mode,
    });
    void subId;

    return () => {
      // Save current state to module-level cache before teardown so the
      // next mount of this specKey renders data immediately.
      if (metaRef.current.synced) {
        setStreamCache(specKey, Array.from(storeRef.current.entries()), true);
      }
      unsubscribe(subId);
      streamDetach?.();
      // Cancel any pending flush so it doesn't fire after unmount.
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey]);

  // Derive the rows array from the Map only when the epoch changes.
  const rows = useMemo(
    () => Array.from(storeRef.current.values()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [epoch],
  );

  // Meta values are also gated on epoch so they stay in sync.
  const { synced, connected } = useMemo(
    () => metaRef.current,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [epoch],
  );

  return useMemo(() => ({ rows, synced, connected }), [rows, synced, connected]);
}
