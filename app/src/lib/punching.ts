/**
 * Per-column punching shear check (ACI 318 §22.6.5 + §8.4.2.3).
 *
 * Biaxial formulation: unbalanced moments about both principal axes, Mu2
 * (about local 2, i.e. about X for an un-rotated column) and Mu3 (about
 * local 3, about Y), each with its own γv, Jc, and lever arm. The two
 * eccentric-shear contributions add to the direct shear stress at the
 * critical-section corner closest to the resultant of the moment vectors.
 *
 * Inputs:  Column (c1, c2, type, tributaryArea), ProjectInputs,
 *          optional (mu2, mu3) from an EFM-lite or FEA solver.
 * Output:  ColumnResult with both per-axis and summary quantities.
 *
 * Simplifications still in v1:
 *   Critical section assumed axis-aligned (column rotation ignored).
 *   b_0 reduced for edge/corner columns using the ACI-table shortcut.
 *   Jc uses the interior rectangular formulas — edge/corner centroid
 *        shift is not modeled here (see the edge/corner commit).
 */
import type { Column, ColumnResult, ColumnType, ProjectInputs } from "./types";

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
 * Polar moment of inertia of an interior rectangular critical section
 * about the axis perpendicular to b1 (the moment-span direction).
 */
function jcRect(b1: number, b2: number, d: number) {
  return (d * b1 ** 3) / 6 + (b1 * d ** 3) / 6 + (b2 * d * b1 ** 2) / 2;
}

/**
 * Placeholder used only when no (mu2, mu3) are supplied. Returns a
 * small conservative static moment so edge/corner columns still show
 * some Mu. Prefer passing explicit unbalancedMoments() from efm.ts.
 */
function scalarMomentFallback(vu_lb: number): number {
  return 0.05 * vu_lb * 12 * 20;
}

export function checkPunching(
  c: Column,
  p: ProjectInputs,
  mu2_lb_in?: number,
  mu3_lb_in?: number,
): ColumnResult {
  const type: ColumnType = c.type ?? "interior";
  const trib_in2 = c.tributaryArea ?? 0;
  const wu_psi = (1.2 * p.deadPsf + 1.6 * p.livePsf) * psf_to_psi;
  const vu = wu_psi * trib_in2;  // lb

  // Critical section dimensions (axis-aligned; rotation not yet handled).
  const b_x = c.c1 + p.dIn;  // X-direction
  const b_y = c.c2 + p.dIn;  // Y-direction
  let b0 = 2 * (b_x + b_y);
  if (type === "edge")   b0 = b_x + 2 * b_y;   // one side truncated
  if (type === "corner") b0 = b_x + b_y;       // two sides truncated

  // If caller didn't supply biaxial moments, fall back to a scalar estimate
  // applied about the longer axis so the ecc term still registers.
  let mu2 = mu2_lb_in ?? 0;
  let mu3 = mu3_lb_in ?? 0;
  if (mu2_lb_in === undefined && mu3_lb_in === undefined) {
    const fallback = scalarMomentFallback(vu);
    if (b_x >= b_y) mu3 = fallback;
    else            mu2 = fallback;
  }

  // Per-axis γv and Jc.
  // Mu2 (about local 2 ~ X-axis): moment span is along Y → b1 = b_y, b2 = b_x.
  const gv2 = gammas(b_y, b_x).gv;
  const jc2 = jcRect(b_y, b_x, p.dIn);
  const c2_lever = b_y / 2;

  // Mu3 (about local 3 ~ Y-axis): moment span is along X → b1 = b_x, b2 = b_y.
  const gv3 = gammas(b_x, b_y).gv;
  const jc3 = jcRect(b_x, b_y, p.dIn);
  const c3_lever = b_x / 2;

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
