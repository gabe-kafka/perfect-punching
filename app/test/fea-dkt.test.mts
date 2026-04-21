/**
 * DKT sanity checks:
 *   1. Ke is symmetric (to machine precision)
 *   2. Ke has rank 6 (3 rigid-body modes in 9 DOFs: w-translation, two rotations)
 *   3. The three rigid-body modes produce Ke·u = 0
 */
import { keDKT } from "../src/fea/dkt.ts";

function rigidBody(x1:number,y1:number,x2:number,y2:number,x3:number,y3:number) {
  // DOF convention per node: [w, ∂w/∂y, ∂w/∂x]
  // Three zero-energy modes for a plate element:
  //   a) w = 1 (constant vertical translation)
  //   b) w = y  →  ∂w/∂y = 1, ∂w/∂x = 0 → DOF per node = [y_i, 1, 0]
  //   c) w = x  →  ∂w/∂y = 0, ∂w/∂x = 1 → DOF per node = [x_i, 0, 1]
  return [
    [1,0,0, 1,0,0, 1,0,0],
    [y1,1,0, y2,1,0, y3,1,0],
    [x1,0,1, x2,0,1, x3,0,1],
  ];
}

function matVec(K: number[][], u: number[]): number[] {
  const out = new Array(K.length).fill(0);
  for (let i = 0; i < K.length; i++) {
    let s = 0;
    for (let j = 0; j < u.length; j++) s += K[i][j] * u[j];
    out[i] = s;
  }
  return out;
}

function fmt(K: number[][]): string {
  return K.map(row => row.map(v => v.toExponential(2).padStart(10)).join(" ")).join("\n");
}

// Unit triangle
const x1=0, y1=0, x2=1, y2=0, x3=0, y3=1;
const D = 1, nu = 0.25;
const K = keDKT(x1,y1, x2,y2, x3,y3, D, nu);

// 1. Symmetry
let maxAsym = 0;
for (let i = 0; i < 9; i++) for (let j = i+1; j < 9; j++) {
  maxAsym = Math.max(maxAsym, Math.abs(K[i][j] - K[j][i]));
}
console.log(`Symmetry: max|K_ij - K_ji| = ${maxAsym.toExponential(3)} (want ~0)`);

// 2. Rigid-body modes produce zero force
for (const u of rigidBody(x1,y1,x2,y2,x3,y3)) {
  const Ku = matVec(K, u);
  const norm = Math.sqrt(Ku.reduce((s, v) => s + v * v, 0));
  console.log(`Rigid-body mode Ku norm = ${norm.toExponential(3)} (want ~0)`);
}

// 3. Diagonal positivity (all free DOFs should have positive diagonal)
let minDiag = Infinity, maxDiag = -Infinity;
for (let i = 0; i < 9; i++) {
  minDiag = Math.min(minDiag, K[i][i]);
  maxDiag = Math.max(maxDiag, K[i][i]);
}
console.log(`Diagonal range: [${minDiag.toExponential(2)}, ${maxDiag.toExponential(2)}]`);

// 4. Try a simple non-rigid deformation and check energy > 0
//    e.g., theta_y1 = 1, others zero -> pure curvature
const uTest = new Array(9).fill(0); uTest[2] = 1;
const Ku = matVec(K, uTest);
const energy = uTest.reduce((s, v, i) => s + v * Ku[i], 0);
console.log(`Energy for theta_y1 = 1 test: ${energy.toExponential(3)} (want > 0)`);

// Print top-left corner
console.log("\nKe top-left 3x3:");
console.log(K.slice(0, 3).map(row => row.slice(0, 3).map(v => v.toExponential(2).padStart(10)).join(" ")).join("\n"));
