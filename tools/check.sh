#!/usr/bin/env bash
# Everything CI runs (.github/workflows/ci.yml), locally: lint, the unit and
# server tests, and — where a Python environment with the optimizer is found
# (OLT_PYTHON, else .venv/ or WEBSITE/.venv/) — the shared vectors and the
# optimizer's acceptance tests.
#
#   npm run check            all of it
#   npm run check -- --quick without tools/optimizer/tests/verify.py (≈ 1 min)
set -euo pipefail
cd "$(dirname "$0")/.."

quick=0
[ "${1:-}" = --quick ] && quick=1

echo "== lint";  npm run -s lint
echo "== tests"; npx vitest run

py=${OLT_PYTHON:-}
for cand in .venv/bin/python WEBSITE/.venv/bin/python; do
  [ -z "$py" ] && [ -x "$cand" ] && py=$PWD/$cand
done
if [ -z "$py" ] || ! "$py" -c 'import olt_optimizer' 2>/dev/null; then
  echo "== optimizer: skipped (no Python environment with olt_optimizer; set OLT_PYTHON)"
  exit 0
fi
cd tools/optimizer
echo "== optimizer: shared vectors"; "$py" tests/vectors.py
echo "== optimizer: service";        "$py" tests/verify_service.py | tail -1
if [ "$quick" = 0 ]; then
  echo "== optimizer: kernel and runs"; "$py" tests/verify.py | tail -1
fi
