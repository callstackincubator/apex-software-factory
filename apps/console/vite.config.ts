import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The page's build (ADR 0017 §2). Vite's root is this directory; the server serves `dist`. Fonts
 * and charts are bundled and nothing is fetched from the internet at runtime.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // No font or image becomes a `data:` URI: they are files the same server serves.
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    // Recharts is most of the page; it is served from this machine, never over a network.
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    // Development only: the console server answers `/api`. It insists on its own Host and
    // Origin, so the proxy says it is the console itself.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4280",
        changeOrigin: true,
        headers: { origin: "http://127.0.0.1:4280" },
      },
    },
  },
});
