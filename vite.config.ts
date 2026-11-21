import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Local dev proxy for the AI worker. The same handler logic lives in
// worker/src/index.ts and is deployed to Cloudflare; this plugin only exists
// so `npm run dev` works without a Cloudflare login.
export default defineConfig({
  // GitHub Pages serves a project site at /<repo>/, Cloudflare Pages at /.
  // Set VITE_BASE=/niyvaru/ when building for GitHub Pages.
  base: process.env.VITE_BASE || "/",
  plugins: [react()],
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
  },
});
