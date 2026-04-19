/**
 * Bounded Voronoi tessellation by d3-delaunay-equivalent grid sampling.
 *
 * For tributary-area assignment we don't strictly need Delaunay; we just
 * need each point in the slab assigned to its nearest column. A coarse
 * grid sample summed up gives the area per column, accurate to grid
 * resolution. Fast, dependency-free, robust on any slab shape.
 */
import { pointInRing } from "./geom";
import type { Column, Polygon, Vec2 } from "./types";

/** Returns area (in²) per columnId, computed by grid sampling. */
export function tributaryAreas(
  slab: Polygon,
  columns: Column[],
  /** Grid step in inches; smaller = more accurate, slower. 12" works well. */
  step = 12,
): Map<string, number> {
  const xs = slab.outer.map(([x]) => x);
  const ys = slab.outer.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  const result = new Map<string, number>();
  for (const c of columns) result.set(c.id, 0);

  const cell = step * step; // in²/cell
  const holes = slab.holes ?? [];

  for (let y = minY + step / 2; y < maxY; y += step) {
    for (let x = minX + step / 2; x < maxX; x += step) {
      const p: Vec2 = [x, y];
      if (!pointInRing(p, slab.outer)) continue;
      let inHole = false;
      for (const h of holes) if (pointInRing(p, h)) { inHole = true; break; }
      if (inHole) continue;

      // nearest column
      let bestId = columns[0]?.id;
      let bestD = Infinity;
      for (const c of columns) {
        const d = (c.position[0] - x) ** 2 + (c.position[1] - y) ** 2;
        if (d < bestD) { bestD = d; bestId = c.id; }
      }
      if (bestId) result.set(bestId, (result.get(bestId) ?? 0) + cell);
    }
  }
  return result;
}
