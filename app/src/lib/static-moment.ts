/**
 * Static-moment (Mo) estimator per ACI 318-19 §8.10.3.2, used as a
 * lower-bound floor on per-column unbalanced moment.
 *
 *   Mo = wu · l2 · ln² / 8
 *
 * where l2 is the span length perpendicular to the bending direction,
 * and ln is the clear span in the bending direction, ≥ 0.65·l1.
 *
 * We compute, per column, the worst-case Mo in each bending direction
 * (x and y) using nearest-neighbor spacings to adjacent columns or the
 * slab edge.  The floor on unbalanced moment is 0.3·Mo — a historically
 * accepted minimum from the Direct Design Method, applied here as a
 * safety floor when a solver-derived Mu is available but might be
 * inflated, reduced, or unstable.
 *
 * Units: wu in psi, lengths in inches → Mo in lb-in.
 */
import type { Column, Polygon, Vec2 } from "./types";

export interface MoEstimate {
  /** Mo for bending in the x-direction (moment vector along y → "about y-axis"). Units: lb-in. */
  moSpanX: number;
  /** Mo for bending in the y-direction (moment vector along x → "about x-axis"). */
  moSpanY: number;
  /** Effective center-to-center x-span (larger of ±x neighbors or slab-edge fallback). */
  spanX: number;
  /** Effective center-to-center y-span. */
  spanY: number;
  /** Clear span in x-direction (subtracted column dim, floored at 0.65·l). */
  clearSpanX: number;
  /** Clear span in y-direction. */
  clearSpanY: number;
}

/**
 * Estimate Mo for every column.  Runs in O(n²) over columns; fine for
 * any realistic slab.
 */
export function estimateMoPerColumn(
  cols: Column[],
  slab: Polygon,
  wu_psi: number,
): Map<string, MoEstimate> {
  const out = new Map<string, MoEstimate>();
  for (const c of cols) {
    const n = findNeighbors(c, cols, slab);
    const l_x = Math.max(n.xPlus, n.xMinus);
    const l_y = Math.max(n.yPlus, n.yMinus);
    const clearSpanX = Math.max(0.65 * l_x, l_x - c.c1);
    const clearSpanY = Math.max(0.65 * l_y, l_y - c.c2);
    // Transverse averaged span — closer to DDM l2 semantics when column
    // has neighbors on both sides; equals the single-sided value
    // otherwise.
    const l_y_avg = (n.yPlus + n.yMinus) / 2;
    const l_x_avg = (n.xPlus + n.xMinus) / 2;
    const moSpanX = wu_psi * l_y_avg * clearSpanX * clearSpanX / 8;
    const moSpanY = wu_psi * l_x_avg * clearSpanY * clearSpanY / 8;
    out.set(c.id, {
      moSpanX, moSpanY,
      spanX: l_x, spanY: l_y,
      clearSpanX, clearSpanY,
    });
  }
  return out;
}

/**
 * For a column, find the nearest neighbor distance in each of the four
 * principal directions (+x, -x, +y, -y).  If no neighbor is present on
 * a side, fall back to the distance from the column to the slab edge
 * along that direction.
 *
 * A neighbor is "in the +x direction" if it lies in the +x quadrant
 * where |dx| > |dy| — this picks column lines rather than diagonals.
 */
function findNeighbors(col: Column, cols: Column[], slab: Polygon) {
  const [cx, cy] = col.position;
  let xPlus = Infinity, xMinus = Infinity;
  let yPlus = Infinity, yMinus = Infinity;
  for (const o of cols) {
    if (o.id === col.id) continue;
    const dx = o.position[0] - cx;
    const dy = o.position[1] - cy;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 1) {
      if (dx > 0 && dx < xPlus) xPlus = dx;
      if (dx < 0 && -dx < xMinus) xMinus = -dx;
    } else if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 1) {
      if (dy > 0 && dy < yPlus) yPlus = dy;
      if (dy < 0 && -dy < yMinus) yMinus = -dy;
    }
  }
  if (!isFinite(xPlus))  xPlus  = slabEdgeDistance(col, slab,  1,  0);
  if (!isFinite(xMinus)) xMinus = slabEdgeDistance(col, slab, -1,  0);
  if (!isFinite(yPlus))  yPlus  = slabEdgeDistance(col, slab,  0,  1);
  if (!isFinite(yMinus)) yMinus = slabEdgeDistance(col, slab,  0, -1);
  return { xPlus, xMinus, yPlus, yMinus };
}

function slabEdgeDistance(col: Column, slab: Polygon, dx: number, dy: number): number {
  const [cx, cy] = col.position;
  let best = Infinity;
  const rings = [slab.outer, ...(slab.holes ?? [])];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a: Vec2 = ring[i];
      const b: Vec2 = ring[(i + 1) % ring.length];
      const t = rayHit(cx, cy, dx, dy, a, b);
      if (t !== null && t > 0 && t < best) best = t;
    }
  }
  return best;
}

/** Return t ≥ 0 such that (cx + t·dx, cy + t·dy) is on the segment [a, b], or null. */
function rayHit(cx: number, cy: number, dx: number, dy: number, a: Vec2, b: Vec2): number | null {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const denom = dx * -ey - dy * -ex;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((a[0] - cx) * -ey - (a[1] - cy) * -ex) / denom;
  const s = (dx * (a[1] - cy) - dy * (a[0] - cx)) / denom;
  if (s < 0 || s > 1) return null;
  return t;
}
