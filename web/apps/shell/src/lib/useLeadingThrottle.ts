import { useEffect, useRef, useState } from "react";

/**
 * Leading-edge throttle for an expensive derived value (e.g. the pressure
 * grid's O(pods) aggregation) that would otherwise recompute on every fast
 * stream flush. The first value is returned immediately; a value passed
 * while the window is still open is held and applied once the window
 * elapses, coalescing any updates that arrived in between.
 */
export function useLeadingThrottle<T>(value: T, ms: number): T {
  const [throttled, setThrottled] = useState(value);
  const lastAppliedAt = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef(value);

  pendingRef.current = value;

  useEffect(() => {
    const elapsed = Date.now() - lastAppliedAt.current;
    if (elapsed >= ms) {
      lastAppliedAt.current = Date.now();
      setThrottled(value);
      return;
    }
    if (timerRef.current !== null) return; // already scheduled — it'll pick up pendingRef's latest value
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      lastAppliedAt.current = Date.now();
      setThrottled(pendingRef.current);
    }, ms - elapsed);
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, ms]);

  return throttled;
}
