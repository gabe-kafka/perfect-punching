/**
 * Extract per-column reactions and transferred moments from the solved
 * displacement vector.
 *
 * V_u at column i = net downward force transferred slab -> column
 *                 = (K_full * u_full)[w-DOF of column node] - F_full[w-DOF]
 *   where K_full is the stiffness BEFORE BC reduction (so the pinned
 *   row survives and we can read the reaction off of it).
 *
 * M_u about X = K_rot_x * theta_x at the column node.
 * M_u about Y = K_rot_y * theta_y at the column node.
 *
 * Sign convention: positive V_u is downward force on the column.
 */
import type { CSR } from "./assembly.ts";
import type { FEAColumnSpring, FEAResult } from "./types.ts";

function rowDot(K: CSR, row: number, u: Float64Array): number {
  let s = 0;
  const start = K.rowPtr[row], end = K.rowPtr[row + 1];
  for (let k = start; k < end; k++) s += K.values[k] * u[K.colIdx[k]];
  return s;
}

export function recoverColumnResults(
  Kfull: CSR,
  F: Float64Array,
  u: Float64Array,
  springs: FEAColumnSpring[],
): FEAResult["columns"] {
  const out: FEAResult["columns"] = new Map();
  for (const s of springs) {
    const wDof = 3 * s.nodeIndex;
    const txDof = 3 * s.nodeIndex + 1;
    const tyDof = 3 * s.nodeIndex + 2;

    // Equilibrium at a pinned w-DOF:  K u = F + R_pin  (R_pin is the
    // reaction applied BY the support TO the slab).  Under a positive-
    // down load q the pin holds the slab up, so R_pin < 0 in the
    // positive-down convention.  The slab applies the opposite: a
    // downward force F - K u on the column, which is the "V_u" the
    // punching check consumes.
    const Kdotu_w = rowDot(Kfull, wDof, u);
    const Vu = F[wDof] - Kdotu_w;

    const muAboutX = s.kAboutX * u[txDof];
    const muAboutY = s.kAboutY * u[tyDof];

    out.set(s.id, {
      Vu,   // positive = downward force on column
      muAboutX,
      muAboutY,
      wAtCol: u[wDof],
    });
  }
  return out;
}

/**
 * Sum the downward forces transferred slab -> columns and slab -> walls.
 * Each contribution = F - K u at the pinned w-DOF (positive = downward
 * force on the support, matching the sign convention of recoverColumnResults).
 */
export function sumReactions(
  Kfull: CSR,
  F: Float64Array,
  u: Float64Array,
  columnWDofs: number[],
  wallWDofs: number[],
): { colSum: number; wallSum: number; total: number } {
  let colSum = 0;
  for (const wDof of columnWDofs) {
    colSum += F[wDof] - rowDot(Kfull, wDof, u);
  }
  let wallSum = 0;
  for (const wDof of wallWDofs) {
    wallSum += F[wDof] - rowDot(Kfull, wDof, u);
  }
  return { colSum, wallSum, total: colSum + wallSum };
}
