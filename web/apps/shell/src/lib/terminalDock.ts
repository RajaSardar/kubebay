import { create } from "zustand";
import type { ShellBinding } from "./localshell";
import type { ShellPhase } from "./shellSession";
import type { ShellPrefill } from "./useExtensions";
import type { GitOpsOwner } from "./gitops";
import { clearDraft } from "./editRecovery";

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

/** An object whose YAML is open as a dock tab (backlog 51). */
export interface EditTab {
  key: string;
  cluster: string;
  gvr: string;
  ns: string;
  name: string;
  gitopsOwner?: GitOpsOwner | null;
  helmRelease?: string | null;
  /** A "New resource" tab (Create Resource in the dock): no object yet, so cluster/gvr/ns/name are empty. */
  isNew?: boolean;
  newKind?: string;
  newYaml?: string;
}

/** The tab id for an object; the same string YamlTab reports to the edit guard. */
export function editTabKey(o: { cluster: string; gvr: string; ns: string; name: string }): string {
  return `${o.cluster}/${o.gvr}/${o.ns}/${o.name}`;
}

/** The row-menu entry that opens an object's YAML as a dock tab. */
export function dockEditItem(o: Omit<EditTab, "key">): { label: string; onClick: () => void } {
  return { label: "Edit in dock", onClick: () => useTerminalDock.getState().openEditTab(o) };
}

/**
 * Backlog 51 phase 5: the tab cap is a budget of editor text, not a count. The
 * open editors hold their text two or three times over (loaded, edited, and
 * Monaco's model), so this is about 2 MB of text: dozens of typical objects or
 * a handful of large CRDs. A rule of thumb, not a measurement.
 */
export const EDIT_TEXT_BUDGET = 2_000_000;
/** What a tab counts for before its text has loaded, and at the least. */
export const MIN_TAB_CHARS = 20_000;

/** The text the open tabs hold, each counted at least MIN_TAB_CHARS. */
export function editTextUsed(tabs: EditTab[], sizes: Record<string, number>): number {
  return tabs.reduce((n, t) => n + Math.max(MIN_TAB_CHARS, sizes[t.key] ?? 0), 0);
}

const CAP_MESSAGE =
  "Not opened: the open editors already hold about as much text as the dock keeps. Close a tab, then open this one again.";

let newTabSeq = 0;

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
  /** YAML editor tabs, in the order opened. Not kept across a relaunch. */
  tabs: EditTab[];
  /** "shell" or an edit tab's key. */
  activeTab: string;
  /** Characters of text each edit tab holds, as its editor reports them. */
  sizes: Record<string, number>;
  /** Why a tab was not opened (the text budget), until dismissed or a tab closes. */
  capMessage: string | null;
  reportSize(key: string, chars: number): void;
  dismissCapMessage(): void;
  /** Open a "New resource" tab (Create Resource in the dock), optionally on a kind or carrying text. */
  openNewTab(o: { kind?: string; yaml?: string }): void;
  /** The dock fills the page's height (backlog 51). Not kept across a relaunch. */
  maximized: boolean;
  toggleMaximized(): void;
  /** Move to the next (1) or previous (-1) tab, Shell first, wrapping. */
  cycleTab(step: 1 | -1): void;
  /** Open (or focus, if already open) the editor tab for an object, and show the dock. */
  openEditTab(o: Omit<EditTab, "key">): void;
  closeEditTab(key: string): void;
  focusTab(key: string): void;
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
  tabs: [],
  activeTab: "shell",
  sizes: {},
  capMessage: null,
  reportSize(key, chars) {
    if (get().sizes[key] !== chars) set({ sizes: { ...get().sizes, [key]: chars } });
  },
  dismissCapMessage() {
    set({ capMessage: null });
  },
  openNewTab({ kind, yaml }) {
    const { tabs, sizes } = get();
    if (editTextUsed(tabs, sizes) >= EDIT_TEXT_BUDGET) {
      set({ capMessage: CAP_MESSAGE });
      get().openDock({ focus: false });
      return;
    }
    const key = `new/${++newTabSeq}`;
    set({
      tabs: [...tabs, { key, cluster: "", gvr: "", ns: "", name: "", isNew: true, newKind: kind, newYaml: yaml }],
      activeTab: key,
      capMessage: null,
    });
    get().openDock({ focus: false });
  },
  maximized: false,
  toggleMaximized() {
    set({ maximized: !get().maximized });
  },
  cycleTab(step) {
    const ids = ["shell", ...get().tabs.map((t) => t.key)];
    const at = Math.max(0, ids.indexOf(get().activeTab));
    set({ activeTab: ids[(at + step + ids.length) % ids.length] ?? "shell" });
  },
  openEditTab(o) {
    const key = editTabKey(o);
    const { tabs, sizes } = get();
    if (!tabs.some((t) => t.key === key)) {
      if (editTextUsed(tabs, sizes) >= EDIT_TEXT_BUDGET) {
        set({ capMessage: CAP_MESSAGE });
        get().openDock({ focus: false });
        return;
      }
      set({ tabs: [...tabs, { ...o, key }], capMessage: null });
    }
    set({ activeTab: key });
    get().openDock({ focus: false });
  },
  closeEditTab(key) {
    const { tabs, activeTab, sizes } = get();
    const rest = { ...sizes };
    delete rest[key];
    clearDraft(key);
    set({ tabs: tabs.filter((t) => t.key !== key), activeTab: activeTab === key ? "shell" : activeTab, sizes: rest, capMessage: null });
  },
  focusTab(key) {
    set({ activeTab: key });
  },
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
