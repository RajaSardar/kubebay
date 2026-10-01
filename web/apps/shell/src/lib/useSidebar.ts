import { useCallback, useEffect, useRef, useState } from "react";
import { TYPING } from "./tableUx";

const KEY = "kb.sidebar.hidden";

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
 * an editor. After a toggle, focus moves to the button that is now visible:
 * the rail's "Show sidebar", or the nav's own "Hide sidebar".
 */
export function useSidebar() {
  const [hidden, setHidden] = useState(load);
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

  return { hidden, hide, show, hideRef, showRef };
}

export type SidebarState = ReturnType<typeof useSidebar>;
