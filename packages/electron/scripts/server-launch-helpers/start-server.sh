#!/usr/bin/env bash
# =============================================================================
# start-server.sh - manual launch of the bundled dashboard server (POSIX)
#
# Resolves bundled node + bundled jiti loader from THIS script's location and
# invokes the same argv shape that the Electron main process uses.
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
#   <root>/resources/server/node_modules/jiti/lib/jiti-register.mjs
#   <root>/resources/server/packages/server/src/cli.ts
#
# Argv contract: packages/shared/src/platform/node-spawn.ts
#   ::buildNodeImportArgvParts
# See change: add-bundle-manual-launch-scripts.
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

# jiti loader as file:// URL
JITI_PATH="$SVR_DIR/node_modules/jiti/lib/jiti-register.mjs"
if [ ! -f "$JITI_PATH" ]; then
  echo "✗ Bundled jiti loader not found: $JITI_PATH" >&2
  exit 1
fi
JITI_URL="file://$JITI_PATH"

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
exec "$NODE_BIN" --import "$JITI_URL" "$CLI" "$@"
