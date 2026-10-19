#!/usr/bin/env bash
#
# Guard (darwin): ad-hoc-sign a COPY of the packaged .app and run
# `codesign --verify --deep --strict` on it.
#
# Why: a bundle holding an absolute (or dangling) symlink fails strict
# verification with `invalid destination for symbolic link in bundle`, and the
# real signing/notarization steps only run on legs with APPLE_IDENTITY. Signing
# a copy ad-hoc (identity `-`) makes the same check run on EVERY darwin leg,
# without touching the artifact that ships.
#
# Usage: codesign-strict-check.sh <path-to-.app>
# Exit 0 verified; 1 verification failed (codesign output is printed, so the log
# contains codesign's own diagnostic); 2 usage.
#
# See change: refresh-electron-bundled-components (design D7).
set -euo pipefail

APP="${1:-}"
if [ -z "$APP" ] || [ ! -d "$APP" ]; then
  echo "usage: codesign-strict-check.sh <path-to-.app>" >&2
  exit 2
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
# ditto preserves symlinks verbatim (cp -R would too, but ditto is the macOS-native bundle copy).
ditto "$APP" "$WORK/app.app"

codesign --force --deep --sign - "$WORK/app.app" >"$WORK/sign.log" 2>&1 || {
  echo "::error::ad-hoc codesign of the packaged-app copy failed"
  cat "$WORK/sign.log"
  exit 1
}
if ! codesign --verify --deep --strict --verbose=2 "$WORK/app.app" >"$WORK/verify.log" 2>&1; then
  echo "::error::codesign --verify --deep --strict failed on the packaged app"
  cat "$WORK/verify.log"
  exit 1
fi
echo "codesign-strict-check: OK — $APP verifies (--deep --strict) after an ad-hoc sign of a copy"
