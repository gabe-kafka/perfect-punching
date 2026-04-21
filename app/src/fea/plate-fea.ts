/**
 * Plate FEA orchestrator.  Drop-in replacement for efm.ts' unbalancedMoments.
 *
 * Pipeline: mesh -> assemble -> springs -> loads -> pin BCs -> CG solve ->
 * recover per-column V_u, M_u about X, M_u about Y.
 *
 * Not yet implemented (follow-ups):
 *   - Rigid master-slave patch over each c1 x c2 column footprint
 *   - Mid-side / quadratic refinement around columns
 *   - Adaptive mesh grading (two-scale h_local / h_global)
 */
import type { Column, Polygon, ProjectInputs, Wall } from "../lib/types.ts";
import type { FEAMaterial } from "./types.ts";
import { buildMesh } from "./mesher.ts";
import { assembleGlobalK } from "./assembly.ts";
import {
  applyColumnSprings,
  applyRigidPatches,
  buildColumnSprings,
  collectFixedDofs,
  concreteE,
  expandDisplacement,
  identifyColumnPatches,
  reconstructSlaves,
  reduceSystem,
} from "./bc.ts";
import { assembleLoadVector, totalLoad } from "./loads.ts";
import { solveCG } from "./solver.ts";
import { recoverColumnResults, sumReactions } from "./recover.ts";

export interface FEAUnbalanced {
  /** Moment about X (matches efm.ts mu2). */
  mu2: number;
  /** Moment about Y (matches efm.ts mu3). */
  mu3: number;
  /** Vertical load transferred to the column (lb, downward positive). */
  Vu: number;
  /** Deflection at the column node (in). */
  wAtCol: number;
}

export interface FEADiagnostics {
  nNodes: number;
  nElements: number;
  nFree: number;
  cgIterations: number;
  residual: number;
  converged: boolean;
  totalLoad: number;
  colReactionSum: number;
  wallReactionSum: number;
  equilibriumError: number;
  wallMax: number;
  elapsedMs: number;
}

export interface FEAOutput {
  perColumn: Map<string, FEAUnbalanced>;
  diagnostics: FEADiagnostics;
}

function defaultMeshEdge(slab: Polygon, cols: Column[], inputs: ProjectInputs): number {
  if (inputs.meshTargetEdgeIn && inputs.meshTargetEdgeIn > 0) {
    return inputs.meshTargetEdgeIn;
  }
  // Heuristic: span/8 based on nearest-column spacing, floored by d.
  let minSpacing = Infinity;
  for (let i = 0; i < cols.length; i++) {
    for (let j = i + 1; j < cols.length; j++) {
      const d = Math.hypot(
        cols[i].position[0] - cols[j].position[0],
        cols[i].position[1] - cols[j].position[1],
      );
      if (d > 1e-3) minSpacing = Math.min(minSpacing, d);
    }
  }
  const fromSpacing = isFinite(minSpacing) ? minSpacing / 8 : 24;
  return Math.max(inputs.dIn, Math.min(fromSpacing, 24));
}

export function unbalancedMomentsFEA(
  slab: Polygon,
  cols: Column[],
  walls: Wall[],
  wu_psi: number,
  inputs: ProjectInputs,
): FEAOutput {
  const t0 = performance.now();

  const material: FEAMaterial = {
    E: concreteE(inputs.fcPsi),
    nu: inputs.concreteNu ?? 0.2,
    h: inputs.hIn,
  };

  const targetEdge = defaultMeshEdge(slab, cols, inputs);
  const mesh = buildMesh(slab, cols, walls, { targetEdge });

  let K = assembleGlobalK(mesh, material);
  const springs = buildColumnSprings(mesh, cols, inputs, material);
  applyColumnSprings(K, springs);

  let F = assembleLoadVector(mesh, wu_psi);
  const totalF = totalLoad(mesh, wu_psi);

  // Rigid master-slave patch over each column footprint.  Eliminates the
  // point-pin singularity that otherwise makes theta at edge columns
  // mesh-dependent and blows up M_u in the recovery step.
  const patches = identifyColumnPatches(mesh, cols);
  const patched = applyRigidPatches(K, F, patches);
  K = patched.K;
  F = patched.F;

  const fixed = collectFixedDofs(mesh);
  for (const d of patched.slaveDofs) fixed.add(d);
  const reduced = reduceSystem(K, F, fixed);
  const cg = solveCG(reduced.Kr, reduced.Fr, { tolerance: 1e-10 });
  const u = expandDisplacement(K.n, reduced.free, cg.u);
  // After solve, populate slave DOFs from their masters via the constraint.
  reconstructSlaves(u, patches);

  const perColumnRaw = recoverColumnResults(K, F, u, springs);

  // Map to the efm.ts interface.
  const perColumn = new Map<string, FEAUnbalanced>();
  for (const [id, v] of perColumnRaw) {
    perColumn.set(id, {
      mu2: v.muAboutX,
      mu3: v.muAboutY,
      Vu: v.Vu,
      wAtCol: v.wAtCol,
    });
  }

  const columnWDofs: number[] = [];
  for (const nodeIdx of mesh.columnNodes.values()) columnWDofs.push(3 * nodeIdx);
  const wallWDofs: number[] = [];
  for (const nodeIdx of mesh.wallNodes) wallWDofs.push(3 * nodeIdx);
  const { colSum, wallSum, total } = sumReactions(K, F, u, columnWDofs, wallWDofs);
  const equilibriumError = Math.abs(total - totalF) / Math.max(Math.abs(totalF), 1e-9);

  const diagnostics: FEADiagnostics = {
    nNodes: mesh.nodes.length,
    nElements: mesh.elements.length,
    nFree: reduced.Kr.n,
    cgIterations: cg.iterations,
    residual: cg.residualNorm,
    converged: cg.converged,
    totalLoad: totalF,
    colReactionSum: colSum,
    wallReactionSum: wallSum,
    equilibriumError,
    wallMax: wallSum,
    elapsedMs: performance.now() - t0,
  };

  return { perColumn, diagnostics };
}
