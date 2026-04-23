/**
 * Deterministic color per DXF layer name.  Same layer → same color
 * across the 3D canvas and the floating layer-mapping card.
 *
 * Assignment is by insertion order (the order `primeLayerColors` is
 * called), not by hash, so no two layers collide unless the palette
 * wraps.  Call `primeLayerColors` once per scan with the sorted layer
 * list so the order is stable across re-renders.
 */

const PALETTE = [
  "#0057FF", // blue
  "#DC2626", // red
  "#16A34A", // green
  "#D97706", // amber
  "#9333EA", // purple
  "#06B6D4", // cyan
  "#DB2777", // pink
  "#0F766E", // teal
  "#CA8A04", // olive
  "#4F46E5", // indigo
  "#F97316", // orange
  "#0891B2", // sky
  "#BE123C", // rose
  "#059669", // emerald
  "#7C3AED", // violet
  "#EA580C", // flame
];

const cache = new Map<string, string>();
let nextIdx = 0;

export function layerColor(name: string | undefined): string {
  const key = name ?? "";
  const hit = cache.get(key);
  if (hit) return hit;
  const color = PALETTE[nextIdx % PALETTE.length];
  nextIdx++;
  cache.set(key, color);
  return color;
}

/** Reset the cache and assign colors to every layer in the given list,
 *  in sorted order, so palette positions are deterministic. */
export function primeLayerColors(layerNames: string[]): void {
  cache.clear();
  nextIdx = 0;
  const unique = [...new Set(layerNames)].sort();
  for (const name of unique) layerColor(name);
}
