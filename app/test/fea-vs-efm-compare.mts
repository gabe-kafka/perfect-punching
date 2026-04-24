/**
 * FEA-vs-EFM accuracy comparison on a synthetic irregular slab.
 *
 * The real SAFE ground-truth files + 1025-Atlantic DXF live outside
 * this repo (per test/README.md).  As a proxy we build an irregular
 * slab geometry in TS, run the plate FEA at fine mesh as the reference,
 * and report how EFM-lite Mu (and Voronoi V_u) compare.
 *
 * Geometry: a 72' x 48' plate with one corner cut off, 12 columns in a
 * 4x3 irregular grid (non-uniform spans), and two shear walls along
 * opposite edges.  Columns 12" x 24".
 *
 * Reference: plate FEA at h = 8" (~5000 nodes).
 * Comparand: (a) EFM-lite Mu, (b) Voronoi tributary V_u.
 *
 * Report per-column and aggregate error stats identical in shape to
 * compare-vs-safe.mts so a reader knows what to expect once the real
 * SAFE numbers land.
 */
import type { Column, Polygon, ProjectInputs, Wall } from "../src/lib/types.ts";
import { classifyColumns } from "../src/lib/classify.ts";
import { tributaryAreas } from "../src/lib/voronoi.ts";
import { unbalancedMoments } from "../src/lib/efm.ts";
import { unbalancedMomentsFEA } from "../src/fea/plate-fea.ts";
import { checkPunching } from "../src/lib/punching.ts";

// ---- Build synthetic geometry ----
const W = 72 * 12;  // 864 in
const H = 48 * 12;  // 576 in
const cut = 8 * 12;  // 96 in corner cutout

// Slab outline: rectangle with the upper-right corner cut off.
const slab: Polygon = {
  outer: [
    [0, 0],
    [W, 0],
    [W, H - cut],
    [W - cut, H - cut],
    [W - cut, H],
    [0, H],
  ],
};

// 4x3 column grid on non-uniform spans.
const xs = [96, 288, 528, 768];
const ys = [96, 336, 528];
const columns: Column[] = [];
for (let i = 0; i < xs.length; i++) {
  for (let j = 0; j < ys.length; j++) {
    // Skip the column that would fall in the cut-out corner.
    if (i === xs.length - 1 && j === ys.length - 1) continue;
    columns.push({
      id: `C${i}${j}`,
      position: [xs[i], ys[j]],
      c1: 12,
      c2: 24,
    });
  }
}
console.log(`${columns.length} columns on slab ${(W/12).toFixed(0)}'x${(H/12).toFixed(0)}' with corner cut`);

// Walls along the two short sides.
const walls: Wall[] = [
  { id: "leftwall",  points: [[0, 0], [0, H]], closed: false },
  { id: "rightwall", points: [[W, 0], [W, H - cut]], closed: false },
];

classifyColumns(slab, columns, 36);
const typeCounts: Record<string, number> = { interior: 0, edge: 0, corner: 0 };
for (const c of columns) typeCounts[c.type ?? "interior"]++;
console.log(`  classify: interior=${typeCounts.interior}, edge=${typeCounts.edge}, corner=${typeCounts.corner}`);

// ---- Load setup (same as compare-vs-safe defaults) ----
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
};
const wu_psi = (1.2 * inputs.deadPsf + 1.6 * inputs.livePsf) / 144;

// ---- FEA reference at fine mesh ----
console.log(`\nRunning FEA reference at target edge 10" ...`);
inputs.meshTargetEdgeIn = 10;
const tFea = performance.now();
const feaRef = unbalancedMomentsFEA(slab, columns, walls, wu_psi, inputs);
console.log(`  ${feaRef.diagnostics.nNodes} nodes, ${feaRef.diagnostics.cgIterations} CG iters in ${(performance.now() - tFea).toFixed(0)}ms`);
console.log(`  equilibrium: ${(feaRef.diagnostics.equilibriumError * 100).toFixed(4)}%   columns=${(feaRef.diagnostics.colReactionSum/1000).toFixed(1)}kip  walls=${(feaRef.diagnostics.wallReactionSum/1000).toFixed(1)}kip  total=${(feaRef.diagnostics.totalLoad/1000).toFixed(1)}kip`);

// Also run a finer mesh to measure numerical-convergence gap.
inputs.meshTargetEdgeIn = 6;
console.log(`\nSanity: finer mesh at target edge 6" ...`);
const tFine = performance.now();
const feaFine = unbalancedMomentsFEA(slab, columns, walls, wu_psi, inputs);
console.log(`  ${feaFine.diagnostics.nNodes} nodes in ${(performance.now() - tFine).toFixed(0)}ms`);
console.log(`  equilibrium: ${(feaFine.diagnostics.equilibriumError * 100).toFixed(4)}%`);

let maxVuDrift = 0, maxMuDrift = 0;
for (const col of columns) {
  const a = feaRef.perColumn.get(col.id)!;
  const b = feaFine.perColumn.get(col.id)!;
  const muA = Math.hypot(a.mu2, a.mu3);
  const muB = Math.hypot(b.mu2, b.mu3);
  const vuDelta = Math.abs(a.Vu - b.Vu) / Math.max(Math.abs(b.Vu), 1);
  const muDelta = Math.abs(muA - muB) / Math.max(Math.abs(muB), 1);
  maxVuDrift = Math.max(maxVuDrift, vuDelta);
  maxMuDrift = Math.max(maxMuDrift, muDelta);
}
console.log(`  max drift ref(h=10) vs fine(h=6): Vu ${(maxVuDrift*100).toFixed(2)}%  Mu ${(maxMuDrift*100).toFixed(2)}%`);
console.log(`  (this is the numerical tail — how much the 'reference' shifts under refinement)`);

// ---- EFM-lite comparand ----
const tribs = tributaryAreas(slab, columns, walls, 12);
for (const c of columns) c.tributaryArea = tribs.get(c.id) ?? 0;
const efmMu = unbalancedMoments(slab, columns, walls, wu_psi);

// ---- Per-column comparison rows ----
interface Row {
  id: string;
  type: string;
  vu_fea: number; vu_efm: number; vu_err: number;
  mu_fea: number; mu_efm: number; mu_err: number;
  dcr_fea: number; dcr_efm: number; dcr_err: number;
  dom_fea: boolean; dom_efm: boolean;
}
const rows: Row[] = [];
for (const c of columns) {
  const f = feaRef.perColumn.get(c.id)!;
  const e = efmMu.get(c.id)!;
  const rFea = checkPunching(c, inputs, f.mu2, f.mu3, slab, f.Vu);
  const rEfm = checkPunching(c, inputs, e?.mu2, e?.mu3, slab);  // EFM uses trib-based Vu
  const muFeaRes = Math.hypot(f.mu2, f.mu3);
  const muEfmRes = Math.hypot(e?.mu2 ?? 0, e?.mu3 ?? 0);
  rows.push({
    id: c.id,
    type: c.type ?? "-",
    vu_fea: f.Vu,
    vu_efm: rEfm.vu,
    vu_err: (rEfm.vu - f.Vu) / Math.max(Math.abs(f.Vu), 1) * 100,
    mu_fea: muFeaRes,
    mu_efm: muEfmRes,
    mu_err: (muEfmRes - muFeaRes) / Math.max(Math.abs(muFeaRes), 1) * 100,
    dcr_fea: rFea.dcr,
    dcr_efm: rEfm.dcr,
    dcr_err: (rEfm.dcr - rFea.dcr) / Math.max(Math.abs(rFea.dcr), 1e-9) * 100,
    dom_fea: false,
    dom_efm: false,
  });
}
// Mark top-5 governing columns
[...rows].sort((a, b) => b.dcr_fea - a.dcr_fea).slice(0, 5).forEach(r => r.dom_fea = true);
[...rows].sort((a, b) => b.dcr_efm - a.dcr_efm).slice(0, 5).forEach(r => r.dom_efm = true);

function stats(vals: number[]) {
  const sorted = vals.slice().sort((a, b) => a - b);
  const abs = vals.map(Math.abs).sort((a, b) => a - b);
  const n = vals.length;
  return {
    mean:   vals.reduce((s, v) => s + v, 0) / n,
    median: sorted[Math.floor(n/2)],
    p90:    abs[Math.floor(n * 0.9)],
    maxAbs: abs[n - 1],
  };
}
const sVu = stats(rows.map(r => r.vu_err));
const sMu = stats(rows.map(r => r.mu_err));
const sDcr = stats(rows.map(r => r.dcr_err));

console.log("\n============================================================");
console.log("EFM-lite  vs  plate-FEA reference (per-column)");
console.log("============================================================");
console.log("id     type       Vu_FEA  Vu_EFM  ΔVu%    Mu_FEA   Mu_EFM   ΔMu%    DCR_F   DCR_E   ΔDCR%  dom");
console.log("-".repeat(103));
for (const r of rows.slice().sort((a, b) => b.dcr_fea - a.dcr_fea)) {
  const dom = `${r.dom_fea ? "F" : "."}${r.dom_efm ? "E" : "."}`;
  console.log(
    `${r.id.padEnd(6)} ${r.type.padEnd(9)} ` +
    `${(r.vu_fea/1000).toFixed(1).padStart(6)}  ${(r.vu_efm/1000).toFixed(1).padStart(6)}  ` +
    `${r.vu_err.toFixed(1).padStart(6)}  ` +
    `${(r.mu_fea/1000).toFixed(1).padStart(7)}  ${(r.mu_efm/1000).toFixed(1).padStart(7)}  ` +
    `${r.mu_err.toFixed(1).padStart(6)}  ` +
    `${r.dcr_fea.toFixed(3).padStart(6)}  ${r.dcr_efm.toFixed(3).padStart(6)}  ` +
    `${r.dcr_err.toFixed(1).padStart(6)}  ${dom}`
  );
}

console.log("\n--- Aggregate (EFM relative to FEA) ---");
console.log(`Vu   : mean ${sVu.mean.toFixed(1).padStart(7)}%  median ${sVu.median.toFixed(1).padStart(7)}%  P90 ${sVu.p90.toFixed(1).padStart(6)}%  maxAbs ${sVu.maxAbs.toFixed(1).padStart(6)}%`);
console.log(`Mu   : mean ${sMu.mean.toFixed(1).padStart(7)}%  median ${sMu.median.toFixed(1).padStart(7)}%  P90 ${sMu.p90.toFixed(1).padStart(6)}%  maxAbs ${sMu.maxAbs.toFixed(1).padStart(6)}%`);
console.log(`DCR  : mean ${sDcr.mean.toFixed(1).padStart(7)}%  median ${sDcr.median.toFixed(1).padStart(7)}%  P90 ${sDcr.p90.toFixed(1).padStart(6)}%  maxAbs ${sDcr.maxAbs.toFixed(1).padStart(6)}%`);

const feaTop5 = new Set(rows.filter(r => r.dom_fea).map(r => r.id));
const efmTop5 = new Set(rows.filter(r => r.dom_efm).map(r => r.id));
const overlap = [...feaTop5].filter(id => efmTop5.has(id));
console.log(`\nTop-5 governing columns overlap: ${overlap.length}/5  (${overlap.join(", ") || "none"})`);
console.log(`  FEA top-5: ${[...feaTop5].join(", ")}`);
console.log(`  EFM top-5: ${[...efmTop5].join(", ")}`);

console.log(`\nNote: this compares EFM-lite against a plate-FEA reference, not`);
console.log(`against SAFE.  The EFM error patterns here (Mu bias direction and`);
console.log(`magnitude) should be similar to what we expect on 1025-Atlantic`);
console.log(`once the companion-repo DXF + SAFE ground truth are available.`);
