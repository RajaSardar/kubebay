import { useEffect } from "react";

/**
 * KB-14: the desktop CI smoke run. Launched with KUBEBAY_SMOKE=1, the desktop
 * app sets window.__KUBEBAY_SMOKE__ and exits 0 when the shell reports it has
 * rendered (or 1 if it never does). A no-op everywhere else.
 */
type SmokeWindow = {
  __KUBEBAY_SMOKE__?: boolean;
  __KUBEBAY_SMOKE_SENT__?: boolean;
  __TAURI_INTERNALS__?: { invoke?: (cmd: string, args: unknown) => Promise<unknown> };
};

export function reportSmokeReady(win: Window = window) {
  const w = win as unknown as SmokeWindow;
  if (!w.__KUBEBAY_SMOKE__ || w.__KUBEBAY_SMOKE_SENT__ || !w.__TAURI_INTERNALS__?.invoke) return;
  w.__KUBEBAY_SMOKE_SENT__ = true;
  w.__TAURI_INTERNALS__.invoke("smoke_ready", {}).catch(() => {});
}

/** Reports once the component using it has painted: two frames after its first commit. */
export function useSmokeReady() {
  useEffect(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => reportSmokeReady()));
  }, []);
}
