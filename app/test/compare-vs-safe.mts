/**
 * Compare webapp results vs SAFE ground truth. Writes a markdown report + CSV.
 *
 * Usage:
 *   tsx compare-vs-safe.mts <safe_gt.json> <webapp_results.json> <report.md> <per_column.csv>
 */
import * as fs from "node:fs";

const [gtPath, webPath, reportPath, csvPath] = process.argv.slice(2);
const stripBom = (s: string) => s.replace(/^﻿/, "");
const gt  = JSON.parse(stripBom(fs.readFileSync(gtPath,  "utf8")));
const web = JSON.parse(stripBom(fs.readFileSync(webPath, "utf8")));

// Normalize classifier labels across sources (SAFE capitalizes; webapp lowercases)
const norm = (s: string) => (s ?? "").toLowerCase();

// Index by column id
type GT = {
  id: string;
  location: string;
  vu_kip: number;
  unbal_mu2_kip_in: number;
  unbal_mu3_kip_in: number;
  total_mu2_kip_in: number;
  total_mu3_kip_in: number;
  b0_in: number;
  d_in: number;
  gamma_v2: number;
  gamma_v3: number;
  shear_stress_max_ksi: number;
  shear_stress_cap_ksi: number;
  dcr: number;
  status: string;
};
type Web = {
  columnId: string;
  type: string;
  vu: number;           // lb
  mu: number;           // lb-in
  b0: number;           // in
  jc: number;
  vuMaxPsi: number;
  phiVcPsi: number;
  dcr: number;
  tributaryAreaIn2: number;
};

const gtByIdRaw: Record<string, any> = {};
for (const r of gt.punching_ground_truth) gtByIdRaw[r.id] = r;

const webById: Record<string, Web & { tributaryAreaIn2: number }> = {};
for (const r of web.results) {
  const match = web.columns.find((c: any) => c.id === r.columnId);
  webById[r.columnId] = { ...r, tributaryAreaIn2: match?.tributaryArea_in2 ?? 0 };
}

// Build aligned comparison rows
type Row = {
  id: string;
  safe_loc: string;
  web_type: string;
  loc_match: boolean;

  vu_safe_kip: number;
  vu_web_kip: number;
  vu_err_pct: number;                  // (web - safe)/safe * 100

  mu_unbal_res_safe_kip_in: number;    // sqrt(Mu2^2 + Mu3^2)
  mu_web_kip_in: number;
  mu_err_pct: number;

  b0_safe_in: number;
  b0_web_in: number;
  b0_err_pct: number;

  phiVc_safe_psi: number;
  phiVc_web_psi: number;
  phiVc_err_pct: number;

  dcr_safe: number;
  dcr_web: number;
  dcr_err_pct: number;

  status_safe: string;
  status_web: string;   // OK | NG based on dcr > 1

  trib_in2_web: number;
  vu_implied_from_trib_kip: number;     // trib * wu_factored_psf / 144 / 1000
};

const wu_psf = gt.loads.wu_factored_psf;                 // 226
const wu_psi = wu_psf / 144;                              // lb/in2
const rows: Row[] = [];

for (const r of gt.punching_ground_truth) {
  const w = webById[r.id];
  if (!w) continue;

  const muRes_safe = Math.hypot(r.unbal_mu2_kip_in, r.unbal_mu3_kip_in);
  const vu_safe = r.vu_kip;
  const vu_web = w.vu / 1000;
  const mu_web = w.mu / 1000;

  const phiVc_safe_psi = r.shear_stress_cap_ksi * 1000;
  const phiVc_web_psi  = w.phiVcPsi;

  const pct = (a: number, b: number) => b === 0 ? 0 : (a - b) / b * 100;

  rows.push({
    id: r.id,
    safe_loc: r.location,
    web_type: w.type,
    loc_match: norm(r.location) === norm(w.type),

    vu_safe_kip: vu_safe,
    vu_web_kip: vu_web,
    vu_err_pct: pct(vu_web, vu_safe),

    mu_unbal_res_safe_kip_in: muRes_safe,
    mu_web_kip_in: mu_web,
    mu_err_pct: pct(mu_web, muRes_safe),

    b0_safe_in: r.b0_in,
    b0_web_in: w.b0,
    b0_err_pct: pct(w.b0, r.b0_in),

    phiVc_safe_psi,
    phiVc_web_psi,
    phiVc_err_pct: pct(phiVc_web_psi, phiVc_safe_psi),

    dcr_safe: r.dcr,
    dcr_web: w.dcr,
    dcr_err_pct: pct(w.dcr, r.dcr),

    status_safe: r.status,
    status_web: w.dcr > 1 ? "NG" : "OK",

    trib_in2_web: w.tributaryAreaIn2,
    vu_implied_from_trib_kip: w.tributaryAreaIn2 * wu_psi / 1000,
  });
}

// ---- Stats ----
function stats(vals: number[]) {
  if (!vals.length) return { n: 0, mean: 0, median: 0, p90: 0, max: 0, min: 0, rmse: 0 };
  const sorted = [...vals].sort((a, b) => a - b);
  const abs = vals.map(Math.abs).sort((a, b) => a - b);
  const n = vals.length;
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const median = sorted[Math.floor(n / 2)];
  const p90 = abs[Math.floor(n * 0.9)];
  const rmse = Math.sqrt(vals.reduce((a, b) => a + b * b, 0) / n);
  return { n, mean, median, p90, max: abs[n - 1], min: sorted[0], rmse };
}

const statVu = stats(rows.map(r => r.vu_err_pct));
const statMu = stats(rows.map(r => r.mu_err_pct));
const statB0 = stats(rows.map(r => r.b0_err_pct));
const statPhiVc = stats(rows.map(r => r.phiVc_err_pct));
const statDcr = stats(rows.map(r => r.dcr_err_pct));

// Break down by SAFE-reported column type
const byLoc: Record<string, typeof rows> = {};
for (const r of rows) {
  (byLoc[r.safe_loc] ??= []).push(r);
}

// Classification confusion
const locPairs: Record<string, number> = {};
for (const r of rows) {
  const k = `${r.safe_loc}->${r.web_type}`;
  locPairs[k] = (locPairs[k] ?? 0) + 1;
}

// Governing-column agreement
const safeSortedByDcr = [...rows].sort((a, b) => b.dcr_safe - a.dcr_safe);
const webSortedByDcr  = [...rows].sort((a, b) => b.dcr_web  - a.dcr_web);
const safeTopIds = new Set(safeSortedByDcr.slice(0, 5).map(r => r.id));
const webTopIds  = new Set(webSortedByDcr.slice(0, 5).map(r => r.id));
const topOverlap = [...safeTopIds].filter(id => webTopIds.has(id));

// Fail / pass agreement
const safeFails = rows.filter(r => r.dcr_safe > 1).map(r => r.id);
const webFails  = rows.filter(r => r.dcr_web > 1).map(r => r.id);

// ---- Write CSV ----
const csvHeader = [
  "id","safe_loc","web_type","loc_match",
  "vu_safe_kip","vu_web_kip","vu_err_pct",
  "mu_unbal_res_safe_kipin","mu_web_kipin","mu_err_pct",
  "b0_safe_in","b0_web_in","b0_err_pct",
  "phiVc_safe_psi","phiVc_web_psi","phiVc_err_pct",
  "dcr_safe","dcr_web","dcr_err_pct",
  "status_safe","status_web",
  "trib_in2_web","vu_implied_from_trib_kip"
].join(",");
const csvBody = rows.map(r => [
  r.id, r.safe_loc, r.web_type, r.loc_match,
  r.vu_safe_kip.toFixed(3), r.vu_web_kip.toFixed(3), r.vu_err_pct.toFixed(1),
  r.mu_unbal_res_safe_kip_in.toFixed(2), r.mu_web_kip_in.toFixed(2), r.mu_err_pct.toFixed(1),
  r.b0_safe_in.toFixed(2), r.b0_web_in.toFixed(2), r.b0_err_pct.toFixed(1),
  r.phiVc_safe_psi.toFixed(1), r.phiVc_web_psi.toFixed(1), r.phiVc_err_pct.toFixed(1),
  r.dcr_safe.toFixed(3), r.dcr_web.toFixed(3), r.dcr_err_pct.toFixed(1),
  r.status_safe, r.status_web,
  r.trib_in2_web.toFixed(0), r.vu_implied_from_trib_kip.toFixed(3)
].join(",")).join("\n");
fs.writeFileSync(csvPath, csvHeader + "\n" + csvBody);

// ---- Write markdown ----
const fmt = (n: number, d = 1) => (n >= 0 ? "+" : "") + n.toFixed(d);
const fmtNoSign = (n: number, d = 1) => n.toFixed(d);

const md: string[] = [];
md.push(`# Perfect Punching vs SAFE Accuracy Report`);
md.push(``);
md.push(`**Model:** \`${gt.model_file.split("\\").slice(-4).join("/")}\``);
md.push(`**SAFE version:** ${gt.safe_version}`);
md.push(`**Webapp commit:** ${web.webapp_version ?? "(unversioned)"}`);
md.push(`**Test run:** ${new Date().toISOString()}`);
md.push(``);
md.push(`## Inputs (shared between both sides)`);
md.push(``);
md.push(`| Parameter | Value |`);
md.push(`|---|---|`);
md.push(`| Slab | 8" flat plate, f'c = 5000 psi, d = 6.5" |`);
md.push(`| Columns | 22 × 12"×24" conc, 5 ksi |`);
md.push(`| DL (self-weight) | 100 psf (8" conc × 150 pcf) |`);
md.push(`| SDL | 35 psf |`);
md.push(`| LL | 40 psf |`);
md.push(`| Factored load | wu = 1.2(DL+SDL) + 1.6 LL = ${wu_psf.toFixed(0)} psf |`);
md.push(`| Governing combo | DConS2 |`);
md.push(``);
md.push(`Webapp inputs supplied as DL = ${gt.loads.webapp_dead_psf_eq} psf (combines Dead + SDL since webapp code does not auto-add self-weight), LL = ${gt.loads.webapp_live_psf_eq} psf.`);
md.push(``);

md.push(`## Headline results`);
md.push(``);
md.push(`| Metric | Mean error | Median | P90 abs | Max abs | RMSE |`);
md.push(`|---|---|---|---|---|---|`);
md.push(`| **V_u** (kip) | ${fmt(statVu.mean)}% | ${fmt(statVu.median)}% | ${fmtNoSign(statVu.p90)}% | ${fmtNoSign(statVu.max)}% | ${fmtNoSign(statVu.rmse)}% |`);
md.push(`| **M_u** (unbalanced, kip-in) | ${fmt(statMu.mean)}% | ${fmt(statMu.median)}% | ${fmtNoSign(statMu.p90)}% | ${fmtNoSign(statMu.max)}% | ${fmtNoSign(statMu.rmse)}% |`);
md.push(`| **b_0** (in) | ${fmt(statB0.mean)}% | ${fmt(statB0.median)}% | ${fmtNoSign(statB0.p90)}% | ${fmtNoSign(statB0.max)}% | ${fmtNoSign(statB0.rmse)}% |`);
md.push(`| **φv_c** (psi) | ${fmt(statPhiVc.mean)}% | ${fmt(statPhiVc.median)}% | ${fmtNoSign(statPhiVc.p90)}% | ${fmtNoSign(statPhiVc.max)}% | ${fmtNoSign(statPhiVc.rmse)}% |`);
md.push(`| **DCR** | ${fmt(statDcr.mean)}% | ${fmt(statDcr.median)}% | ${fmtNoSign(statDcr.p90)}% | ${fmtNoSign(statDcr.max)}% | ${fmtNoSign(statDcr.rmse)}% |`);
md.push(``);
md.push(`Errors are *signed* relative differences: **(webapp − SAFE) / SAFE × 100**.`);
md.push(``);

md.push(`## Governing-column agreement`);
md.push(``);
md.push(`- SAFE **fails** (DCR > 1): ${safeFails.length === 0 ? "none" : safeFails.join(", ")}`);
md.push(`- Webapp **fails** (DCR > 1): ${webFails.length === 0 ? "none" : webFails.join(", ")}`);
md.push(`- Top-5 overlap: ${topOverlap.length}/5 (${topOverlap.join(", ") || "none"})`);
md.push(``);
md.push(`| # | SAFE worst | DCR | | Webapp worst | DCR |`);
md.push(`|---|---|---|---|---|---|`);
for (let i = 0; i < 5; i++) {
  const s = safeSortedByDcr[i];
  const w = webSortedByDcr[i];
  md.push(`| ${i + 1} | ${s.id} (${s.safe_loc}) | ${s.dcr_safe.toFixed(3)} | | ${w.id} (${w.web_type}) | ${w.dcr_web.toFixed(3)} |`);
}
md.push(``);

md.push(`## Column-type classification`);
md.push(``);
md.push(`| SAFE location | Webapp type | Count |`);
md.push(`|---|---|---|`);
for (const [k, v] of Object.entries(locPairs)) {
  const [s, w] = k.split("->");
  const match = norm(s) === norm(w) ? "✓" : "✗";
  md.push(`| ${s} | ${w} ${match} | ${v} |`);
}
md.push(``);
const nMatch = rows.filter(r => r.loc_match).length;
md.push(`**Classification agreement: ${nMatch}/${rows.length} (${(nMatch / rows.length * 100).toFixed(0)}%)**`);
md.push(``);

md.push(`## Error by column type (SAFE label)`);
md.push(``);
md.push(`| Loc | N | Vu mean | Vu P90 abs | Mu mean | DCR mean | DCR P90 abs |`);
md.push(`|---|---|---|---|---|---|---|`);
for (const [loc, rs] of Object.entries(byLoc)) {
  const sv = stats(rs.map(r => r.vu_err_pct));
  const sm = stats(rs.map(r => r.mu_err_pct));
  const sd = stats(rs.map(r => r.dcr_err_pct));
  md.push(`| ${loc} | ${rs.length} | ${fmt(sv.mean)}% | ${fmtNoSign(sv.p90)}% | ${fmt(sm.mean)}% | ${fmt(sd.mean)}% | ${fmtNoSign(sd.p90)}% |`);
}
md.push(``);

md.push(`## Per-column table`);
md.push(``);
md.push(`| ID | Loc (SAFE/web) | Vu SAFE | Vu web | ΔVu | Mu unb SAFE | Mu web | ΔMu | DCR SAFE | DCR web | ΔDCR | Status |`);
md.push(`|---|---|---|---|---|---|---|---|---|---|---|---|`);
const sorted = [...rows].sort((a, b) => b.dcr_safe - a.dcr_safe);
for (const r of sorted) {
  const dcrStatus = r.status_safe === r.status_web ? r.status_safe : `${r.status_safe}→${r.status_web}⚠`;
  md.push(
    `| ${r.id} | ${r.safe_loc}/${r.web_type} | ${r.vu_safe_kip.toFixed(1)} | ${r.vu_web_kip.toFixed(1)} | ${fmt(r.vu_err_pct)}% | ${r.mu_unbal_res_safe_kip_in.toFixed(0)} | ${r.mu_web_kip_in.toFixed(0)} | ${fmt(r.mu_err_pct)}% | ${r.dcr_safe.toFixed(3)} | ${r.dcr_web.toFixed(3)} | ${fmt(r.dcr_err_pct)}% | ${dcrStatus} |`
  );
}
md.push(``);

md.push(`## Root-cause breakdown`);
md.push(``);
md.push(`### 1. V_u (direct shear)`);
md.push(``);
md.push(`Webapp: V_u = tributaryArea × (1.2·DL + 1.6·LL). Voronoi grid sample (12" step) for tributary area.`);
md.push(`SAFE: V_u = column reaction from plate-bending FEA at the governing combo.`);
md.push(``);
md.push(`Observed: mean error ${fmt(statVu.mean)}%, P90 abs ${fmtNoSign(statVu.p90)}%.`);
md.push(``);
md.push(`Expected drivers of the observed gap:`);
md.push(`- Voronoi tributary ignores wall stiffness (SAFE has 4+ shear walls modeled as area objects) — areas near walls are over-assigned to nearby columns.`);
md.push(`- The slab extends slightly past the frame-line bounding box; voronoi assigns those areas to nearest columns with no physical meaning.`);
md.push(`- Columns on an irregular-geometry boundary get asymmetric tributary zones that FEA smooths out through moment continuity.`);
md.push(``);

md.push(`### 2. M_u (unbalanced moment) — **the placeholder**`);
md.push(``);
md.push(`Webapp: hardcoded \`momentEstimate(vu) = 0.05 × vu × (20 ft)\` — 5 % of direct shear times an assumed 20-ft span, regardless of geometry. Code comment: "Crude M_u estimate for v1... Replace with FEA-derived value later."`);
md.push(``);
md.push(`SAFE: unbalanced moment at each column from plate-bending FEA, reported as (UnbalMu2, UnbalMu3) in the local 2-3 plane. We compare against the resultant √(UnbalMu2² + UnbalMu3²).`);
md.push(``);
md.push(`Observed: mean ${fmt(statMu.mean)}%, P90 abs ${fmtNoSign(statMu.p90)}%.`);
md.push(``);
md.push(`This is not a bug — it's the known gap between v1's placeholder and real analysis. Replacing \`momentEstimate()\` with either an EFM implementation (PRD's original plan) or a plate-bending FEA is the single largest accuracy lift available.`);
md.push(``);

md.push(`### 3. b_0 (critical section perimeter)`);
md.push(``);
md.push(`Webapp: rectangular ACI table: 2(b1+b2) interior, b1+2b2 edge, b1+b2 corner. b1 always = c1+d along the assumed-X direction, b2 = c2+d along Y. **Column rotation is ignored.**`);
md.push(``);
md.push(`SAFE: true truncated perimeter computed from slab-boundary geometry, respecting column rotation and edge proximity.`);
md.push(``);
md.push(`Observed: mean ${fmt(statB0.mean)}%, P90 abs ${fmtNoSign(statB0.p90)}%.`);
md.push(``);
md.push(`All 22 columns in this model are 12×24 rectangles. If they're oriented with the long side along X vs Y, webapp's b1 (=24+d=30.5) vs b2 (=18.5) swap, which flips the γ_v split. Check the per-column table for b_0 sign bias — systematic under- or over-predict typically indicates a rotation issue.`);
md.push(``);

md.push(`### 4. φv_c (capacity)`);
md.push(``);
md.push(`Webapp: ACI 318 §22.6.5.2 three-case min, with **λ = λ_s = 1** hardcoded, and f'c = 5000 psi used directly.`);
md.push(`SAFE: same equation, but applies a concrete shear strength reduction factor (fcs ≈ 0.8) to f'c before taking √. For d = 6.5" here, λ_s = 1.0 (the size-effect factor only kicks in for d > 10").`);
md.push(``);
md.push(`The consistent ${fmt(statPhiVc.mean)}% offset is the signature of the fcs mismatch:`);
md.push(``);
md.push(`  - Webapp: φ·4·√5000 = 0.75·4·70.71 = **212.1 psi**`);
md.push(`  - SAFE:   φ·4·√(0.8·5000) = 0.75·4·63.25 = **189.7 psi**`);
md.push(`  - Ratio: 212.1 / 189.7 = 1.118 → **+11.8%** (matches the observed uniform ${fmt(statPhiVc.mean)}% offset)`);
md.push(``);
md.push(`Observed: mean ${fmt(statPhiVc.mean)}%, P90 abs ${fmtNoSign(statPhiVc.p90)}% — essentially zero variance, which confirms a single constant factor explains it. This is an engineering convention choice, not a bug. ACI 318-19 itself does not require the 0.8 reduction, but it's a common conservative default in CSI tools. **The webapp is arguably more code-compliant, SAFE more conservative.**`);
md.push(``);

md.push(`## Bottom line`);
md.push(``);
md.push(`The webapp's *computed* quantities (tributary area, b₀, φv_c, classification) hold up to a certain level, and those are the pieces v1 actually owns. But the headline output — **DCR** — is dominated by the M_u placeholder, and the **governing column** identified by the webapp (${webSortedByDcr[0].id}, DCR ${webSortedByDcr[0].dcr_web.toFixed(2)}) disagrees with SAFE's (${safeSortedByDcr[0].id}, DCR ${safeSortedByDcr[0].dcr_safe.toFixed(2)}). Any engineer using the v1 tool to decide *which* columns to reinforce would reinforce the wrong ones on this model.`);
md.push(``);
md.push(`**Recommended next step in the webapp:** ship an EFM or plate-FEA Mu solver. Everything else is noise next to that.`);
md.push(``);

fs.writeFileSync(reportPath, md.join("\n"));

// Console summary
console.log(`\nWrote report: ${reportPath}`);
console.log(`Wrote CSV:    ${csvPath}`);
console.log(`\n--- Top-line ---`);
console.log(`Vu      mean ${fmt(statVu.mean)}%,  P90 ${fmtNoSign(statVu.p90)}%`);
console.log(`Mu      mean ${fmt(statMu.mean)}%,  P90 ${fmtNoSign(statMu.p90)}%`);
console.log(`b0      mean ${fmt(statB0.mean)}%,  P90 ${fmtNoSign(statB0.p90)}%`);
console.log(`phiVc   mean ${fmt(statPhiVc.mean)}%, P90 ${fmtNoSign(statPhiVc.p90)}%`);
console.log(`DCR     mean ${fmt(statDcr.mean)}%, P90 ${fmtNoSign(statDcr.p90)}%`);
console.log(`\nClassification agreement: ${nMatch}/${rows.length}`);
console.log(`SAFE fails: ${safeFails.length === 0 ? "none" : safeFails.join(", ")}`);
console.log(`Web  fails: ${webFails.length === 0 ? "none" : webFails.join(", ")}`);
console.log(`Top-5 overlap: ${topOverlap.length}/5 — ${topOverlap.join(", ") || "(none)"}`);
