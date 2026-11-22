/**
 * Time-of-day engine — the Sete Colinas architecture, Niyvaru palette.
 * Hour-keyframed palettes (wraparound 24h), smoothstep interpolation,
 * one function v(hour) that returns every color the map needs.
 */

export interface HourPalette {
  sky: string;
  horizon: string;
  fog: string;
  land: string;
  landAlt: string;
  park: string;
  water: string;
  road: string;
  roadMajor: string;
  rail: string;
  label: string;
  halo: string;
  buildingLow: string;
  buildingHigh: string;
  shade: string;
  highlight: string;
  light: string;
  lightIntensity: number;
}

interface Keyframe {
  hour: number;
  name: string;
  palette: HourPalette;
}

/**
 * Niyvaru's day: warm paper and bronze; night: deep ink with brass-lit towers.
 * Keyframes wrap around midnight — hour 24 resolves back to the Night frame.
 */
const g: Keyframe[] = [
  {
    hour: 0,
    name: "Night",
    palette: {
      sky: "#131020",
      horizon: "#2c2440",
      fog: "#171426",
      land: "#1c1826",
      landAlt: "#211d2e",
      park: "#1e2a26",
      water: "#101626",
      road: "#322c40",
      roadMajor: "#c9a15a",
      rail: "#2a2638",
      label: "#e8ddc9",
      halo: "#1c1826",
      buildingLow: "#262034",
      buildingHigh: "#e8b86a",
      shade: "#0f0d18",
      highlight: "#3a3153",
      light: "#b8a8e0",
      lightIntensity: 0.3,
    },
  },
  {
    hour: 6.5,
    name: "Dawn",
    palette: {
      sky: "#f3b7a0",
      horizon: "#ffd9b0",
      fog: "#f6cdb6",
      land: "#f4e9dc",
      landAlt: "#efe1d0",
      park: "#cbcfA8".toLowerCase(),
      water: "#9fb6d4",
      road: "#fcf3e8",
      roadMajor: "#f4d4ac",
      rail: "#d8c4b0",
      label: "#4a3a34",
      halo: "#faf0e4",
      buildingLow: "#e9c6b2",
      buildingHigh: "#f6dfcd",
      shade: "#8c6f7a",
      highlight: "#fff1e0",
      light: "#ffc89a",
      lightIntensity: 0.3,
    },
  },
  {
    hour: 13,
    name: "Midday",
    palette: {
      sky: "#d8e9f4",
      horizon: "#f2ecdf",
      fog: "#eae5d8",
      land: "#fbf7f1",
      landAlt: "#f6efe2",
      park: "#dfe7cf",
      water: "#a8c8dc",
      road: "#ffffff",
      roadMajor: "#f3e3c2",
      rail: "#e0d2ba",
      label: "#191512",
      halo: "#fdfbf7",
      buildingLow: "#f1e8d6",
      buildingHigh: "#faf4ea",
      shade: "#8a7a66",
      highlight: "#ffffff",
      light: "#ffffff",
      lightIntensity: 0.22,
    },
  },
  {
    hour: 18.5,
    name: "Golden",
    palette: {
      sky: "#f0a35e",
      horizon: "#ffd59a",
      fog: "#f5c38e",
      land: "#f3dcbe",
      landAlt: "#edcfa9",
      park: "#c3c48c",
      water: "#7d95b4",
      road: "#fdeed6",
      roadMajor: "#f0c98e",
      rail: "#d6b890",
      label: "#4a2c14",
      halo: "#fbeedd",
      buildingLow: "#f2c39c",
      buildingHigh: "#fbe2c0",
      shade: "#6e4a3e",
      highlight: "#ffe2b8",
      light: "#ffb070",
      lightIntensity: 0.3,
    },
  },
  {
    hour: 20.5,
    name: "Dusk",
    palette: {
      sky: "#3b3f7a",
      horizon: "#c76f6a",
      fog: "#5a4a76",
      land: "#35304a",
      landAlt: "#3a3550",
      park: "#2a3a3c",
      water: "#1d2a52",
      road: "#4c4874",
      roadMajor: "#e3a45c",
      rail: "#4a4a6e",
      label: "#e8dcef",
      halo: "#35304a",
      buildingLow: "#3c3a62",
      buildingHigh: "#e8a86a",
      shade: "#14152b",
      highlight: "#6a5a8a",
      light: "#c58dbb",
      lightIntensity: 0.35,
    },
  },
];

/** Named stops for the time control (Sete Colinas pattern). */
export const TIME_STOPS: { label: string; hour: number }[] = [
  { label: "Dawn", hour: 6.5 },
  { label: "Midday", hour: 13 },
  { label: "Golden", hour: 18.5 },
  { label: "Night", hour: 23 },
];

const wrap = (hour: number): number => ((hour % 24) + 24) % 24;

function hexToRgb(hex: string): [number, number, number] {
  const t = hex.replace("#", "");
  const full = t.length === 3 ? [...t].map((c) => c + c).join("") : t;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

function mixColor(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbToHex([r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t]);
}

function mixNumber(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** The two keyframes surrounding `hour`, and how far into the gap we are. */
function bracket(hour: number): { a: Keyframe; b: Keyframe; t: number } {
  const h = wrap(hour);
  for (let i = 0; i < g.length; i++) {
    const a = g[i];
    const b = g[(i + 1) % g.length];
    const end = i + 1 < g.length ? b.hour : 24;
    if (h >= a.hour && h < end) {
      return { a, b, t: (h - a.hour) / (end - a.hour) };
    }
  }
  return { a: g[0], b: g[1], t: 0 };
}

/** v(hour) — the single source of every map color. */
export function paletteAt(hour: number): HourPalette & { name: string } {
  const { a, b, t: raw } = bracket(hour);
  const t = raw * raw * (3 - 2 * raw); // smoothstep
  const out: Record<string, string | number> = { name: t < 0.5 ? a.name : b.name };
  for (const key of Object.keys(a.palette)) {
    const from = a.palette[key as keyof HourPalette];
    const to = b.palette[key as keyof HourPalette];
    out[key] =
      typeof from === "number"
        ? mixNumber(from, to as number, t)
        : mixColor(from, to as string, t);
  }
  return out as unknown as HourPalette & { name: string };
}

/** Light position [radial, azimuthal, polar] — the sun's path across the day. */
export function lightPosition(hour: number): [number, number, number] {
  const azimuth = wrap(hour) * 15 - 180; // noon overhead-ish sweep
  const polar = Math.max(8, 80 - Math.abs(wrap(hour) - 13) * 12);
  return [1.15, azimuth, polar];
}

/** Clock label for the current hour, e.g. "18:30". */
export function clockLabel(hour: number): string {
  const h = wrap(hour);
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
