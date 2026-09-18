import "@fontsource/roboto/300.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
