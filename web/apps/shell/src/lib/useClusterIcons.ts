import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ClusterIcon {
  bg: string;
  label: string;
}

interface ClusterIconState {
  icons: Record<string, ClusterIcon>;
  setIcon: (clusterId: string, icon: ClusterIcon) => void;
  resetIcon: (clusterId: string) => void;
}

export const useClusterIconStore = create<ClusterIconState>()((set) => ({
  icons: {},
  setIcon: (clusterId, icon) =>
    set((state) => ({
      icons: { ...state.icons, [clusterId]: icon },
    })),
  resetIcon: (clusterId) =>
    set((state) => {
      const next = { ...state.icons };
      delete next[clusterId];
      return { icons: next };
    }),
}));

/**
 * Shared, reactive cluster-icon store. All consumers (ClusterStrip, Sidebar,
 * Home) read from the same zustand store, so an icon change made in one
 * shows up in the others immediately instead of only after a remount.
 */
export function useClusterIcons() {
  const icons = useClusterIconStore((s) => s.icons);
  const setIcon = useClusterIconStore((s) => s.setIcon);
  const resetIcon = useClusterIconStore((s) => s.resetIcon);
  return { icons, setIcon, resetIcon };
}
