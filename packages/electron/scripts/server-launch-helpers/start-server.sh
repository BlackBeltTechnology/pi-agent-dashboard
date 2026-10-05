#!/usr/bin/env bash
# =============================================================================
# start-server.sh - manual launch of the bundled dashboard server (POSIX)
#
# Resolves bundled node + the bundled TypeScript loader from THIS script's
# location and invokes the same argv shape that the Electron main process uses.
# Loader: Node-native (default) or jiti when PI_DASHBOARD_TS_LOADER=jiti.
# No system Node required.
#
# Usage:
#   ./start-server.sh              # defaults to: cli.ts start
#   ./start-server.sh status
#   ./start-server.sh stop
#   ./start-server.sh restart
#
# Layout assumption (Linux .deb / .AppImage extracted; macOS .app contents):
#   <root>/resources/node/bin/node
#   <root>/resources/server/node_modules/@blackbelt-technology/pi-dashboard-shared/src/platform/native-ts-register.mjs
#   <root>/resources/server/node_modules/jiti/lib/jiti-register.mjs   (jiti opt-in)
#   <root>/resources/server/packages/server/src/cli.ts
#
# Argv contract: packages/shared/src/platform/node-spawn.ts
#   ::buildNodeImportArgvParts
# See changes: add-bundle-manual-launch-scripts, fix-appimage-cold-boot-latency.
# =============================================================================
set -euo pipefail

# Resolve this script's directory, dereferencing symlinks (matters on
# AppImage: the FUSE-mounted root is itself a symlink target chain).
src="${BASH_SOURCE[0]}"
while [ -L "$src" ]; do
  dir="$(cd -P "$(dirname "$src")" && pwd)"
  src="$(readlink "$src")"
  [[ "$src" != /* ]] && src="$dir/$src"
done
SVR_DIR="$(cd -P "$(dirname "$src")" && pwd)"

# Bundled node lives one level up under resources/node/bin/
NODE_BIN="$SVR_DIR/../node/bin/node"
if [ ! -x "$NODE_BIN" ]; then
  echo "✗ Bundled node not found or not executable: $NODE_BIN" >&2
  exit 1
fi

# TypeScript loader as file:// URL — native by default, jiti on opt-in.
# Unknown non-empty values warn and fall back to native (parity with selectTsLoader).
if [ "${PI_DASHBOARD_TS_LOADER:-}" = "jiti" ]; then
  LOADER_PATH="$SVR_DIR/node_modules/jiti/lib/jiti-register.mjs"
else
  case "${PI_DASHBOARD_TS_LOADER:-}" in
    ""|native) ;;
    *) echo "⚠ unknown PI_DASHBOARD_TS_LOADER=\"${PI_DASHBOARD_TS_LOADER}\"; using the native TypeScript loader (valid: native, jiti)." >&2 ;;
  esac
  LOADER_PATH="$SVR_DIR/node_modules/@blackbelt-technology/pi-dashboard-shared/src/platform/native-ts-register.mjs"
fi
if [ ! -f "$LOADER_PATH" ]; then
  echo "✗ Bundled TypeScript loader not found: $LOADER_PATH" >&2
  exit 1
fi
LOADER_URL="file://$LOADER_PATH"

# Entry — raw POSIX path (URL wrapping unnecessary on non-Windows)
CLI="$SVR_DIR/packages/server/src/cli.ts"
if [ ! -f "$CLI" ]; then
  echo "✗ Bundled cli.ts not found: $CLI" >&2
  exit 1
fi

# Default subcommand = "start" when invoked with no args
if [ $# -eq 0 ]; then
  set -- start
fi

cd "$SVR_DIR"
exec "$NODE_BIN" --import "$LOADER_URL" "$CLI" "$@"
