import { useEffect, useRef, useState } from "react";
import { attach, closeChannel, openChannel } from "./ws";

export type LogStatus = "idle" | "streaming" | "closed";

const MAX_LINES = 5000;

export interface PodLogsSpec {
  cluster: string;
  namespace: string;
  pod: string;
  container?: string;
  tail: number;
  follow: boolean;
  previous: boolean;
}

function specKey(s: PodLogsSpec): string {
  return [s.cluster, s.namespace, s.pod, s.container ?? "", s.tail, s.follow ? 1 : 0, s.previous ? 1 : 0].join("|");
}

export function usePodLogs(spec: PodLogsSpec | null) {
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<LogStatus>("idle");
  const [error, setError] = useState("");
  const key = spec ? specKey(spec) : "";

  useEffect(() => {
    if (!spec) {
      setLines([]);
      setStatus("idle");
      return;
    }
    setLines([]);
    setStatus("streaming");
    setError("");

    const decoder = new TextDecoder();
    let pending: string[] = [];
    let raf = 0;

    const flush = () => {
      raf = 0;
      if (!pending.length) return;
      const batch = pending;
      pending = [];
      setLines((prev) => {
        const next = prev.concat(batch);
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
      });
    };

    let chanId = "";
    const detach = attach({
      onAck: (id) => {
        if (id === chanId) setStatus("streaming");
      },
      onChanData: (id, data) => {
        if (id !== chanId) return;
        const text = decoder.decode(data, { stream: true });
        if (!text) return;
        const parts = text.split("\n");
        if (parts[parts.length - 1] === "") parts.pop();
        pending.push(...parts);
        if (!raf) raf = requestAnimationFrame(flush);
      },
      onChanClosed: (id, msg) => {
        if (id !== chanId) return;
        setStatus("closed");
        setError(msg && msg !== "done" ? msg : "");
      },
      onError: (msg) => setError(msg),
    });

    chanId = `logs-${Math.random().toString(36).slice(2, 10)}`;
    openChannel({
      id: chanId,
      kind: "logs",
      cluster: spec.cluster,
      namespace: spec.namespace,
      pod: spec.pod,
      container: spec.container,
      tail: spec.tail,
      follow: spec.follow,
      previous: spec.previous,
    });

    return () => {
      cancelAnimationFrame(raf);
      closeChannel(chanId);
      detach();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { lines, status, error };
}

export function useLatestRef<T>(v: T) {
  const ref = useRef(v);
  ref.current = v;
  return ref;
}
