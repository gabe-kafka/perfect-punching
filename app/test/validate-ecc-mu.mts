/**
 * Validate the "Mu ~= V * e" hypothesis, where e = offset of the Voronoi
 * tributary centroid from the column centroid. If this tracks SAFE's FEA
 * unbalanced moment well, it's a principled replacement for the webapp's
 * current 0.05 * V * 20ft placeholder.
 *
 * Usage:
 *   tsx validate-ecc-mu.mts <dxf> <safe_gt.json> <out_csv>
 */
import * as fs from "node:fs";
import { ingestDxf } from "../src/lib/dxf-ingest.ts";
import { classifyColumns } from "../src/lib/classify.ts";
import { pointInRing } from "../src/lib/geom.ts";
import type { Polygon, Column, Vec2 } from "../src/lib/types.ts";

const [dxfPath, gtPath, outCsv] = process.argv.slice(2);
const stripBom = (s: string) => s.replace(/^﻿/, "");
const gt = JSON.parse(stripBom(fs.readFileSync(gtPath, "utf8")));
const dxfText = stripBom(fs.readFileSync(dxfPath, "utf8"));

// Ingest
const ing = ingestDxf(dxfText);
let slab: Polygon = ing.slabs[0].polygon;
for (const s of ing.slabs) {
  const a = Math.abs(ringAreaSigned(s.polygon.outer));
  if (a > Math.abs(ringAreaSigned(slab.outer))) slab = s.polygon;
}

// Size columns from SAFE
const byId = new Map<string, any>(gt.columns.map((c: any) => [c.id, c]));
for (const c of ing.columns) {
  const src = byId.get(c.id);
  if (src) { c.c1 = src.c1_in; c.c2 = src.c2_in; }
}
classifyColumns(slab, ing.columns, 36);

// --- Voronoi with centroid tracking ---
function tributaryAreasAndCentroids(
  slab: Polygon, cols: Column[], step = 12
) {
  const xs = slab.outer.map(([x]) => x);
  const ys = slab.outer.map(([, y]) => y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const maxX = Math.max(...xs), maxY = Math.max(...ys);
  const cell = step * step;

  type Bin = { area: number; sx: number; sy: number; n: number };
  const bins = new Map<string, Bin>();
  for (const c of cols) bins.set(c.id, { area: 0, sx: 0, sy: 0, n: 0 });

  const holes = slab.holes ?? [];
  for (let y = minY + step / 2; y < maxY; y += step) {
    for (let x = minX + step / 2; x < maxX; x += step) {
      const p: Vec2 = [x, y];
      if (!pointInRing(p, slab.outer)) continue;
      let inHole = false;
      for (const h of holes) if (pointInRing(p, h)) { inHole = true; break; }
      if (inHole) continue;

      let best: Column | null = null;
      let bestD = Infinity;
      for (const c of cols) {
        const d = (c.position[0] - x) ** 2 + (c.position[1] - y) ** 2;
        if (d < bestD) { bestD = d; best = c; }
      }
      if (!best) continue;
      const b = bins.get(best.id)!;
      b.area += cell; b.sx += x; b.sy += y; b.n += 1;
    }
  }

  const out = new Map<string, { area: number; centroid: Vec2 }>();
  for (const [id, b] of bins) {
    if (b.n === 0) { out.set(id, { area: 0, centroid: [0, 0] }); continue; }
    out.set(id, { area: b.area, centroid: [b.sx / b.n, b.sy / b.n] });
  }
  return out;
}

const tribMap = tributaryAreasAndCentroids(slab, ing.columns, 12);

// --- Compare ---
type Row = {
  id: string;
  loc: string;
  vu_safe_kip: number;
  mu_safe_unbal_res: number;
  e_in: number;
  e_x_in: number;
  e_y_in: number;
  mu_ecc_safeV: number;      // V_safe * e
  mu_ecc_webV: number;        // V_webapp * e
  mu_placeholder: number;     // current webapp
  err_ecc_pct: number;        // (ecc - safe) / safe
  err_placeholder_pct: number;
};

const wu_psf = gt.loads.wu_factored_psf;
const wu_psi = wu_psf / 144;

const rows: Row[] = [];
for (const c of ing.columns) {
  const trib = tribMap.get(c.id)!;
  const ex = trib.centroid[0] - c.position[0];
  const ey = trib.centroid[1] - c.position[1];
  const e = Math.hypot(ex, ey);

  const gtRow = gt.punching_ground_truth.find((r: any) => r.id === c.id);
  const vu_safe_kip = gtRow.vu_kip;
  const vu_web_kip = (trib.area * wu_psi) / 1000;
  const mu_safe_resultant = Math.hypot(gtRow.unbal_mu2_kip_in, gtRow.unbal_mu3_kip_in);

  const mu_ecc_safeV = vu_safe_kip * e;      // kip * in = kip-in
  const mu_ecc_webV  = vu_web_kip  * e;
  const mu_placeholder = 0.05 * vu_web_kip * 240; // current webapp

  rows.push({
    id: c.id,
    loc: gtRow.location,
    vu_safe_kip,
    mu_safe_unbal_res: mu_safe_resultant,
    e_in: e,
    e_x_in: ex,
    e_y_in: ey,
    mu_ecc_safeV,
    mu_ecc_webV,
    mu_placeholder,
    err_ecc_pct: (mu_ecc_safeV - mu_safe_resultant) / mu_safe_resultant * 100,
    err_placeholder_pct: (mu_placeholder - mu_safe_resultant) / mu_safe_resultant * 100,
  });
}

// Stats helper
function stats(vals: number[]) {
  const n = vals.length;
  const abs = vals.map(Math.abs).sort((a, b) => a - b);
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const sorted = [...vals].sort((a, b) => a - b);
  const median = sorted[Math.floor(n / 2)];
  return {
    mean,
    median,
    p90: abs[Math.floor(n * 0.9)],
    max: abs[n - 1],
    rmse: Math.sqrt(vals.reduce((a, b) => a + b * b, 0) / n),
  };
}
const sEcc = stats(rows.map(r => r.err_ecc_pct));
const sPh  = stats(rows.map(r => r.err_placeholder_pct));

// R^2 of mu_ecc_safeV vs mu_safe
function rSquared(xs: number[], ys: number[]) {
  const n = xs.length;
  const xbar = xs.reduce((a, b) => a + b, 0) / n;
  const ybar = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xbar) * (ys[i] - ybar);
    dx2 += (xs[i] - xbar) ** 2;
    dy2 += (ys[i] - ybar) ** 2;
  }
  const r = num / Math.sqrt(dx2 * dy2);
  return r * r;
}
const r2_ecc = rSquared(rows.map(r => r.mu_ecc_safeV), rows.map(r => r.mu_safe_unbal_res));
const r2_ph  = rSquared(rows.map(r => r.mu_placeholder), rows.map(r => r.mu_safe_unbal_res));

console.log(`\n=== Mu hypothesis validation (n=${rows.length}) ===\n`);
console.log(`                          mean      P90 abs    R^2`);
console.log(`Current placeholder    ${pad(sPh.mean)}%    ${pad(sPh.p90)}%    ${r2_ph.toFixed(3)}`);
console.log(`Eccentricity (V_safe × e) ${pad(sEcc.mean)}%    ${pad(sEcc.p90)}%    ${r2_ecc.toFixed(3)}`);

function pad(n: number) { const s = (n >= 0 ? "+" : "") + n.toFixed(1); return s.padStart(7); }

console.log(`\nPer-column (sorted by SAFE Mu):`);
console.log(`  ID    loc      V_safe  e(in)  Mu_SAFE  Mu_ecc  err%   | Mu_ph   err_ph%`);
const sorted = [...rows].sort((a, b) => b.mu_safe_unbal_res - a.mu_safe_unbal_res);
for (const r of sorted) {
  console.log(
    `  ${r.id.padEnd(5)} ${r.loc.padEnd(8)} ${r.vu_safe_kip.toFixed(1).padStart(6)}  ${r.e_in.toFixed(1).padStart(5)}  ${r.mu_safe_unbal_res.toFixed(0).padStart(6)}  ${r.mu_ecc_safeV.toFixed(0).padStart(6)}  ${pad(r.err_ecc_pct)}% | ${r.mu_placeholder.toFixed(0).padStart(6)}  ${pad(r.err_placeholder_pct)}%`
  );
}

// CSV
const header = "id,loc,vu_safe_kip,e_in,e_x,e_y,mu_safe_resultant,mu_ecc_safeV,mu_ecc_webV,mu_placeholder,err_ecc_pct,err_ph_pct";
const body = rows.map(r => [
  r.id, r.loc, r.vu_safe_kip.toFixed(2), r.e_in.toFixed(2), r.e_x_in.toFixed(2), r.e_y_in.toFixed(2),
  r.mu_safe_unbal_res.toFixed(1), r.mu_ecc_safeV.toFixed(1), r.mu_ecc_webV.toFixed(1),
  r.mu_placeholder.toFixed(1), r.err_ecc_pct.toFixed(1), r.err_placeholder_pct.toFixed(1)
].join(",")).join("\n");
if (outCsv) fs.writeFileSync(outCsv, header + "\n" + body);
console.log(`\nWrote ${outCsv}`);

function ringAreaSigned(r: [number, number][]) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
}
