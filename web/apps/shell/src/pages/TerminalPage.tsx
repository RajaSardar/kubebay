import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { ShellPrefill } from "../lib/useExtensions";
import { useTerminalDock } from "../lib/terminalDock";

// ADR 0005: the terminal lives in the dock. /terminal (a bookmark, an
// extension's command action) opens the dock and goes back to where you were,
// or to the Overview on a link opened cold.

/** A command action's line from the route state (KB-13), if that's what it holds. */
function prefillOf(state: unknown): ShellPrefill | undefined {
  const p = (state as { prefill?: Partial<ShellPrefill> } | null)?.prefill;
  return p && typeof p.cluster === "string" && typeof p.command === "string" && typeof p.label === "string"
    ? { cluster: p.cluster, command: p.command, label: p.label }
    : undefined;
}

export default function TerminalPage() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const prefill = prefillOf(location.state);
    const dock = useTerminalDock.getState();
    if (prefill) {
      // The dock types it into a new shell, or offers it beside a running
      // one; either way the shell isn't focused for you.
      dock.offerPrefill(prefill);
      dock.openDock({ focus: false });
    } else {
      dock.openDock({ focus: true });
    }
    // The first entry of a history has the key "default": a link opened cold.
    if (location.key === "default") navigate("/workloads-overview", { replace: true });
    else navigate(-1);
    // Runs once per visit to /terminal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
