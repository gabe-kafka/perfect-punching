/**
 * Stiffness-aware tributary assignment by grid sampling.
 *
 * Each grid point inside the slab is assigned to the *nearest support*.
 * Supports are columns (points) AND walls (line segments). Grid points
 * whose nearest support is a wall are dropped — the wall carries that
 * load, not a column, and so it does not contribute to any column's
 * punching shear demand.
 *
 * Without walls (walls = []) this reduces to the original nearest-column
 * Voronoi assignment.
 */
import { pointInRing, pointToSegmentDistance } from "./geom";
import type { Column, Polygon, Vec2, Wall } from "./types";

/** Returns area (in²) per columnId, computed by grid sampling. */
export function tributaryAreas(
  slab: Polygon,
  columns: Column[],
  walls: Wall[] = [],
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

      // Nearest column (point distance)
      let bestColId = columns[0]?.id;
      let bestColD2 = Infinity;
      for (const c of columns) {
        const d2 = (c.position[0] - x) ** 2 + (c.position[1] - y) ** 2;
        if (d2 < bestColD2) { bestColD2 = d2; bestColId = c.id; }
      }
      const bestColD = Math.sqrt(bestColD2);

      // Nearest wall segment (point-to-segment distance)
      let bestWallD = Infinity;
      for (const w of walls) {
        const pts = w.points;
        const n = pts.length;
        const lastIdx = w.closed ? n : n - 1;
        for (let i = 0; i < lastIdx; i++) {
          const d = pointToSegmentDistance(p, pts[i], pts[(i + 1) % n]);
          if (d < bestWallD) bestWallD = d;
        }
      }

      // Wall wins → this cell does not contribute to any column
      if (bestWallD < bestColD) continue;

      if (bestColId) result.set(bestColId, (result.get(bestColId) ?? 0) + cell);
    }
  }
  return result;
}
