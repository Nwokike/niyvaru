# Mobile support: research and recommendation

This document records the research done on 2026-11-21 so nobody has to
re-litigate it. The short answer: **Tauri can package this app, but it is not
the right first move for mobile, and it does not solve on-device AI.**

## The options compared

| Option | Effort from this repo | Store distribution | WebGL constraints | On-device AI | Desktop |
|---|---|---|---|---|---|
| PWA (manifest + service worker) | days | none; install from browser | browser APIs | needs a browser model | no |
| Capacitor | low | yes | same system webview | same problem | no |
| Tauri v2 | medium | yes | same system webview | desktop sidecar yes, mobile doubtful | yes |
| React Native | high (rewrite UI/map) | yes | native map renderer | native modules | no |

## What transfers to Tauri unchanged

The whole `src/` tree, the packs, the memory format, the agent and the Worker
client. Tauri consumes a Vite build. You would add a native shell, plugins,
capabilities/permission files and a CSP, plus a small platform adapter because
Android bundled resources appear as `asset://localhost/` URIs rather than real
paths (Tauri resource docs).

## Hard constraints found

1. **WebGL2 is mandatory in MapLibre v6.** The official v5→v6 migration guide
   says WebGL1 support was removed; a device without WebGL2 fails to render.
   Tauri uses the system webview: Android WebView depends on the device's
   provider, and iOS WKWebView uses the system WebKit (WebGL2 since Safari 15).
   There are documented WebGL context-loss reports on iOS WebViews. Test on
   real devices; emulators are not proof. Pinning MapLibre v5 is a fallback.
2. **App stores are not free.** Tauri is free, but iOS needs the Apple Developer
   Program ($99/year), macOS, Xcode and code signing; Google Play is $25 once.
   iOS cannot be built from Linux. This conflicts with the project's $0 rule.
   Side-loading Android is free but not a product channel.
3. **Local AI on a phone is a separate project.** Tauri sidecars work on
   desktop but are unreliable on mobile: issue #9774 reports a bundled sidecar
   not found on Android; iOS generally disallows executing arbitrary bundled
   binaries. Kiri Runtime (Python/numpy) and Kiri Router (Node on localhost)
   do not fit a phone as-is. The Tauri updater plugin is desktop-only too.
4. **Review risk.** Apple Guideline 4.2 rejects apps that are essentially a
   website in a WebView. This app has offline packs, native plugins and a real
   utility, which is a defensible case, but the native behaviour must be
   visible, not just a wrapped URL.
5. **CSP and remote hosts.** A Tauri shell must explicitly allow
   `tiles.openfreemap.org`, `panoramax.openstreetmap.fr`, `api.kiri.ng` and the
   deployed Worker in `app.security.csp`/capabilities. The gateway secret must
   stay on the server, never in the binary.

Capacitor and Tauri share the same webview constraints. Tauri's real advantages
are the Rust backend, smaller binary, desktop target and desktop sidecars.
Capacitor is the lower-effort mobile-first path from this exact codebase
(`npm i @capacitor/core @capacitor/ios @capacitor/android`, `npx cap add ios`,
`npx cap add android`, `npx cap sync`).

## Recommendation

1. **Now:** keep the web app canonical and add a PWA manifest + service worker.
   Installable on phones, $0, no toolchain, validates real mobile usage.
2. **When stores are required:** choose Capacitor if mobile is the only goal;
   choose Tauri if you also want desktop and a Rust/local-model path.
3. **Before either:** bundle a basemap PMTiles pack for genuine offline use
   (today only POIs/routes/frames are offline), and decide what "local AI"
   means on a phone. Those product decisions dominate the shell choice.

## Sources

- Tauri prerequisites (iOS is macOS-only; Android needs Android Studio/NDK):
  https://tauri.app/start/prerequisites
- Tauri App Store distribution (signing, Apple Developer, IPA upload):
  https://v2.tauri.app/distribute/app-store/
- MapLibre GL JS v5→v6 migration guide ("WebGL2 is now required"):
  https://maplibre.org/maplibre-gl-js/docs/guides/v5-to-v6-migration-guide/
- Tauri webview versions: https://v2.tauri.app/reference/webview-versions/
- Tauri sidecar mobile bug: https://github.com/tauri-apps/tauri/issues/9774
- Tauri WebGL2 support discussion: https://github.com/tauri-apps/tauri/issues/2866
- Capacitor workflow: https://capacitorjs.com/docs/basics/workflow
- Apple App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
