import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { shipMinified } from "./build/shipMinified";

export default defineConfig({
  // Monaco is bundled rather than fetched from a CDN (lib/monaco.tsx); its
  // worker is a separate build, so it gets the plugin too.
  plugins: [react(), shipMinified("monaco-editor")],
  worker: {
    format: "es",
    plugins: () => [shipMinified("monaco-editor")],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:9898", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:9898", ws: true },
    },
  },
  build: {
    sourcemap: true,
    minify: false,
    rollupOptions: {
      output: {
        // Monaco in a chunk of its own, so shipMinified can tell it apart.
        manualChunks: (id) => (id.includes("/node_modules/monaco-editor/") ? "monaco-editor" : undefined),
      },
    },
  },
});
