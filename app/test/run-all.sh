#!/usr/bin/env bash
# Full DKT + FEA verification + integration harness.
# Runs each stage; stops on first failure; prints a summary at the end.
#
# Usage (from app/):
#   bash test/run-all.sh

set -u
cd "$(dirname "$0")/.."

stages=(
  "DKT rigid-body             |node --experimental-strip-types --no-warnings test/fea-dkt.test.mts"
  "DKT single-element patch   |node --experimental-strip-types --no-warnings test/fea-dkt-patch.test.mts"
  "DKT eigenvalue rank        |node --experimental-strip-types --no-warnings test/fea-dkt-eigen.test.mts"
  "DKT multi-element patch    |node --experimental-strip-types --no-warnings test/fea-dkt-multi-patch.test.mts"
  "SS plate benchmark         |node --experimental-strip-types --no-warnings test/fea-benchmark.test.mts"
  "Convergence + M_xx + clamp |node --experimental-strip-types --no-warnings test/fea-convergence.test.mts"
  "FEA pipeline smoke         |npx tsx test/fea-smoke.test.mts"
  "EFM vs FEA compare         |npx tsx test/fea-vs-efm-compare.mts"
)

pass=0
fail=0
results=()
start_all=$(date +%s)

for stage in "${stages[@]}"; do
  label="${stage%%|*}"
  cmd="${stage##*|}"
  echo
  echo "===================================================="
  echo "   $label"
  echo "===================================================="
  t0=$(date +%s)
  if bash -c "$cmd" > /tmp/pp-stage.out 2>&1; then
    t1=$(date +%s)
    dur=$((t1 - t0))
    tail -4 /tmp/pp-stage.out
    results+=("  PASS  ($dur s)  $label")
    pass=$((pass+1))
  else
    t1=$(date +%s)
    dur=$((t1 - t0))
    cat /tmp/pp-stage.out
    results+=("  FAIL  ($dur s)  $label")
    fail=$((fail+1))
    break
  fi
done
end_all=$(date +%s)

echo
echo "===================================================="
echo "   Summary  (${pass} pass, ${fail} fail, $((end_all-start_all))s total)"
echo "===================================================="
for r in "${results[@]}"; do echo "$r"; done

if [ "$fail" -gt 0 ]; then exit 1; fi
