import { create } from "zustand";

const ACTIVE_CLUSTER_KEY = "kubebay.activeCluster";

interface ClusterState {
  /** The currently-selected cluster id (empty string = none selected) */
  active: string;
  setActive: (id: string) => void;
}

// URL param takes precedence (macOS window-restore preserves the full URL).
// localStorage is the fallback for a cold start (full quit + reopen) where
// the webview starts fresh with no query string.
const urlCluster = new URLSearchParams(window.location.search).get("cluster") ?? "";
const storedCluster = (() => {
  try { return localStorage.getItem(ACTIVE_CLUSTER_KEY) ?? ""; }
  catch { return ""; }
})();

export const useClusterStore = create<ClusterState>((set) => ({
  active: urlCluster || storedCluster,
  setActive: (active) => {
    try { localStorage.setItem(ACTIVE_CLUSTER_KEY, active); } catch { /* quota */ }
    set({ active });
  },
}));
