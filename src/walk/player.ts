/**
 * Walk player — the signature experience.
 * Real street photographs anchored along the real route, crossfaded on the
 * GPU with a preload window; a camera flythrough when imagery is sparse; a
 * photo strip when the traveller prefers reduced motion. Distance and
 * progress always come from the route, never invented.
 */
import type { MapApi } from "../map/mapView";
import type { AnchoredFrame, } from "./matcher";
import type { WalkRoute } from "../sources/types";

export interface WalkHandle {
  stop: () => void;
}

export interface WalkLabels {
  stop: string;
  realFrames: (n: number) => string;
  routeOnly: string;
}

export interface WalkOptions {
  map: MapApi;
  route: WalkRoute;
  frames: AnchoredFrame[];
  reducedMotion: boolean;
  labels: WalkLabels;
  onEnd: () => void;
}

const DEMO_SECONDS_MIN = 45;
const DEMO_SECONDS_MAX = 150;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

function buildOverlay(route: WalkRoute, labels: WalkLabels, frameCount: number, reducedMotion: boolean): {
  root: HTMLDivElement;
  layerA: HTMLImageElement;
  layerB: HTMLImageElement;
  distEl: HTMLElement;
  barEl: HTMLElement;
  noteEl: HTMLElement;
  strip?: HTMLDivElement;
} {
  const root = document.createElement("div");
  root.className = "walk-overlay";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", route.name);

  const media = document.createElement("div");
  media.className = "walk-media";
  const layerA = document.createElement("img");
  const layerB = document.createElement("img");
  layerA.alt = "";
  layerB.alt = "";
  layerA.style.opacity = "0";
  layerB.style.opacity = "0";
  media.append(layerA, layerB, Object.assign(document.createElement("div"), { className: "walk-scrim" }));

  const hud = document.createElement("div");
  hud.className = "walk-hud";
  hud.innerHTML = `
    <div class="eyebrow">Niyvaru walk</div>
    <div class="walk-title">${escapeHtml(route.name)}</div>
    <div class="walk-meta">
      <span class="walk-dist">0 m ${labelsOf(route, labels)}</span>
      <span class="walk-eta"></span>
    </div>
    <div class="walk-bar"><i></i></div>
    <div class="walk-note">${frameCount >= 2 ? labels.realFrames(frameCount) : labels.routeOnly}</div>`;
  const stopBtn = document.createElement("button");
  stopBtn.className = "walk-stop";
  stopBtn.type = "button";
  stopBtn.textContent = labels.stop;
  root.append(media, stopBtn, hud);

  let strip: HTMLDivElement | undefined;
  if (reducedMotion && frameCount >= 2) {
    strip = document.createElement("div");
    strip.className = "walk-strip";
    root.querySelector(".walk-media")?.replaceWith(strip);
  }

  document.body.appendChild(root);
  return {
    root,
    layerA,
    layerB,
    distEl: hud.querySelector(".walk-dist") as HTMLElement,
    barEl: hud.querySelector(".walk-bar i") as HTMLElement,
    noteEl: hud.querySelector(".walk-note") as HTMLElement,
    strip,
  };
}

function labelsOf(route: WalkRoute, labels: WalkLabels): string {
  void labels;
  return `of ${route.distanceM} m`;
}

function preload(src: string): void {
  const img = new Image();
  img.src = src;
}

export function startWalk(options: WalkOptions): WalkHandle {
  const { map, route, frames, reducedMotion, labels, onEnd } = options;
  const demoSeconds = Math.min(DEMO_SECONDS_MAX, Math.max(DEMO_SECONDS_MIN, route.distanceM / 60));
  const ui = buildOverlay(route, labels, frames.length, reducedMotion);

  let stopped = false;
  let raf = 0;
  const start = performance.now();
  let active = ui.layerA;
  let standby = ui.layerB;
  let loadedIndex = -1;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    ui.root.remove();
    onEnd();
  };
  (ui.root.querySelector(".walk-stop") as HTMLButtonElement).addEventListener("click", stop);

  // — Reduced motion: a scrolleable photo strip in route order —
  if (ui.strip) {
    for (const frame of frames) {
      const img = document.createElement("img");
      img.src = frame.thumbUrl;
      img.alt = `street view, heading ${Math.round(frame.heading)}°`;
      img.loading = "lazy";
      ui.strip.appendChild(img);
    }
    return { stop };
  }

  // — Sparse coverage: fly the camera along the real route —
  if (frames.length < 2) {
    const coords = route.coordinates;
    const tick = (): void => {
      if (stopped) return;
      const elapsed = (performance.now() - start) / 1000;
      const t = Math.min(1, elapsed / demoSeconds);
      const idx = Math.min(coords.length - 1, Math.floor(t * (coords.length - 1)));
      const [lon, lat] = coords[idx];
      map.map.jumpTo({ center: [lon, lat], zoom: 17.6, pitch: 62, bearing: -12 + 24 * Math.sin(t * Math.PI) });
      ui.distEl.textContent = `${Math.round(route.distanceM * t)} m of ${route.distanceM} m`;
      ui.barEl.style.width = `${Math.round(t * 100)}%`;
      if (t >= 1) return stop();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return { stop };
  }

  // — Full playback: crossfaded real photographs along the walked distance —
  let lastFrameIdx = -1;
  const tick = (): void => {
    if (stopped) return;
    const elapsed = (performance.now() - start) / 1000;
    const t = Math.min(1, elapsed / demoSeconds);
    const walkedM = route.distanceM * t;

    let frameIdx = 0;
    for (let i = 0; i < frames.length; i++) {
      if (frames[i].alongM <= walkedM) frameIdx = i;
      else break;
    }

    if (frameIdx !== lastFrameIdx) {
      const nextFrame = frames[frameIdx];
      const incoming = standby;
      incoming.src = nextFrame.url;
      const swap = (): void => {
        incoming.style.opacity = "1";
        active.style.opacity = "0";
        const swapTmp = active;
        active = incoming;
        standby = swapTmp;
      };
      if (incoming.complete) swap();
      else incoming.onload = swap;
      preload(frames[Math.min(frames.length - 1, frameIdx + 2)]?.url ?? "");
      lastFrameIdx = frameIdx;
    }

    ui.distEl.textContent = `${Math.round(walkedM)} m of ${route.distanceM} m`;
    ui.barEl.style.width = `${Math.round(t * 100)}%`;
    if (t >= 1) return stop();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  void loadedIndex;
  return { stop };
}
