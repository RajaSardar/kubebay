import "@fontsource/roboto/300.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
// Display settings' "JetBrains Mono" font. A browser fetches a face only when
// text uses it, so this costs nothing until someone picks it.
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./lib/theme";
import "./lib/display";
import { createQueryClient } from "./lib/queryClient";
import { startWindowSync } from "./lib/windowSyncApply";
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

// Other desktop windows share this origin's localStorage: follow their theme, font and density changes.
startWindowSync();

// Window bounce is stopped in CSS (overscroll-behavior on html, body, #root). There is no wheel
// listener: a non-passive one cancelled sideways trackpad scrolling and made every scroll wait on
// the main thread (backlog 90).

const qc = createQueryClient();

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
