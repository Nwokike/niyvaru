import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@fontsource-variable/playfair-display";
import "@fontsource-variable/cormorant-garamond";
import "@fontsource-variable/dm-sans/opsz.css";
import "@fontsource-variable/noto-sans-arabic";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Stale lazy chunks after a deploy (service worker + hashed files): reload
// once instead of leaving a dead screen.
window.addEventListener("vite:preloadError", () => {
  window.location.reload();
});

// Offline app shell (area data caches itself in IndexedDB)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const base = import.meta.env.BASE_URL ?? "/";
    navigator.serviceWorker.register(`${base}sw.js`).catch(() => {
      /* offline shell is an enhancement */
    });
  });
}
