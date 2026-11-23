# Mobile support

The browser app is canonical and already mobile-shaped: responsive layout, touch-friendly controls, `viewport-fit=cover`, reduced-motion handling, installable PWA manifest and an offline shell. This document records what that covers and what a native shell would add.

## PWA shell (shipped)

- `public/manifest.webmanifest`: standalone display, portrait orientation, theme colour, SVG maskable icon and favicon.
- `public/sw.js`: precaches `./`, `./index.html`, the manifest, the icon and `areas.json`; navigation is network-first with a shell fallback, same-origin assets are stale-while-revalidate, and cross-origin tiles/APIs are left to HTTP caching.
- `src/main.tsx`: registers the worker at `import.meta.env.BASE_URL + "sw.js"` on `load`; offline failure is non-fatal. A `vite:preloadError` listener reloads once after a deploy replaces hashed lazy chunks.
- `src/sources/cache.ts`: IndexedDB holds area packs, TTL caches, memory files, archive and the chat window. `requestPersistence()` asks the browser to keep that storage across pressure eviction.
- `src/ui/MemoryPanel.tsx`: surfaces the `beforeinstallprompt` event as an Install button and shows whether persistent storage was granted.

This means the shell and previously assembled areas open without a network. Map tiles and live pulse sources need a connection.

On coarse-pointer devices reporting under 6 GB of memory, `src/map/mapView.ts` caps the POI set at 600 and `src/map/style.ts` skips terrain and building extrusion while keeping the hour-driven palette and all brand colours. The map stays readable and interactive without the expensive 3D work.

## Native-shell options

| Option | Effort from this repo | Store distribution | WebGL | On-device AI | Desktop |
|---|---|---|---|---|---|
| PWA (current) | days, already done | none; install from browser | system browser | browser model only | no |
| Capacitor | low | yes | system webview | same constraint | no |
| Tauri v2 | medium | yes | system webview | desktop sidecar; mobile unreliable | yes |
| React Native | high (UI and map rewrite) | yes | native map renderer | native modules | no |

The whole `src/` tree, the IndexedDB schema, the agent and the Worker client transfer to Capacitor or Tauri unchanged: both consume a Vite build. A native shell adds plugins, permission/capability files and a CSP, plus a platform adapter for bundled resources (for example Tauri's `asset://localhost/` on Android).

## Hard constraints

1. **MapLibre v6 requires WebGL2.** Android WebView depends on the device's provider; iOS WKWebView has WebGL2 since Safari 15 but has documented context-loss cases. Test on real devices — emulators are not proof. Pinning MapLibre v5 is the fallback if a target device cannot provide WebGL2.
2. **Stores are not free.** Tauri itself is free, but iOS needs the Apple Developer Program ($99/year), macOS, Xcode and signing; Google Play is $25 once. iOS cannot be built from Linux. This conflicts with the project's $0 rule; sideloading Android is not a product channel.
3. **Local AI on a phone is a separate product.** Desktop sidecars are not reliable on mobile (Tauri issue #9774 covers a missing bundled sidecar on Android), and iOS generally disallows executing bundled binaries. Inference here currently goes to the Kiri Gateway from the browser.
4. **Review risk.** Apple Guideline 4.2 rejects apps that are essentially a website in a WebView. Installable offline areas, local memory and a real walk utility are the defensible native behaviours; they must be visible, not just a wrapped URL.
5. **CSP and remote hosts.** A native shell must allow `tiles.openfreemap.org`, `s3.amazonaws.com` (Terrarium DEM), Wikimedia, Panoramax/Mapillary, `api.kiri.ng` and any configured Worker. The gateway credential stays the public family key in the bundle; no secret belongs in the binary.

## Practical order

1. Keep the PWA canonical and validate real mobile usage; it is already installable and offline-capable for assembled areas.
2. If stores are required, choose Capacitor for a mobile-only target, or Tauri if desktop and a Rust/local-model path also matter.
3. Decide what "local AI" means on a phone before committing to a shell — that decision dominates the packaging choice.

## Sources

- Tauri prerequisites: https://tauri.app/start/prerequisites
- Tauri App Store distribution: https://v2.tauri.app/distribute/app-store/
- MapLibre GL JS v5→v6 migration guide (WebGL2 required): https://maplibre.org/maplibre-gl-js/docs/guides/v5-to-v6-migration-guide/
- Tauri webview versions: https://v2.tauri.app/reference/webview-versions/
- Tauri sidecar mobile bug: https://github.com/tauri-apps/tauri/issues/9774
- Capacitor workflow: https://capacitorjs.com/docs/basics/workflow
- Apple App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
