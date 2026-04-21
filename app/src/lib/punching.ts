/**
 * Per-column punching shear check (ACI 318 §22.6.5 + §8.4.2.3).
 *
 * Biaxial formulation: unbalanced moments about both principal axes, Mu2
 * (about local 2, i.e. about X for an un-rotated column) and Mu3 (about
 * local 3, about Y), each with its own γv, Jc, and lever arm. The two
 * eccentric-shear contributions add to the direct shear stress at the
 * critical-section corner closest to the resultant of the moment vectors.
 *
 * For edge and corner columns the critical section is truncated at the
 * free edge(s). Its centroid shifts toward the supported side per
 * ACI R8.4.4.2.3, and both Jc and the lever arm c change. The shift
 * direction(s) are inferred from the slab polygon (if supplied).
 *
 * Inputs:  Column (c1, c2, type, tributaryArea), ProjectInputs,
 *          optional (mu2, mu3) from an EFM-lite or FEA solver,
 *          optional slab polygon for free-edge direction detection.
 */
import type {
  Column, ColumnResult, ColumnType, Polygon, ProjectInputs, Vec2,
} from "./types";

const psf_to_psi = 1 / 144;
const ft2 = 144;

/**
 * Two-way shear capacity (no shear reinforcement, normal-weight, λ=λs=1).
 *
 * fcsFactor multiplies f'_c under the square root. ACI 318 uses f'_c directly
 * (fcs=1.0). SAFE's default workflow applies ~0.8.
 */
export function phiVc(
  c1: number, c2: number, b0: number, d: number, type: ColumnType,
  fcPsi: number, phi: number, fcsFactor: number = 1.0,
): number {
  const beta = Math.max(c1, c2) / Math.min(c1, c2);
  const alphaS = type === "interior" ? 40 : type === "edge" ? 30 : 20;
  const sq = Math.sqrt(fcsFactor * fcPsi);
  return phi * Math.min(
    4 * sq,
    (2 + 4 / beta) * sq,
    (alphaS * d / b0 + 2) * sq,
  );
}

/** γf, γv per ACI 318 eq 8.4.2.3.2. b1 is in the moment-span direction. */
function gammas(b1: number, b2: number) {
  const gf = 1 / (1 + (2 / 3) * Math.sqrt(b1 / b2));
  return { gf, gv: 1 - gf };
}

/**
 * Polar moment of inertia of an INTERIOR rectangular critical section
 * about the axis perpendicular to b1 (the moment-span direction).
 */
function jcInterior(b1: number, b2: number, d: number) {
  return (d * b1 ** 3) / 6 + (b1 * d ** 3) / 6 + (b2 * d * b1 ** 2) / 2;
}

/**
 * Section properties for an EDGE-column critical section. The free edge
 * is perpendicular to the b1 direction — the section is 3-sided:
 *   two legs of length b1 running from the free edge to the interior side
 *   one leg of length b2 at the interior side (parallel to the free edge)
 *
 * x̄ = centroid measured from the free edge toward the interior:
 *     x̄ = b1² / (2·b1 + b2)
 *
 * Jc about the centroidal axis parallel to the free edge:
 *   Jc = 2·[(d·b1³)/12 + b1·d·(b1/2 − x̄)²] + b2·d·(b1 − x̄)² + 2·(b1·d³)/12
 * c (lever arm to the farthest perimeter point): c = b1 − x̄
 *
 * For the axis *parallel* to b1 (perpendicular to the free edge), the
 * section is symmetric and the interior formula applies:
 *   Jc_parallel = (d·b2³)/6·(2b1+b2)/(2b1+b2)... (use jcInterior for that axis)
 */
function jcEdge(b1: number, b2: number, d: number) {
  const xbar = (b1 * b1) / (2 * b1 + b2);
  const c = b1 - xbar;
  const jc =
    2 * ((d * b1 ** 3) / 12 + b1 * d * (b1 / 2 - xbar) ** 2) +
    b2 * d * (b1 - xbar) ** 2 +
    2 * (b1 * d ** 3) / 12;
  return { jc, c, xbar };
}

/**
 * Section properties for a CORNER-column critical section — 2 legs meeting
 * at the inside corner. The section is a right angle of arm lengths b1, b2.
 *
 * Treat as two perpendicular legs meeting at (0,0), with free edges along
 * +x (length b1) and +y (length b2). Centroid of the L:
 *   x̄ = b1² / (2·(b1 + b2))
 *   ȳ = b2² / (2·(b1 + b2))
 *
 * Jc about the centroidal axis parallel to b2 (perpendicular to b1 direction):
 *   Jc_about_b2 = (d·b1³)/12 + b1·d·(b1/2 − x̄)² + b2·d·x̄² + (b1·d³)/12
 * and symmetrically for the axis parallel to b1.
 *
 * c (lever arm) = b1 − x̄ (for axis perp to b1 direction).
 */
function jcCorner(b1: number, b2: number, d: number) {
  const xbar = (b1 * b1) / (2 * (b1 + b2));
  const c = b1 - xbar;
  const jc =
    (d * b1 ** 3) / 12 + b1 * d * (b1 / 2 - xbar) ** 2 +
    b2 * d * xbar * xbar +
    (b1 * d ** 3) / 12;
  return { jc, c, xbar };
}

function scalarMomentFallback(vu_lb: number): number {
  return 0.05 * vu_lb * 12 * 20;
}

/**
 * Classify which axis is the "free-edge" axis for an edge column by
 * finding the slab-boundary segment nearest the column and taking its
 * perpendicular as the free-edge direction. Returns "x" if the free edge
 * is perpendicular to the X-axis (so b1 in X-direction is truncated) or
 * "y" otherwise. For interior columns, returns null.
 */
function freeEdgeAxis(c: Column, slab?: Polygon): "x" | "y" | null {
  if (!slab) return null;
  const p = c.position;
  let bestNormalAbsX = 0, bestNormalAbsY = 0, bestD = Infinity;
  for (let i = 0; i < slab.outer.length; i++) {
    const a = slab.outer[i];
    const b = slab.outer[(i + 1) % slab.outer.length];
    const d = pointToSegDist(p, a, b);
    if (d < bestD) {
      bestD = d;
      // Edge direction unit vector (along the segment)
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const len = Math.hypot(ex, ey) || 1;
      // Normal = perpendicular to edge direction
      bestNormalAbsX = Math.abs(-ey / len);
      bestNormalAbsY = Math.abs(ex / len);
    }
  }
  // If normal points predominantly in X, free edge is perpendicular to X.
  return bestNormalAbsX >= bestNormalAbsY ? "x" : "y";
}

function pointToSegDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (len2 || 1);
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function checkPunching(
  c: Column,
  p: ProjectInputs,
  mu2_lb_in?: number,
  mu3_lb_in?: number,
  slab?: Polygon,
  vuOverride_lb?: number,
): ColumnResult {
  const type: ColumnType = c.type ?? "interior";
  const trib_in2 = c.tributaryArea ?? 0;
  const wu_psi = (1.2 * p.deadPsf + 1.6 * p.livePsf) * psf_to_psi;
  // Prefer an FEA-derived column reaction (vuOverride_lb) over the
  // Voronoi tributary estimate.  Tributary only models nearest-support
  // geometry; FEA captures slab-wall stiffness competition and plate
  // redistribution.
  const vu = vuOverride_lb ?? (wu_psi * trib_in2);

  // Base critical-section rectangle (before edge/corner truncation)
  const b_x = c.c1 + p.dIn;  // X-direction
  const b_y = c.c2 + p.dIn;  // Y-direction

  // Truncated perimeter per column type
  let b0 = 2 * (b_x + b_y);
  if (type === "edge")   b0 = b_x + 2 * b_y;
  if (type === "corner") b0 = b_x + b_y;

  // Biaxial moments; scalar fallback when caller supplies neither
  let mu2 = mu2_lb_in ?? 0;
  let mu3 = mu3_lb_in ?? 0;
  if (mu2_lb_in === undefined && mu3_lb_in === undefined) {
    const fallback = scalarMomentFallback(vu);
    if (b_x >= b_y) mu3 = fallback;
    else            mu2 = fallback;
  }

  // Determine free-edge axis for edge/corner centroid shift
  const freeAxis = (type === "edge" || type === "corner")
    ? (freeEdgeAxis(c, slab) ?? (b_x >= b_y ? "y" : "x"))
    : null;

  // Per-axis Jc and lever arm — choose formula based on truncation direction
  // For Mu2 (about X, bending in Y-direction): b1 = b_y, b2 = b_x
  let jc2: number, c2_lever: number;
  // For Mu3 (about Y, bending in X-direction): b1 = b_x, b2 = b_y
  let jc3: number, c3_lever: number;

  if (type === "interior") {
    jc2 = jcInterior(b_y, b_x, p.dIn);  c2_lever = b_y / 2;
    jc3 = jcInterior(b_x, b_y, p.dIn);  c3_lever = b_x / 2;
  } else if (type === "edge") {
    // Only the axis whose moment span is perpendicular to the free edge
    // sees a centroid shift. The other axis remains interior-symmetric.
    if (freeAxis === "x") {
      // Free edge perpendicular to X → b_x direction is truncated.
      // Mu3 bending is along X → b1_for_Mu3 = b_x is truncated → shift applies.
      const e3 = jcEdge(b_x, b_y, p.dIn);  jc3 = e3.jc; c3_lever = e3.c;
      jc2 = jcInterior(b_y, b_x, p.dIn);   c2_lever = b_y / 2;
    } else {
      // Free edge perpendicular to Y → b_y truncated → Mu2 axis shifts.
      const e2 = jcEdge(b_y, b_x, p.dIn);  jc2 = e2.jc; c2_lever = e2.c;
      jc3 = jcInterior(b_x, b_y, p.dIn);   c3_lever = b_x / 2;
    }
  } else {
    // Corner: both axes truncated.
    const e3 = jcCorner(b_x, b_y, p.dIn);  jc3 = e3.jc; c3_lever = e3.c;
    const e2 = jcCorner(b_y, b_x, p.dIn);  jc2 = e2.jc; c2_lever = e2.c;
  }

  const gv2 = gammas(b_y, b_x).gv;
  const gv3 = gammas(b_x, b_y).gv;

  const direct = vu / (b0 * p.dIn);
  const ecc2 = (gv2 * Math.abs(mu2) * c2_lever) / jc2;
  const ecc3 = (gv3 * Math.abs(mu3) * c3_lever) / jc3;
  const vuMax = direct + ecc2 + ecc3;

  const phiVc_ = phiVc(c.c1, c.c2, b0, p.dIn, type, p.fcPsi, p.phi, p.fcsFactor ?? 1.0);

  const muResultant = Math.hypot(mu2, mu3);

  return {
    columnId: c.id,
    type,
    tributaryAreaIn2: trib_in2,
    vu,
    mu: muResultant,
    mu2,
    mu3,
    b0,
    jc: jc3,
    jc2,
    jc3,
    vuMaxPsi: vuMax,
    phiVcPsi: phiVc_,
    dcr: vuMax / phiVc_,
  };
}

export const lbToKip = (lb: number) => lb / 1000;
export const in2ToFt2 = (in2: number) => in2 / ft2;
