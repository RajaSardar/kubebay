import { create } from "zustand";

const KEY = "kb.cluster-icons";

export interface ClusterIcon {
  bg: string;
  label: string;
  imageUrl?: string;
}

function load(): Record<string, ClusterIcon> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

interface ClusterIconState {
  icons: Record<string, ClusterIcon>;
  setIcon: (clusterId: string, icon: ClusterIcon) => void;
  resetIcon: (clusterId: string) => void;
}

export const useClusterIcons = create<ClusterIconState>((set) => ({
  icons: load(),
  setIcon: (clusterId, icon) =>
    set((s) => {
      const next = { ...s.icons, [clusterId]: icon };
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* quota */ }
      return { icons: next };
    }),
  resetIcon: (clusterId) =>
    set((s) => {
      const next = { ...s.icons };
      delete next[clusterId];
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* quota */ }
      return { icons: next };
    }),
}));
