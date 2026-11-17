/**
 * Several desktop windows are served from one origin, so they share one
 * localStorage. Appearance (theme, font, density) is meant to be shared, but a
 * window only reads it at start-up, so the others would stay as they were until
 * reloaded. The browser fires a `storage` event in every OTHER window when one
 * changes a key; this turns those into a callback.
 *
 * Everything else under `kb.*` is left alone on purpose: the active cluster is
 * per window (sessionStorage), and layout keys such as the terminal dock
 * height are read once when a window starts, so a change in one window never
 * moves another window under the user.
 */
export const SHARED_KEYS = ["kb.theme", "kb.fontSize", "kb.fontFamily", "kb.density"] as const;

export type SharedKey = (typeof SHARED_KEYS)[number];

/** Calls `handler` when another window changes a shared appearance key; returns a function that stops listening. */
export function onSharedPrefChange(handler: (key: SharedKey, value: string) => void): () => void {
  const listener = (e: StorageEvent) => {
    if (e.key === null || e.newValue === null) return;
    if (!(SHARED_KEYS as readonly string[]).includes(e.key)) return;
    handler(e.key as SharedKey, e.newValue);
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}
