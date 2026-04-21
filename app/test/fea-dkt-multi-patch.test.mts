/**
 * Irons-Razzaque multi-element patch test.
 *
 * Four-triangle patch of a unit square meeting at an interior node at
 * (0.5, 0.5). The four corner nodes get DOFs prescribed to match the
 * quadratic w = x^2 / 2 (kappa_xx = 1 everywhere). Solve for the free
 * interior node.  The interior DOFs should match w=x^2/2 at (0.5,0.5)
 * EXACTLY (DKT reproduces quadratics), and kappa should be [1,0,0] at
 * every Gauss point of every element.
 *
 * Passing this test is the standard criterion that the element is
 * inter-element compatible — something a single-triangle patch test
 * cannot detect.
 */
import { bMatrix, dktCoeffs, keDKT } from "../src/fea/dkt.ts";

const TOL = 1e-8;

function matVec(K: number[][], u: number[]): number[] {
  const out = new Array(K.length).fill(0);
  for (let i = 0; i < K.length; i++) {
    let s = 0;
    for (let j = 0; j < u.length; j++) s += K[i][j] * u[j];
    out[i] = s;
  }
  return out;
}

// Gauss-Jordan elimination for a dense symmetric positive-definite system.
function solveDense(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M: number[][] = A.map(r => r.slice());
  const x = b.slice();
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[piv][i])) piv = k;
    if (piv !== i) { [M[i], M[piv]] = [M[piv], M[i]]; [x[i], x[piv]] = [x[piv], x[i]]; }
    const d = M[i][i];
    if (Math.abs(d) < 1e-14) throw new Error(`singular pivot at ${i}`);
    for (let k = i + 1; k < n; k++) {
      const f = M[k][i] / d;
      for (let j = i; j < n; j++) M[k][j] -= f * M[i][j];
      x[k] -= f * x[i];
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = x[i];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

interface Node { x: number; y: number }

function runPatch(label: string, quadCorners: [number, number][], centerOffset: [number, number] = [0, 0]) {
  console.log(`\n--- ${label} ---`);
  // Nodes: 0..3 = corners in CCW order, 4 = interior centroid.
  const cx = quadCorners.reduce((s, p) => s + p[0], 0) / 4 + centerOffset[0];
  const cy = quadCorners.reduce((s, p) => s + p[1], 0) / 4 + centerOffset[1];
  const nodes: Node[] = [
    { x: quadCorners[0][0], y: quadCorners[0][1] },
    { x: quadCorners[1][0], y: quadCorners[1][1] },
    { x: quadCorners[2][0], y: quadCorners[2][1] },
    { x: quadCorners[3][0], y: quadCorners[3][1] },
    { x: cx, y: cy },
  ];
  // 4 triangles: each connects center (4) to an edge (i, i+1)
  const tris: [number, number, number][] = [
    [0, 1, 4],
    [1, 2, 4],
    [2, 3, 4],
    [3, 0, 4],
  ];

  // Assemble dense K (15x15 for 5 nodes x 3 DOF).
  const n = nodes.length;
  const nDof = 3 * n;
  const K: number[][] = Array.from({ length: nDof }, () => new Array(nDof).fill(0));
  for (const tri of tris) {
    const [a, b, c] = tri;
    const Ke = keDKT(nodes[a].x, nodes[a].y, nodes[b].x, nodes[b].y, nodes[c].x, nodes[c].y, 1, 0.25);
    const gdof = [3*a, 3*a+1, 3*a+2, 3*b, 3*b+1, 3*b+2, 3*c, 3*c+1, 3*c+2];
    for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) K[gdof[i]][gdof[j]] += Ke[i][j];
  }

  // Prescribe DOFs on the 4 corners matching w = x^2/2:
  //   DOFs = [x^2/2, 0, x]  (theta_x = -dw/dy = 0, theta_y = +dw/dx = x)
  const u = new Array(nDof).fill(0);
  const prescribed = new Set<number>();
  for (let i = 0; i < 4; i++) {
    const { x } = nodes[i];
    u[3*i]     = x * x / 2;   prescribed.add(3*i);
    u[3*i + 1] = 0;            prescribed.add(3*i + 1);
    u[3*i + 2] = x;            prescribed.add(3*i + 2);
  }

  // Solve for the interior 3 DOFs.
  const free = [3*4, 3*4 + 1, 3*4 + 2];
  const K_ff: number[][] = [];
  const K_fp: number[][] = [];
  for (let i = 0; i < 3; i++) {
    K_ff.push(free.map(j => K[free[i]][j]));
    const row: number[] = [];
    for (let j = 0; j < nDof; j++) if (prescribed.has(j)) row.push(K[free[i]][j]);
    K_fp.push(row);
  }
  const uP = Array.from(prescribed).sort((a, b) => a - b).map(i => u[i]);
  const rhs = new Array(3).fill(0);
  for (let i = 0; i < 3; i++) {
    let s = 0;
    for (let k = 0; k < uP.length; k++) s += K_fp[i][k] * uP[k];
    rhs[i] = -s;
  }
  const uF = solveDense(K_ff, rhs);
  for (let i = 0; i < 3; i++) u[free[i]] = uF[i];

  // Expected interior: w = cx^2/2, theta_x = 0, theta_y = cx.
  const expected = [cx * cx / 2, 0, cx];
  const errW  = Math.abs(u[free[0]] - expected[0]);
  const errTx = Math.abs(u[free[1]] - expected[1]);
  const errTy = Math.abs(u[free[2]] - expected[2]);
  const okCenter = errW < TOL && errTx < TOL && errTy < TOL;
  console.log(`  center DOFs (w, theta_x, theta_y)`);
  console.log(`    got      = [${u[free[0]].toExponential(4)}, ${u[free[1]].toExponential(3)}, ${u[free[2]].toExponential(4)}]`);
  console.log(`    expected = [${expected[0].toExponential(4)}, ${expected[1].toExponential(3)}, ${expected[2].toExponential(4)}]`);
  console.log(`    errors   = [${errW.toExponential(2)}, ${errTx.toExponential(2)}, ${errTy.toExponential(2)}]  ${okCenter ? "OK" : "FAIL"}`);

  // Check kappa at a few sample points per element.
  let maxKappaErr = 0;
  for (const tri of tris) {
    const [a, b, c] = tri;
    const C = dktCoeffs(nodes[a].x, nodes[a].y, nodes[b].x, nodes[b].y, nodes[c].x, nodes[c].y);
    const uEl = [
      u[3*a], u[3*a+1], u[3*a+2],
      u[3*b], u[3*b+1], u[3*b+2],
      u[3*c], u[3*c+1], u[3*c+2],
    ];
    const samples: [number, number, number][] = [
      [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5], [1/3, 1/3, 1/3],
    ];
    for (const [xi1, xi2, xi3] of samples) {
      const B = bMatrix(xi1, xi2, xi3, C);
      const k0 = B[0].reduce((s, v, i) => s + v * uEl[i], 0);
      const k1 = B[1].reduce((s, v, i) => s + v * uEl[i], 0);
      const k2 = B[2].reduce((s, v, i) => s + v * uEl[i], 0);
      const err = Math.max(Math.abs(k0 - 1), Math.abs(k1), Math.abs(k2));
      maxKappaErr = Math.max(maxKappaErr, err);
    }
  }
  const okKappa = maxKappaErr < TOL;
  console.log(`  max interior |kappa - [1,0,0]| over elements: ${maxKappaErr.toExponential(2)}  ${okKappa ? "OK" : "FAIL"}`);
  return okCenter && okKappa;
}

const p1 = runPatch("unit square, symmetric center", [[0,0], [1,0], [1,1], [0,1]]);
const p2 = runPatch("rectangle, center offset",      [[0,0], [2,0], [2,1], [0,1]], [0.3, -0.1]);
const p3 = runPatch("skewed quad",                   [[0,0], [1.2,0.1], [1.0,1.1], [-0.1,0.9]]);

const allPass = p1 && p2 && p3;
console.log(`\nOverall multi-element patch: ${allPass ? "PASS" : "FAIL"}`);
if (!allPass) process.exit(1);
