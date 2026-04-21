#!/usr/bin/env bash
#
# Bundle first-party recommended pi extensions into the Electron installer.
#
# Shipped layout:
#   packages/electron/resources/bundled-extensions/<id>/        # source tree
#   packages/electron/resources/bundled-extensions/<id>/.bundled-sha
#
# Drives the runtime `installBundledExtensions()` in
# packages/electron/src/lib/dependency-installer.ts.
#
# Opt-in: set BUNDLE_RECOMMENDED_EXTENSIONS=1.
# Default (unset or != 1): no-op exit 0, no files written.
#
# License allowlist: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC.
# Size budget: total bundled tree must be <= 15 MB.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ELECTRON_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_DIR="$(cd "$ELECTRON_DIR/../.." && pwd)"
SHARED_DIR="$(cd "$PROJECT_DIR/packages/shared" && pwd)"
OUT_DIR="$ELECTRON_DIR/resources/bundled-extensions"

# Allowlist & size budget.
LICENSE_ALLOWLIST=("MIT" "Apache-2.0" "BSD-2-Clause" "BSD-3-Clause" "ISC")
SIZE_BUDGET_BYTES=$((15 * 1024 * 1024))

# Gate: opt-in only.
if [ "${BUNDLE_RECOMMENDED_EXTENSIONS:-}" != "1" ]; then
  echo "→ bundle-recommended-extensions: BUNDLE_RECOMMENDED_EXTENSIONS!=1 — skipping (no-op)."
  exit 0
fi

echo "→ Bundling first-party recommended extensions into $OUT_DIR"

# Clean previous bundle so we never ship stale commits.
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# Read BUNDLED_EXTENSION_IDS + source URL for each id from the shared manifest.
# We emit one line per id: `<id>\t<git-url>`.
# Using node -e with tsx/jiti is overkill here — the source file is TS but we
# only need a literal string array and a lookup, so we transpile-on-the-fly via
# tsx if available, otherwise fall back to node --import tsx.
MANIFEST_OUTPUT="$(
  cd "$PROJECT_DIR" && node --import tsx/esm -e '
    import(new URL("./packages/shared/src/recommended-extensions.ts", "file://" + process.cwd() + "/")).then(m => {
      const byId = new Map(m.RECOMMENDED_EXTENSIONS.map(e => [e.id, e]));
      for (const id of m.BUNDLED_EXTENSION_IDS) {
        const entry = byId.get(id);
        if (!entry) { console.error(`manifest: unknown bundled id ${id}`); process.exit(2); }
        console.log(`${id}\t${entry.source}`);
      }
    }).catch(err => { console.error(err); process.exit(2); });
  '
)"

if [ -z "$MANIFEST_OUTPUT" ]; then
  echo "✗ BUNDLED_EXTENSION_IDS is empty — nothing to bundle."
  exit 1
fi

is_allowed_license() {
  local detected="$1"
  for allowed in "${LICENSE_ALLOWLIST[@]}"; do
    if [ "$detected" = "$allowed" ]; then
      return 0
    fi
  done
  return 1
}

detect_license_spdx() {
  # Best-effort SPDX detection:
  # 1) package.json "license" field.
  # 2) Heuristic match on LICENSE / LICENSE.md / COPYING contents.
  local dir="$1"
  local pkg_json="$dir/package.json"
  if [ -f "$pkg_json" ]; then
    local from_pkg
    from_pkg="$(node -e "const p=require('$pkg_json'); const l=p.license; if (typeof l === 'string') console.log(l); else if (l && l.type) console.log(l.type);" 2>/dev/null || true)"
    if [ -n "$from_pkg" ]; then
      echo "$from_pkg"
      return 0
    fi
  fi
  local candidate
  for name in LICENSE LICENSE.md LICENSE.txt COPYING; do
    candidate="$dir/$name"
    if [ -f "$candidate" ]; then
      local content
      content="$(tr '[:upper:]' '[:lower:]' < "$candidate")"
      if echo "$content" | grep -q "apache license"; then echo "Apache-2.0"; return 0; fi
      if echo "$content" | grep -q "mit license"; then echo "MIT"; return 0; fi
      if echo "$content" | grep -q "isc license"; then echo "ISC"; return 0; fi
      if echo "$content" | grep -q "bsd 3-clause\|redistribution and use in source and binary forms, with or without"; then
        # Can't cheaply distinguish 2 vs 3 clause from the heuristic — default to 3-clause.
        echo "BSD-3-Clause"; return 0
      fi
    fi
  done
  echo ""
}

# Process each bundled id.
while IFS=$'\t' read -r ID SOURCE; do
  [ -z "$ID" ] && continue

  # Only git sources can be bundled (requirement: "non-git source rejected").
  case "$SOURCE" in
    npm:*|local:*)
      echo "✗ $ID: source '$SOURCE' is not a git URL. Bundling refuses non-git sources."
      exit 1
      ;;
  esac

  TARGET="$OUT_DIR/$ID"
  echo ""
  echo "→ $ID  ($SOURCE)"

  # Shallow clone; no caching between runs.
  git clone --depth=1 "$SOURCE" "$TARGET"

  # Record the resolved commit SHA for forensics.
  SHA="$(git -C "$TARGET" rev-parse HEAD)"
  echo "$SHA" > "$TARGET/.bundled-sha"
  echo "  SHA: $SHA"

  # Strip the .git directory — shipping it would bloat the installer and
  # confuse pi's installGit (it expects a fresh clone).
  rm -rf "$TARGET/.git"

  # License check.
  LICENSE_ID="$(detect_license_spdx "$TARGET")"
  if [ -z "$LICENSE_ID" ]; then
    echo "✗ $ID: could not detect SPDX license in $TARGET (no package.json license / no LICENSE file heuristic match)."
    exit 1
  fi
  if ! is_allowed_license "$LICENSE_ID"; then
    echo "✗ $ID: license '$LICENSE_ID' is not in the allowlist (${LICENSE_ALLOWLIST[*]})."
    exit 1
  fi
  echo "  License: $LICENSE_ID ✓"
done <<< "$MANIFEST_OUTPUT"

# Size budget — report per-id breakdown, fail if over.
echo ""
echo "→ Size breakdown:"
TOTAL_BYTES=0
while IFS=$'\t' read -r ID _; do
  [ -z "$ID" ] && continue
  BYTES="$(du -sk "$OUT_DIR/$ID" | awk '{print $1 * 1024}')"
  TOTAL_BYTES=$((TOTAL_BYTES + BYTES))
  HUMAN="$(du -sh "$OUT_DIR/$ID" | awk '{print $1}')"
  echo "  $ID: $HUMAN"
done <<< "$MANIFEST_OUTPUT"

TOTAL_HUMAN="$(du -sh "$OUT_DIR" | awk '{print $1}')"
echo "  TOTAL: $TOTAL_HUMAN ($TOTAL_BYTES bytes)"

if [ "$TOTAL_BYTES" -gt "$SIZE_BUDGET_BYTES" ]; then
  echo "✗ Bundled extensions exceed size budget: $TOTAL_BYTES > $SIZE_BUDGET_BYTES bytes (15 MB)."
  exit 1
fi

echo ""
echo "✓ Bundled extensions ready in $OUT_DIR"
