import { useEffect } from "react";
import { create } from "zustand";
import type { QueryClient } from "@tanstack/react-query";

// ⌘R / Ctrl+R: refresh everything on screen without reloading the window.
// REST data is refetched (inactive queries are only marked stale, so this
// costs one round of the queries the user can see) and every live stream
// re-subscribes. Streams keep their last rows until the fresh list syncs, so
// nothing flashes to a skeleton. A cooldown stops a held key from flooding
// the cluster.

export const REFRESH_COOLDOWN_MS = 1000;

export const useRefreshEpoch = create<{ epoch: number }>(() => ({ epoch: 0 }));

let lastAt = -Infinity;

export function _resetRefreshForTests(): void {
  lastAt = -Infinity;
}

/** Refetches every query and re-subscribes every stream. False while cooling down. */
export function refreshAll(qc: QueryClient): boolean {
  const now = Date.now();
  if (now - lastAt < REFRESH_COOLDOWN_MS) return false;
  lastAt = now;
  void qc.invalidateQueries().catch(() => {
    // Each query shows its own error state; nothing to add here.
  });
  useRefreshEpoch.setState((s) => ({ epoch: s.epoch + 1 }));
  return true;
}

export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** ⌘R on a Mac, Ctrl+R elsewhere. Shift is left to the browser's hard reload, and
 *  Ctrl+R typed in a terminal stays the shell's history search. */
export function isRefreshShortcut(e: KeyboardEvent, mac: boolean = IS_MAC): boolean {
  if (e.key.toLowerCase() !== "r" || e.shiftKey || e.altKey) return false;
  if (mac) return e.metaKey && !e.ctrlKey;
  if (!e.ctrlKey || e.metaKey) return false;
  const t = e.target;
  return !(t instanceof Element && t.closest(".xterm"));
}

export function useRefreshShortcut(qc: QueryClient): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!isRefreshShortcut(e)) return;
      e.preventDefault();
      refreshAll(qc);
    }
    // Capture, so an editor or terminal that stops the event can't turn ⌘R
    // back into a full window reload.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [qc]);
}
