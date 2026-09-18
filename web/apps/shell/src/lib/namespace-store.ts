import { create } from "zustand";

interface NamespaceState {
  /** Maps clusterName → selected namespace names. Empty array means "all namespaces". */
  selections: Record<string, string[]>;
  setNamespaces: (cluster: string, namespaces: string[]) => void;
  clearNamespaces: (cluster: string) => void;
}

export const useNamespaceStore = create<NamespaceState>()((set) => ({
  selections: {},
  setNamespaces: (cluster, namespaces) =>
    set((state) => ({
      selections: { ...state.selections, [cluster]: namespaces },
    })),
  clearNamespaces: (cluster) =>
    set((state) => {
      const next = { ...state.selections };
      delete next[cluster];
      return { selections: next };
    }),
}));

// Stable empty array — reusing the same reference ensures Zustand's Object.is
// check doesn't see a "new" value every render, which would cause infinite loops.
const EMPTY: string[] = [];

/** Returns the selected namespaces for a cluster. Empty array means "all namespaces". */
export function useSelectedNamespaces(cluster: string | undefined): string[] {
  return useNamespaceStore(
    (state) => (cluster ? (state.selections[cluster] ?? EMPTY) : EMPTY),
  );
}

/**
 * Adapter for pages that need single-namespace semantics (e.g. a topology
 * graph that only stays readable for one namespace at a time) while still
 * sharing the same persisted, cross-page namespace selection. Reads the
 * first selected namespace for the cluster, falling back to `fallback` when
 * nothing is selected, and setting it writes back a single-element selection.
 */
export function useSingleNamespace(cluster: string | undefined, fallback: string): [string, (ns: string) => void] {
  const selected = useSelectedNamespaces(cluster);
  const { setNamespaces } = useNamespaceStore();
  const current = selected[0] ?? fallback;
  const setNs = (ns: string) => {
    if (cluster) setNamespaces(cluster, [ns]);
  };
  return [current, setNs];
}
