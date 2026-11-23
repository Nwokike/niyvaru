import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * MapLibre v6 derives its worker URL from import.meta.url at runtime
 * (`./maplibre-gl-worker.mjs`). Vite never copies that file into dist because
 * the reference is dynamic — the worker 404s on every static deployment.
 * Copy it beside the built maplibre chunk so the relative URL resolves.
 */
function maplibreWorker() {
  return {
    name: "copy-maplibre-worker",
    closeBundle() {
      const from = resolve("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs");
      const toDir = resolve("dist/assets");
      if (existsSync(from)) {
        mkdirSync(toDir, { recursive: true });
        copyFileSync(from, resolve(toDir, "maplibre-gl-worker.mjs"));
      }
    },
  };
}

// Local dev proxy for the optional Worker mode. The same handler logic lives
// in worker/src/index.ts; this proxy only exists so `npm run dev` works
// without a Cloudflare login.
export default defineConfig({
  // GitHub Pages serves a project site at /<repo>/; Cloudflare Pages at /.
  // Set VITE_BASE=/niyvaru/ when building for GitHub Pages.
  base: process.env.VITE_BASE || "/",
  plugins: [react(), maplibreWorker()],
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
    // Do not inject eager modulepreloads for lazy chunks: the agent must not
    // cost first paint, and map/search chunks are loaded on demand.
    modulePreload: { resolveDependencies: () => [] },
    // Mobile-first: the map engine, the agent and the search engine are
    // separate lazy chunks — the welcome screen ships without them.
    rollupOptions: {
      output: {
        manualChunks: {
          maplibre: ["maplibre-gl"],
          agent: ["ai", "@ai-sdk/react", "@ai-sdk/openai-compatible"],
          search: ["@orama/orama"],
        },
      },
    },
  },
});
