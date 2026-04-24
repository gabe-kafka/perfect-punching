/**
 * DKT patch test — constant curvature modes.
 *
 * If the nodal DOFs are set to reproduce a quadratic w(x,y), B*u at every
 * interior point must return the corresponding constant curvature:
 *
 *   w = x^2 / 2   ->  kappa = [1, 0, 0]
 *   w = y^2 / 2   ->  kappa = [0, 1, 0]
 *   w = x * y     ->  kappa = [0, 0, 2]   (shear curvature = 2 * kappa_xy)
 *
 * Under convention theta_x = -dw/dy, theta_y = +dw/dx:
 *   w = x^2/2:  per-node DOFs = [x_i^2/2, 0,    x_i]
 *   w = y^2/2:  per-node DOFs = [y_i^2/2, -y_i, 0]
 *   w = x*y  :  per-node DOFs = [x_i*y_i, -x_i, y_i]
 */
import { bMatrix, dktCoeffs, keDKT } from "../src/fea/dkt.ts";

const TOL = 1e-10;

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

function patchOnTriangle(
  label: string,
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number,
) {
  console.log(`\n=== patch: ${label} ===`);
  const C = dktCoeffs(x1,y1,x2,y2,x3,y3);
  const D = 1, nu = 0.25;

  const modes: {
    name: string;
    u: number[];
    expect: [number, number, number];
  }[] = [
    {
      name: "w = x^2/2",
      u: [
        x1*x1/2, 0, x1,
        x2*x2/2, 0, x2,
        x3*x3/2, 0, x3,
      ],
      expect: [1, 0, 0],
    },
    {
      name: "w = y^2/2",
      u: [
        y1*y1/2, -y1, 0,
        y2*y2/2, -y2, 0,
        y3*y3/2, -y3, 0,
      ],
      expect: [0, 1, 0],
    },
    {
      name: "w = x*y",
      u: [
        x1*y1, -x1, y1,
        x2*y2, -x2, y2,
        x3*y3, -x3, y3,
      ],
      expect: [0, 0, 2],
    },
  ];

  // Sample a 6-point lattice inside the reference triangle.
  const samples: [number, number, number][] = [];
  const n = 4;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n - i; j++) {
      const xi1 = i / n, xi2 = j / n;
      const xi3 = 1 - xi1 - xi2;
      if (xi3 < -1e-12) continue;
      samples.push([xi1, xi2, xi3]);
    }
  }

  let allPass = true;
  for (const { name, u, expect } of modes) {
    let maxErr = 0;
    for (const [xi1, xi2, xi3] of samples) {
      const B = bMatrix(xi1, xi2, xi3, C);
      const kappa = [
        B[0].reduce((s, v, i) => s + v * u[i], 0),
        B[1].reduce((s, v, i) => s + v * u[i], 0),
        B[2].reduce((s, v, i) => s + v * u[i], 0),
      ];
      const err = Math.max(
        Math.abs(kappa[0] - expect[0]),
        Math.abs(kappa[1] - expect[1]),
        Math.abs(kappa[2] - expect[2]),
      );
      maxErr = Math.max(maxErr, err);
    }
    const pass = maxErr < TOL;
    console.log(`  ${name}: max |kappa - expected| = ${maxErr.toExponential(3)}  ${pass ? "OK" : "FAIL"}`);
    if (!pass) allPass = false;
  }

  // Energy check for constant kappa_xx = 1:
  //   U = (1/2) integral kappa^T D_b kappa dA = (1/2) * D * 1 * Area
  // Unit right triangle has Area = 0.5, so U = 0.25 * D.
  // For arbitrary triangle with area A, U = D * A / 2.
  const area = Math.abs(C.twoA) / 2;
  const Ke = keDKT(x1,y1,x2,y2,x3,y3, D, nu);
  const uKxx = modes[0].u;
  const energy = 0.5 * dot(uKxx, matVec(Ke, uKxx));
  const expectedEnergy = D * area / 2;   // (1/2) * kappa^T Db kappa * A = (1/2)*D*A
  const relErr = Math.abs(energy - expectedEnergy) / expectedEnergy;
  console.log(`  energy(w=x^2/2): got ${energy.toExponential(4)}, expected ${expectedEnergy.toExponential(4)}, rel err ${relErr.toExponential(2)}  ${relErr < 1e-10 ? "OK" : "FAIL"}`);
  if (relErr > 1e-10) allPass = false;

  return allPass;
}

const p1 = patchOnTriangle("unit right",        0,0, 1,0, 0,1);
const p2 = patchOnTriangle("skewed",            0.3,0.1, 2.1,0.5, 1.2,1.8);
const p3 = patchOnTriangle("shifted off-origin", 5,5, 7,5, 5,7);
const p4 = patchOnTriangle("aspect-10",         0,0, 10,0, 0,1);

const allPass = p1 && p2 && p3 && p4;
console.log(`\nOverall patch test: ${allPass ? "PASS" : "FAIL"}`);
if (!allPass) process.exit(1);
