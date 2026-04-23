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
  /** Master-node rotation about global X (rad), for diagnostics. */
  thetaX?: number;
  /** Master-node rotation about global Y (rad), for diagnostics. */
  thetaY?: number;
  /** Column rotational spring stiffness about X (lb-in/rad). */
  kAboutX?: number;
  /** Column rotational spring stiffness about Y (lb-in/rad). */
  kAboutY?: number;
  /** Count of slave nodes in the rigid patch (diagnostic). */
  patchSlaves?: number;
  /** Index of the mesh node used as the column "master". */
  masterNode?: number;
  /** Distance from the column centroid to the master node (in).  0 if
   *  the centroid landed exactly on the mesh node, which is what we
   *  want; nonzero means the mesher found a different nearest node
   *  and the rigid-patch assumptions may be off. */
  masterOffsetIn?: number;
}

export type FEAStability = "stable" | "degraded" | "unstable";

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
  /** Mesh target edge actually used (may differ from user-requested). */
  targetEdgeIn: number;
  /** Human-readable note if targetEdge was overridden (cap/floor applied). */
  meshEdgeNotice?: string;
  /** Which poly2tri retry tier won (0 = full Steiner set; 3 = centroids+boundary only). */
  meshTier: number;
  /** Human-readable mesher tier label ("full", "no-refine-ring", etc.). */
  meshTierLabel: string;
  /**
   * Overall run trustworthiness.
   *   stable    — trust the per-column numbers
   *   degraded  — probably usable; review flagged columns
   *   unstable  — do not ship these values
   */
  stability: FEAStability;
  /** Human-readable bullets explaining the stability label. */
  stabilityReasons: string[];
  /** Column ids that are individually in the unstable bucket (no rigid patch, etc.). */
  unstableColumnIds: string[];
}

export interface FEAOutput {
  perColumn: Map<string, FEAUnbalanced>;
  diagnostics: FEADiagnostics;
}

interface MeshEdgeDecision {
  edge: number;
  notice?: string;
}

/**
 * Choose the mesh target edge length, enforcing two invariants that the
 * rigid-patch constraint depends on:
 *
 *   1. targetEdge <= min(c1, c2) / 2 over all columns.  The interior
 *      grid is spaced at 1.5 * targetEdge, so capping here guarantees
 *      that every column footprint contains at least ~1-4 ambient mesh
 *      nodes even if poly2tri rejects the pre-seeded 0.8x ring.  Without
 *      this cap, a 24" mesh on 24x24 columns leaves the master as the
 *      only node in the footprint -> point-pin singularity -> mesh-
 *      dependent Mu (see tasks/todo.md §1).
 *
 *   2. targetEdge >= max(dIn, span/32).  Thickness floor is a DKT
 *      stiffness-scaling sanity check; span/32 caps element count on
 *      huge slabs so the CG solver doesn't drown.
 *
 * User-set `inputs.meshTargetEdgeIn` is respected only up to the cap —
 * a coarser user value silently inflates Mu, which is a safety issue for
 * a punching checker.  We override and warn.
 */
function computeMeshEdge(
  slab: Polygon,
  cols: Column[],
  inputs: ProjectInputs,
): MeshEdgeDecision {
  // --- Floor ---
  // Only the thickness-based floor.  An earlier draft also floored at
  // span/32 as a "don't drown the solver on big slabs" guard, but that
  // scales with slab size instead of column size — on a 90-ft building
  // slab it evaluates to ~34" and overrides both the footprint cap and
  // a reasonable user-requested value.  Big meshes are tolerated; the
  // CG solver is O(n) per iter.  User's `meshTargetEdgeIn` is the
  // performance escape hatch.
  const floor = inputs.dIn;

  // --- Footprint cap ---
  // Ignore pathologically small ingested footprints so one bad column
  // doesn't collapse the whole mesh.
  const validMins = cols
    .map((c) => Math.min(c.c1, c.c2))
    .filter((d) => d >= 4);
  const footprintCap = validMins.length > 0
    ? Math.min(...validMins) / 2
    : Infinity;

  // --- Pick the starting value ---
  let edge: number;
  const userRequested = inputs.meshTargetEdgeIn && inputs.meshTargetEdgeIn > 0
    ? inputs.meshTargetEdgeIn
    : undefined;
  if (userRequested !== undefined) {
    edge = userRequested;
  } else {
    // Heuristic when user doesn't override: column-spacing based.
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
    edge = Math.min(fromSpacing, 24);
  }

  // --- Apply cap, then floor ---
  const notes: string[] = [];
  const preCap = edge;
  if (edge > footprintCap) {
    edge = footprintCap;
    if (userRequested !== undefined) {
      notes.push(
        `meshTargetEdgeIn=${userRequested.toFixed(2)}" overridden to ${edge.toFixed(2)}" (min_col/2) for rigid-patch resolution`,
      );
    } else {
      notes.push(
        `targetEdge ${preCap.toFixed(2)}" capped to ${edge.toFixed(2)}" (min_col/2)`,
      );
    }
  }
  if (edge < floor) {
    const capHitFirst = edge < preCap; // footprint cap wanted to go finer
    edge = floor;
    if (capHitFirst) {
      notes.push(
        `footprint cap below dIn=${floor.toFixed(2)}"; rigid patches may not fully resolve on the smallest columns`,
      );
    } else {
      notes.push(`targetEdge raised to dIn=${floor.toFixed(2)}" (thickness floor)`);
    }
  }

  return { edge, notice: notes.length > 0 ? notes.join("; ") : undefined };
}

export type FEAProgressStage = "mesh" | "assemble" | "solve" | "recover";

export interface FEAProgressOptions {
  /** Called at stage boundaries + periodically during CG. Awaited so the UI can paint. */
  onProgress?: (stage: FEAProgressStage, fraction: number) => Promise<void> | void;
}

export async function unbalancedMomentsFEA(
  slab: Polygon,
  cols: Column[],
  walls: Wall[],
  wu_psi: number,
  inputs: ProjectInputs,
  progress: FEAProgressOptions = {},
): Promise<FEAOutput> {
  const t0 = performance.now();
  const emit = async (stage: FEAProgressStage, f: number) => {
    if (progress.onProgress) await progress.onProgress(stage, f);
  };

  const material: FEAMaterial = {
    E: concreteE(inputs.fcPsi),
    nu: inputs.concreteNu ?? 0.2,
    h: inputs.hIn,
  };

  await emit("mesh", 0);
  const meshDecision = computeMeshEdge(slab, cols, inputs);
  if (meshDecision.notice) {
    // eslint-disable-next-line no-console
    console.warn(`[plate-fea] ${meshDecision.notice}`);
  }
  const targetEdge = meshDecision.edge;
  const mesh = buildMesh(slab, cols, walls, { targetEdge });
  await emit("mesh", 1);

  await emit("assemble", 0);
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
  await emit("assemble", 1);

  await emit("solve", 0);
  const cg = await solveCG(reduced.Kr, reduced.Fr, {
    tolerance: 1e-10,
    progressEveryN: 50,
    onProgress: async (iter, _rr, maxIter) => {
      // Map CG iter → solve-stage fraction.
      const f = Math.min(0.99, iter / Math.max(maxIter, 1));
      await emit("solve", f);
    },
  });
  await emit("solve", 1);
  await emit("recover", 0);
  const u = expandDisplacement(K.n, reduced.free, cg.u);
  // After solve, populate slave DOFs from their masters via the constraint.
  reconstructSlaves(u, patches);

  const perColumnRaw = recoverColumnResults(K, F, u, springs);

  // Map to the efm.ts interface + attach diagnostics for the UI.
  const patchByCol = new Map(patches.map(p => [p.columnId, p]));
  const springByCol = new Map(springs.map(s => [s.id, s]));
  const colByCol = new Map(cols.map(c => [c.id, c]));

  const perColumn = new Map<string, FEAUnbalanced>();
  for (const [id, v] of perColumnRaw) {
    const sp = springByCol.get(id);
    const p = patchByCol.get(id);
    const col = colByCol.get(id);
    const masterNode = sp?.nodeIndex ?? -1;
    const masterOffsetIn = (col && masterNode >= 0)
      ? Math.hypot(
          mesh.nodes[masterNode].x - col.position[0],
          mesh.nodes[masterNode].y - col.position[1],
        )
      : undefined;
    perColumn.set(id, {
      mu2: v.muAboutX,
      mu3: v.muAboutY,
      Vu: v.Vu,
      wAtCol: v.wAtCol,
      thetaX: masterNode >= 0 ? u[3 * masterNode + 1] : undefined,
      thetaY: masterNode >= 0 ? u[3 * masterNode + 2] : undefined,
      kAboutX: sp?.kAboutX,
      kAboutY: sp?.kAboutY,
      patchSlaves: p?.slaves.length,
      masterNode,
      masterOffsetIn,
    });
  }

  const columnWDofs: number[] = [];
  for (const nodeIdx of mesh.columnNodes.values()) columnWDofs.push(3 * nodeIdx);
  const wallWDofs: number[] = [];
  for (const nodeIdx of mesh.wallNodes) wallWDofs.push(3 * nodeIdx);
  const { colSum, wallSum, total } = sumReactions(K, F, u, columnWDofs, wallWDofs);
  const equilibriumError = Math.abs(total - totalF) / Math.max(Math.abs(totalF), 1e-9);

  // --- Stability classification ---
  // "unstable" is reserved for results the user should NOT ship:
  //   * mesher fell to tier 3 (no Steiners beyond column centroids)
  //   * any column has patchSlaves == 0 (point-pin singularity)
  //   * equilibrium error > 0.5%
  //   * CG did not converge
  // "degraded" is yellow-flag: results probably usable, review the
  //   columns flagged individually.
  // "stable" is everything clean.
  const reasons: string[] = [];
  const unstableColumnIds: string[] = [];
  const degradedColumnIds: string[] = [];
  let unstable = false;
  let degraded = false;

  for (const [id, entry] of perColumn) {
    const slaves = entry.patchSlaves ?? 0;
    if (slaves === 0) {
      unstable = true;
      unstableColumnIds.push(id);
    } else if (slaves < 4) {
      degraded = true;
      degradedColumnIds.push(id);
    }
  }

  if (mesh.quality.tierUsed >= 3) {
    unstable = true;
    reasons.push(
      `mesher fell to tier 3 (${mesh.quality.tierLabel}); ${mesh.quality.droppedSteiners} Steiner pts dropped — no rigid patches formed from the bulk mesh`,
    );
  } else if (mesh.quality.tierUsed >= 1) {
    degraded = true;
    reasons.push(
      `mesher retried to tier ${mesh.quality.tierUsed} (${mesh.quality.tierLabel}); ${mesh.quality.droppedSteiners} Steiner pts dropped`,
    );
  }

  if (unstableColumnIds.length > 0) {
    reasons.push(
      `${unstableColumnIds.length} column(s) have no rigid-patch slaves (point-pin singularity): ${unstableColumnIds.join(", ")}`,
    );
  }
  if (degradedColumnIds.length > 0) {
    reasons.push(
      `${degradedColumnIds.length} column(s) have thin rigid patch (1–3 slaves): ${degradedColumnIds.join(", ")}`,
    );
  }

  if (equilibriumError > 0.005) {
    unstable = true;
    reasons.push(`equilibrium error ${(equilibriumError * 100).toFixed(3)}% > 0.5%`);
  } else if (equilibriumError > 0.001) {
    degraded = true;
    reasons.push(`equilibrium error ${(equilibriumError * 100).toFixed(3)}% > 0.1%`);
  }

  if (!cg.converged) {
    unstable = true;
    reasons.push(`CG solver did not converge (residual ${cg.residualNorm.toExponential(2)})`);
  }

  const stability: FEAStability = unstable ? "unstable" : degraded ? "degraded" : "stable";
  if (stability === "stable") reasons.push("mesh tier 0, all columns have ≥4 patch slaves, equilibrium < 0.1%");

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
    targetEdgeIn: targetEdge,
    meshEdgeNotice: meshDecision.notice,
    meshTier: mesh.quality.tierUsed,
    meshTierLabel: mesh.quality.tierLabel,
    stability,
    stabilityReasons: reasons,
    unstableColumnIds,
  };

  await emit("recover", 1);
  return { perColumn, diagnostics };
}
