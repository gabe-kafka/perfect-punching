/**
 * Headless webapp runner: ingests a DXF, runs the same shipping pipeline the
 * browser runs (classify -> tributary -> checkPunching), writes JSON out.
 *
 * Usage:
 *   tsx run-webapp-headless.mts <dxf> <safe_ground_truth.json> <out.json>
 */
import * as fs from "node:fs";
import { ingestDxf } from "../src/lib/dxf-ingest.ts";
import { classifyColumns } from "../src/lib/classify.ts";
import { tributaryAreas } from "../src/lib/voronoi.ts";
import { checkPunching } from "../src/lib/punching.ts";
import type { ProjectInputs, Polygon } from "../src/lib/types.ts";

const [dxfPath, gtPath, outPath] = process.argv.slice(2);
if (!dxfPath || !gtPath || !outPath) {
  console.error("Usage: tsx run-webapp-headless.mts <dxf> <gt.json> <out.json>");
  process.exit(2);
}

const stripBom = (s: string) => s.replace(/^﻿/, "");
const dxfText = stripBom(fs.readFileSync(dxfPath, "utf8"));
const gt = JSON.parse(stripBom(fs.readFileSync(gtPath, "utf8")));

// 1. Ingest DXF through the webapp's parser
const ingest = ingestDxf(dxfText);
console.log(`Ingest: ${ingest.slabs.length} slabs, ${ingest.columns.length} columns`);
console.log(`Layers found: ${ingest.stats.layersFound.join(", ")}`);
console.log(`Entity counts:`, ingest.stats.entityCounts);

if (ingest.slabs.length === 0) {
  throw new Error("DXF ingest found no slab on SLAB layer.");
}
if (ingest.columns.length === 0) {
  throw new Error("DXF ingest found no columns on COLUMN-REAL layer.");
}

// Pick the largest slab polygon as the active slab (webapp convention)
let slab: Polygon = ingest.slabs[0].polygon;
let area = Math.abs(ringArea(slab.outer));
for (const s of ingest.slabs) {
  const a = Math.abs(ringArea(s.polygon.outer));
  if (a > area) { slab = s.polygon; area = a; }
}

// Attach holes from any other slab-layer entities that are inside the outer
// (our DXF synthesizer only writes outer + holes as separate LWPOLYLINEs on
//  the SLAB layer, all tagged as slabs by the ingest).
const holes: { outer: number[][] }[] = [];
for (const s of ingest.slabs) {
  if (s.polygon === slab) continue;
  holes.push(s.polygon);
}
if (holes.length > 0) {
  slab = { outer: slab.outer, holes: holes.map(h => h.outer as [number, number][]) };
}

// 2. Column sizes: DXF POINTs have no size info; override from SAFE ground truth
const byId = new Map<string, any>(gt.columns.map((c: any) => [c.id, c]));
let sized = 0;
for (const c of ingest.columns) {
  const src = byId.get(c.id);
  if (src) { c.c1 = src.c1_in; c.c2 = src.c2_in; sized++; }
}
console.log(`Sized ${sized}/${ingest.columns.length} columns from ground truth`);

// 3. Classify columns
classifyColumns(slab, ingest.columns, 36);
const typeCounts = { interior: 0, edge: 0, corner: 0 };
for (const c of ingest.columns) typeCounts[c.type ?? "interior"]++;
console.log(`Column types (webapp):`, typeCounts);

// 4. Tributary areas via Voronoi grid sample (step = 12 in, as in the app)
const tribs = tributaryAreas(slab, ingest.columns, 12);
for (const c of ingest.columns) c.tributaryArea = tribs.get(c.id) ?? 0;

// 5. ProjectInputs — matched to SAFE's design assumptions
const inputs: ProjectInputs = {
  fcPsi: gt.materials.fc_psi,
  hIn: gt.slab.thickness_in,
  dIn: gt.slab.effective_depth_in,
  deadPsf: gt.loads.webapp_dead_psf_eq,   // 100 + 35 = 135 (webapp does NOT add self-weight despite comment)
  livePsf: gt.loads.webapp_live_psf_eq,   // 40
  defaultC1: 12,
  defaultC2: 12,
  phi: 0.75,
};

// 6. Run checkPunching for each column
const results = ingest.columns.map(c => checkPunching(c, inputs));

// 7. Write output
const out = {
  webapp_version: "perfect-punching @ f7cdc37",
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
};
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`\nWrote ${results.length} webapp results -> ${outPath}`);

// Print top-5 DCRs
const sorted = [...results].sort((a, b) => b.dcr - a.dcr).slice(0, 5);
console.log("\nTop 5 webapp DCRs:");
for (const r of sorted) {
  console.log(`  ${r.columnId}  type=${r.type.padEnd(8)}  Vu=${(r.vu/1000).toFixed(2)} kip  Mu=${(r.mu/1000).toFixed(1)} kip-in  b0=${r.b0.toFixed(1)} in  DCR=${r.dcr.toFixed(3)}`);
}

function ringArea(r: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  }
  return a / 2;
}
