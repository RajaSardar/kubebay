import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Kbd, NavItem, StatusPill } from "@kubebay/ui";
import { IconTerminal } from "@kubebay/ui/src/icons";
import { settingsApi } from "../lib/api";
import { bindingLooksProduction } from "../lib/localshell";
import { dockKeyAction, isDockToggle, useTerminalDock } from "../lib/terminalDock";

// ADR 0005: the ways into the terminal dock. None of them navigates.

/** Where the shell sits in the dock: focus there means "in the shell". */
const IN_SHELL = ".kb-dock .kb-dock-term";

/** Opens the dock with its shell focused, or closes it. */
function toggleDock() {
  const { open, openDock, closeDock } = useTerminalDock.getState();
  if (open) closeDock();
  else openDock({ focus: true });
}

/** The status bar's Terminal toggle, with the live shell's context. Hidden without a local shell. */
export function DockToggle() {
  const settings = useQuery({ queryKey: ["settings"], queryFn: settingsApi.get });
  const open = useTerminalDock((s) => s.open);
  const binding = useTerminalDock((s) => s.binding);
  const phase = useTerminalDock((s) => s.phase);
  if (!settings.data?.localShell?.available) return null;
  const live = binding && (phase?.at === "connecting" || phase?.at === "live");
  return (
    <span className="statusbar-dock">
      <Button variant="ghost" size="sm" aria-pressed={open} onClick={toggleDock}>
        Terminal <Kbd>Ctrl `</Kbd>
      </Button>
      {live && (
        <>
          <span className="mono">{binding.context}</span>
          {bindingLooksProduction(binding) && <StatusPill tone="err">production</StatusPill>}
        </>
      )}
    </span>
  );
}

/** Tools → Terminal in the sidebar: opens the dock and focuses its shell, staying on the page. */
export function SidebarTerminal() {
  const open = useTerminalDock((s) => s.open);
  return (
    <NavItem label="Terminal" icon={<IconTerminal />} active={open} onClick={() => useTerminalDock.getState().openDock({ focus: true })} />
  );
}

/**
 * Ctrl+` from anywhere, the shell included: opens the dock and focuses its
 * shell, focuses the shell of an open dock, or closes it from inside the
 * shell. Caught before anything else sees it, so it never reaches the page or
 * the shell.
 */
export function useDockShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isDockToggle(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const { open, openDock, closeDock } = useTerminalDock.getState();
      const focusInShell = !!(document.activeElement as Element | null)?.closest(IN_SHELL);
      const action = dockKeyAction({ open, focusInShell });
      if (action === "close") closeDock();
      else openDock({ focus: true });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}

/** How far above the window's bottom edge the open dock begins, so drawers end there; 0 while it's closed. */
export function useDockInset(ref: RefObject<HTMLElement | null>, open: boolean, height: number): number {
  const [bottom, setBottom] = useState(0);
  useLayoutEffect(() => {
    if (!open) {
      setBottom(0);
      return;
    }
    const measure = () => {
      const el = ref.current;
      setBottom(el ? Math.max(0, Math.round(window.innerHeight - el.getBoundingClientRect().top)) : 0);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [ref, open, height]);
  return bottom;
}
