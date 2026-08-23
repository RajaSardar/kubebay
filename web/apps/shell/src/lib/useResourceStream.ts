import { useEffect, useMemo, useRef, useState } from "react";
import { KubebayStream, type Op, type StreamHandlers } from "../lib/ws";
import { getToken } from "./api";

export interface StreamState {
  rows: Record<string, unknown>[];
  synced: boolean;
  connected: boolean;
}

export function useResourceStream(
  cluster: string | undefined,
  gvr: string,
  opts: { ns?: string[]; labelSelector?: string; mode?: "metadata" | "full" } = {},
): StreamState {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [synced, setSynced] = useState(false);
  const [connected, setConnected] = useState(false);
  const storeRef = useRef(new Map<string, Record<string, unknown>>());

  const specKey = `${cluster ?? ""}|${gvr}|${opts.ns?.join(",") ?? "*"}|${opts.labelSelector ?? ""}|${opts.mode ?? "metadata"}`;

  useEffect(() => {
    if (!cluster) return;

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

    let stream: KubebayStream | null = null;
    let subId = "";

    const handlers: StreamHandlers = {
      onStatus: setConnected,
      onBegin: () => {
        storeRef.current = new Map();
        setRows([]);
      },
      onItems: (_id, ops) => applyOps(ops, false),
      onDelta: (_id, ops) => applyOps(ops, false),
      onSync: () => setSynced(true),
      onError: (msg) => console.warn("[kubebay-stream]", msg),
    };
    stream = new KubebayStream(getToken(), handlers);
    subId = `ui-${Math.random().toString(36).slice(2, 10)}`;
    stream.subscribe({
      id: subId,
      cluster,
      gvr,
      ns: opts.ns,
      labelSelector: opts.labelSelector,
      mode: opts.mode,
    });

    return () => {
      stream?.unsubscribe(subId);
      stream?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey]);

  return useMemo(() => ({ rows, synced, connected }), [rows, synced, connected]);
}
