import "@fontsource/roboto/300.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./lib/theme";
import "./lib/display";
import App from "./App";
import { TokenGate } from "./components/TokenGate";
import "./app.css";

// WKWebView height fix: set --app-h to exact pixel height so layout never relies on
// unreliable 100vh/100% chain in Tauri's WebView renderer.
function syncAppHeight() {
  document.documentElement.style.setProperty("--app-h", `${window.innerHeight}px`);
}
syncAppHeight();
window.addEventListener("resize", syncAppHeight);

// Belt-and-suspenders bounce suppression for macOS WKWebView.
// CSS overscroll-behavior stops DOM chaining; this wheel handler catches any
// remaining native-level elastic scroll the CSS layer misses (e.g. two-finger
// drag when no inner element is scrollable or has already hit its boundary).
document.addEventListener(
  "wheel",
  (e) => {
    // Walk up from the event target. If we find a scrollable element that still
    // has room to scroll in the direction of the gesture, let it scroll normally.
    let el = e.target as HTMLElement | null;
    while (el && el !== document.documentElement) {
      const style = window.getComputedStyle(el);
      const oy = style.overflowY;
      if (oy === "scroll" || oy === "auto") {
        const canUp   = el.scrollTop > 0;
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

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchInterval: 30_000,
      // Show cached data immediately on context switch; background-refetch only when stale.
      // Without staleTime the default is 0 — every focus/mount triggers a refetch even for
      // data fetched a second ago, causing a loading flash when switching clusters.
      staleTime: 30_000,
      // Keep inactive query data in memory for 10 minutes so switching back to a previously-
      // viewed context restores the cache instantly without a network round-trip.
      gcTime: 10 * 60_000,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <TokenGate>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </TokenGate>
    </QueryClientProvider>
  </StrictMode>,
);
