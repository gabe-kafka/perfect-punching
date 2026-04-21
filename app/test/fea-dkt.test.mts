/**
 * DKT sanity checks.
 *
 * DOF convention per node (Batoz): [w, theta_x, theta_y]
 *   theta_x = -dw/dy   (rotation about x-axis, RH rule)
 *   theta_y = +dw/dx   (rotation about y-axis, RH rule)
 *
 * Rigid-body modes (3 zero-energy modes expected):
 *   w = 1  -> u_i = [1, 0, 0]
 *   w = y  -> u_i = [y_i, -1, 0]
 *   w = x  -> u_i = [x_i, 0, +1]
 */
import { keDKT } from "../src/fea/dkt.ts";

function rigidBody(x1:number,y1:number,x2:number,y2:number,x3:number,y3:number) {
  return [
    { label: "w = 1",  u: [1,0,0, 1,0,0, 1,0,0] },
    { label: "w = y",  u: [y1,-1,0, y2,-1,0, y3,-1,0] },
    { label: "w = x",  u: [x1,0,1, x2,0,1, x3,0,1] },
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

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function runOnTriangle(label: string, x1:number,y1:number,x2:number,y2:number,x3:number,y3:number) {
  console.log(`\n=== ${label} ===`);
  const D = 1, nu = 0.25;
  const K = keDKT(x1,y1, x2,y2, x3,y3, D, nu);

  let maxAsym = 0;
  for (let i = 0; i < 9; i++) for (let j = i+1; j < 9; j++) {
    maxAsym = Math.max(maxAsym, Math.abs(K[i][j] - K[j][i]));
  }
  console.log(`Symmetry: max|K_ij - K_ji| = ${maxAsym.toExponential(3)}`);

  let allRigidPass = true;
  for (const { label: l, u } of rigidBody(x1,y1,x2,y2,x3,y3)) {
    const Ku = matVec(K, u);
    const norm = Math.sqrt(Ku.reduce((s, v) => s + v * v, 0));
    const pass = norm < 1e-10;
    console.log(`  ${l}: |Ku| = ${norm.toExponential(3)}  ${pass ? "OK" : "FAIL"}`);
    if (!pass) allRigidPass = false;
  }

  // Rank check: the 9x9 Ke should have nullity exactly 3.
  // Quick proxy: count near-zero eigenvalues via Gram-Schmidt + rank estimate.
  // Use smallest-singular-value via power iteration on K^T K - no; simpler:
  // check that Ke is PSD on the range complement by running a small set of
  // non-rigid test vectors and confirming positive energy each time.
  const nonRigid: { label: string; u: number[] }[] = [
    { label: "theta_y1 bump", u: [0,0,1, 0,0,0, 0,0,0] },
    { label: "theta_x2 bump", u: [0,0,0, 0,1,0, 0,0,0] },
    { label: "w3 bump",       u: [0,0,0, 0,0,0, 1,0,0] },
    { label: "mixed mode",    u: [0,0,1, 1,0,0, 0,-1,0] },
  ];
  for (const { label: l, u } of nonRigid) {
    const Ku = matVec(K, u);
    const energy = dot(u, Ku);
    const okPSD = energy > 0;
    console.log(`  non-rigid "${l}": energy = ${energy.toExponential(3)}  ${okPSD ? "OK (>0)" : "FAIL (<=0)"}`);
  }

  return allRigidPass;
}

// Case 1: unit right triangle (0,0)-(1,0)-(0,1)
const p1 = runOnTriangle("unit right triangle", 0,0, 1,0, 0,1);

// Case 2: skewed triangle
const p2 = runOnTriangle("skewed triangle", 0.3,0.1, 2.1,0.5, 1.2,1.8);

// Case 3: shifted triangle (not anchored at origin)
const p3 = runOnTriangle("shifted triangle", 5,5, 7,5, 5,7);

// Case 4: large aspect ratio (thin triangle) - sanity that it still passes
const p4 = runOnTriangle("aspect-ratio 10", 0,0, 10,0, 0,1);

const allPass = p1 && p2 && p3 && p4;
console.log(`\nOverall rigid-body test: ${allPass ? "PASS" : "FAIL"}`);
if (!allPass) process.exit(1);
