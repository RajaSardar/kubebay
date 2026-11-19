import { create } from "zustand";

// Whether the command palette is open. A store rather than App state so a
// Monaco editor, which swallows Cmd/Ctrl+K, can toggle it too (backlog 53).
export const usePalette = create<{ open: boolean; toggle: () => void; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
}));
