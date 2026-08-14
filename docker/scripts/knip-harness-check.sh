#!/usr/bin/env bash
# Dead-code oracle inside the harness container (test-plan #H1).
#
# Reproducibility check, not a second gate: Knip is deterministic static
# analysis, so a differing verdict here means the container's tree differs from
# the host's — which is exactly the failure this guards. The image previously
# carried only `qa/fixtures` and no knip.json, so a scan inside it silently
# analysed a smaller graph and would have reported different, lower counts.
#
# Runs the config check first: an unrooted graph reports live files as dead, so
# a count comparison over it compares two kinds of noise.
#
# See change: add-knip-dead-code-oracle.
set -euo pipefail

cd /app

echo "→ verifying knip.json roots every manifest-declared entry"
node scripts/knip-config.mjs

echo "→ running the per-class ratchet against the committed baseline"
node scripts/knip-ratchet.mjs
