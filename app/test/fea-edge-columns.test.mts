/**
 * Edge/corner column sanity check.
 *
 * Build a small symmetric rectangular slab with walls on two long edges
 * (supported like a one-way span), columns along one short free edge.
 * Under uniform q, each edge column should take a reasonable Vu and a
 * bounded Mu — NOT the DCR-of-30 blow-up that the point-pin model
 * produced before the rigid patch.
 *
 * Numbers to eyeball:
 *   Vu per edge column ~ (trib strip area) x wu
 *   Mu per edge column — should be in the 100-500 kip-in range for the
 *     typical flat-plate span ratios here, NOT thousands.
 *   DCR — should be in 0.3-1.2 range, NOT 30.
 */
import type { Column, Polygon, ProjectInputs, Wall } from "../src/lib/types.ts";
import { classifyColumns } from "../src/lib/classify.ts";
import { unbalancedMomentsFEA } from "../src/fea/plate-fea.ts";
import { checkPunching } from "../src/lib/punching.ts";

const inputs: ProjectInputs = {
  fcPsi: 5000,
  hIn: 8,
  dIn: 6.5,
  deadPsf: 135,
  livePsf: 40,
  defaultC1: 12,
  defaultC2: 24,
  phi: 0.75,
  columnHeightIn: 144,
  columnFarEndFixity: "fixed",
  concreteNu: 0.2,
  meshTargetEdgeIn: 18,
};
const wu_psi = (1.2 * inputs.deadPsf + 1.6 * inputs.livePsf) / 144;

// 60 ft x 36 ft slab; walls along top + bottom edges; three columns in
// a row near the right edge so column #3 is a true edge column.
const W = 60 * 12;   // 720 in
const H = 36 * 12;   // 432 in
const slab: Polygon = {
  outer: [[0, 0], [W, 0], [W, H], [0, H]],
};

// Place columns: two interior (spacing 20 ft apart), and two on the
// right free edge (one at each end of the free span).
const cols: Column[] = [
  { id: "INT-1", position: [240, H/2], c1: 18, c2: 18 },
  { id: "INT-2", position: [480, H/2], c1: 18, c2: 18 },
  { id: "EDGE-T", position: [W - 9, H - 120], c1: 18, c2: 18 },  // near top-right
  { id: "EDGE-B", position: [W - 9, 120],     c1: 18, c2: 18 },  // near bot-right
];

// Walls along the short ends (left, top-bottom) and nothing at right = free edge
const walls: Wall[] = [
  { id: "wall-left",   points: [[0, 0], [0, H]], closed: false },
  { id: "wall-top",    points: [[0, H], [W, H]], closed: false },
  { id: "wall-bottom", points: [[0, 0], [W, 0]], closed: false },
];

classifyColumns(slab, cols, 36);
console.log("Classification:");
for (const c of cols) console.log(`  ${c.id}: ${c.type}`);

const fea = unbalancedMomentsFEA(slab, cols, walls, wu_psi, inputs);
const d = fea.diagnostics;
console.log(`\nMesh: ${d.nNodes} nodes, ${d.nElements} elements`);
console.log(`CG: ${d.cgIterations} iters, converged=${d.converged}`);
console.log(`Equilibrium: ${(d.equilibriumError * 100).toFixed(4)}%`);
console.log(`Total load: ${(d.totalLoad/1000).toFixed(1)} kip  (columns ${(d.colReactionSum/1000).toFixed(1)}, walls ${(d.wallReactionSum/1000).toFixed(1)})`);

console.log(`\nPer-column:`);
console.log(`  id       type      Vu (kip)    Mu_res (kip-in)   DCR`);
for (const c of cols) {
  const fe = fea.perColumn.get(c.id)!;
  const muRes = Math.hypot(fe.mu2, fe.mu3);
  const r = checkPunching(c, inputs, fe.mu2, fe.mu3, slab, fe.Vu);
  console.log(`  ${c.id.padEnd(8)} ${(c.type ?? "-").padEnd(9)} ${(fe.Vu/1000).toFixed(2).padStart(8)}   ${(muRes/1000).toFixed(1).padStart(10)}      ${r.dcr.toFixed(2).padStart(5)}`);
}
