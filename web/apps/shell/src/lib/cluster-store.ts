import { create } from "zustand";

interface ClusterState {
  /** The currently-selected cluster id (empty string = "auto-pick first connected") */
  active: string;
  setActive: (id: string) => void;
}

export const useClusterStore = create<ClusterState>((set) => ({
  active: new URLSearchParams(window.location.search).get("cluster") ?? "",
  setActive: (active) => set({ active }),
}));
