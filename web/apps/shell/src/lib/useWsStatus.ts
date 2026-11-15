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
        setStatus({
          connected,
          retryAttempt,
          nextRetryMs,
          hasEverConnected: hasEverConnected.current,
        });
      },
    });
  }, []);

  return status;
}
