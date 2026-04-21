/**
 * Per-column punching shear check (ACI 318 §22.6.5 + §8.4.2.3).
 *
 * Inputs:  Column (with c1, c2, type, tributaryArea), ProjectInputs.
 * Output:  ColumnResult — V_u, M_u, b_0, J_c, v_u_max, φv_c, DCR.
 *
 * Simplifications for v1 (no FEA yet):
 *   V_u = uniform load × tributary area.
 *   M_u from a simple coefficient (see momentEstimate). Real M_u
 *        comes from plate FEA in a later phase.
 *   Critical section assumed rectangular (b1×b2 with b1=c1+d, b2=c2+d).
 *   Truncation at slab edges: b_0 reduced for edge / corner columns
 *        per the standard ACI table-style adjustment.
 */
import type { Column, ColumnResult, ProjectInputs } from "./types";

const psf_to_psi = 1 / 144;
const ft2 = 144;

/**
 * Two-way shear capacity (no shear reinforcement, normal-weight, λ=λs=1).
 *
 * fcsFactor (default 1.0) multiplies f'_c under the square root. ACI 318
 * uses f'_c directly. SAFE's default workflow applies ~0.8 as a conservative
 * reduction — set fcsFactor=0.8 to SAFE-match.
 */
export function phiVc(
  c1: number, c2: number, b0: number, d: number, type: ColumnResult["type"],
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

/** γf, γv per ACI 318 eq 8.4.2.3.2. */
function gammas(b1: number, b2: number) {
  const gf = 1 / (1 + (2 / 3) * Math.sqrt(b1 / b2));
  return { gf, gv: 1 - gf };
}

/**
 * Polar moment of inertia of the critical section about the centroidal
 * axis perpendicular to the moment span. Interior rectangular column.
 */
function jcInterior(b1: number, b2: number, d: number) {
  return (d * b1 ** 3) / 6 + (b1 * d ** 3) / 6 + (b2 * d * b1 ** 2) / 2;
}

/**
 * Crude M_u estimate for v1. Uses 5% of column reaction × average
 * span (assumed 20 ft for now). Replace with FEA-derived value later.
 */
function momentEstimate(vu_lb: number): number {
  const avgSpanIn = 20 * 12;
  return 0.05 * vu_lb * avgSpanIn;
}

export function checkPunching(c: Column, p: ProjectInputs): ColumnResult {
  const type = c.type ?? "interior";
  const trib_in2 = c.tributaryArea ?? 0;
  const wu_psi = (1.2 * p.deadPsf + 1.6 * p.livePsf) * psf_to_psi;
  const vu = wu_psi * trib_in2;  // lb

  const b1 = c.c1 + p.dIn;
  const b2 = c.c2 + p.dIn;
  let b0 = 2 * (b1 + b2);
  if (type === "edge")   b0 = b1 + 2 * b2;          // one side truncated
  if (type === "corner") b0 = b1 + b2;              // two sides truncated

  const jc = jcInterior(b1, b2, p.dIn);
  const mu = momentEstimate(vu);
  const { gv } = gammas(b1, b2);

  const direct = vu / (b0 * p.dIn);
  const ecc = (gv * mu * (b1 / 2)) / jc;
  const vuMax = direct + ecc;

  const phiVc_ = phiVc(c.c1, c.c2, b0, p.dIn, type, p.fcPsi, p.phi, p.fcsFactor ?? 1.0);

  return {
    columnId: c.id,
    type,
    tributaryAreaIn2: trib_in2,
    vu,
    mu,
    b0,
    jc,
    vuMaxPsi: vuMax,
    phiVcPsi: phiVc_,
    dcr: vuMax / phiVc_,
  };
}

/** Helpful: convert vu_lb back to kip and tributary area to ft². */
export const lbToKip = (lb: number) => lb / 1000;
export const in2ToFt2 = (in2: number) => in2 / ft2;
