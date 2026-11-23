/**
 * Walk player — the signature experience.
 * Real street photographs anchored along the real route, crossfaded on the
 * GPU with a preload window; a smooth 3D camera glide along the same route
 * when imagery is sparse; a compact photo strip for reduced motion. The map
 * stays visible in every mode. Distance and progress always come from the
 * route, never invented.
 */
import type { MapApi } from "../map/mapView";
import type { AnchoredFrame } from "./matcher";
import type { WalkRoute } from "../sources/types";

export interface WalkHandle {
  stop: () => void;
}

export interface WalkLabels {
  eyebrow: string;
  stop: string;
  pause: string;
  resume: string;
  eta: (minutes: number) => string;
  of: string;
  streetFrame: (heading: number) => string;
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

interface WalkUi {
  root: HTMLDivElement;
  layerA: HTMLImageElement;
  layerB: HTMLImageElement;
  distEl: HTMLElement;
  etaEl: HTMLElement;
  barEl: HTMLElement;
  noteEl: HTMLElement;
  pauseBtn: HTMLButtonElement;
  strip?: HTMLDivElement;
}

function buildOverlay(route: WalkRoute, labels: WalkLabels, frameCount: number, reducedMotion: boolean): WalkUi {
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
  media.append(layerA, layerB);

  let strip: HTMLDivElement | undefined;
  if (reducedMotion && frameCount >= 2) {
    strip = document.createElement("div");
    strip.className = "walk-strip";
    media.appendChild(strip);
    layerA.style.display = "none";
    layerB.style.display = "none";
  }

  const hud = document.createElement("div");
  hud.className = "walk-hud";
  hud.innerHTML = `
    <div class="eyebrow">${escapeHtml(labels.eyebrow)}</div>
    <div class="walk-title">${escapeHtml(route.name)}</div>
    <div class="walk-meta">
      <span class="walk-dist"></span>
      <span class="walk-eta"></span>
    </div>
    <div class="walk-bar"><i></i></div>
    <div class="walk-note">${frameCount >= 2 ? escapeHtml(labels.realFrames(frameCount)) : escapeHtml(labels.routeOnly)}</div>`;

  const pauseBtn = document.createElement("button");
  pauseBtn.className = "walk-pause";
  pauseBtn.type = "button";
  pauseBtn.textContent = labels.pause;

  const stopBtn = document.createElement("button");
  stopBtn.className = "walk-stop";
  stopBtn.type = "button";
  stopBtn.textContent = labels.stop;

  root.append(media, pauseBtn, stopBtn, hud);
  document.body.appendChild(root);

  if (strip) pauseBtn.style.display = "none";

  return {
    root,
    layerA,
    layerB,
    distEl: hud.querySelector(".walk-dist") as HTMLElement,
    etaEl: hud.querySelector(".walk-eta") as HTMLElement,
    barEl: hud.querySelector(".walk-bar i") as HTMLElement,
    noteEl: hud.querySelector(".walk-note") as HTMLElement,
    pauseBtn,
    strip,
  };
}

type LonLat = [number, number];

function cumulativeDistances(coords: LonLat[]): number[] {
  const out = [0];
  for (let i = 1; i < coords.length; i++) {
    const [lon1, lat1] = coords[i - 1];
    const [lon2, lat2] = coords[i];
    const dLat = (lat2 - lat1) * 111_320;
    const dLon = (lon2 - lon1) * 111_320 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
    out.push(out[i - 1] + Math.hypot(dLat, dLon));
  }
  return out;
}

function sampleRoute(coords: LonLat[], cum: number[], t: number): { center: LonLat; bearing: number } {
  if (coords.length === 0) return { center: [0, 0], bearing: -15 };
  if (coords.length === 1) return { center: coords[0], bearing: -15 };
  const total = cum[cum.length - 1] || 1;
  const target = total * Math.max(0, Math.min(1, t));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < target) i++;
  const a = coords[i - 1];
  const b = coords[i];
  const span = cum[i] - cum[i - 1] || 1;
  const local = Math.max(0, Math.min(1, (target - cum[i - 1]) / span));
  const center: LonLat = [a[0] + (b[0] - a[0]) * local, a[1] + (b[1] - a[1]) * local];
  const ahead = coords[Math.min(coords.length - 1, i + 1)];
  const dLon = ahead[0] - b[0];
  const dLat = ahead[1] - b[1];
  const bearing = dLon === 0 && dLat === 0 ? (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI : (Math.atan2(dLon, dLat) * 180) / Math.PI;
  return { center, bearing };
}

function preload(src: string): void {
  if (!src) return;
  const img = new Image();
  img.src = src;
}

export function startWalk(options: WalkOptions): WalkHandle {
  const { map, route, frames, reducedMotion, labels, onEnd } = options;
  const demoSeconds = Math.min(DEMO_SECONDS_MAX, Math.max(DEMO_SECONDS_MIN, route.distanceM / 60));
  const ui = buildOverlay(route, labels, frames.length, reducedMotion);
  const coords = route.coordinates as LonLat[];
  const cum = cumulativeDistances(coords);
  const narrow = window.innerWidth < 720;
  const walkZoom = narrow ? 15.8 : 17.2;
  const walkPitch = narrow ? 52 : 60;

  let stopped = false;
  let paused = false;
  let pauseStarted = 0;
  let pausedTotal = 0;
  let elapsedBeforePause = 0;
  let raf = 0;
  const startedAt = performance.now();
  let active = ui.layerA;
  let standby = ui.layerB;
  let lastFrameIdx = -1;

  const progress = (now: number): number => {
    const elapsed = paused
      ? elapsedBeforePause
      : (now - startedAt - pausedTotal) / 1000;
    return Math.min(1, elapsed / demoSeconds);
  };

  const updateHud = (t: number): void => {
    const walked = Math.round(route.distanceM * t);
    const minutes = Math.max(1, Math.ceil(((1 - t) * demoSeconds) / 60));
    ui.distEl.textContent = `${walked} m ${labels.of} ${route.distanceM} m`;
    ui.etaEl.textContent = labels.eta(minutes);
    ui.barEl.style.width = `${Math.round(t * 100)}%`;
  };

  const glideCamera = (t: number): void => {
    if (!coords.length) return;
    const sample = sampleRoute(coords, cum, t);
    map.map.jumpTo({ center: sample.center, zoom: walkZoom, pitch: walkPitch, bearing: sample.bearing });
  };

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKey);
    ui.root.remove();
    onEnd();
  };

  let playbackStarted = false;

  const setPaused = (next: boolean): void => {
    if (stopped || paused === next || !playbackStarted) return;
    if (next) {
      cancelAnimationFrame(raf);
      raf = 0;
      elapsedBeforePause = (performance.now() - startedAt - pausedTotal) / 1000;
      pauseStarted = performance.now();
      pauseBtnText(labels.resume);
    } else {
      pausedTotal += performance.now() - pauseStarted;
      pauseBtnText(labels.pause);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    }
    paused = next;
  };

  function pauseBtnText(text: string): void {
    ui.pauseBtn.textContent = text;
    ui.pauseBtn.setAttribute("aria-label", text);
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") stop();
    if (e.key === " " && playbackStarted) {
      e.preventDefault();
      setPaused(!paused);
    }
  }

  ui.pauseBtn.addEventListener("click", () => setPaused(!paused));
  (ui.root.querySelector(".walk-stop") as HTMLButtonElement).addEventListener("click", stop);
  window.addEventListener("keydown", onKey);
  updateHud(0);

  // Reduced motion: a compact, scrollable photo strip in route order.
  if (ui.strip) {
    for (const frame of frames) {
      const img = document.createElement("img");
      img.src = frame.thumbUrl;
      img.alt = labels.streetFrame(Math.round(frame.heading));
      img.loading = "lazy";
      ui.strip.appendChild(img);
    }
    return { stop };
  }

  const tick = (): void => {
    if (stopped || paused) return;
    const t = progress(performance.now());
    glideCamera(t);

    let frameIdx = 0;
    const walkedM = route.distanceM * t;
    for (let i = 0; i < frames.length; i++) {
      if (frames[i].alongM <= walkedM) frameIdx = i;
      else break;
    }

    if (frameIdx !== lastFrameIdx && frames[frameIdx]) {
      const nextFrame = frames[frameIdx];
      const incoming = standby;
      incoming.onload = null;
      incoming.onerror = null;
      incoming.src = nextFrame.url;
      const swap = (): void => {
        incoming.style.opacity = "1";
        active.style.opacity = "0";
        const swapTmp = active;
        active = incoming;
        standby = swapTmp;
      };
      if (incoming.complete && incoming.naturalWidth) swap();
      else {
        incoming.onload = swap;
        incoming.onerror = (): void => { incoming.style.opacity = "0"; };
      }
      preload(frames[Math.min(frames.length - 1, frameIdx + 2)]?.url ?? "");
      lastFrameIdx = frameIdx;
    }

    updateHud(t);
    if (t >= 1) return stop();
    raf = requestAnimationFrame(tick);
  };

  playbackStarted = true;
  raf = requestAnimationFrame(tick);
  return { stop };
}
