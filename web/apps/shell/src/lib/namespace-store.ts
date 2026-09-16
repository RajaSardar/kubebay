import { create } from "zustand";
import { persist } from "zustand/middleware";

interface NamespaceState {
  /** Maps clusterName → selected namespace names. Empty array means "all namespaces". */
  selections: Record<string, string[]>;
  setNamespaces: (cluster: string, namespaces: string[]) => void;
  clearNamespaces: (cluster: string) => void;
}

export const useNamespaceStore = create<NamespaceState>()(
  persist(
    (set) => ({
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
    }),
    {
      name: "kb.ns-filter",
    },
  ),
);

/** Returns the selected namespaces for a cluster. Empty array means "all namespaces". */
export function useSelectedNamespaces(cluster: string | undefined): string[] {
  return useNamespaceStore(
    (state) => (cluster ? (state.selections[cluster] ?? []) : []),
  );
}
