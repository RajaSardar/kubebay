import { useEffect, useRef, useState } from "react";

/** How long a changed row stays tinted (matches --kb-dur-flash). */
export const CHANGED_ROW_MS = 1000;

const EMPTY: ReadonlySet<string> = new Set();

/**
 * The keys of rows whose shown data just changed, each for about a second.
 * A new `versionOf` (resourceVersion) is the cheap signal; the row counts as
 * changed only if `signatureOf` (the values its columns show) changed too, so
 * a Node heartbeat that bumps resourceVersion alone does not flicker. Nothing
 * tints on the first load, for rows that just arrived, or across a re-sync.
 */
export function useChangedRows<R>(
  rows: readonly R[],
  keyOf: (r: R) => string,
  versionOf: ((r: R) => string) | undefined,
  signatureOf: (r: R) => string,
  synced: boolean,
): ReadonlySet<string> {
  const seen = useRef<Map<string, R> | null>(null);
  const [changed, setChanged] = useState<ReadonlySet<string>>(EMPTY);
  // Each batch clears itself; a later update must not cancel an earlier one's timer.
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const live = timers.current;
    return () => {
      for (const t of live) clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    if (!versionOf) return;
    if (!synced) {
      // A re-sync replaces every object: the next synced list is a new baseline.
      seen.current = null;
      return;
    }
    const prev = seen.current;
    const next = new Map<string, R>();
    const hits: string[] = [];
    for (const r of rows) {
      const k = keyOf(r);
      next.set(k, r);
      const old = prev?.get(k);
      if (old !== undefined && versionOf(old) !== versionOf(r) && signatureOf(old) !== signatureOf(r)) hits.push(k);
    }
    seen.current = next;
    if (hits.length === 0) return;
    setChanged((cur) => new Set([...cur, ...hits]));
    const t = setTimeout(() => {
      timers.current.delete(t);
      setChanged((cur) => {
        const out = new Set(cur);
        for (const k of hits) out.delete(k);
        return out.size === 0 ? EMPTY : out;
      });
    }, CHANGED_ROW_MS);
    timers.current.add(t);
  }, [rows, keyOf, versionOf, signatureOf, synced]);

  return changed;
}
