/**
 * Consistent nodal load vector for uniform pressure q (lb / in^2).
 *
 * For uniform pressure, the consistent DKT element load vector has its
 * entire work term on the w-DOFs with weight q * A / 3 per vertex; the
 * rotational DOFs get zero (because integrating N_i * q over a triangle
 * with constant q and vanishing rotational shape functions yields zero).
 * This is exact for uniform q.  Non-uniform q would need the full
 * consistent integration; deferred to v1.1.
 */
import type { FEAMesh } from "./types.ts";

/** Uniform pressure q in lb/in^2.  Sign: positive q is downward loading. */
export function assembleLoadVector(mesh: FEAMesh, q: number): Float64Array {
  const F = new Float64Array(mesh.nodes.length * 3);
  for (const elem of mesh.elements) {
    const contrib = q * elem.area / 3;
    for (const nodeIdx of elem.n) {
      F[3 * nodeIdx] += contrib;  // w-DOF only
    }
  }
  return F;
}

/** Total downward load across the whole mesh, lb.  Used for equilibrium check. */
export function totalLoad(mesh: FEAMesh, q: number): number {
  let total = 0;
  for (const elem of mesh.elements) total += q * elem.area;
  return total;
}
