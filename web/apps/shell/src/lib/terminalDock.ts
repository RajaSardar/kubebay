import { create } from "zustand";
import type { ShellBinding } from "./localshell";
import type { ShellPhase } from "./shellSession";
import type { ShellPrefill } from "./useExtensions";

// ADR 0005: the terminal dock's state. It imports no xterm, so the app shell,
// the status bar and the sidebar can read it without loading a terminal. The
// height is kept on this machine; whether the dock is open, and the shell,
// are not: a relaunch starts closed, with no terminal built and nothing sent.

export const DOCK_HEIGHT_KEY = "kb.dock.height";

/** How tall the dock may be in a window this tall, and where it starts. */
export function dockBounds(windowHeight: number): { min: number; max: number; initial: number } {
  const min = 120;
  return {
    min,
    max: Math.max(min, windowHeight - 240),
    initial: Math.max(min, Math.min(300, Math.round(windowHeight * 0.35))),
  };
}

function clampHeight(h: number, windowHeight: number): number {
  const { min, max } = dockBounds(windowHeight);
  return Math.max(min, Math.min(max, Math.round(h)));
}

/** The kept height, held to this window; the default when nothing usable is kept. */
export function readDockHeight(windowHeight: number): number {
  let kept = NaN;
  try {
    kept = Number(localStorage.getItem(DOCK_HEIGHT_KEY) ?? NaN);
  } catch {
    // Storage blocked: start from the default.
  }
  return Number.isFinite(kept) && kept > 0 ? clampHeight(kept, windowHeight) : dockBounds(windowHeight).initial;
}

/**
 * What Ctrl+` does: open a closed dock (and focus the shell), focus the shell
 * of an open one, or close it when focus is already in the shell.
 */
export function dockKeyAction(at: { open: boolean; focusInShell: boolean }): "open" | "focus" | "close" {
  if (!at.open) return "open";
  return at.focusInShell ? "close" : "focus";
}

/** Ctrl+` (by the key's position, so any layout; Ctrl on every OS, never ⌘). */
export function isDockToggle(e: KeyboardEvent): boolean {
  return e.code === "Backquote" && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
}

/**
 * Keys the shell must not take: the dock's toggle, and the drawer chords
 * Ctrl/⌘+Shift+S and Ctrl/⌘+Shift+Enter (xterm sends a CR for Enter with
 * any modifier, so ⌘⇧Enter would run the line). Every other key, Ctrl+K,
 * Ctrl+W, Esc and Tab included, belongs to the shell.
 */
export function isShellReservedKey(e: KeyboardEvent): boolean {
  if (isDockToggle(e)) return true;
  const chord = (e.ctrlKey || e.metaKey) && e.shiftKey;
  return chord && (e.key.toLowerCase() === "s" || e.key === "Enter");
}

const windowHeight = () => (typeof window === "undefined" ? 800 : window.innerHeight);

interface DockState {
  open: boolean;
  height: number;
  /** The context the live shell is bound to, or null with no shell. */
  binding: ShellBinding | null;
  phase: ShellPhase | null;
  /** A command from an extension, waiting to be typed or copied. */
  prefill: ShellPrefill | null;
  /** Set to ask the dock to focus its shell; nothing else focuses it. The
   *  shell clears it once it has focus. */
  wantFocus: boolean;
  /** The first shell of a run opens by itself (not on production); once
   *  you've ended one, the next waits for you. */
  autoOpen: boolean;
  openDock(opts: { focus: boolean }): void;
  closeDock(): void;
  focusDone(): void;
  setHeight(h: number): void;
  setShell(binding: ShellBinding | null, phase: ShellPhase | null): void;
  /** You ended the shell: forget it, and don't open the next by itself. */
  shellEnded(): void;
  offerPrefill(p: ShellPrefill): void;
  clearPrefill(): void;
}

// Where focus was before the shell took it, so closing the dock gives it back.
let returnFocus: HTMLElement | null = null;

export const useTerminalDock = create<DockState>()((set, get) => ({
  open: false,
  height: readDockHeight(windowHeight()),
  binding: null,
  phase: null,
  prefill: null,
  wantFocus: false,
  autoOpen: true,
  openDock({ focus }) {
    if (focus) {
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body && !active.closest(".kb-dock")) returnFocus = active;
    }
    set({ open: true, wantFocus: focus || get().wantFocus });
  },
  closeDock() {
    set({ open: false, wantFocus: false });
    const back = returnFocus;
    returnFocus = null;
    if (back && document.contains(back)) back.focus();
  },
  focusDone() {
    set({ wantFocus: false });
  },
  setHeight(h) {
    const height = clampHeight(h, windowHeight());
    set({ height });
    try {
      localStorage.setItem(DOCK_HEIGHT_KEY, String(height));
    } catch {
      // Storage blocked: the height lasts until the app closes.
    }
  },
  setShell(binding, phase) {
    set({ binding, phase });
  },
  shellEnded() {
    set({ binding: null, phase: null, autoOpen: false });
  },
  offerPrefill(p) {
    set({ prefill: p });
  },
  clearPrefill() {
    set({ prefill: null });
  },
}));
