/**
 * Boundary conditions and column rotational springs.
 *
 * Three kinds of constraints applied in this v1:
 *
 *   1. Column centroid: w = 0 (pin), plus rotational springs resisting
 *      theta_x and theta_y.  The springs represent the flexural stiffness
 *      that the column (as a fixed-far-end beam) exerts back on the slab
 *      when the slab tries to rotate at the joint.
 *
 *   2. Wall nodes: w = 0 (pin).  No rotational restraint — the slab is
 *      free to rotate across the wall line.
 *
 *   3. Slab edges: free.
 *
 * Not yet implemented (noted in the PR description as a follow-up):
 *   - Rigid master-slave patch over the c1 x c2 column footprint.  The
 *     current point-pin at a single mesh node will over-localize the
 *     slab rotation near each column and produces a mesh-dependent M_u.
 *     This is acceptable only for the end-to-end pipeline shake-out; the
 *     rigid patch upgrade lands before the vs-SAFE accuracy pass.
 */
import type { CSR } from "./assembly.ts";
import { csrAddEntry } from "./assembly.ts";
import type { Column, ProjectInputs } from "../lib/types.ts";
import type { FEAMesh, FEAColumnSpring, FEAMaterial } from "./types.ts";

/**
 * Rigid master-slave patch over each column footprint.
 *
 *   slave_w   = master_w + master_theta_y * dx - master_theta_x * dy
 *   slave_tx  = master_tx
 *   slave_ty  = master_ty
 *
 * with (dx, dy) = (x_slave - x_master, y_slave - y_master).  Implemented
 * as matrix condensation: K' = T^T K T via in-place sparse row/column
 * folds.  Slave DOFs are orphaned after the fold and pinned to zero in
 * the reduction.  After solve, reconstruct slave displacements from
 * master values via the same constraint.
 */
export interface RigidPatch {
  columnId: string;
  masterNode: number;
  slaves: { nodeIndex: number; dx: number; dy: number }[];
}

/** Which mesh nodes lie inside each column's c1 x c2 footprint (axis-aligned). */
export function identifyColumnPatches(
  mesh: FEAMesh,
  columns: Column[],
): RigidPatch[] {
  const patches: RigidPatch[] = [];
  for (const col of columns) {
    const master = mesh.columnNodes.get(col.id);
    if (master === undefined) continue;
    const mNode = mesh.nodes[master];
    const halfC1 = col.c1 / 2, halfC2 = col.c2 / 2;
    const eps = 1e-6;
    const slaves: RigidPatch["slaves"] = [];
    for (let i = 0; i < mesh.nodes.length; i++) {
      if (i === master) continue;
      if (mesh.wallNodes.has(i)) continue;        // wall-pinned nodes stay independent
      // exclude other columns' master nodes
      let otherMaster = false;
      for (const [, n2] of mesh.columnNodes) {
        if (n2 === i) { otherMaster = true; break; }
      }
      if (otherMaster) continue;
      const n = mesh.nodes[i];
      const dx = n.x - mNode.x, dy = n.y - mNode.y;
      if (Math.abs(dx) <= halfC1 + eps && Math.abs(dy) <= halfC2 + eps) {
        slaves.push({ nodeIndex: i, dx, dy });
      }
    }
    patches.push({ columnId: col.id, masterNode: master, slaves });
  }
  return patches;
}

/**
 * Apply rigid-patch constraints in place.  After this returns, K is
 * K_reduced (slave DOFs zeroed), F is F_reduced, and slaveDofs contains
 * every slave DOF index so the caller can add them to the pinned set.
 *
 * Internally we convert K to row-keyed map form, do the row+col folds,
 * then recompact to CSR.
 */
export function applyRigidPatches(
  K: CSR,
  F: Float64Array,
  patches: RigidPatch[],
): { K: CSR; F: Float64Array; slaveDofs: Set<number> } {
  const n = K.n;

  // Inflate CSR -> row-map form for in-place edits.
  const rows: Map<number, number>[] = [];
  for (let i = 0; i < n; i++) rows.push(new Map());
  for (let i = 0; i < n; i++) {
    const start = K.rowPtr[i], end = K.rowPtr[i + 1];
    for (let k = start; k < end; k++) {
      rows[i].set(K.colIdx[k], K.values[k]);
    }
  }

  const slaveDofs = new Set<number>();
  for (const p of patches) {
    const mw  = 3 * p.masterNode;
    const mtx = 3 * p.masterNode + 1;
    const mty = 3 * p.masterNode + 2;

    for (const s of p.slaves) {
      const sw  = 3 * s.nodeIndex;
      const stx = 3 * s.nodeIndex + 1;
      const sty = 3 * s.nodeIndex + 2;
      const dx = s.dx, dy = s.dy;

      // ---- Fold slave rows into master rows (also F) ----
      const F_sw = F[sw], F_stx = F[stx], F_sty = F[sty];
      F[mw]  += F_sw;
      F[mtx] += -dy * F_sw + F_stx;
      F[mty] +=  dx * F_sw + F_sty;
      F[sw] = 0; F[stx] = 0; F[sty] = 0;

      for (const [col, v] of rows[sw]) {
        rows[mw].set(col,  (rows[mw].get(col)  ?? 0) + v);
        rows[mtx].set(col, (rows[mtx].get(col) ?? 0) + (-dy) * v);
        rows[mty].set(col, (rows[mty].get(col) ?? 0) +   dx  * v);
      }
      for (const [col, v] of rows[stx]) {
        rows[mtx].set(col, (rows[mtx].get(col) ?? 0) + v);
      }
      for (const [col, v] of rows[sty]) {
        rows[mty].set(col, (rows[mty].get(col) ?? 0) + v);
      }
      rows[sw].clear();
      rows[stx].clear();
      rows[sty].clear();

      slaveDofs.add(sw);
      slaveDofs.add(stx);
      slaveDofs.add(sty);
    }
  }

  // ---- Fold slave columns into master columns (one sweep over all rows) ----
  // We walk every row and, for any non-zero entry pointing to a slave column,
  // redistribute to the master columns with the proper lever.  Lookup table:
  const slaveInfo = new Map<number, { mDof: number; lever: number }>();
  // Slave w-DOF -> (master_w, 1), also contributes to (master_tx, -dy) and (master_ty, dx)
  // But only one "primary" master for each slave DOF: w-DOF spreads to 3 master DOFs.
  // To do this cleanly, track three entries per slave DOF.
  const slaveSpread = new Map<number, { masterDof: number; coef: number }[]>();
  for (const p of patches) {
    const mw  = 3 * p.masterNode;
    const mtx = 3 * p.masterNode + 1;
    const mty = 3 * p.masterNode + 2;
    for (const s of p.slaves) {
      const sw  = 3 * s.nodeIndex;
      const stx = 3 * s.nodeIndex + 1;
      const sty = 3 * s.nodeIndex + 2;
      slaveSpread.set(sw,  [{ masterDof: mw, coef: 1 }, { masterDof: mtx, coef: -s.dy }, { masterDof: mty, coef: s.dx }]);
      slaveSpread.set(stx, [{ masterDof: mtx, coef: 1 }]);
      slaveSpread.set(sty, [{ masterDof: mty, coef: 1 }]);
    }
  }
  for (let i = 0; i < n; i++) {
    const row = rows[i];
    // Collect slave column hits first (to avoid mutating while iterating)
    const hits: { slaveCol: number; v: number }[] = [];
    for (const [col, v] of row) {
      if (slaveSpread.has(col)) hits.push({ slaveCol: col, v });
    }
    for (const { slaveCol, v } of hits) {
      for (const { masterDof, coef } of slaveSpread.get(slaveCol)!) {
        row.set(masterDof, (row.get(masterDof) ?? 0) + coef * v);
      }
      row.delete(slaveCol);
    }
  }

  // Recompact to CSR.
  let nnz = 0;
  for (const r of rows) nnz += r.size;
  const rowPtr = new Int32Array(n + 1);
  const colIdx = new Int32Array(nnz);
  const values = new Float64Array(nnz);
  let w = 0;
  for (let i = 0; i < n; i++) {
    rowPtr[i] = w;
    const sorted = [...rows[i].keys()].sort((a, b) => a - b);
    for (const c of sorted) {
      colIdx[w] = c;
      values[w] = rows[i].get(c)!;
      w++;
    }
  }
  rowPtr[n] = w;

  return {
    K: { n, rowPtr, colIdx, values },
    F,
    slaveDofs,
  };
}

/** After the solve, reconstruct the slave DOFs from their masters. */
export function reconstructSlaves(u: Float64Array, patches: RigidPatch[]): void {
  for (const p of patches) {
    const mw  = u[3 * p.masterNode];
    const mtx = u[3 * p.masterNode + 1];
    const mty = u[3 * p.masterNode + 2];
    for (const s of p.slaves) {
      u[3 * s.nodeIndex]     = mw + mty * s.dx - mtx * s.dy;
      u[3 * s.nodeIndex + 1] = mtx;
      u[3 * s.nodeIndex + 2] = mty;
    }
  }
}

/** Young's modulus from f'c (ACI 318 normal-weight concrete). */
export function concreteE(fcPsi: number): number {
  return 57000 * Math.sqrt(fcPsi);
}

/**
 * Compute column rotational spring stiffness at the slab-column joint.
 * K_rot = 4 E_col I / L for a fixed far-end, 3 E_col I / L for pinned.
 *
 * I_x (resists theta_x = rotation about global X) uses the section's
 * second moment about the global X-axis = c1 * c2^3 / 12.
 * I_y uses c2 * c1^3 / 12.
 */
export function columnSpringStiffness(
  col: Column,
  mat: FEAMaterial,
  heightIn: number,
  farEndFixity: "fixed" | "pinned",
): { kAboutX: number; kAboutY: number } {
  const c1 = col.c1, c2 = col.c2;
  const Ix = (c1 * c2 * c2 * c2) / 12;
  const Iy = (c2 * c1 * c1 * c1) / 12;
  const factor = farEndFixity === "fixed" ? 4 : 3;
  const kx = (factor * mat.E * Ix) / heightIn;
  const ky = (factor * mat.E * Iy) / heightIn;
  return { kAboutX: kx, kAboutY: ky };
}

/**
 * Build the list of spring definitions (one per column).  The caller
 * applies these to the global K by adding to the diagonals of the
 * column's theta_x / theta_y DOFs.
 */
export function buildColumnSprings(
  mesh: FEAMesh,
  columns: Column[],
  inputs: ProjectInputs,
  mat: FEAMaterial,
): FEAColumnSpring[] {
  const heightIn = inputs.columnHeightIn ?? 144;
  const fixity = inputs.columnFarEndFixity ?? "fixed";
  const out: FEAColumnSpring[] = [];
  for (const col of columns) {
    const nodeIndex = mesh.columnNodes.get(col.id);
    if (nodeIndex === undefined) continue;
    const { kAboutX, kAboutY } = columnSpringStiffness(col, mat, heightIn, fixity);
    out.push({ id: col.id, nodeIndex, kAboutX, kAboutY });
  }
  return out;
}

/** Add rotational spring stiffnesses into the assembled global K (in place). */
export function applyColumnSprings(K: CSR, springs: FEAColumnSpring[]): void {
  for (const s of springs) {
    // DOF layout: [w, theta_x, theta_y] -> offsets 0, 1, 2
    csrAddEntry(K, 3 * s.nodeIndex + 1, 3 * s.nodeIndex + 1, s.kAboutX);
    csrAddEntry(K, 3 * s.nodeIndex + 2, 3 * s.nodeIndex + 2, s.kAboutY);
  }
}

/**
 * Identify fixed (pinned-to-zero) DOFs from column and wall nodes.
 * Only the w-DOF is pinned — rotations remain free.
 */
export function collectFixedDofs(mesh: FEAMesh): Set<number> {
  const fixed = new Set<number>();
  for (const nodeIdx of mesh.columnNodes.values()) fixed.add(3 * nodeIdx);
  for (const nodeIdx of mesh.wallNodes) fixed.add(3 * nodeIdx);
  return fixed;
}

export interface ReducedSystem {
  /** Reduced K acting on free DOFs only. */
  Kr: CSR;
  /** Reduced load vector. */
  Fr: Float64Array;
  /** Map from free-DOF index -> original global DOF. */
  free: Int32Array;
  /** Map from global DOF -> reduced index, or -1 if pinned. */
  dofMap: Int32Array;
  /** The fixed DOFs (all pinned to zero). */
  fixed: Set<number>;
}

/**
 * Build the reduced system by eliminating pinned (w=0) DOFs.  Since all
 * pinned DOFs are fixed to zero, this is a simple row/column deletion of
 * K and F.
 */
export function reduceSystem(K: CSR, F: Float64Array, fixed: Set<number>): ReducedSystem {
  const n = K.n;
  const dofMap = new Int32Array(n).fill(-1);
  const free: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!fixed.has(i)) {
      dofMap[i] = free.length;
      free.push(i);
    }
  }
  const nr = free.length;

  // Reduced F
  const Fr = new Float64Array(nr);
  for (let i = 0; i < nr; i++) Fr[i] = F[free[i]];

  // Reduced K: walk rows of the free DOFs, copy entries whose column is also free.
  const rowPtrR = new Int32Array(nr + 1);
  const colsBuffer: number[][] = [];
  const valsBuffer: number[][] = [];
  let nnzR = 0;
  for (let ir = 0; ir < nr; ir++) {
    const origRow = free[ir];
    const start = K.rowPtr[origRow], end = K.rowPtr[origRow + 1];
    const cs: number[] = [];
    const vs: number[] = [];
    for (let k = start; k < end; k++) {
      const origCol = K.colIdx[k];
      const mapped = dofMap[origCol];
      if (mapped < 0) continue;
      cs.push(mapped);
      vs.push(K.values[k]);
    }
    colsBuffer.push(cs);
    valsBuffer.push(vs);
    nnzR += cs.length;
  }
  const colIdxR = new Int32Array(nnzR);
  const valuesR = new Float64Array(nnzR);
  let w = 0;
  for (let ir = 0; ir < nr; ir++) {
    rowPtrR[ir] = w;
    const cs = colsBuffer[ir], vs = valsBuffer[ir];
    for (let k = 0; k < cs.length; k++) {
      colIdxR[w] = cs[k];
      valuesR[w] = vs[k];
      w++;
    }
  }
  rowPtrR[nr] = w;

  return {
    Kr: { n: nr, rowPtr: rowPtrR, colIdx: colIdxR, values: valuesR },
    Fr,
    free: Int32Array.from(free),
    dofMap,
    fixed,
  };
}

/** Expand a reduced displacement back to the full global vector (zeros on fixed DOFs). */
export function expandDisplacement(n: number, free: Int32Array, ur: Float64Array): Float64Array {
  const u = new Float64Array(n);
  for (let i = 0; i < free.length; i++) u[free[i]] = ur[i];
  return u;
}
