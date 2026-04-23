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

/** Baseline γf per ACI 318-19 Eq. 8.4.2.2.2. b1 is in the moment-span direction. */
function gammas(b1: number, b2: number) {
  const gf = 1 / (1 + (2 / 3) * Math.sqrt(b1 / b2));
  return { gf, gv: 1 - gf };
}

/**
 * γf per Table 8.4.2.2.4 when the direct-shear gate passes; otherwise
 * falls back to the baseline.  Returns `{gv, modified}` where `modified`
 * is true if the table's modified γf was applied.
 *
 *   v_uv   = V_u / A_c   (direct shear stress only, no moment)
 *   phiVc  = design capacity (already includes φ)
 *   parallelToEdge: for edge columns, whether THIS axis's moment span
 *                   runs parallel to the free edge.  Ignored for
 *                   interior/corner (single row for each).
 */
function gammaVForAxis(
  b1: number, b2: number,
  colType: ColumnType,
  parallelToEdge: boolean,
  vuv: number, phiVc: number,
  useTable: boolean,
): { gv: number; modified: boolean } {
  const baselineGf = 1 / (1 + (2 / 3) * Math.sqrt(b1 / b2));
  if (!useTable) return { gv: 1 - baselineGf, modified: false };

  let thresholdFrac: number;
  let gfMax: number;
  if (colType === "corner") {
    thresholdFrac = 0.5; gfMax = 1.0;
  } else if (colType === "edge") {
    if (parallelToEdge) {
      thresholdFrac = 0.4;
      gfMax = Math.min(1.25 * baselineGf, 1.0);
    } else {
      thresholdFrac = 0.75; gfMax = 1.0;
    }
  } else {
    thresholdFrac = 0.4;
    gfMax = Math.min(1.25 * baselineGf, 1.0);
  }
  if (vuv <= thresholdFrac * phiVc) {
    return { gv: 1 - gfMax, modified: true };
  }
  return { gv: 1 - baselineGf, modified: false };
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

export interface MoFloor {
  /** Floor on |mu2| (bending in y), lb-in. */
  mu2Floor: number;
  /** Floor on |mu3| (bending in x), lb-in. */
  mu3Floor: number;
}

export function checkPunching(
  c: Column,
  p: ProjectInputs,
  mu2_lb_in?: number,
  mu3_lb_in?: number,
  slab?: Polygon,
  vuOverride_lb?: number,
  moFloor?: MoFloor,
): ColumnResult {
  const type: ColumnType = c.type ?? "interior";
  const trib_in2 = c.tributaryArea ?? 0;
  const wu_psi = (1.2 * p.deadPsf + 1.6 * p.livePsf) * psf_to_psi;
  // Prefer an FEA-derived column reaction (vuOverride_lb) over the
  // Voronoi tributary estimate.  Tributary only models nearest-support
  // geometry; FEA captures slab-wall stiffness competition and plate
  // redistribution.
  const vu = vuOverride_lb ?? (wu_psi * trib_in2);

  // Critical-section face lengths per ACI 318 §22.6.4.
  //
  // An interior column extends d/2 past both sides of each column face
  // (face length = c + d).  At a free slab edge the extension exists
  // only on the interior side (face length = c + d/2).  So:
  //   interior:  bx = c1 + d,    by = c2 + d
  //   edge:      one direction truncated (c + d/2), the other full
  //   corner:    both directions truncated (c + d/2)
  //
  // These face lengths also feed Jc — jcEdge() and jcCorner() expect
  // the TRUNCATED lengths, not the full interior-column extensions.
  const bx_full  = c.c1 + p.dIn;
  const by_full  = c.c2 + p.dIn;
  const bx_trunc = c.c1 + p.dIn / 2;
  const by_trunc = c.c2 + p.dIn / 2;

  // Biaxial moments; scalar fallback when caller supplies neither.
  let mu2 = mu2_lb_in ?? 0;
  let mu3 = mu3_lb_in ?? 0;
  if (mu2_lb_in === undefined && mu3_lb_in === undefined) {
    const fallback = scalarMomentFallback(vu);
    if (bx_full >= by_full) mu3 = fallback;
    else                    mu2 = fallback;
  }

  // 0.3·Mo lower-bound (DDM historical minimum) — prevents solver Mu
  // from silently under-predicting. Preserves sign from solver when
  // present, positive otherwise.
  let mu2FloorApplied = false;
  let mu3FloorApplied = false;
  if (moFloor) {
    if (Math.abs(mu2) < moFloor.mu2Floor) {
      mu2 = (mu2 < 0 ? -1 : 1) * moFloor.mu2Floor;
      mu2FloorApplied = true;
    }
    if (Math.abs(mu3) < moFloor.mu3Floor) {
      mu3 = (mu3 < 0 ? -1 : 1) * moFloor.mu3Floor;
      mu3FloorApplied = true;
    }
  }

  // Determine free-edge axis for edge/corner centroid shift.
  const freeAxis = (type === "edge" || type === "corner")
    ? (freeEdgeAxis(c, slab) ?? (bx_full >= by_full ? "y" : "x"))
    : null;

  // Effective face lengths after edge/corner truncation.  Used for b0,
  // γv, and as arguments into jcEdge/jcCorner.
  let bx_eff: number, by_eff: number, b0: number;
  if (type === "interior") {
    bx_eff = bx_full;  by_eff = by_full;
    b0 = 2 * (bx_full + by_full);
  } else if (type === "corner") {
    bx_eff = bx_trunc; by_eff = by_trunc;
    b0 = bx_trunc + by_trunc;
  } else if (freeAxis === "x") {
    // Free edge perpendicular to X → x-direction faces truncated.
    // Critical section: 2 truncated x-faces + 1 full y-face.
    bx_eff = bx_trunc; by_eff = by_full;
    b0 = by_full + 2 * bx_trunc;
  } else {
    // Free edge perpendicular to Y → y-direction faces truncated.
    bx_eff = bx_full;  by_eff = by_trunc;
    b0 = bx_full + 2 * by_trunc;
  }

  // Per-axis Jc and lever arm.  Pass the truncated face lengths into
  // jcEdge/jcCorner — those formulas take the actual face dims, not
  // the interior-extension lengths.
  //   Mu2 is about X, bending span in Y → "b1" for Mu2 is by_eff.
  //   Mu3 is about Y, bending span in X → "b1" for Mu3 is bx_eff.
  let jc2: number, c2_lever: number;
  let jc3: number, c3_lever: number;

  if (type === "interior") {
    jc2 = jcInterior(by_eff, bx_eff, p.dIn);  c2_lever = by_eff / 2;
    jc3 = jcInterior(bx_eff, by_eff, p.dIn);  c3_lever = bx_eff / 2;
  } else if (type === "edge") {
    if (freeAxis === "x") {
      // x-axis faces truncated → Mu3 (bending in x) sees the shift.
      const e3 = jcEdge(bx_eff, by_eff, p.dIn);  jc3 = e3.jc; c3_lever = e3.c;
      jc2 = jcInterior(by_eff, bx_eff, p.dIn);   c2_lever = by_eff / 2;
    } else {
      // y-axis faces truncated → Mu2 (bending in y) sees the shift.
      const e2 = jcEdge(by_eff, bx_eff, p.dIn);  jc2 = e2.jc; c2_lever = e2.c;
      jc3 = jcInterior(bx_eff, by_eff, p.dIn);   c3_lever = bx_eff / 2;
    }
  } else {
    // Corner: both axes truncated.
    const e3 = jcCorner(bx_eff, by_eff, p.dIn);  jc3 = e3.jc; c3_lever = e3.c;
    const e2 = jcCorner(by_eff, bx_eff, p.dIn);  jc2 = e2.jc; c2_lever = e2.c;
  }

  const direct = vu / (b0 * p.dIn);
  const phiVc_ = phiVc(c.c1, c.c2, b0, p.dIn, type, p.fcPsi, p.phi, p.fcsFactor ?? 1.0);

  // Table 8.4.2.2.4 gate uses DIRECT shear stress v_uv (no moments).
  // For edge columns, the "parallel to edge" bound applies to the axis
  // whose moment span runs along the free edge:
  //   freeAxis "x" (edge ⟂ x, edge runs in y): Mu3 span=x ⟂ edge; Mu2 span=y ∥ edge
  //   freeAxis "y" (edge ⟂ y, edge runs in x): Mu3 span=x ∥ edge; Mu2 span=y ⟂ edge
  const useTable = p.applyAciDesignAssumptions ?? true;
  const mu2ParallelToEdge = type === "edge" && freeAxis === "x";
  const mu3ParallelToEdge = type === "edge" && freeAxis === "y";
  const gv2Res = gammaVForAxis(by_eff, bx_eff, type, mu2ParallelToEdge, direct, phiVc_, useTable);
  const gv3Res = gammaVForAxis(bx_eff, by_eff, type, mu3ParallelToEdge, direct, phiVc_, useTable);
  const gv2 = gv2Res.gv;
  const gv3 = gv3Res.gv;

  const ecc2 = (gv2 * Math.abs(mu2) * c2_lever) / jc2;
  const ecc3 = (gv3 * Math.abs(mu3) * c3_lever) / jc3;
  const vuMax = direct + ecc2 + ecc3;

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
    mu2FloorApplied,
    mu3FloorApplied,
    mu2FloorValue: moFloor?.mu2Floor,
    mu3FloorValue: moFloor?.mu3Floor,
  };
}

export const lbToKip = (lb: number) => lb / 1000;
export const in2ToFt2 = (in2: number) => in2 / ft2;
