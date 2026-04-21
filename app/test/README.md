# Accuracy test harness

Runs the shipping `ingestDxf → classify → voronoi → checkPunching` pipeline
headlessly against a DXF + SAFE ground-truth JSON, diffs the results, and
writes a markdown report + CSV.

Ground-truth JSON and DXF are produced by PowerShell scripts in a companion
repo that attaches to a running SAFE instance. They live outside this repo.

## Running

```bash
# From app/
npx tsx test/run-webapp-headless.mts <dxf> <safe_gt.json> <webapp_results.json>
npx tsx test/compare-vs-safe.mts    <safe_gt.json> <webapp_results.json> <report.md> <per_column.csv>
```

## What it tests

| Metric | Pulled from SAFE | Computed by webapp |
|---|---|---|
| V_u (direct shear) | Punching design table | tributaryArea × factored w |
| M_u (unbalanced moment) | UnbalMu2, UnbalMu3 resultant | `momentEstimate()` (or EFM, once landed) |
| b_0 (critical perimeter) | Perimeter field | ACI table approximation |
| φv_c (capacity) | ShrStrCap field | ACI §22.6.5.2 three-case min |
| DCR | Ratio field | v_u_max / φv_c |
| Classification | Location field | `classifyColumns` edge-band |

## Known gaps, pre-fix (f7cdc37 baseline)

- V_u off by +26% mean, P90 79% — Voronoi ignores wall stiffness
- M_u off by +481% mean — hardcoded `0.05·V·20ft` placeholder
- φv_c off by +11.6% uniform — SAFE applies fcs=0.8 reduction, webapp uses f'c direct
- 4 false-positive DCR failures vs SAFE on the reference model
- Top-5 critical column agreement: 2/5
