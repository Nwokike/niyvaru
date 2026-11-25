/**
 * Brand token values shared by CSS, the map re-grader and the UI.
 * The palette is Niyvaru's identity — warm paper and bronze — city-neutral.
 * Kind colours stay earthy and quiet: the map is the picture, not the pins.
 */

export const KIND_COLORS: Record<string, string> = {
  hotel: "#96682f",
  pharmacy: "#2f6b62",
  food: "#b3572f",
  cafe: "#8a6d3b",
  bar: "#7a5b46",
  shop: "#8a7a63",
  worship: "#3e6b4f",
  health: "#a8442c",
  money: "#6b5b3e",
  toilets: "#7a6d5d",
  green: "#4a7a52",
  heritage: "#96682f",
  civic: "#7a6d5d",
};

export const KIND_FALLBACK_COLOR = "#8a7a63";

/** Universal kind → UI filter groups (data, not code). */
export const KIND_GROUPS: Record<string, string[]> = {
  hotels: ["hotel"],
  pharmacy: ["pharmacy"],
  food: ["food", "cafe", "bar"],
  worship: ["worship"],
  shops: ["shop"],
  health: ["health", "toilets"],
  money: ["money"],
  heritage: ["heritage"],
  green: ["green"],
};

/**
 * Reverse lookup: the filter group whose membership is exactly `kinds`.
 * Used to keep the visible filter dropdown in sync when the agent filters.
 */
export function kindGroupFor(kinds: string[] | null | undefined): string | null {
  if (!kinds || !kinds.length) return null;
  const wanted = new Set(kinds);
  const hit = Object.entries(KIND_GROUPS).find(
    ([, list]) => list.length === wanted.size && list.every((k) => wanted.has(k))
  );
  return hit ? hit[0] : null;
}
