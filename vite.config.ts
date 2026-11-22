import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Local dev proxy for the optional Worker mode. The same handler logic lives
// in worker/src/index.ts; this proxy only exists so `npm run dev` works
// without a Cloudflare login.
export default defineConfig({
  // GitHub Pages serves a project site at /<repo>/; Cloudflare Pages at /.
  // Set VITE_BASE=/niyvaru/ when building for GitHub Pages.
  base: process.env.VITE_BASE || "/",
  plugins: [react()],
  optimizeDeps: {
    exclude: ["maplibre-gl"],
  },
  // maplibre's worker is an ES module that imports its shared chunk
  worker: {
    format: "es",
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.NIYVARU_API_TARGET || "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    // Mobile-first: the map engine, the agent and the search engine are
    // separate lazy chunks — the welcome screen ships without them.
    rollupOptions: {
      output: {
        manualChunks: {
          maplibre: ["maplibre-gl", "pmtiles"],
          agent: ["ai", "@ai-sdk/react", "@ai-sdk/openai-compatible"],
          search: ["@orama/orama"],
        },
      },
    },
  },
});
