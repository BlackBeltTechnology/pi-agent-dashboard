# rebuild-restart.sh — index

Build (+ optional `--check` tsc) → verify served client (`node scripts/sync-served-client.mjs`) → `pi-dashboard restart` → `./scripts/reload-all.sh`. `set -euo pipefail` aborts before any restart/reload when built ≠ served. See change: add-served-build-coherence-and-hash-parity.
