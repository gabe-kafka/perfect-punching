/**
 * Convergence, moment recovery, and clamped-plate benchmarks.
 *
 * 1) SS square plate w_center convergence.
 *    Interpolate w at the EXACT plate center (0,0) via barycentric linear
 *    interpolation in the enclosing triangle.  Compute log-log slope of
 *    error vs h; DKT should be O(h^2).
 *
 * 2) M_xx at plate center vs Navier closed-form.
 *    Evaluate kappa at the centroid of the triangle containing the
 *    center, M_xx = D (kappa_xx + nu * kappa_yy).
 *
 * 3) Clamped square plate w_center.  Timoshenko & Woinowsky-Krieger
 *    Table 35: w_c = 0.00126 * q * a^4 / D, nu-independent to the
 *    precision we care about.  Enforced as w=0 on boundary AND theta_x=0
 *    on top/bottom edges AND theta_y=0 on left/right edges.
 */
import type { Column, Polygon, ProjectInputs, Wall } from "../src/lib/types.ts";
import { concreteE } from "../src/fea/bc.ts";
import { flexuralRigidity } from "../src/fea/assembly.ts";
import type { FEAMaterial } from "../src/fea/types.ts";
import { buildMesh } from "../src/fea/mesher.ts";
import { assembleGlobalK } from "../src/fea/assembly.ts";
import {
  applyColumnSprings, buildColumnSprings,
  expandDisplacement, reduceSystem,
} from "../src/fea/bc.ts";
import { assembleLoadVector } from "../src/fea/loads.ts";
import { solveCG } from "../src/fea/solver.ts";
import { bMatrix, dktCoeffs } from "../src/fea/dkt.ts";

// Navier alpha for SS square, center deflection.
const ALPHA_W_SS = 0.00406;

/**
 * Compute the Navier coefficient for M_xx at the center of an SS square
 * plate: M_xx(a/2, a/2) / (q a^2) summed to m,n=N terms.
 */
function alphaMxxNavier(nu: number, N = 31): number {
  let sum = 0;
  for (let m = 1; m <= N; m += 2) {
    for (let n = 1; n <= N; n += 2) {
      const sgn = ((m - 1) / 2 + (n - 1) / 2) % 2 === 0 ? 1 : -1;
      const amn = (16 * sgn) / (Math.PI * Math.PI * Math.PI * Math.PI * Math.PI * Math.PI * m * n * Math.pow(m*m + n*n, 2));
      // kappa_xx = -w_xx at center; M_xx = D (kappa_xx + nu kappa_yy)
      // w = sum amn * sin(m pi x / a) sin(n pi y / a); at x=a/2, y=a/2 sin terms give sgn via (m-1)/2 parity
      // w_xx = - (m pi / a)^2 * w_component.  At center, multiplied by sin(m pi/2) sin(n pi/2).
      // Since we already extracted sgn (from the sin's), contribution to kappa_xx = (m pi)^2 * amn in nondim units.
      const kxx = Math.pow(Math.PI * m, 2) * amn;
      const kyy = Math.pow(Math.PI * n, 2) * amn;
      sum += kxx + nu * kyy;
    }
  }
  return sum;   // dimensionless alpha_Mxx = M_xx / (q * a^2)
}

function ssPlateConvergence() {
  console.log("\n========================");
  console.log("SS square, convergence");
  console.log("========================");
  const a = 144, h = 8, fc = 4000, q = 1, nu = 0.2;
  const material: FEAMaterial = { E: concreteE(fc), nu, h };
  const D = flexuralRigidity(material);
  const wTheory = ALPHA_W_SS * q * Math.pow(a, 4) / D;
  const alphaMxx = alphaMxxNavier(nu);
  const MxxTheory = alphaMxx * q * a * a;
  console.log(`  D = ${D.toExponential(3)} lb-in,  w_center theory = ${wTheory.toExponential(4)} in`);
  console.log(`  alpha_Mxx(nu=${nu}) = ${alphaMxx.toExponential(4)},  M_xx theory = ${MxxTheory.toExponential(3)} lb-in/in`);

  const half = a / 2;
  const slab: Polygon = {
    outer: [[-half, -half], [half, -half], [half, half], [-half, half]],
  };
  const edges = [24, 16, 12, 9, 6, 4.5];
  const table: { h: number; nNodes: number; wFEA: number; wErr: number; MxxFEA: number; MxxErr: number; iters: number }[] = [];

  for (const targetEdge of edges) {
    const mesh = buildMesh(slab, [], [], { targetEdge });
    const eps = 1e-3;
    const fixed = new Set<number>();
    for (let i = 0; i < mesh.nodes.length; i++) {
      const { x, y } = mesh.nodes[i];
      if (
        Math.abs(x - half) < eps || Math.abs(x + half) < eps ||
        Math.abs(y - half) < eps || Math.abs(y + half) < eps
      ) {
        fixed.add(3 * i);
      }
    }
    const inputs = { fcPsi: fc, hIn: h, dIn: h*0.8, deadPsf: 0, livePsf: 0, defaultC1: 12, defaultC2: 12, phi: 0.75 } as ProjectInputs;
    const K = assembleGlobalK(mesh, material);
    const springs = buildColumnSprings(mesh, [], inputs, material);
    applyColumnSprings(K, springs);
    const F = assembleLoadVector(mesh, q);
    const reduced = reduceSystem(K, F, fixed);
    const cg = solveCG(reduced.Kr, reduced.Fr, { tolerance: 1e-11, maxIter: 20000 });
    const u = expandDisplacement(K.n, reduced.free, cg.u);

    // Find triangle containing (0,0); interpolate w barycentrically.
    let wFEA = NaN;
    let MxxFEA = NaN;
    for (const el of mesh.elements) {
      const p0 = mesh.nodes[el.n[0]], p1 = mesh.nodes[el.n[1]], p2 = mesh.nodes[el.n[2]];
      const denom = (p1.y - p2.y)*(p0.x - p2.x) + (p2.x - p1.x)*(p0.y - p2.y);
      const l0 = ((p1.y - p2.y)*(0 - p2.x) + (p2.x - p1.x)*(0 - p2.y)) / denom;
      const l1 = ((p2.y - p0.y)*(0 - p2.x) + (p0.x - p2.x)*(0 - p2.y)) / denom;
      const l2 = 1 - l0 - l1;
      if (l0 >= -1e-9 && l1 >= -1e-9 && l2 >= -1e-9) {
        wFEA = l0 * u[3*el.n[0]] + l1 * u[3*el.n[1]] + l2 * u[3*el.n[2]];
        // Moment: evaluate kappa at the centroid of this element.
        const C = dktCoeffs(p0.x, p0.y, p1.x, p1.y, p2.x, p2.y);
        const B = bMatrix(1/3, 1/3, 1/3, C);
        const uEl = [
          u[3*el.n[0]], u[3*el.n[0]+1], u[3*el.n[0]+2],
          u[3*el.n[1]], u[3*el.n[1]+1], u[3*el.n[1]+2],
          u[3*el.n[2]], u[3*el.n[2]+1], u[3*el.n[2]+2],
        ];
        const kxx = B[0].reduce((s, v, i) => s + v * uEl[i], 0);
        const kyy = B[1].reduce((s, v, i) => s + v * uEl[i], 0);
        // Kirchhoff plate theory: M_xx = -D (d^2w/dx^2 + nu d^2w/dy^2).
        // Our kappa = d(beta_x)/dx = d^2w/dx^2 (positive when slope grows in +x),
        // so M_xx = -D (kappa_xx + nu kappa_yy).
        MxxFEA = -D * (kxx + nu * kyy);
        break;
      }
    }
    const wErr = Math.abs(wFEA - wTheory) / Math.abs(wTheory);
    const MxxErr = Math.abs(MxxFEA - MxxTheory) / Math.abs(MxxTheory);
    table.push({ h: targetEdge, nNodes: mesh.nodes.length, wFEA, wErr, MxxFEA, MxxErr, iters: cg.iterations });
    console.log(`  h=${targetEdge.toString().padStart(5)}  nodes=${mesh.nodes.length.toString().padStart(4)}  iters=${cg.iterations.toString().padStart(4)}  w=${wFEA.toExponential(4)}  wErr=${(wErr*100).toFixed(2)}%  M_xx=${MxxFEA.toExponential(3)}  MxxErr=${(MxxErr*100).toFixed(2)}%`);
  }

  // Log-log slope of wErr vs h, over the last few steps.
  const xs = table.map(r => Math.log(r.h));
  const ys = table.map(r => Math.log(r.wErr));
  const n = xs.length;
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - meanX) * (ys[i] - meanY); den += (xs[i] - meanX) ** 2; }
  const slope = num / den;
  console.log(`  convergence slope (log-log wErr vs h) = ${slope.toFixed(2)}  (expect ~2)`);
  const finest = table[table.length - 1];
  const slopeOk = slope > 1.5 && slope < 2.5;
  const wOk = finest.wErr < 0.01;
  const MOk = finest.MxxErr < 0.05;  // moment recovery is one order worse than displacement
  console.log(`  finest wErr=${(finest.wErr*100).toFixed(2)}% ${wOk ? "OK" : "FAIL (target <1%)"}`);
  console.log(`  finest M_xx err=${(finest.MxxErr*100).toFixed(2)}% ${MOk ? "OK" : "FAIL (target <5%)"}`);
  return { slopeOk, wOk, MOk };
}

function clampedPlate() {
  console.log("\n========================");
  console.log("Clamped square, w_center");
  console.log("========================");
  const a = 120, h = 8, fc = 4000, q = 1, nu = 0.2;
  const material: FEAMaterial = { E: concreteE(fc), nu, h };
  const D = flexuralRigidity(material);
  // Timoshenko Table 35: clamped square uniform q, w_c = 0.00126 * q * a^4 / D (for nu=0.3).
  // For nu=0.2 the value is ~0.00128; we use 0.00126 with a looser tolerance.
  const ALPHA = 0.00126;
  const wTheory = ALPHA * q * Math.pow(a, 4) / D;
  console.log(`  w_center theory ~ ${wTheory.toExponential(4)} in`);

  const half = a / 2;
  const slab: Polygon = { outer: [[-half, -half], [half, -half], [half, half], [-half, half]] };
  const table: { h: number; nNodes: number; wFEA: number; wErr: number }[] = [];
  for (const targetEdge of [16, 10, 6]) {
    const mesh = buildMesh(slab, [], [], { targetEdge });
    const eps = 1e-3;
    const fixed = new Set<number>();
    for (let i = 0; i < mesh.nodes.length; i++) {
      const { x, y } = mesh.nodes[i];
      const onTop    = Math.abs(y - half) < eps;
      const onBot    = Math.abs(y + half) < eps;
      const onRight  = Math.abs(x - half) < eps;
      const onLeft   = Math.abs(x + half) < eps;
      if (onTop || onBot || onRight || onLeft) {
        fixed.add(3 * i);  // w
        // Clamped extras: theta_x = 0 on top/bottom (dw/dy=0), theta_y = 0 on left/right (dw/dx=0).
        if (onTop || onBot) fixed.add(3 * i + 1);
        if (onLeft || onRight) fixed.add(3 * i + 2);
      }
    }
    const inputs = { fcPsi: fc, hIn: h, dIn: h*0.8, deadPsf: 0, livePsf: 0, defaultC1: 12, defaultC2: 12, phi: 0.75 } as ProjectInputs;
    const K = assembleGlobalK(mesh, material);
    const springs = buildColumnSprings(mesh, [], inputs, material);
    applyColumnSprings(K, springs);
    const F = assembleLoadVector(mesh, q);
    const reduced = reduceSystem(K, F, fixed);
    const cg = solveCG(reduced.Kr, reduced.Fr, { tolerance: 1e-11, maxIter: 20000 });
    const u = expandDisplacement(K.n, reduced.free, cg.u);

    let wFEA = NaN;
    for (const el of mesh.elements) {
      const p0 = mesh.nodes[el.n[0]], p1 = mesh.nodes[el.n[1]], p2 = mesh.nodes[el.n[2]];
      const denom = (p1.y - p2.y)*(p0.x - p2.x) + (p2.x - p1.x)*(p0.y - p2.y);
      const l0 = ((p1.y - p2.y)*(0 - p2.x) + (p2.x - p1.x)*(0 - p2.y)) / denom;
      const l1 = ((p2.y - p0.y)*(0 - p2.x) + (p0.x - p2.x)*(0 - p2.y)) / denom;
      const l2 = 1 - l0 - l1;
      if (l0 >= -1e-9 && l1 >= -1e-9 && l2 >= -1e-9) {
        wFEA = l0 * u[3*el.n[0]] + l1 * u[3*el.n[1]] + l2 * u[3*el.n[2]];
        break;
      }
    }
    const wErr = Math.abs(wFEA - wTheory) / Math.abs(wTheory);
    table.push({ h: targetEdge, nNodes: mesh.nodes.length, wFEA, wErr });
    console.log(`  h=${targetEdge}  nodes=${mesh.nodes.length}  w_FEA=${wFEA.toExponential(4)}  err=${(wErr*100).toFixed(2)}%`);
  }
  const finest = table[table.length - 1];
  const ok = finest.wErr < 0.05;   // tolerant because clamped + coarse mesh and nu=0.2 vs table 0.3
  console.log(`  finest err=${(finest.wErr*100).toFixed(2)}% ${ok ? "OK" : "FAIL (target <5%)"}`);
  return ok;
}

const ss = ssPlateConvergence();
const clamped = clampedPlate();
const allOk = ss.slopeOk && ss.wOk && ss.MOk && clamped;
console.log(`\n================================`);
console.log(`SS convergence slope:   ${ss.slopeOk ? "OK" : "FAIL"}`);
console.log(`SS w_center accuracy:   ${ss.wOk ? "OK" : "FAIL"}`);
console.log(`SS M_xx  accuracy:      ${ss.MOk ? "OK" : "FAIL"}`);
console.log(`Clamped w_center:       ${clamped ? "OK" : "FAIL"}`);
console.log(`Overall:                ${allOk ? "PASS" : "FAIL"}`);
if (!allOk) process.exit(1);
