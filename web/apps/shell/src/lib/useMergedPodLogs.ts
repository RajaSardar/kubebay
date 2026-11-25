// Backlog 59: the logs of several pods of one workload in one list. Each pod
// has its own logs channel, opened as the user (so RBAC applies per pod); lines
// are kept in the order they arrive, each tagged with its pod.
import { useEffect, useRef, useState } from "react";
import { attach, closeChannel, openChannel } from "./ws";

export const mergedLinesLimit = 5000;
/** Channels waiting for their first answer at any moment; the rest queue. */
export const OPEN_AT_ONCE = 6;

export interface MergedLine {
  /** Arrival number, a stable React key. */
  id: number;
  pod: string;
  text: string;
}

export interface MergedLogsSpec {
  cluster: string;
  namespace: string;
  pods: { pod: string; container?: string }[];
  tail: number;
  follow: boolean;
  previous: boolean;
}

function specKey(s: MergedLogsSpec): string {
  return [s.cluster, s.namespace, s.pods.map((p) => `${p.pod}/${p.container ?? ""}`).sort().join(","), s.tail, s.follow ? 1 : 0, s.previous ? 1 : 0].join("|");
}

export function useMergedPodLogs(spec: MergedLogsSpec | null) {
  const [lines, setLines] = useState<MergedLine[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const specRef = useRef(spec);
  specRef.current = spec;
  const key = spec ? specKey(spec) : "";

  useEffect(() => {
    const s = specRef.current;
    setLines([]);
    setErrors({});
    if (!s || s.pods.length === 0) return;

    const decoder = new TextDecoder();
    const byChan = new Map<string, { pod: string; rest: string }>();
    const queue = [...s.pods];
    const opening = new Set<string>();
    let pending: MergedLine[] = [];
    let seq = 0;
    let raf = 0;

    const flush = () => {
      raf = 0;
      if (!pending.length) return;
      const batch = pending;
      pending = [];
      setLines((prev) => {
        const next = prev.concat(batch);
        return next.length > mergedLinesLimit ? next.slice(next.length - mergedLinesLimit) : next;
      });
    };

    const openNext = () => {
      while (opening.size < OPEN_AT_ONCE && queue.length) {
        const p = queue.shift()!;
        const id = `logs-${Math.random().toString(36).slice(2, 10)}`;
        byChan.set(id, { pod: p.pod, rest: "" });
        opening.add(id);
        openChannel({
          id,
          kind: "logs",
          cluster: s.cluster,
          namespace: s.namespace,
          pod: p.pod,
          container: p.container,
          tail: s.tail,
          follow: s.follow,
          previous: s.previous,
        });
      }
    };
    const settled = (id: string) => {
      if (opening.delete(id)) openNext();
    };

    const detach = attach({
      onAck: (id) => settled(id),
      onChanData: (id, data) => {
        const c = byChan.get(id);
        if (!c) return;
        // A first byte also means the stream is up.
        settled(id);
        const text = c.rest + decoder.decode(data, { stream: true });
        const parts = text.split("\n");
        c.rest = parts.pop() ?? "";
        for (const t of parts) pending.push({ id: seq++, pod: c.pod, text: t });
        if (pending.length && !raf) raf = requestAnimationFrame(flush);
      },
      onChanClosed: (id, msg) => {
        const c = byChan.get(id);
        if (!c) return;
        if (c.rest) pending.push({ id: seq++, pod: c.pod, text: c.rest });
        c.rest = "";
        if (pending.length && !raf) raf = requestAnimationFrame(flush);
        if (msg && msg !== "done") setErrors((e) => ({ ...e, [c.pod]: msg }));
        settled(id);
      },
      onError: (id, msg) => {
        const c = byChan.get(id);
        if (!c) return;
        setErrors((e) => ({ ...e, [c.pod]: msg }));
        settled(id);
      },
    });

    openNext();

    return () => {
      cancelAnimationFrame(raf);
      for (const id of byChan.keys()) closeChannel(id);
      detach();
    };
  }, [key]);

  return { lines, errors };
}
