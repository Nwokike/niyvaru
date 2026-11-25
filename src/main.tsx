import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@fontsource-variable/playfair-display";
import "@fontsource-variable/cormorant-garamond";
import "@fontsource-variable/dm-sans/opsz.css";
import "@fontsource-variable/noto-sans-arabic";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Stale lazy chunks after a deploy (service worker + hashed files): reload
// once instead of leaving a dead screen. The session guard stops a bad cache
// from looping the reload forever.
window.addEventListener("vite:preloadError", () => {
  try {
    if (sessionStorage.getItem("niyvaru.preloadReloaded") === "1") return;
    sessionStorage.setItem("niyvaru.preloadReloaded", "1");
  } catch {
    /* private mode — still reload */
  }
  window.location.reload();
});

// Offline app shell (area data caches itself in IndexedDB). Production only:
// a dev-mode worker caches source modules and serves stale CSS after edits.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const base = import.meta.env.BASE_URL ?? "/";
    navigator.serviceWorker
      .register(`${base}sw.js`, { updateViaCache: "none" })
      .then((registration) => {
        // A deployed update must reach the traveller on this visit, not the
        // visit after next: when the new worker takes control, reload once.
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state !== "activated") return;
            try {
              if (sessionStorage.getItem("niyvaru.swReloaded") === "1") return;
              sessionStorage.setItem("niyvaru.swReloaded", "1");
            } catch {
              /* private mode */
            }
            window.location.reload();
          });
        });
      })
      .catch(() => {
        /* offline shell is an enhancement */
      });
  });
}
