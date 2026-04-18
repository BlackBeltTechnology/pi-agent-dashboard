#!/usr/bin/env bash
# Migrate `node:child_process` imports to the platform/exec wrapper.
# Path differs based on which package the file is in.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Files inside packages/shared/src/platform/* use "./exec.js" (relative sibling)
for f in \
  packages/shared/src/platform/binary-lookup.ts \
  packages/shared/src/platform/commands.ts \
  packages/shared/src/platform/process.ts \
  packages/shared/src/platform/process-scan.ts; do
  sed -i 's|from "node:child_process"|from "./exec.js"|g' "$f"
done

# Files inside packages/shared/src (not under platform/) use "./platform/exec.js"
for f in \
  packages/shared/src/openspec-poller.ts; do
  sed -i 's|from "node:child_process"|from "./platform/exec.js"|g' "$f"
done

# Files in packages/server, packages/extension, packages/electron use the full package path
SHARED_IMPORT='"@blackbelt-technology/pi-dashboard-shared/platform/exec.js"'
for f in \
  packages/server/src/browser-handlers/directory-handler.ts \
  packages/server/src/browser-handlers/session-action-handler.ts \
  packages/server/src/cli.ts \
  packages/server/src/editor-manager.ts \
  packages/server/src/git-operations.ts \
  packages/server/src/headless-pid-registry.ts \
  packages/server/src/package-manager-wrapper.ts \
  packages/server/src/pi-resource-scanner.ts \
  packages/server/src/process-manager.ts \
  packages/server/src/restart-helper.ts \
  packages/server/src/routes/system-routes.ts \
  packages/server/src/tunnel.ts \
  packages/extension/src/dev-build.ts \
  packages/extension/src/git-info.ts \
  packages/extension/src/process-scanner.ts \
  packages/extension/src/server-launcher.ts \
  packages/electron/src/lib/dependency-detector.ts \
  packages/electron/src/lib/dependency-installer.ts \
  packages/electron/src/lib/doctor.ts \
  packages/electron/src/lib/server-lifecycle.ts \
  packages/electron/src/lib/update-checker.ts; do
  sed -i "s|from \"node:child_process\"|from $SHARED_IMPORT|g" "$f"
done

echo "done"
