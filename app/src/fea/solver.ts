/**
 * Preconditioned Conjugate Gradient solver for symmetric positive-definite
 * sparse systems K u = F.
 *
 * For DKT plate stiffness matrices with reasonable column/wall BCs, the
 * reduced K is SPD; Jacobi preconditioning is adequate for a few-thousand-
 * DOF system.  No WASM dependency.
 */
import type { CSR } from "./assembly.ts";

export interface CGOptions {
  tolerance?: number;   // relative residual ||r||/||F||
  maxIter?: number;     // default 5 * n
  warmStart?: Float64Array;
  /** Callback invoked every `progressEveryN` iters with (iter, relResidual, maxIter). Awaited so the caller can yield to the UI. */
  onProgress?: (iter: number, relResidual: number, maxIter: number) => Promise<void> | void;
  /** How often to emit progress. Default 50 iters. */
  progressEveryN?: number;
}

export interface CGResult {
  u: Float64Array;
  iterations: number;
  residualNorm: number;   // relative
  converged: boolean;
}

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function norm(a: Float64Array): number {
  return Math.sqrt(dot(a, a));
}

/** y = K * x  (no accumulation, overwrites y). */
function matvec(K: CSR, x: Float64Array, y: Float64Array): void {
  const { n, rowPtr, colIdx, values } = K;
  for (let i = 0; i < n; i++) {
    let s = 0;
    const start = rowPtr[i], end = rowPtr[i + 1];
    for (let k = start; k < end; k++) s += values[k] * x[colIdx[k]];
    y[i] = s;
  }
}

export async function solveCG(K: CSR, F: Float64Array, opts: CGOptions = {}): Promise<CGResult> {
  const n = K.n;
  const tol = opts.tolerance ?? 1e-10;
  const maxIter = opts.maxIter ?? Math.max(2000, 5 * n);
  const progressEveryN = opts.progressEveryN ?? 50;

  // Jacobi preconditioner = diag(K)^-1
  const diag = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const start = K.rowPtr[i], end = K.rowPtr[i + 1];
    for (let k = start; k < end; k++) {
      if (K.colIdx[k] === i) { diag[i] = K.values[k]; break; }
    }
  }
  // Guard against zero diagonals (would indicate isolated DOF).
  for (let i = 0; i < n; i++) {
    if (diag[i] <= 0) {
      throw new Error(`solveCG: non-positive diagonal at DOF ${i} (${diag[i]})`);
    }
  }
  const Minv = new Float64Array(n);
  for (let i = 0; i < n; i++) Minv[i] = 1 / diag[i];

  const u = opts.warmStart ? new Float64Array(opts.warmStart) : new Float64Array(n);
  const r = new Float64Array(n);
  const z = new Float64Array(n);
  const p = new Float64Array(n);
  const Ap = new Float64Array(n);

  // r = F - K u
  matvec(K, u, r);
  for (let i = 0; i < n; i++) r[i] = F[i] - r[i];

  const Fnorm = Math.max(norm(F), 1e-30);
  let rnorm = norm(r);
  if (rnorm / Fnorm < tol) {
    return { u, iterations: 0, residualNorm: rnorm / Fnorm, converged: true };
  }

  // z = Minv r
  for (let i = 0; i < n; i++) z[i] = Minv[i] * r[i];
  // p = z
  p.set(z);
  let rz = dot(r, z);

  let iter = 0;
  let converged = false;
  for (iter = 1; iter <= maxIter; iter++) {
    matvec(K, p, Ap);
    const pAp = dot(p, Ap);
    if (pAp <= 0) {
      throw new Error(`solveCG: non-positive p^T K p at iter ${iter} (${pAp}). Matrix not SPD?`);
    }
    const alpha = rz / pAp;

    for (let i = 0; i < n; i++) {
      u[i] += alpha * p[i];
      r[i] -= alpha * Ap[i];
    }

    rnorm = norm(r);
    if (rnorm / Fnorm < tol) { converged = true; break; }

    for (let i = 0; i < n; i++) z[i] = Minv[i] * r[i];
    const rz_new = dot(r, z);
    const beta = rz_new / rz;
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
    rz = rz_new;

    if (opts.onProgress && iter % progressEveryN === 0) {
      await opts.onProgress(iter, rnorm / Fnorm, maxIter);
    }
  }

  return { u, iterations: iter, residualNorm: rnorm / Fnorm, converged };
}
