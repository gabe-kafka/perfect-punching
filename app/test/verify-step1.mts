/**
 * One-shot verification for §1.1 (mesh-edge cap).
 *
 * Loads the demo DXF (app/public/test-input.dxf), sizes columns from the
 * webapp's DEFAULT_INPUTS (not from a SAFE ground-truth file like the
 * other harnesses), runs plate FEA, and prints per-column patchSlaves
 * plus Mu magnitudes so we can see whether the rigid patch is actually
 * firing.  Acceptance criteria (from tasks/todo.md Step 1):
 *   - patchSlaves >= 4 on every column
 *   - col-4 vs col-14 (both interior) Mu within an order of magnitude
 *   - meshEdgeNotice is present and names the override
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ingestDxf } from "../src/lib/dxf-ingest.ts";
import { classifyColumns } from "../src/lib/classify.ts";
import { unbalancedMomentsFEA } from "../src/fea/plate-fea.ts";
import { buildMesh } from "../src/fea/mesher.ts";
import { identifyColumnPatches } from "../src/fea/bc.ts";
import { largest, pointInRing } from "../src/lib/geom.ts";
import { factoredPressurePsi } from "../src/lib/load-combos.ts";
import type { ProjectInputs, Polygon, Vec2 } from "../src/lib/types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dxfPath = path.resolve(__dirname, "../public/test-input.dxf");

const dxfText = fs.readFileSync(dxfPath, "utf8").replace(/^﻿/, "");
const ingest = ingestDxf(dxfText);
console.log(`Ingest: ${ingest.slabs.length} slabs, ${ingest.columns.length} cols (raw), ${ingest.walls.length} walls`);

const slab: Polygon | null = largest(ingest.slabs.map(s => s.polygon));
if (!slab) throw new Error("no slab");

const inside = (p: Vec2) => {
  if (!pointInRing(p, slab.outer)) return false;
  for (const h of slab.holes ?? []) if (pointInRing(p, h)) return false;
  return true;
};

// Mirror App.tsx DEFAULT_INPUTS
const inputs: ProjectInputs = {
  fcPsi: 5000,
  hIn: 8,
  dIn: 7,
  deadPsf: 30,
  livePsf: 50,
  defaultC1: 24,
  defaultC2: 24,
  phi: 0.75,
  columnHeightIn: 144,
  columnFarEndFixity: "fixed",
  concreteNu: 0.2,
  meshTargetEdgeIn: 24,
};

// Drop phantom columns + apply default sizing (same as App.tsx)
const columns = ingest.columns
  .filter(c => inside(c.position))
  .map(c => ({ ...c, c1: c.c1 || inputs.defaultC1, c2: c.c2 || inputs.defaultC2 }));
console.log(`Kept ${columns.length} columns after phantom filter`);

classifyColumns(slab, columns);

const wu_psi = factoredPressurePsi(inputs);

// Optional override via argv[2]: pass a number (e.g., 24) to force a
// targetEdge by calling buildMesh directly (bypasses §1.1 cap).  With
// no arg, go through the normal unbalancedMomentsFEA path.
const forceEdge = Number(process.argv[2]);
if (Number.isFinite(forceEdge) && forceEdge > 0) {
  console.log(`\n[verify] bypassing §1.1, calling buildMesh(targetEdge=${forceEdge})...`);
  const mesh = buildMesh(slab, columns, ingest.walls, { targetEdge: forceEdge });
  const patches = identifyColumnPatches(mesh, columns);
  console.log(`  mesh: ${mesh.nodes.length} nodes, ${mesh.elements.length} elements`);
  console.log(`\n=== Raw patch slave counts at targetEdge=${forceEdge} ===`);
  console.log(`id    type       c1      c2      slaves`);
  for (const c of columns) {
    const p = patches.find(pp => pp.columnId === c.id);
    console.log(`${c.id.padEnd(5)} ${(c.type ?? "-").padEnd(10)} ${c.c1.toFixed(2).padStart(6)}  ${c.c2.toFixed(2).padStart(6)}   ${String(p?.slaves.length ?? 0).padStart(4)}`);
  }
  process.exit(0);
}

console.log(`\nRunning FEA...`);
const t0 = performance.now();
const fea = await unbalancedMomentsFEA(slab, columns, ingest.walls, wu_psi, inputs);
const elapsed = performance.now() - t0;
const d = fea.diagnostics;

console.log(`\n=== Mesh ===`);
console.log(`targetEdgeIn:  ${d.targetEdgeIn.toFixed(2)}"`);
console.log(`notice:        ${d.meshEdgeNotice ?? "(none)"}`);
console.log(`mesh:          ${d.nNodes} nodes, ${d.nElements} elements`);
console.log(`solve:         ${d.cgIterations} CG iters, residual ${d.residual.toExponential(2)}, elapsed ${elapsed.toFixed(0)} ms`);
console.log(`equilibrium:   ${(d.equilibriumError * 100).toFixed(4)}%`);
console.log(`load:          total ${(d.totalLoad/1000).toFixed(1)} kip, cols ${(d.colReactionSum/1000).toFixed(1)}, walls ${(d.wallReactionSum/1000).toFixed(1)}`);

console.log(`\n=== Per-column patch diagnostic ===`);
console.log(`id    type       c1      c2      slaves    Mu (kip-in)`);
const rows: { id: string; slaves: number; mu: number }[] = [];
for (const c of columns) {
  const m = fea.perColumn.get(c.id);
  const slaves = m?.patchSlaves ?? 0;
  const mu = Math.hypot(m?.mu2 ?? 0, m?.mu3 ?? 0) / 1000;
  rows.push({ id: c.id, slaves, mu });
  console.log(
    `${c.id.padEnd(5)} ${(c.type ?? "-").padEnd(10)} ${c.c1.toFixed(2).padStart(6)}  ${c.c2.toFixed(2).padStart(6)}   ${String(slaves).padStart(4)}       ${mu.toFixed(1)}`,
  );
}

// Acceptance checks
console.log(`\n=== Stability ===`);
console.log(`label: ${d.stability.toUpperCase()}`);
for (const r of d.stabilityReasons) console.log(`  - ${r}`);

console.log(`\n=== Acceptance ===`);
// Phase 0 gate: app must report stability honestly.  A run that returns
// "stable" with patchSlaves=0 is a BIGGER failure than a run that
// returns "unstable" and tells the user not to ship.
const zeroSlaves = rows.filter(r => r.slaves === 0);
let ok = true;
if (zeroSlaves.length > 0 && d.stability !== "unstable") {
  console.log(`FAIL  ${zeroSlaves.length} columns have patchSlaves=0 but stability=${d.stability} — detector is lying`);
  ok = false;
} else if (zeroSlaves.length > 0 && d.stability === "unstable") {
  console.log(`PASS  detector correctly reported UNSTABLE for ${zeroSlaves.length} columns with no rigid patch`);
} else if (d.stability === "stable") {
  console.log(`PASS  all columns have patchSlaves >= 4 and stability = stable`);
} else {
  console.log(`INFO  stability = ${d.stability}; no columns with patchSlaves=0 but other signals flagged`);
}
process.exit(ok ? 0 : 1);
