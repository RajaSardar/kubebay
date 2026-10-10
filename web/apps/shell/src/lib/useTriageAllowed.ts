import { useEffect, useState } from "react";
import { triageApi } from "./api";

/**
 * Backlog #13: whether incident triage is on for this cluster, so the pod
 * drawer offers its Triage tab only where the user allowed it. Any failure
 * (an older engine, a network error) reads as not allowed.
 */
export function useTriageAllowed(cluster: string): boolean {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => triageApi.get())
      .then((st) => live && setAllowed(st.enabled && !st.disabled && (st.clusters ?? []).includes(cluster)))
      .catch(() => live && setAllowed(false));
    return () => {
      live = false;
    };
  }, [cluster]);
  return allowed;
}
