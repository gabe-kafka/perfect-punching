# Perfect Punching — Honest FEA Ship Plan

**Operating principle:** a structural tool that produces silent bad numbers is worse than a tool that refuses to answer. Before we ship anything, the app must know when it is lying and tell the user.

**Shipping gate:** preview deploy requires Phase 0 complete; prod promotion requires Phase 0 + Phase 2 + one SAFE-matched case.

---

## What we learned today (2026-04-22)

- §1.1 (mesh-edge auto-cap) **does not fix `patchSlaves = 0`** on the demo DXF. The mesher was failing at poly2tri tiers 0/1/2 before §1.1 existed; it falls to tier 3 (centroids-only) regardless of `targetEdge`. Confirmed by direct `buildMesh(targetEdge=24)` bypass — same 182n/202e result as the user's original report.
- The `span/32` floor I added was unsound — on a 90-ft slab it evaluated to 34", overriding both the footprint cap and a reasonable user input. **Reverted** to `dIn`-only floor.
- `mesher.ts` was silently mutating the slab polygon via `dedupeAgainst(outerPts, steiner, tol)`. Dropping boundary vertices creates self-intersecting/collinear outlines that poly2tri rejects. **Reverted** — boundary is now sacred; only Steiners are deduped against boundary, not the other way.
- Per-tier error logging added to the retry ladder so we can see which stage throws.
- Every failing tier throws the same error (`getConstrainedEdgeCW` → null triangle). The offender is somewhere in the bulk Steiner set (wall + interior grid) or in the densified boundary itself, not the column rings. **Still unknown which — need bisection.**
- Footprint cap (`min(c1,c2)/2`) still in place. Harmless on DXFs where mesher naturally works; no effect on DXFs where it doesn't.

---

## Phase 0.5 — DXF layer-mapping import flow ✅

- [x] `dxf-ingest.ts` refactored: `scanDxfLayers(text)` returns a `DxfScan` (per-layer inventory + geometry stats + suggested role); `ingestDxfWithMapping(text, mapping)` does the actual ingest; back-compat `ingestDxf(text) = scan + apply suggested`.
- [x] New `UploadPanel` component shown when no DXF loaded: drag-and-drop zone + file picker + "Load demo" button.
- [x] New `LayerMappingPanel` component shown after scan: one row per layer with entity counts, geometry stats (closed/open poly, line, point, text counts; max polygon area; avg segment length), suggested role, and a dropdown (Slab / Columns / Walls / Column labels / Ignore). Requires at least one slab + one columns assignment before Apply enables.
- [x] `App.tsx` routes between three stages: `blank` → `mapping` → `analyzed`. Header collapses its buttons in `blank`; adds a **Change Layers** button in `analyzed` so user can revise without re-uploading.
- [x] Side-benefit hypothesis: if the mysterious `20.72 × 26.81` polylines are on an annotation/furniture layer auto-mis-classified as columns, explicit assignment lets the user drop them — which may also fix the mesher failure in Phase 1.

## Phase 0 — Stability detector (BLOCKS ALL SHIPPING)

The app must label each run `stable | degraded | unstable` from signals it already computes, surface that label prominently, and gate exports when unstable. Without this, every later fix is progress we can't trust.

- [ ] **0.1** Plumb mesher tier used out of `mesher.ts` (return a `quality: { tierUsed, droppedSteiners }` alongside the mesh).
- [ ] **0.2** In `plate-fea.ts`, compute stability after the solve:
  - `unstable` if: mesher at tier 3, OR any `patchSlaves == 0`, OR equilibrium > 0.5%, OR mesher failed all tiers
  - `degraded` if: mesher at tier 1–2, OR any `patchSlaves ∈ [1,3]`, OR equilibrium 0.1–0.5%
  - `stable` otherwise
  Populate `FEADiagnostics.stability: "stable" | "degraded" | "unstable"` and `stabilityReasons: string[]` (human-readable bullet list).
- [ ] **0.3** `SolverPanel` banners:
  - stable → small green dot, no banner
  - degraded → amber "Mesh degraded — review listed columns" with reason bullets
  - unstable → red "UNSTABLE — per-column Mu unreliable. Do not ship these values." with reasons
- [ ] **0.4** In `App.tsx`: disable `Export Excel` and `Export DXF` when `stability == "unstable"`; show a confirm-dialog when `degraded`.
- [ ] **0.5** When `exportExcel` runs on a `degraded` stability, inject a header row `DO_NOT_SHIP — FEA was degraded at time of export` so downloaded numbers can't escape the warning.
- [ ] **0.6** Per-column row in `ResultsTable` gets a `!` glyph for any column in the unstable set.
- [ ] **0.7** Update `test/verify-step1.mts` to assert the stability label rather than patchSlaves directly.

**Gate:** reload demo DXF → UI shows red "UNSTABLE" banner → `Export Excel` and `Export DXF` disabled. That's honesty.

---

## Phase 1 — Root-cause the mesher failure

Before picking a fix, identify what poisons poly2tri. This is cheap and informs whether Phase 2 alone is enough or we also need Phase 3.

- [ ] **1.1** In `test/verify-step1.mts`, add isolation experiments: call `buildMesh` with each Steiner family stripped independently (no walls, no interior grid, no tight ring, no refine ring). Log which subset breaks tier 0.
- [ ] **1.2** Also test: boundary alone (no Steiners) at tier 0. If that fails, the densified boundary itself is the issue (collinear triplets, holes touching outer, non-simple polygon) and we need boundary hygiene, not Steiner filtering.
- [ ] **1.3** Based on bisection, pick one of:
  - Grid alignment with boundary → jitter interior grid by a fraction of `targetEdge`
  - Wall pts coinciding with boundary → dedupe wall pts against boundary before feeding
  - Column rings → subsumed by Phase 2 (oddball c1/c2 make for oddball ring positions)
  - Boundary pathology → collapse near-collinear triplets, assert ring is simple

**Gate:** after the Phase 1 fix, `buildMesh(targetEdge=24)` on the demo DXF succeeds at tier 0 or tier 1 with a non-trivial Steiner set.

---

## Phase 2 — Rotation-aware column ingestion (was §2)

Even after Phase 1, the `20.72 × 26.81` oddball columns will still be geometrically wrong — wrong c1/c2 feeds wrong critical perimeter `b0`, wrong patch footprint, wrong everything.

- [ ] **2.1** Replace bbox extraction in `src/lib/dxf-ingest.ts` (POLYLINE branch, ~line 128) with a min-area-rectangle fit (convex hull via Graham scan in `geom.ts` + rotating calipers).
- [ ] **2.2** Extend `Column` type in `src/lib/types.ts` with `angleRad?: number`.
- [ ] **2.3** Snap c1/c2 to 0.25"; warn in `IngestResult.stats` when pre-snap delta > 0.1".
- [ ] **2.4** `bc.ts::identifyColumnPatches`: rotate `(dx, dy)` into column-local frame before the `|dx| ≤ halfC1` footprint test.
- [ ] **2.5** `punching.ts`: rotate the critical perimeter so `b0` tracks the actual column orientation.
- [ ] **2.6** `exports.ts::exportDxf`: draw column outlines at the actual orientation.
- [ ] **2.7** Test fixture `test/fixtures/rotated-column.dxf` — one 45°-rotated rectangle, assert ingest returns clean c1/c2/angleRad.

**Gate:** verify-step1 shows c1/c2 in clean values (24.00, 12.00, etc.) and `stability == "stable"` on demo DXF. If still unstable at Phase 2 end, go to Phase 3.

---

## Phase 3 — Post-mesh local refinement (conditional; was §1.2)

Only if Phase 1 + Phase 2 together don't bring the demo DXF to `stable`.

- [ ] **3.1** In `mesher.ts`, after `getTriangles()`, for each column with `patchSlaves < 4` (evaluated against the nascent patch), subdivide triangles whose centroid lies inside the footprint. Insert edge-midpoint nodes (Delaunay-preserving bisection) until the target slave count is met or 3 passes exhausted.
- [ ] **3.2** Update mesh quality tracking to record post-refinement slave counts per column.
- [ ] **3.3** Wire before patch identification in `plate-fea.ts`.

**Gate:** every column on demo DXF has `patchSlaves ≥ 4`.

---

## Phase 4 — Simplify UX

- [ ] **4.1** Remove the `Solver: FEA / Solver: EFM-lite` toggle from `App.tsx` Header. Keep the `try { FEA } catch { EFM-lite }` internal fallback.
- [ ] **4.2** If EFM fallback fires, `SolverPanel` displays "Solver: FEA crashed → EFM-lite fallback" with the underlying error message.
- [ ] **4.3** `efm.ts` stays untouched as the internal crash net.

---

## Phase 5 — Preview deploy

- [ ] **5.1** `npm run build`. Zero warnings.
- [ ] **5.2** `vercel ls` to identify the project. Confirm `perfect-punching.vercel.app` vs `perfect-punching-app.vercel.app` (same Vercel project or separate? check `.vercel/project.json`).
- [ ] **5.3** Deploy **preview** (no `--prod`). Capture the preview URL.
- [ ] **5.4** Visual QA on preview URL: load demo DXF, click Analyze, verify stability label, try export (should be gated appropriately). Tweak a field, re-analyze, confirm UI tracks state.

---

## Phase 6 — SAFE validation & prod promote

- [ ] **6.1** Pick a canonical plate for `test/compare-vs-safe.mts`: interior + edge + corner column, unbalanced DL, clean rectangular slab (not the demo). Build in SAFE, export per-column Mu.
- [ ] **6.2** Run FEA on the same geometry. Acceptance: per-column Mu within 15% of SAFE. If out, decide: accept + document the gap, or prioritize Phase 7 (§3 strip-integration Mu) before shipping.
- [ ] **6.3** Only after 6.2 passes: promote preview to prod (`vercel promote <preview-id> --prod` or `vercel --prod`).

---

## Phase 7 — SAFE-parity Mu (deferred, was §3)

If Phase 6 finds the node-reaction Mu doesn't match SAFE within 15%, implement strip-integration.

- [ ] **7.1** `dkt.ts::elementMoments(el, u, material)` → {Mxx,Myy,Mxy} at element centroid.
- [ ] **7.2** Area-weighted nodal moment smoothing.
- [ ] **7.3** `recover.ts`: design-strip cut integration for Mu across two-way slab strips per ACI 318 §8.4.
- [ ] **7.4** Back-compat flag `inputs.muRecovery: "nodeReaction" | "stripIntegration"`.
- [ ] **7.5** Re-validate against SAFE.

---

## What good looks like at ship time

- On the demo DXF: FEA runs, mesher hits tier 0 or 1, every column has `patchSlaves ≥ 4`, equilibrium < 0.1%, stability = `stable`. Exports enabled.
- On pathological DXFs: stability = `degraded` or `unstable`, red banner visible, exports gated, user knows to dig deeper.
- One canonical plate has been compared against SAFE with per-column Mu within 15%.
- EFM toggle is gone; EFM only fires as an internal crash net.

---

## Archive — superseded plans

See git history for earlier drafts: the original "Ship Plan — Option B" Steps 1–4 checklist and the broader "§1 Rigid patch / §2 Ingestion / §3 SAFE-parity Mu" scope have been consolidated into the phases above.
