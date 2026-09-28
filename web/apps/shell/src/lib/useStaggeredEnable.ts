import { useEffect, useState } from "react";
import { staggerDelay } from "./staggerDelay";

/**
 * True once this cluster's wave is allowed to open its subscriptions — see
 * staggerDelay for why. index 0 (and every index within the first
 * `concurrency`) is enabled immediately; later waves flip true after their
 * own delay elapses.
 */
export function useStaggeredEnable(index: number, concurrency: number, intervalMs: number): boolean {
  const delay = staggerDelay(index, concurrency, intervalMs);
  const [enabled, setEnabled] = useState(delay === 0);

  useEffect(() => {
    if (delay === 0) return;
    const t = setTimeout(() => setEnabled(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  return enabled;
}
