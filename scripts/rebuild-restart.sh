#!/usr/bin/env bash
# Build client + server, then restart the dashboard server.
#
# Usage: ./scripts/rebuild-restart.sh [--check]
#   --check  Run TypeScript type-check before building

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

CHECK=false
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=true ;;
    -h|--help)
      echo "Usage: $0 [--check]"
      echo "  --check  Run TypeScript type-check before building"
      exit 0
      ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

# Step 1: Optional type-check
if $CHECK; then
  echo "=== Type-checking ==="
  npx tsc --noEmit
  echo "✓ Type-check passed"
fi

# Step 2: Build web client
echo "=== Building web client ==="
npm run build
echo "✓ Client built"

# Step 2.5: Verify/deploy one coherent served-client artifact set. Fails BEFORE
# the restart/reload below when built ≠ served (set -euo pipefail).
echo "=== Verifying served client build ==="
node scripts/sync-served-client.mjs
echo "✓ Served client verified"

# Step 3: Restart dashboard server
echo "=== Restarting dashboard server ==="
pi-dashboard restart
echo "✓ Server restarted"

# Step 4: Reload all connected pi sessions
echo "=== Reloading pi sessions ==="
./scripts/reload-all.sh
