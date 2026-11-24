/**
 * Visible surface registry — every capability has a stable, visible address.
 * Future features register here instead of inventing new hidden chrome.
 */
import type { Dictionary } from "./i18n";

export type SurfaceId = "explore" | "pulse" | "brief" | "agent" | "memory";
export type Detent = "peek" | "half" | "full";

export interface SurfaceDefinition {
  id: SurfaceId;
  label: (d: Dictionary) => string;
  /** Icon key resolved by ui/primitives.tsx — data, not inline markup. */
  icon: "places" | "pulse" | "story" | "spark" | "memory" | "locate";
  defaultDetent: Detent;
  priority: number;
  enabled: boolean;
}

export const SURFACES: SurfaceDefinition[] = [
  { id: "explore", label: (d) => d.tabs.explore, icon: "places", defaultDetent: "peek", priority: 10, enabled: true },
  { id: "pulse", label: (d) => d.tabs.pulse, icon: "pulse", defaultDetent: "half", priority: 20, enabled: true },
  { id: "brief", label: (d) => d.tabs.brief, icon: "story", defaultDetent: "half", priority: 30, enabled: true },
  { id: "agent", label: (d) => d.tabs.agent, icon: "spark", defaultDetent: "half", priority: 40, enabled: true },
  { id: "memory", label: (d) => d.tabs.memory, icon: "memory", defaultDetent: "half", priority: 50, enabled: true },
];

export const DOCK_SURFACES = SURFACES.filter((s) => s.id !== "memory" && s.enabled);
