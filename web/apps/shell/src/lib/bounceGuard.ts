// macOS WKWebView bounces the whole window on an elastic scroll. CSS
// `overscroll-behavior: none` (app.css, on html, body and #root) stops it on
// Safari 16 and later. Older WebKit (macOS 10.15's Safari 15) needs a wheel
// listener that cancels the gesture when nothing under the pointer can scroll.
// It must not be installed where the CSS works: a listener that can cancel a
// wheel makes WebKit wait for the main thread before every scroll (root #23).

/** Installs the wheel fallback on `doc` only when CSS can't stop the bounce. Says whether it did. */
export function installBounceGuard(
  doc: Document,
  cssStopsBounce: () => boolean = () => typeof CSS !== "undefined" && CSS.supports("overscroll-behavior", "none"),
): boolean {
  if (cssStopsBounce()) return false;
  doc.addEventListener(
    "wheel",
    (e) => {
      // Walk up from the event target. If we find a scrollable element that still
      // has room to scroll in the direction of the gesture, let it scroll normally.
      let el = e.target as HTMLElement | null;
      while (el && el !== doc.documentElement) {
        const oy = window.getComputedStyle(el).overflowY;
        if (oy === "scroll" || oy === "auto") {
          const canUp = el.scrollTop > 0;
          const canDown = el.scrollTop + el.clientHeight < el.scrollHeight;
          if ((e.deltaY < 0 && canUp) || (e.deltaY > 0 && canDown)) return;
        }
        el = el.parentElement;
      }
      // No scrollable element consumed the event — block the native window bounce.
      e.preventDefault();
    },
    { passive: false },
  );
  return true;
}
