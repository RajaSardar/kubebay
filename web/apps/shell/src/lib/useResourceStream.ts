import { useEffect, useMemo, useRef, useState } from "react";
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
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [synced, setSynced] = useState(false);
  const [connected, setConnected] = useState(false);
  const storeRef = useRef(new Map<string, Record<string, unknown>>());

  const specKey = `${cluster ?? ""}|${gvr}|${opts.ns?.join(",") ?? "*"}|${opts.labelSelector ?? ""}|${opts.mode ?? "metadata"}`;

  useEffect(() => {
    if (!cluster || opts.enabled === false) {
      setRows([]);
      setSynced(false);
      return;
    }

    storeRef.current = new Map();
    setRows([]);
    setSynced(false);

    const applyOps = (ops: Op[], replaceAll: boolean) => {
      if (replaceAll) storeRef.current = new Map();
      const m = storeRef.current;
      for (const op of ops) {
        if (op.op === "d") m.delete(op.key);
        else if (op.obj) m.set(op.key, op.obj);
      }
      setRows(Array.from(m.values()));
    };

    let streamDetach: (() => void) | null = null;
    let subId = "";

    const handlers = {
      onStatus: setConnected,
      onBegin: () => {
        storeRef.current = new Map();
        setRows([]);
      },
      onItems: (_id: string, ops: Op[]) => applyOps(ops, false),
      onDelta: (_id: string, ops: Op[]) => applyOps(ops, false),
      onSync: () => setSynced(true),
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey]);

  return useMemo(() => ({ rows, synced, connected }), [rows, synced, connected]);
}
