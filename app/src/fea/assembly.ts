/**
 * Global stiffness assembly.
 *
 * Builds the sparse 3N x 3N stiffness matrix K in CSR form from the
 * per-element DKT stiffness matrices.
 */
import { keDKT } from "./dkt.ts";
import type { FEAMesh, FEAMaterial } from "./types.ts";

/** Compressed-sparse-row matrix, upper and lower triangles both stored. */
export interface CSR {
  n: number;
  rowPtr: Int32Array;  // length n+1
  colIdx: Int32Array;  // length nnz
  values: Float64Array; // length nnz
}

/** Flexural rigidity D = E h^3 / (12 (1 - nu^2)).  Returned in lb-in. */
export function flexuralRigidity(mat: FEAMaterial): number {
  return (mat.E * Math.pow(mat.h, 3)) / (12 * (1 - mat.nu * mat.nu));
}

/**
 * Assemble the global stiffness.  Uses an intermediate row-wise map of
 * column-index -> value for O(nnz) compaction to CSR.
 */
export function assembleGlobalK(mesh: FEAMesh, mat: FEAMaterial): CSR {
  const nDof = mesh.nodes.length * 3;
  const D = flexuralRigidity(mat);
  const nu = mat.nu;

  // Per-row accumulators.
  const rowMaps: Map<number, number>[] = [];
  for (let i = 0; i < nDof; i++) rowMaps.push(new Map());

  for (const elem of mesh.elements) {
    const [n0, n1, n2] = elem.n;
    const p0 = mesh.nodes[n0];
    const p1 = mesh.nodes[n1];
    const p2 = mesh.nodes[n2];
    const Ke = keDKT(p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, D, nu);

    const gdof = [
      3 * n0, 3 * n0 + 1, 3 * n0 + 2,
      3 * n1, 3 * n1 + 1, 3 * n1 + 2,
      3 * n2, 3 * n2 + 1, 3 * n2 + 2,
    ];
    for (let i = 0; i < 9; i++) {
      const row = rowMaps[gdof[i]];
      for (let j = 0; j < 9; j++) {
        const v = Ke[i][j];
        if (v === 0) continue;
        const col = gdof[j];
        row.set(col, (row.get(col) ?? 0) + v);
      }
    }
  }

  // Compact to CSR with sorted columns per row.
  let nnz = 0;
  for (const r of rowMaps) nnz += r.size;
  const rowPtr = new Int32Array(nDof + 1);
  const colIdx = new Int32Array(nnz);
  const values = new Float64Array(nnz);
  let k = 0;
  for (let i = 0; i < nDof; i++) {
    rowPtr[i] = k;
    const r = rowMaps[i];
    const cols = Array.from(r.keys()).sort((a, b) => a - b);
    for (const c of cols) {
      colIdx[k] = c;
      values[k] = r.get(c)!;
      k++;
    }
  }
  rowPtr[nDof] = k;
  return { n: nDof, rowPtr, colIdx, values };
}

/** y += alpha * K * x  (sparse matrix-vector multiply). */
export function csrMatVec(K: CSR, x: Float64Array, y: Float64Array, alpha = 1): void {
  const { n, rowPtr, colIdx, values } = K;
  for (let i = 0; i < n; i++) {
    let s = 0;
    const start = rowPtr[i], end = rowPtr[i + 1];
    for (let k = start; k < end; k++) {
      s += values[k] * x[colIdx[k]];
    }
    y[i] += alpha * s;
  }
}

/** Extract the diagonal of K. */
export function csrDiagonal(K: CSR): Float64Array {
  const { n, rowPtr, colIdx, values } = K;
  const diag = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const start = rowPtr[i], end = rowPtr[i + 1];
    for (let k = start; k < end; k++) {
      if (colIdx[k] === i) { diag[i] = values[k]; break; }
    }
  }
  return diag;
}

/** Add v to the (i,j) entry.  Requires (i,j) to already be in the sparsity
 *  pattern (true when i,j share an element; used here only for adding
 *  diagonal or same-node spring terms).  Caller must ensure the slot exists. */
export function csrAddEntry(K: CSR, i: number, j: number, v: number): void {
  const { rowPtr, colIdx, values } = K;
  const start = rowPtr[i], end = rowPtr[i + 1];
  for (let k = start; k < end; k++) {
    if (colIdx[k] === j) { values[k] += v; return; }
  }
  throw new Error(`csrAddEntry: (${i},${j}) not in sparsity pattern`);
}
