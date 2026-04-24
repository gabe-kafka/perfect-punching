/**
 * FEA-path headless webapp runner.  Mirrors run-webapp-headless.mts but
 * replaces the EFM-lite Mu estimator AND the Voronoi-tributary Vu with
 * values recovered from the DKT plate FEA.
 *
 * Usage:
 *   tsx run-webapp-headless-fea.mts <dxf> <safe_ground_truth.json> <out.json>
 */
import * as fs from "node:fs";
import { ingestDxf } from "../src/lib/dxf-ingest.ts";
import { classifyColumns } from "../src/lib/classify.ts";
import { tributaryAreas } from "../src/lib/voronoi.ts";
import { checkPunching } from "../src/lib/punching.ts";
import { unbalancedMomentsFEA } from "../src/fea/plate-fea.ts";
import type { ProjectInputs, Polygon } from "../src/lib/types.ts";

const [dxfPath, gtPath, outPath] = process.argv.slice(2);
if (!dxfPath || !gtPath || !outPath) {
  console.error("Usage: tsx run-webapp-headless-fea.mts <dxf> <gt.json> <out.json>");
  process.exit(2);
}

const stripBom = (s: string) => s.replace(/^﻿/, "");
const dxfText = stripBom(fs.readFileSync(dxfPath, "utf8"));
const gt = JSON.parse(stripBom(fs.readFileSync(gtPath, "utf8")));

const ingest = ingestDxf(dxfText);
console.log(`Ingest: ${ingest.slabs.length} slabs, ${ingest.columns.length} columns, ${ingest.walls.length} walls`);
if (ingest.slabs.length === 0) throw new Error("no slab in DXF");
if (ingest.columns.length === 0) throw new Error("no columns in DXF");

function ringArea(r: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  }
  return a / 2;
}

let slab: Polygon = ingest.slabs[0].polygon;
let area = Math.abs(ringArea(slab.outer));
for (const s of ingest.slabs) {
  const a = Math.abs(ringArea(s.polygon.outer));
  if (a > area) { slab = s.polygon; area = a; }
}
const holes: [number, number][][] = [];
for (const s of ingest.slabs) {
  if (s.polygon === slab) continue;
  holes.push(s.polygon.outer as [number, number][]);
}
if (holes.length > 0) slab = { outer: slab.outer, holes };

// Column sizes from SAFE ground truth (DXF POINTs don't carry sizes).
const byId = new Map<string, any>(gt.columns.map((c: any) => [c.id, c]));
let sized = 0;
for (const c of ingest.columns) {
  const src = byId.get(c.id);
  if (src) { c.c1 = src.c1_in; c.c2 = src.c2_in; sized++; }
}
console.log(`Sized ${sized}/${ingest.columns.length} columns from ground truth`);

classifyColumns(slab, ingest.columns, 36);

// Voronoi is still computed for visualization / diagnostic comparison —
// but the punching check uses FEA-derived V_u via the vuOverride arg.
const tribs = tributaryAreas(slab, ingest.columns, ingest.walls, 12);
for (const c of ingest.columns) c.tributaryArea = tribs.get(c.id) ?? 0;

const inputs: ProjectInputs = {
  fcPsi: gt.materials.fc_psi,
  hIn: gt.slab.thickness_in,
  dIn: gt.slab.effective_depth_in,
  deadPsf: gt.loads.webapp_dead_psf_eq,
  livePsf: gt.loads.webapp_live_psf_eq,
  defaultC1: 12,
  defaultC2: 12,
  phi: 0.75,
  columnHeightIn: 144,
  columnFarEndFixity: "fixed",
  concreteNu: 0.2,
  meshTargetEdgeIn: 24,
};

const wu_psi = (1.2 * inputs.deadPsf + 1.6 * inputs.livePsf) / 144;

console.log(`Running plate FEA...`);
const t0 = performance.now();
const fea = unbalancedMomentsFEA(slab, ingest.columns, ingest.walls, wu_psi, inputs);
const feaMs = performance.now() - t0;
const d = fea.diagnostics;
console.log(`  mesh: ${d.nNodes} nodes, ${d.nElements} elements, ${d.nFree} free DOF`);
console.log(`  solve: ${d.cgIterations} CG iters, residual ${d.residual.toExponential(2)}, converged=${d.converged}`);
console.log(`  equilibrium err: ${(d.equilibriumError * 100).toFixed(4)}%`);
console.log(`  total load: ${(d.totalLoad / 1000).toFixed(2)} kip, columns take ${(d.colReactionSum / 1000).toFixed(2)} kip, walls ${(d.wallReactionSum / 1000).toFixed(2)} kip`);
console.log(`  time: ${feaMs.toFixed(0)} ms`);

if (d.equilibriumError > 0.005) {
  console.error(`FAIL: equilibrium error ${(d.equilibriumError * 100).toFixed(4)}% > 0.5% — downstream numbers are unreliable`);
  process.exit(1);
}

const results = ingest.columns.map(c => {
  const m = fea.perColumn.get(c.id);
  return checkPunching(c, inputs, m?.mu2, m?.mu3, slab, m?.Vu);
});

const out = {
  webapp_version: `perfect-punching @ plate-fea (${new Date().toISOString().slice(0, 10)})`,
  ingest_stats: ingest.stats,
  inputs,
  slab: { outer: slab.outer, holes: slab.holes ?? [] },
  columns: ingest.columns.map(c => ({
    id: c.id,
    position: c.position,
    c1: c.c1,
    c2: c.c2,
    type: c.type,
    tributaryArea_in2: c.tributaryArea,
  })),
  results,
  fea_diagnostics: d,
};
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`\nWrote ${results.length} FEA results -> ${outPath}`);

const sorted = [...results].sort((a, b) => b.dcr - a.dcr).slice(0, 5);
console.log("\nTop 5 FEA DCRs:");
for (const r of sorted) {
  console.log(`  ${r.columnId}  type=${(r.type ?? "-").padEnd(8)}  Vu=${(r.vu/1000).toFixed(2)} kip  Mu=${(r.mu/1000).toFixed(1)} kip-in  b0=${r.b0.toFixed(1)} in  DCR=${r.dcr.toFixed(3)}`);
}
