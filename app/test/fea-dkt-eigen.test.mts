/**
 * Eigenvalue rank check for DKT Ke.
 *
 * A correctly implemented DKT element has a 3-dimensional null space
 * (the three rigid-body modes) and 6 strictly positive eigenvalues.  A
 * rank deficiency (an extra zero eigenvalue) indicates a spurious
 * zero-energy mode — single-element rigid-body tests pass but assembled
 * meshes become singular or locked.
 *
 * We use Jacobi sweeps on the 9x9 symmetric Ke (converges in ~40
 * sweeps to 1e-14).
 */
import { keDKT } from "../src/fea/dkt.ts";

function eigJacobi(A: number[][]): number[] {
  const n = A.length;
  const M: number[][] = A.map(r => r.slice());
  const MAX_SWEEPS = 100;
  const TOL = 1e-14;
  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    let off = 0;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) off += M[p][q] * M[p][q];
    }
    if (Math.sqrt(off) < TOL) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = M[p][q];
        if (Math.abs(apq) < 1e-16) continue;
        const app = M[p][p], aqq = M[q][q];
        const theta = (aqq - app) / (2 * apq);
        const t = Math.sign(theta) / (Math.abs(theta) + Math.sqrt(1 + theta * theta));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = t * c;
        M[p][p] = app - t * apq;
        M[q][q] = aqq + t * apq;
        M[p][q] = 0; M[q][p] = 0;
        for (let k = 0; k < n; k++) {
          if (k === p || k === q) continue;
          const akp = M[k][p], akq = M[k][q];
          M[k][p] = c * akp - s * akq;
          M[p][k] = M[k][p];
          M[k][q] = s * akp + c * akq;
          M[q][k] = M[k][q];
        }
      }
    }
  }
  const eigs = new Array(n);
  for (let i = 0; i < n; i++) eigs[i] = M[i][i];
  eigs.sort((a, b) => a - b);
  return eigs;
}

function runOnTri(label: string, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
  const Ke = keDKT(x1,y1,x2,y2,x3,y3, 1, 0.25);
  const eigs = eigJacobi(Ke);
  const maxEig = Math.max(...eigs.map(Math.abs));
  const tol = maxEig * 1e-10;
  const nearZero = eigs.filter(e => Math.abs(e) < tol).length;
  const positive = eigs.filter(e => e > tol).length;
  const negative = eigs.filter(e => e < -tol).length;
  const ok = nearZero === 3 && positive === 6 && negative === 0;
  console.log(`${label}`);
  console.log(`  eigs = [${eigs.map(e => e.toExponential(3)).join(", ")}]`);
  console.log(`  near-zero = ${nearZero}  positive = ${positive}  negative = ${negative}  ${ok ? "OK" : "FAIL"}`);
  return ok;
}

const cases = [
  ["unit right", 0,0, 1,0, 0,1],
  ["skewed",     0.3,0.1, 2.1,0.5, 1.2,1.8],
  ["shifted",    5,5, 7,5, 5,7],
  ["aspect-10",  0,0, 10,0, 0,1],
  ["tiny",       0,0, 0.01,0, 0,0.01],
  ["large",      0,0, 500,0, 0,500],
] as [string, number, number, number, number, number, number][];

let allOk = true;
for (const [label, x1, y1, x2, y2, x3, y3] of cases) {
  if (!runOnTri(label, x1, y1, x2, y2, x3, y3)) allOk = false;
}

console.log(`\nOverall eigenvalue rank check: ${allOk ? "PASS" : "FAIL"}`);
if (!allOk) process.exit(1);
