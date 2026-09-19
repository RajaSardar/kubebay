import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ClusterMeta {
  alias?: string;
  pinned?: boolean;
  hidden?: boolean;
  lastUsed?: number;
}

interface ClusterMetaState {
  meta: Record<string, ClusterMeta>;
  setAlias: (id: string, alias: string) => void;
  togglePin: (id: string) => void;
  hide: (id: string) => void;
  show: (id: string) => void;
  touchLastUsed: (id: string) => void;
}

export const useClusterMeta = create<ClusterMetaState>()(
  persist(
    (set) => ({
      meta: {},
      setAlias: (id, alias) =>
        set((s) => ({
          meta: {
            ...s.meta,
            [id]: { ...s.meta[id], alias: alias.trim() || undefined },
          },
        })),
      togglePin: (id) =>
        set((s) => ({
          meta: {
            ...s.meta,
            [id]: { ...s.meta[id], pinned: !s.meta[id]?.pinned },
          },
        })),
      hide: (id) =>
        set((s) => ({
          meta: { ...s.meta, [id]: { ...s.meta[id], hidden: true } },
        })),
      show: (id) =>
        set((s) => ({
          meta: { ...s.meta, [id]: { ...s.meta[id], hidden: false } },
        })),
      touchLastUsed: (id) =>
        set((s) => ({
          meta: {
            ...s.meta,
            [id]: { ...s.meta[id], lastUsed: Date.now() },
          },
        })),
    }),
    { name: "kubebay-cluster-meta" },
  ),
);
