import { TYPING } from "./tableUx";

/**
 * A drawer's chord: ⌘/Ctrl+Shift+Enter pops it out to a page, ⌘/Ctrl+Shift+S
 * splits it. They belong to the page, so typing in a field, an editor or a
 * terminal (the dock's included, ADR 0005) never fires them.
 */
export function drawerChord(e: KeyboardEvent): "pop-out" | "split" | null {
  if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return null;
  if ((e.target as Element | null)?.closest?.(TYPING)) return null;
  if (e.key === "Enter") return "pop-out";
  if (e.key === "S") return "split";
  return null;
}
