/**
 * End-to-end smoke test of the FEA pipeline on a synthetic slab.
 *
 * The real 1025-Atlantic DXF + SAFE ground truth live outside this repo
 * (in a companion PowerShell harness, per test/README.md).  For a
 * machine-local shake-out, we construct a 3-bay x 3-bay flat-plate slab
 * in TypeScript directly — no DXF parsing — and verify:
 *
 *   - Mesh builds
 *   - CG converges
 *   - Per-column V_u, M_u2, M_u3 are finite
 *   - Global equilibrium: Sum of column + wall reactions matches total
 *     applied load within 0.1%
 *
 * Run also with a single column and a regular grid to exercise the
 * interior-vs-edge classification.
 */
import type { Column, Polygon, ProjectInputs, Wall } from "../src/lib/types.ts";
import { classifyColumns } from "../src/lib/classify.ts";
import { unbalancedMomentsFEA } from "../src/fea/plate-fea.ts";

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
console.log(`wu = ${wu_psi.toExponential(3)} lb/in^2  (${(wu_psi*144).toFixed(0)} psf)`);

function ringArea(r: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  }
  return Math.abs(a / 2);
}

interface Case {
  name: string;
  slab: Polygon;
  columns: Column[];
  walls: Wall[];
  inputs?: Partial<ProjectInputs>;
}

function makeGrid(name: string, nx: number, ny: number, spacing: number, edgeOffset: number, withWalls: boolean): Case {
  const w = (nx - 1) * spacing + 2 * edgeOffset;
  const h = (ny - 1) * spacing + 2 * edgeOffset;
  const slab: Polygon = {
    outer: [[0, 0], [w, 0], [w, h], [0, h]],
  };
  const columns: Column[] = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      columns.push({
        id: `C${i}${j}`,
        position: [edgeOffset + i * spacing, edgeOffset + j * spacing],
        c1: 18,
        c2: 18,
      });
    }
  }
  const walls: Wall[] = withWalls
    ? [{ id: "leftwall", points: [[0, 0], [0, h]], closed: false }]
    : [];
  return { name, slab, columns, walls };
}

function singleInteriorColumn(): Case {
  const a = 240;
  return {
    name: "single interior column (200x200, col at center)",
    slab: { outer: [[0, 0], [a, 0], [a, a], [0, a]] },
    columns: [{ id: "C1", position: [a/2, a/2], c1: 18, c2: 18 }],
    walls: [
      { id: "bottom", points: [[0, 0], [a, 0]], closed: false },
      { id: "right",  points: [[a, 0], [a, a]], closed: false },
      { id: "top",    points: [[a, a], [0, a]], closed: false },
      { id: "left",   points: [[0, a], [0, 0]], closed: false },
    ],
  };
}

const cases: Case[] = [
  singleInteriorColumn(),
  makeGrid("3x3 grid, no walls", 3, 3, 240, 120, false),
  makeGrid("3x3 grid, 1 edge wall", 3, 3, 240, 120, true),
];

let allOk = true;
for (const c of cases) {
  console.log(`\n========================================`);
  console.log(`Case: ${c.name}`);
  console.log(`========================================`);
  classifyColumns(c.slab, c.columns, 36);
  const typeCounts: Record<string, number> = { interior: 0, edge: 0, corner: 0 };
  for (const col of c.columns) typeCounts[col.type ?? "interior"]++;
  console.log(`  columns: total=${c.columns.length}  interior=${typeCounts.interior}  edge=${typeCounts.edge}  corner=${typeCounts.corner}`);
  const slabArea = ringArea(c.slab.outer);
  const totalLoadExpected = wu_psi * slabArea;
  console.log(`  slab: ${(slabArea/144).toFixed(0)} ft^2,  expected total load ${(totalLoadExpected/1000).toFixed(2)} kip`);

  const mergedInputs = { ...inputs, ...(c.inputs ?? {}) };
  const t0 = performance.now();
  let out: ReturnType<typeof unbalancedMomentsFEA>;
  try {
    out = unbalancedMomentsFEA(c.slab, c.columns, c.walls, wu_psi, mergedInputs);
  } catch (e) {
    console.error(`  FAIL: ${(e as Error).message}`);
    allOk = false;
    continue;
  }
  const wall = performance.now() - t0;
  const d = out.diagnostics;
  console.log(`  nodes=${d.nNodes}  elements=${d.nElements}  free DOF=${d.nFree}  CG iters=${d.cgIterations}  time=${d.elapsedMs.toFixed(0)}ms (wall ${wall.toFixed(0)}ms)`);
  console.log(`  total load=${(d.totalLoad/1000).toFixed(2)} kip   Sum Vu cols=${(d.colReactionSum/1000).toFixed(2)} kip   Sum walls=${(d.wallReactionSum/1000).toFixed(2)} kip`);
  console.log(`  equilibrium err=${(d.equilibriumError*100).toFixed(4)} %`);

  let nNaN = 0;
  for (const [, r] of out.perColumn) {
    if (!isFinite(r.Vu) || !isFinite(r.mu2) || !isFinite(r.mu3)) nNaN++;
  }
  console.log(`  columns with finite results: ${out.perColumn.size - nNaN}/${out.perColumn.size}`);
  // Per-column summary (if small)
  if (out.perColumn.size <= 12) {
    console.log(`    ${"id".padEnd(8)}  ${"type".padEnd(8)}  Vu(kip)    Mu2(kip-in)  Mu3(kip-in)   w(in)`);
    for (const col of c.columns) {
      const r = out.perColumn.get(col.id)!;
      console.log(`    ${col.id.padEnd(8)}  ${(col.type ?? "-").padEnd(8)}  ${(r.Vu/1000).toFixed(2).padStart(7)}  ${(r.mu2/1000).toFixed(2).padStart(10)}   ${(r.mu3/1000).toFixed(2).padStart(10)}   ${r.wAtCol.toExponential(2)}`);
    }
  }

  const equilOk = d.equilibriumError < 0.001;
  const convergedOk = d.converged;
  const allFinite = nNaN === 0;
  const pass = equilOk && convergedOk && allFinite;
  console.log(`  verdict: ${pass ? "PASS" : "FAIL"}  (converged=${convergedOk} equil=${equilOk} finite=${allFinite})`);
  if (!pass) allOk = false;
}

console.log(`\n${allOk ? "PASS" : "FAIL"} overall smoke test.`);
if (!allOk) process.exit(1);
