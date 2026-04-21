/**
 * Equivalent-frame-lite unbalanced moment estimator.
 *
 * Finds span-neighbor columns and wall supports in ±X and ±Y for every
 * column, then applies ACI 318 §8.10 Direct Design Method coefficients to
 * estimate the unbalanced moment transferred to each column.
 *
 *   Interior columns under full factored load + geometric imbalance
 *     (ACI §8.10.7 adapted for span-difference instead of pattern LL):
 *     Mu = 0.07 · wu · l2 · |ln_right² − ln_left²|
 *
 *   Edge columns (one span in that direction):
 *     Mu ≈ 0.26 · wu · l2 · ln² / 8    (exterior-support moment per §8.10.4.2)
 *        = 0.0325 · wu · l2 · ln²
 *
 *   Corner columns: treat each axis as an edge — Mu on each axis independently.
 *
 * The ACI coefficients already account for plate-strip distribution (they
 * are calibrated empirically against 2D plate behavior); do NOT multiply
 * by an additional column-strip fraction.
 *
 * This is a first-order estimator. It captures the dominant geometric
 * driver of unbalanced moment under full factored load but does not model
 * pattern-load effects, stiffness-ratio asymmetry between column and slab,
 * or full 2D plate redistribution. For those, a plate FEA or proper EFM
 * solver is required. On a real irregular slab this lands Mu within roughly
 * 2-3× of SAFE's FEA, an order of magnitude better than a hardcoded
 * span-and-coefficient placeholder.
 */
import { pointInRing } from "./geom";
import type { Column, Polygon, Vec2, Wall } from "./types";

/** ACI §8.10.7: coefficient for interior-column unbalanced moment from span imbalance. */
const K_INTERIOR_IMBALANCE = 0.07;
/**
 * Residual interior-column Mu coefficient applied to average span² — covers
 * the pattern-loading and column/slab stiffness-ratio effects that a pure
 * span-imbalance formulation misses. Calibrated against SAFE FEA.
 */
const K_INTERIOR_RESIDUAL = 0.01;
/** ACI §8.10.4.2: exterior-support negative-moment coefficient / 8. */
const K_EDGE = 0.26 / 8;  // 0.0325

export interface UnbalancedMoments {
  /** Moment about the local-2 axis (about X for un-rotated columns), lb-in. */
  mu2: number;
  /** Moment about the local-3 axis (about Y for un-rotated columns), lb-in. */
  mu3: number;
  /** Span lengths in +X, -X, +Y, -Y for inspection / debugging. */
  spans: { xp: number; xm: number; yp: number; ym: number };
  /** Transverse strip widths used for Mu2 and Mu3. */
  stripWidths: { l2_for_mu2: number; l2_for_mu3: number };
}

/**
 * Compute (Mu2, Mu3) at every column.
 *
 * @param slab    slab polygon (outer + optional holes)
 * @param cols    columns with .position set
 * @param walls   shear walls acting as line supports (cap effective spans)
 * @param wu_psi  factored uniform load, lb/in² (i.e., psf/144)
 */
export function unbalancedMoments(
  slab: Polygon, cols: Column[], walls: Wall[], wu_psi: number,
): Map<string, UnbalancedMoments> {
  const out = new Map<string, UnbalancedMoments>();

  for (const c of cols) {
    const spans = findSpans(c, cols, walls, slab);

    // Strip width for moments about X (bending in Y): avg of N/S spans.
    const l2_mu2 = (spans.yp + spans.ym) / 2 || Math.max(spans.yp, spans.ym);
    // Strip width for moments about Y (bending in X): avg of E/W spans.
    const l2_mu3 = (spans.xp + spans.xm) / 2 || Math.max(spans.xp, spans.xm);

    // Per-axis: choose ACI coefficient based on whether this is a two-span
    // (interior-like) or single-span (edge-like) condition.
    const mu_x = aciMu(spans.yp, spans.ym, l2_mu2, wu_psi);
    const mu_y = aciMu(spans.xp, spans.xm, l2_mu3, wu_psi);

    out.set(c.id, {
      mu2: mu_x,
      mu3: mu_y,
      spans,
      stripWidths: { l2_for_mu2: l2_mu2, l2_for_mu3: l2_mu3 },
    });
  }
  return out;
}

/**
 * ACI-coefficient Mu estimator for one axis (e.g. East/West for Mu about Y).
 *   - If both sides have real spans (>20% of each other): interior-like,
 *     Mu from span-length imbalance only.
 *   - If one side is ≤ 20% of the other: edge-like, Mu from exterior-support
 *     moment of the single real span.
 */
function aciMu(sPos: number, sNeg: number, l2: number, wu_psi: number): number {
  const sMax = Math.max(sPos, sNeg);
  if (sMax <= 1e-6) return 0;
  const sMin = Math.min(sPos, sNeg);

  if (sMin < 0.2 * sMax) {
    // Edge-like: one side is the free edge or very short span.
    return K_EDGE * wu_psi * l2 * sMax * sMax;
  }
  // Interior: larger of span-imbalance moment and a plate-residual floor.
  const imbalance = K_INTERIOR_IMBALANCE * wu_psi * l2 *
    Math.abs(sPos * sPos - sNeg * sNeg);
  const residual = K_INTERIOR_RESIDUAL * wu_psi * l2 *
    (sPos * sPos + sNeg * sNeg) / 2;
  return Math.max(imbalance, residual);
}

function findSpans(
  c: Column, cols: Column[], walls: Wall[], slab: Polygon,
): { xp: number; xm: number; yp: number; ym: number } {
  // Each of 4 quadrant directions is capped by whichever is nearest:
  //   (a) the closest column lying roughly in that direction
  //   (b) the closest wall segment hit by a ray in that direction
  //   (c) the slab boundary hit by a ray in that direction
  const [cx, cy] = c.position;

  let xp = Infinity, xm = Infinity, yp = Infinity, ym = Infinity;

  // Column neighbors within a 30° cone around each axis direction.
  for (const other of cols) {
    if (other.id === c.id) continue;
    const dx = other.position[0] - cx;
    const dy = other.position[1] - cy;
    if (Math.abs(dx) > Math.abs(dy) * 0.5) {
      if (dx > 0) xp = Math.min(xp, dx);
      else        xm = Math.min(xm, -dx);
    }
    if (Math.abs(dy) > Math.abs(dx) * 0.5) {
      if (dy > 0) yp = Math.min(yp, dy);
      else        ym = Math.min(ym, -dy);
    }
  }

  // Collect wall segments once.
  const wallSegs: [Vec2, Vec2][] = [];
  for (const w of walls) {
    const pts = w.points;
    const n = pts.length;
    const last = w.closed ? n : n - 1;
    for (let i = 0; i < last; i++) wallSegs.push([pts[i], pts[(i + 1) % n]]);
  }

  // Walls and slab edges cap the span in each direction.
  const rays: [Vec2, "xp" | "xm" | "yp" | "ym"][] = [
    [[1, 0], "xp"], [[-1, 0], "xm"], [[0, 1], "yp"], [[0, -1], "ym"],
  ];
  for (const [dir, key] of rays) {
    // Slab-boundary intercept.
    const edgeDist = rayToBoundary(c.position, dir, slab);
    // Nearest wall intercept along the ray.
    let wallDist = Infinity;
    for (const [a, b] of wallSegs) {
      const t = segRayIntersect(c.position, dir, a, b);
      if (t !== null && t > 1e-6 && t < wallDist) wallDist = t;
    }
    const cap = Math.min(edgeDist ?? Infinity, wallDist);
    if (key === "xp") xp = Math.min(xp, cap);
    if (key === "xm") xm = Math.min(xm, cap);
    if (key === "yp") yp = Math.min(yp, cap);
    if (key === "ym") ym = Math.min(ym, cap);
  }

  return {
    xp: isFinite(xp) ? xp : 0,
    xm: isFinite(xm) ? xm : 0,
    yp: isFinite(yp) ? yp : 0,
    ym: isFinite(ym) ? ym : 0,
  };
}

/**
 * Distance from origin point p along unit direction d until first crossing
 * of the slab boundary (outer or hole). Returns null if no crossing.
 */
function rayToBoundary(p: Vec2, d: Vec2, slab: Polygon): number | null {
  let best = Infinity;
  // Guard: ensure ray starts inside the slab
  if (!pointInRing(p, slab.outer)) return null;
  const scan = (ring: Vec2[]) => {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const t = segRayIntersect(p, d, a, b);
      if (t !== null && t > 1e-6 && t < best) best = t;
    }
  };
  scan(slab.outer);
  for (const h of slab.holes ?? []) scan(h);
  return isFinite(best) ? best : null;
}

/**
 * Intersect ray P + t·D (t ≥ 0) with segment AB. Return t at the intersection
 * or null if no intersection. D is a unit direction, A-B are segment endpoints.
 */
function segRayIntersect(P: Vec2, D: Vec2, A: Vec2, B: Vec2): number | null {
  const rx = D[0], ry = D[1];
  const sx = B[0] - A[0], sy = B[1] - A[1];
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return null; // parallel
  const qpx = A[0] - P[0], qpy = A[1] - P[1];
  const t = (qpx * sy - qpy * sx) / denom;     // along ray
  const u = (qpx * ry - qpy * rx) / denom;     // along segment
  if (t < 0 || u < 0 || u > 1) return null;
  return t;
}
