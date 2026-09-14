import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./lib/theme";
import "./lib/display";
import App from "./App";
import "./app.css";

// WKWebView height fix: set --app-h to exact pixel height so layout never relies on
// unreliable 100vh/100% chain in Tauri's WebView renderer.
function syncAppHeight() {
  document.documentElement.style.setProperty("--app-h", `${window.innerHeight}px`);
}
syncAppHeight();
window.addEventListener("resize", syncAppHeight);

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchInterval: 30_000 } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
