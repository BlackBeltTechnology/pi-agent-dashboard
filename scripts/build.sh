#!/usr/bin/env bash
# Build the dashboard: type-check everything and build the web client.
# The bridge extension runs via tsx at runtime (no compilation needed).
#
# Usage: ./scripts/build.sh [--check-only | --client-only]

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

CHECK=true
CLIENT=true

for arg in "$@"; do
  case "$arg" in
    --check-only)  CLIENT=false ;;
    --client-only) CHECK=false ;;
    -h|--help)
      echo "Usage: $0 [--check-only | --client-only]"
      echo "  --check-only   Type-check only (tsc --noEmit), skip Vite build"
      echo "  --client-only  Build web client only, skip type-check"
      exit 0
      ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

# Ensure dependencies
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

if $CHECK; then
  echo "=== Type-checking (tsc --noEmit) ==="
  node scripts/tsc7.mjs --noEmit
  echo "✓ Type-check passed"
fi

if $CLIENT; then
  echo "=== Building web client (Vite) ==="
  npm run build
  echo "✓ Web client built"
fi

echo ""
echo "Build complete."
