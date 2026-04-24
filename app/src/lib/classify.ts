/**
 * Corner / edge / interior classification.
 *
 * A column is at an edge if its centroid is within `edgeBand` of the
 * slab boundary. It's at a corner if its centroid is within `edgeBand`
 * of TWO non-collinear edge segments (we approximate by counting how
 * many edges of the slab outer ring lie within `edgeBand` of the
 * centroid using a swept-perpendicular test on each segment).
 */
import { pointToRingDistance, pointToSegmentDistance } from "./geom";
import type { Column, ColumnType, Polygon, Vec2 } from "./types";

export function classifyColumns(slab: Polygon, columns: Column[], edgeBand = 36): void {
  for (const c of columns) {
    c.type = classifyOne(c.position, slab, edgeBand);
  }
}

function classifyOne(p: Vec2, slab: Polygon, edgeBand: number): ColumnType {
  const r = slab.outer;
  const closeEdges: { i: number; theta: number }[] = [];
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    const d = pointToSegmentDistance(p, a, b);
    if (d <= edgeBand) {
      const theta = Math.atan2(b[1] - a[1], b[0] - a[0]);
      closeEdges.push({ i, theta });
    }
  }

  // Single edge: edge column.
  // Two edges with significantly different angles (>30°): corner column.
  if (closeEdges.length === 0) return "interior";

  // Distance to entire ring (just for a sanity bound)
  const ringD = pointToRingDistance(p, r);
  if (ringD > edgeBand) return "interior";

  if (closeEdges.length === 1) return "edge";

  // Look for non-collinear pair
  for (let i = 0; i < closeEdges.length; i++) {
    for (let j = i + 1; j < closeEdges.length; j++) {
      const dt = Math.abs(angleDiff(closeEdges[i].theta, closeEdges[j].theta));
      if (dt > Math.PI / 6 && dt < Math.PI - Math.PI / 6) return "corner";
    }
  }
  return "edge";
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
