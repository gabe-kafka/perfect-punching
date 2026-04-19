/**
 * 2D polygon utilities. Uses polygon-clipping for robust Booleans/offsets.
 */
import polygonClipping from "polygon-clipping";
import type { Polygon, Ring, Vec2 } from "./types";

/** Polygon area (signed). Positive for CCW. */
export function ringArea(r: Ring): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  }
  return a / 2;
}

export function ringCentroid(r: Ring): Vec2 {
  let cx = 0, cy = 0, a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
    cx += (r[j][0] + r[i][0]) * f;
    cy += (r[j][1] + r[i][1]) * f;
    a += f;
  }
  a /= 2;
  return [cx / (6 * a), cy / (6 * a)];
}

export function ringPerimeter(r: Ring): number {
  let p = 0;
  for (let i = 0; i < r.length; i++) {
    const j = (i + 1) % r.length;
    p += Math.hypot(r[j][0] - r[i][0], r[j][1] - r[i][1]);
  }
  return p;
}

/** Convert our Polygon (single ring + holes) to polygon-clipping's nested array. */
function toPC(p: Polygon): polygonClipping.Geom {
  const outer = closeRing(p.outer);
  const holes = (p.holes ?? []).map(closeRing);
  return [[outer, ...holes]];
}

function closeRing(r: Ring): polygonClipping.Ring {
  if (r.length === 0) return r as polygonClipping.Ring;
  const [a, b] = [r[0], r[r.length - 1]];
  if (a[0] === b[0] && a[1] === b[1]) return r as polygonClipping.Ring;
  return [...r, r[0]] as polygonClipping.Ring;
}

/** Convert polygon-clipping's MultiPolygon back to our Polygon[]. */
function fromPC(mp: polygonClipping.MultiPolygon): Polygon[] {
  return mp.map((poly) => ({
    outer: openRing(poly[0]),
    holes: poly.slice(1).map(openRing),
  }));
}

function openRing(r: polygonClipping.Ring): Ring {
  if (r.length === 0) return [];
  const [a, b] = [r[0], r[r.length - 1]];
  if (a[0] === b[0] && a[1] === b[1]) {
    return r.slice(0, -1).map(([x, y]) => [x, y] as Vec2);
  }
  return r.map(([x, y]) => [x, y] as Vec2);
}

export function intersectPolygons(a: Polygon, b: Polygon): Polygon[] {
  const result = polygonClipping.intersection(toPC(a), toPC(b));
  return fromPC(result);
}

export function subtractPolygons(a: Polygon, b: Polygon): Polygon[] {
  const result = polygonClipping.difference(toPC(a), toPC(b));
  return fromPC(result);
}

/**
 * Square-corner offset of a closed polygon. We use a sample-and-clip
 * approach: build a rectangular polygon by walking edges, expanded by
 * `dist` in the outward normal direction. Adequate for axis-aligned and
 * convex column footprints (which are the realistic punching cases).
 *
 * For arbitrary polygons polygon-clipping doesn't expose offset directly;
 * for now we handle the axis-aligned bounding-box case explicitly, which
 * covers rectangular columns. Extensible later via a true offset library.
 */
export function offsetRect(c1: number, c2: number, center: Vec2, dist: number): Polygon {
  const hx = c1 / 2 + dist;
  const hy = c2 / 2 + dist;
  return {
    outer: [
      [center[0] - hx, center[1] - hy],
      [center[0] + hx, center[1] - hy],
      [center[0] + hx, center[1] + hy],
      [center[0] - hx, center[1] + hy],
    ],
  };
}

/** Build a rectangular polygon centred at `center`. */
export function rectPolygon(c1: number, c2: number, center: Vec2): Polygon {
  return offsetRect(c1, c2, center, 0);
}

/** Closest distance from a point to a polygon ring (positive inside or out). */
export function pointToRingDistance(p: Vec2, r: Ring): number {
  let best = Infinity;
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (len2 || 1);
    t = Math.max(0, Math.min(1, t));
    const cx = a[0] + t * dx;
    const cy = a[1] + t * dy;
    const d = Math.hypot(p[0] - cx, p[1] - cy);
    if (d < best) best = d;
  }
  return best;
}

export function pointInRing(p: Vec2, r: Ring): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0], yi = r[i][1];
    const xj = r[j][0], yj = r[j][1];
    const intersect =
      ((yi > p[1]) !== (yj > p[1])) &&
      (p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Largest by area. */
export function largest(slabs: Polygon[]): Polygon | null {
  if (slabs.length === 0) return null;
  return slabs.reduce((a, b) =>
    Math.abs(ringArea(a.outer)) > Math.abs(ringArea(b.outer)) ? a : b,
  );
}
