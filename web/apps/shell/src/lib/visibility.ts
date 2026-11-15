/** Whether the page is hidden: the window is minimised, or the app is hidden. */
export function isHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/** Calls `cb` each time the page becomes visible again. Returns the unsubscribe. */
export function onVisible(cb: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  const handler = () => {
    if (document.visibilityState === "visible") cb();
  };
  document.addEventListener("visibilitychange", handler);
  return () => document.removeEventListener("visibilitychange", handler);
}
