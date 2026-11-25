import { create } from "zustand";
import type { CompareRef } from "./compare";

/**
 * The compare dialog's state (backlog 83). Any entry point (a table's
 * selection bar, an object drawer, the palette) calls `show`; one host in
 * App renders the dialog. A side left out is picked inside the dialog.
 */
export const useCompare = create<{
  open: boolean;
  left: CompareRef | null;
  right: CompareRef | null;
  show: (left?: CompareRef | null, right?: CompareRef | null) => void;
  close: () => void;
}>((set) => ({
  open: false,
  left: null,
  right: null,
  show: (left = null, right = null) => set({ open: true, left, right }),
  close: () => set({ open: false, left: null, right: null }),
}));
