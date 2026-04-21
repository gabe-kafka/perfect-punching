/**
 * Plate FEA closed-form benchmark.
 *
 *   Simply-supported square plate, side a, uniform pressure q.
 *   w_center = alpha * q * a^4 / D         (alpha ~ 0.00406)
 *
 * SS BCs are enforced by pinning w = 0 at every node whose position lies
 * on the slab perimeter.  Rotations remain free (SS).  We bypass the
 * walls / columnNodes mechanism and construct the fixed-DOF set directly.
 */
import type { Column, Polygon, ProjectInputs, Wall } from "../src/lib/types.ts";
import { concreteE } from "../src/fea/bc.ts";
import { flexuralRigidity } from "../src/fea/assembly.ts";
import type { FEAMaterial } from "../src/fea/types.ts";
import { buildMesh } from "../src/fea/mesher.ts";
import { assembleGlobalK } from "../src/fea/assembly.ts";
import {
  applyColumnSprings,
  buildColumnSprings,
  expandDisplacement,
  reduceSystem,
} from "../src/fea/bc.ts";
import { assembleLoadVector } from "../src/fea/loads.ts";
import { solveCG } from "../src/fea/solver.ts";

const ALPHA = 0.00406;

function runOneCase(a: number, h: number, fcPsi: number, q_psi: number, targetEdge: number) {
  console.log(`\n-- a=${a}in, h=${h}in, f'c=${fcPsi}psi, q=${q_psi}psi, mesh~${targetEdge}in --`);

  const half = a / 2;
  const slab: Polygon = {
    outer: [[-half, -half], [half, -half], [half, half], [-half, half]],
  };
  const walls: Wall[] = [];
  const columns: Column[] = [];

  const material: FEAMaterial = { E: concreteE(fcPsi), nu: 0.2, h };
  const D = flexuralRigidity(material);
  const wTheory = ALPHA * q_psi * Math.pow(a, 4) / D;

  const mesh = buildMesh(slab, columns, walls, { targetEdge });

  // Directly identify boundary nodes (on the slab perimeter) — bypass walls.
  const eps = 1e-3;
  const fixed = new Set<number>();
  for (let i = 0; i < mesh.nodes.length; i++) {
    const { x, y } = mesh.nodes[i];
    if (
      Math.abs(x - half) < eps || Math.abs(x + half) < eps ||
      Math.abs(y - half) < eps || Math.abs(y + half) < eps
    ) {
      fixed.add(3 * i);  // pin w
    }
  }

  const inputs = {
    fcPsi, hIn: h, dIn: h * 0.8, deadPsf: 0, livePsf: 0,
    defaultC1: 12, defaultC2: 12, phi: 0.75,
  } as ProjectInputs;
  const K = assembleGlobalK(mesh, material);
  const springs = buildColumnSprings(mesh, columns, inputs, material);
  applyColumnSprings(K, springs);
  const F = assembleLoadVector(mesh, q_psi);
  const reduced = reduceSystem(K, F, fixed);
  const cg = solveCG(reduced.Kr, reduced.Fr, { tolerance: 1e-11 });
  const u = expandDisplacement(K.n, reduced.free, cg.u);

  let centerIdx = 0, bestDist = Infinity;
  for (let i = 0; i < mesh.nodes.length; i++) {
    const d = Math.hypot(mesh.nodes[i].x, mesh.nodes[i].y);
    if (d < bestDist) { bestDist = d; centerIdx = i; }
  }
  const wCenter = u[3 * centerIdx];

  const relErr = Math.abs(wCenter - wTheory) / Math.abs(wTheory);
  console.log(`  nodes=${mesh.nodes.length}, elements=${mesh.elements.length}, nFree=${reduced.Kr.n}, boundary pinned=${fixed.size}`);
  console.log(`  CG iters=${cg.iterations}, converged=${cg.converged}, rel residual=${cg.residualNorm.toExponential(2)}`);
  console.log(`  D = ${D.toExponential(4)} lb-in`);
  console.log(`  w_center (FEA)    = ${wCenter.toExponential(5)} in  at (${mesh.nodes[centerIdx].x.toFixed(1)}, ${mesh.nodes[centerIdx].y.toFixed(1)})`);
  console.log(`  w_center (theory) = ${wTheory.toExponential(5)} in`);
  console.log(`  relative error    = ${(relErr * 100).toFixed(2)} %`);
  return relErr;
}

const a = 120, h = 8, fc = 4000, q = 1;
const errs: number[] = [];
errs.push(runOneCase(a, h, fc, q, 20));
errs.push(runOneCase(a, h, fc, q, 12));
errs.push(runOneCase(a, h, fc, q, 8));
errs.push(runOneCase(a, h, fc, q, 6));

console.log(`\nConvergence: ${errs.map(e => (e * 100).toFixed(2) + "%").join("  ->  ")}`);
const finest = errs[errs.length - 1];
const threshold = 0.05;
if (finest > threshold) {
  console.log(`\nFAIL: finest-mesh error ${(finest*100).toFixed(2)}% exceeds ${(threshold*100).toFixed(0)}%`);
  process.exit(1);
}
console.log(`\nPASS: finest-mesh error ${(finest*100).toFixed(2)}% within ${(threshold*100).toFixed(0)}%`);
