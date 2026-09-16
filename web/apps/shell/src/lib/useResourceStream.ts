import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { attach, subscribe, unsubscribe, type Op } from "./ws";

export interface StreamState {
  rows: Record<string, unknown>[];
  synced: boolean;
  connected: boolean;
}

export function useResourceStream(
  cluster: string | undefined,
  gvr: string,
  opts: { ns?: string[]; labelSelector?: string; mode?: "metadata" | "full"; enabled?: boolean } = {},
): StreamState {
  // The Map lives entirely outside React — never stored in useState.
  const storeRef = useRef(new Map<string, Record<string, unknown>>());

  // Epoch counter: increments once per debounced flush (≤10/s).
  const epochRef = useRef(0);

  // Stable/synced/connected scalars — stored in a single ref object so we
  // can update them without going through React state, then notify listeners
  // only when the epoch flush fires.
  const metaRef = useRef({ synced: false, connected: false });

  // Pending flush timer handle.
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // External-store listener set — useSyncExternalStore will register here.
  const listenersRef = useRef(new Set<() => void>());

  const specKey = `${cluster ?? ""}|${gvr}|${opts.ns?.join(",") ?? "*"}|${opts.labelSelector ?? ""}|${opts.mode ?? "metadata"}`;

  // Schedules a debounced flush (100 ms). All WS mutations call this.
  // Using a ref-captured closure so the function identity is stable across
  // renders and can be used inside the useEffect without re-registration.
  const scheduleFlushRef = useRef<() => void>(() => {});
  scheduleFlushRef.current = () => {
    if (flushTimerRef.current !== null) return; // already pending
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      epochRef.current += 1;
      listenersRef.current.forEach((l) => l());
    }, 100);
  };

  useEffect(() => {
    if (!cluster || opts.enabled === false) {
      storeRef.current = new Map();
      metaRef.current = { synced: false, connected: false };
      epochRef.current += 1;
      listenersRef.current.forEach((l) => l());
      return;
    }

    storeRef.current = new Map();
    metaRef.current = { ...metaRef.current, synced: false };
    epochRef.current += 1;
    listenersRef.current.forEach((l) => l());

    const applyOps = (ops: Op[], replaceAll: boolean) => {
      if (replaceAll) storeRef.current = new Map();
      const m = storeRef.current;
      for (const op of ops) {
        if (op.op === "d") m.delete(op.key);
        else if (op.obj) m.set(op.key, op.obj);
      }
      scheduleFlushRef.current();
    };

    let streamDetach: (() => void) | null = null;
    let subId = "";

    const handlers = {
      onStatus: (connected: boolean) => {
        metaRef.current = { ...metaRef.current, connected };
        scheduleFlushRef.current();
      },
      onBegin: () => {
        storeRef.current = new Map();
        metaRef.current = { ...metaRef.current, synced: false };
        scheduleFlushRef.current();
      },
      onItems: (_id: string, ops: Op[]) => applyOps(ops, false),
      onDelta: (_id: string, ops: Op[]) => applyOps(ops, false),
      onSync: () => {
        metaRef.current = { ...metaRef.current, synced: true };
        scheduleFlushRef.current();
      },
      onError: (msg: string) => console.warn("[kubebay-stream]", msg),
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

  // useSyncExternalStore drives React re-renders. The "snapshot" is the epoch
  // integer: React re-renders only when it changes (i.e. on each flush).
  const epoch = useSyncExternalStore(
    (cb) => {
      listenersRef.current.add(cb);
      return () => listenersRef.current.delete(cb);
    },
    () => epochRef.current,
  );

  // Derive the rows array from the Map only when the epoch changes.
  const rows = useMemo(
    () => Array.from(storeRef.current.values()),
    // epoch is the only reactive dependency — storeRef.current is deliberately
    // mutated in-place so including it would be wrong.
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
