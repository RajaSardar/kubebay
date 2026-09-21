import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ClusterIcon {
  bg: string;
  label: string;
  imageUrl?: string;
}

interface ClusterIconState {
  icons: Record<string, ClusterIcon>;
  setIcon: (clusterId: string, icon: ClusterIcon) => void;
  resetIcon: (clusterId: string) => void;
}

export const useClusterIcons = create<ClusterIconState>()(
  persist(
    (set) => ({
      icons: {},
      setIcon: (clusterId, icon) =>
        set((s) => ({ icons: { ...s.icons, [clusterId]: icon } })),
      resetIcon: (clusterId) =>
        set((s) => {
          const next = { ...s.icons };
          delete next[clusterId];
          return { icons: next };
        }),
    }),
    { name: "kb.cluster-icons" },
  ),
);
