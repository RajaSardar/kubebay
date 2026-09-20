import { create } from "zustand";

const ACTIVE_CLUSTER_KEY = "kubebay.activeCluster";

interface ClusterState {
  /** The cluster actively connected to (persisted, drives navigation). */
  active: string;
  /** The row highlighted in the catalog (ephemeral preview, no navigation). */
  selected: string;
  setActive: (id: string) => void;
  setSelected: (id: string) => void;
}

// URL param takes precedence (macOS window-restore preserves the full URL).
// sessionStorage keeps the active cluster alive while the app window is open,
// but clears when the app is quit — so every fresh launch starts at the
// cluster picker and the user must explicitly connect. (localStorage would
// auto-connect to the last cluster on every restart, which the user rejected.)
const urlCluster = new URLSearchParams(window.location.search).get("cluster") ?? "";
const storedCluster = (() => {
  try { return sessionStorage.getItem(ACTIVE_CLUSTER_KEY) ?? ""; }
  catch { return ""; }
})();

// Evict the old localStorage value so restarting after this upgrade doesn't
// auto-connect one last time.
try { localStorage.removeItem(ACTIVE_CLUSTER_KEY); } catch { /* ignore */ }

export const useClusterStore = create<ClusterState>((set) => ({
  active: urlCluster || storedCluster,
  selected: "",
  setActive: (active) => {
    try { sessionStorage.setItem(ACTIVE_CLUSTER_KEY, active); } catch { /* quota */ }
    set({ active });
  },
  setSelected: (selected) => set({ selected }),
}));
