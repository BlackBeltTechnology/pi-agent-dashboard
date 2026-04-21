#!/usr/bin/env bash
#
# Build a per-platform npm cacache snapshot of pi-coding-agent + openspec + tsx
# so first-run install works fully offline.
#
# Writes:
#   resources/offline-packages/npm-cache.tar.gz   # gzipped cacache
#   resources/offline-packages/manifest.json      # pins, platform, SHA-256
#
# Usage:
#   bundle-offline-packages.sh                    # current platform
#   bundle-offline-packages.sh --platform=win32-x64
#
# Emits nothing (exit 0) and prints a skip note if
# packages/electron/offline-packages.json is missing — lets dev/local
# forge builds succeed without the bundle.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ELECTRON_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PINS_FILE="$ELECTRON_DIR/offline-packages.json"
OUT_DIR="$ELECTRON_DIR/resources/offline-packages"

# ── parse --platform=<os>-<cpu> ────────────────────────────────────────────
PLATFORM_ARG=""
for arg in "$@"; do
  case "$arg" in
    --platform=*) PLATFORM_ARG="${arg#--platform=}" ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

if [ -n "$PLATFORM_ARG" ]; then
  TARGET_OS="${PLATFORM_ARG%-*}"
  TARGET_CPU="${PLATFORM_ARG#*-}"
else
  # Current platform
  case "$(uname -s)" in
    Darwin)  TARGET_OS="darwin" ;;
    Linux)   TARGET_OS="linux" ;;
    MINGW*|MSYS*|CYGWIN*) TARGET_OS="win32" ;;
    *) echo "unsupported host: $(uname -s)" >&2; exit 1 ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) TARGET_CPU="x64" ;;
    arm64|aarch64) TARGET_CPU="arm64" ;;
    *) echo "unsupported arch: $(uname -m)" >&2; exit 1 ;;
  esac
fi
TARGET_PLATFORM="${TARGET_OS}-${TARGET_CPU}"

# ── skip gracefully if pins file missing ───────────────────────────────────
if [ ! -f "$PINS_FILE" ]; then
  echo "→ bundle-offline-packages: no $PINS_FILE — skipping"
  exit 0
fi

echo "→ Bundling offline packages for $TARGET_PLATFORM"

# ── read pins via node (no jq dep) ─────────────────────────────────────────
PINS=$(node -e "
  const p = require('$PINS_FILE').packages;
  console.log(p.map(e => \`\${e.name}@\${e.version}\`).join(' '));
")
if [ -z "$PINS" ]; then
  echo "✗ offline-packages.json has no packages" >&2
  exit 1
fi
echo "  pins: $PINS"

# ── scratch dir ─────────────────────────────────────────────────────────────
SCRATCH=$(mktemp -d -t offline-pkg-XXXXXX)
trap 'rm -rf "$SCRATCH"' EXIT

echo '{"name":"offline-bundle-scratch","private":true}' > "$SCRATCH/package.json"

# ── populate cacache with platform-specific metadata ───────────────────────
echo "  populating cacache (--os=$TARGET_OS --cpu=$TARGET_CPU --ignore-scripts)..."
# shellcheck disable=SC2086
npm install \
  --prefix "$SCRATCH" \
  --cache "$SCRATCH/npm-cache" \
  --os="$TARGET_OS" \
  --cpu="$TARGET_CPU" \
  --ignore-scripts \
  --no-audit \
  --no-fund \
  $PINS >"$SCRATCH/npm.log" 2>&1 || {
    echo "✗ npm install failed — last 20 lines:" >&2
    tail -20 "$SCRATCH/npm.log" >&2
    exit 1
  }

if [ ! -d "$SCRATCH/npm-cache/_cacache" ]; then
  echo "✗ expected _cacache directory not produced by npm" >&2
  exit 1
fi

# ── tar.gz the cacache ──────────────────────────────────────────────────────
mkdir -p "$OUT_DIR"
TARBALL="$OUT_DIR/npm-cache.tar.gz"
rm -f "$TARBALL"
# pax format supports long pathnames present in cacache (ustar caps at 100 chars).
# Pipe through gzip with --no-name so timestamps don't poison the hash.
set -o pipefail
tar --format=pax -cf - -C "$SCRATCH/npm-cache" _cacache | gzip --no-name -9 > "$TARBALL"
set +o pipefail

# Sanity: tarball must list a non-trivial number of entries
ENTRY_COUNT=$(tar -tzf "$TARBALL" | wc -l | tr -d ' ')
if [ "$ENTRY_COUNT" -lt 100 ]; then
  echo "✗ produced tarball has only $ENTRY_COUNT entries — expected several hundred" >&2
  exit 1
fi
echo "  tarball entries: $ENTRY_COUNT"

# ── compute SHA-256 ─────────────────────────────────────────────────────────
if command -v shasum >/dev/null 2>&1; then
  SHA256=$(shasum -a 256 "$TARBALL" | cut -d' ' -f1)
elif command -v sha256sum >/dev/null 2>&1; then
  SHA256=$(sha256sum "$TARBALL" | cut -d' ' -f1)
else
  echo "✗ no shasum or sha256sum found" >&2; exit 1
fi

# ── write manifest ──────────────────────────────────────────────────────────
MANIFEST="$OUT_DIR/manifest.json"
BUNDLED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TARBALL_BYTES=$(wc -c < "$TARBALL" | tr -d ' ')

node - <<EOF > "$MANIFEST"
const pins = require('$PINS_FILE').packages;
const out = {
  bundledAt: "$BUNDLED_AT",
  targetPlatform: "$TARGET_PLATFORM",
  tarball: "npm-cache.tar.gz",
  tarballBytes: $TARBALL_BYTES,
  sha256: "$SHA256",
  packages: pins,
};
console.log(JSON.stringify(out, null, 2));
EOF

# ── size reporting ──────────────────────────────────────────────────────────
SIZE_H=$(du -h "$TARBALL" | cut -f1)
echo "✓ offline bundle written:"
echo "  $TARBALL ($SIZE_H, $TARBALL_BYTES bytes)"
echo "  $MANIFEST"
echo "  sha256: $SHA256"

# Warn above 60 MB, fail above 100 MB (per design §1 budget)
MB=$(( TARBALL_BYTES / 1024 / 1024 ))
if [ "$MB" -gt 100 ]; then
  echo "✗ bundle size ${MB} MB exceeds 100 MB budget — aborting" >&2
  exit 1
fi
if [ "$MB" -gt 60 ]; then
  echo "⚠ bundle size ${MB} MB exceeds 60 MB target" >&2
fi
