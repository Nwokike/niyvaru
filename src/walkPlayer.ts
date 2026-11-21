import type { FrameSequence, WalkRoute } from "./types";

export interface WalkHandle {
  stop: () => void;
}

/**
 * Plays real street-level frames along a route. Prototype speed is compressed
 * (a 15-minute walk plays in ~75 seconds) so the experience reads as a walk,
 * not a wait. Distance along the route is shown from the route itself.
 */
export function startWalk(
  container: HTMLElement,
  route: WalkRoute,
  sequence: FrameSequence | undefined,
  onDone?: () => void
): WalkHandle {
  const frames = sequence?.frames ?? [];
  const total = Math.max(route.duration_s, 30);
  const DEMO_SECONDS = Math.min(150, Math.max(45, Math.round(total / 12)));
  const start = performance.now();
  let raf = 0;
  let stopped = false;

  const wrap = document.createElement("div");
  wrap.className = "walk-overlay";
  wrap.innerHTML = `
    <div class="walk-media"><img alt="street level" draggable="false" /></div>
    <div class="walk-hud">
      <div class="walk-title">${escapeHtml(route.name)}</div>
      <div class="walk-meta"><span class="walk-dist">0 m</span><span class="walk-eta"></span></div>
      <div class="walk-bar"><i></i></div>
      <div class="walk-controls">
        <button type="button" class="walk-stop">Stop walk</button>
      </div>
      <div class="walk-note">${frames.length ? `${frames.length} real street frames` : "route only"}</div>
    </div>`;
  const img = wrap.querySelector("img") as HTMLImageElement;
  const distEl = wrap.querySelector(".walk-dist") as HTMLElement;
  const etaEl = wrap.querySelector(".walk-eta") as HTMLElement;
  const barEl = wrap.querySelector(".walk-bar i") as HTMLElement;
  const stopBtn = wrap.querySelector(".walk-stop") as HTMLButtonElement;
  container.appendChild(wrap);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    wrap.remove();
    onDone?.();
  };
  stopBtn.addEventListener("click", stop);

  const tick = () => {
    if (stopped) return;
    const elapsed = (performance.now() - start) / 1000;
    const t = Math.min(1, elapsed / DEMO_SECONDS);
    const idx = frames.length ? Math.min(frames.length - 1, Math.floor(t * frames.length)) : 0;
    const frame = frames[idx];
    if (frame && img.dataset.loaded !== String(idx)) {
      img.dataset.loaded = String(idx);
      img.src = frame.url;
      img.style.transform = `rotate(${frame.heading ? 0 : 0}deg)`;
      wrap.style.setProperty("--heading", `${frame.heading ?? 0}deg`);
    }
    const dist = Math.round(route.distance_m * t);
    distEl.textContent = `${dist} m of ${route.distance_m} m`;
    const remaining = Math.max(0, Math.round((DEMO_SECONDS - elapsed) / (DEMO_SECONDS / Math.max(1, Math.round(total / 60)))));
    etaEl.textContent = frames.length
      ? `frame ${idx + 1}/${frames.length} · heading ${Math.round(frame?.heading ?? 0)}°`
      : "route only";
    barEl.style.width = `${Math.round(t * 100)}%`;
    if (t >= 1) {
      stop();
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return { stop };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}
