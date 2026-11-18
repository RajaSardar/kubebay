import { useEffect } from "react";
import { anyEditDirty } from "./editGuard";

/**
 * Closing or reloading the window with a YAML editor holding unapplied edits
 * asks first (backlog 51 phase 3). The browser build honours `beforeunload`.
 * Whether the Tauri window honours it on close has not been checked in the
 * packaged app; the dirty text is also kept as a draft (editRecovery.ts), so a
 * close that slips through can still offer it back.
 */
export function useUnloadGuard(): void {
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!anyEditDirty()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);
}
