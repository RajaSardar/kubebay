import { useCallback, useEffect, useRef, useState } from "react";
import { useStoredWidth } from "@kubebay/ui";
import { TYPING } from "./tableUx";

const KEY = "kb.sidebar.hidden";

/** The nav's width in px: the --kb-sidebar-w token until you drag its edge (a test keeps the two equal). */
export const SIDEBAR_DEFAULT_W = 210;
export const SIDEBAR_MIN_W = 160;
export const SIDEBAR_MAX_W = 420;
/** Dragging the edge below this collapses the nav instead of squeezing it. */
export const SIDEBAR_COLLAPSE_BELOW = 100;

function load(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Whether the left nav is hidden, remembered across launches. ⌘B / Ctrl+B
 * toggles it (as in VS Code), except while typing in a field, the terminal or
 * an editor. Its width is dragged at its right edge (`SidebarResizer`) and kept too, under
 * kb.sidebar.width. After a toggle, focus moves to the button that is now visible:
 * the rail's "Show sidebar", or the nav's own "Hide sidebar".
 */
export function useSidebar() {
  const [hidden, setHidden] = useState(load);
  const { width, setWidth, reset: resetWidth } = useStoredWidth("kb.sidebar.width", {
    min: SIDEBAR_MIN_W,
    max: SIDEBAR_MAX_W,
    defaultValue: SIDEBAR_DEFAULT_W,
  });
  const hideRef = useRef<HTMLButtonElement>(null);
  const showRef = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef(false);
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;

  const set = useCallback((next: boolean) => {
    moveFocus.current = true;
    setHidden(next);
    try {
      if (next) localStorage.setItem(KEY, "1");
      else localStorage.removeItem(KEY);
    } catch {
      /* storage unavailable: keep it for this visit */
    }
  }, []);
  const hide = useCallback(() => set(true), [set]);
  const show = useCallback(() => set(false), [set]);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (hidden ? showRef : hideRef).current?.focus();
  }, [hidden]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "b") return;
      if ((e.target as HTMLElement | null)?.closest?.(TYPING)) return;
      e.preventDefault();
      set(!hiddenRef.current);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [set]);

  return { hidden, hide, show, hideRef, showRef, width, setWidth, resetWidth };
}

export type SidebarState = ReturnType<typeof useSidebar>;
