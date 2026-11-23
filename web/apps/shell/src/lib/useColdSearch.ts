import { useEffect, useState } from "react";
import { searchApi, type ColdSearchResponse } from "./api";

const DEBOUNCE_MS = 250;
const POLL_MS = 1500;

/**
 * Searches the clusters that aren't connected, once the user opts in and
 * typing pauses. The engine answers at once with what it has and marks the
 * clusters still listing as pending; this asks again until none are.
 */
export function useColdSearch(enabled: boolean, ids: string[], q: string): { data?: ColdSearchResponse; loading: boolean; error?: string } {
  const [state, setState] = useState<{ data?: ColdSearchResponse; loading: boolean; error?: string }>({ loading: false });
  const key = ids.join("\0");
  const query = q.trim();
  const active = enabled && ids.length > 0 && query !== "";

  useEffect(() => {
    if (!active) {
      setState({ loading: false });
      return;
    }
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState((s) => ({ data: s.data, loading: true }));
    const ask = async () => {
      try {
        const data = await searchApi.clusters(key.split("\0"), q, ctl.signal);
        if (ctl.signal.aborted) return;
        const pending = data.clusters.some((c) => c.pending);
        setState({ data, loading: pending });
        if (pending) timer = setTimeout(() => void ask(), POLL_MS);
      } catch (e) {
        if (ctl.signal.aborted) return;
        setState({ loading: false, error: e instanceof Error ? e.message : String(e) });
      }
    };
    timer = setTimeout(() => void ask(), DEBOUNCE_MS);
    return () => {
      ctl.abort();
      if (timer) clearTimeout(timer);
    };
    // q itself is sent (a trailing space names a kind); `key` stands for ids.
  }, [active, key, q]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}
