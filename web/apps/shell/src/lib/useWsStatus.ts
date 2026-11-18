import { useEffect, useRef, useState } from "react";
import { attach } from "./ws";

export interface WsStatus {
  connected: boolean;
  retryAttempt: number;
  nextRetryMs: number;
  hasEverConnected: boolean;
}

export function useWsStatus(): WsStatus {
  const hasEverConnected = useRef(false);
  const latest = useRef<WsStatus>({ connected: false, retryAttempt: 0, nextRetryMs: 0, hasEverConnected: false });
  const [status, setStatus] = useState<WsStatus>({
    connected: false,
    retryAttempt: 0,
    nextRetryMs: 0,
    hasEverConnected: false,
  });

  useEffect(() => {
    return attach({
      onStatus: (connected, retryAttempt = 0, nextRetryMs = 0) => {
        if (connected) hasEverConnected.current = true;
        const next: WsStatus = { connected, retryAttempt, nextRetryMs, hasEverConnected: hasEverConnected.current };
        // The socket re-announces an unchanged status (the stable timer, a new
        // listener): skip the update so the app shell doesn't re-render.
        const cur = latest.current;
        if (
          cur.connected === next.connected &&
          cur.retryAttempt === next.retryAttempt &&
          cur.nextRetryMs === next.nextRetryMs &&
          cur.hasEverConnected === next.hasEverConnected
        )
          return;
        latest.current = next;
        setStatus(next);
      },
    });
  }, []);

  return status;
}
