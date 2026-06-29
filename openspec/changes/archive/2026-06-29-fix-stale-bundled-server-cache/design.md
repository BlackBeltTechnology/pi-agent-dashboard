## Context

`packages/electron/scripts/build-installer.sh` orchestrates the Electron build pipeline. Near line 295 it gates the call to `bundle-server.mjs`:

```bash
if [ ! -d "$ELECTRON_DIR/resources/server/node_modules" ]; then
    echo "→ Bundling dashboard server (arch=$target_arch)..."
    node "$ELECTRON_DIR/scripts/bundle-server.mjs"
else
    echo "✓ Bundled server already present"
fi
```

This "directory exists" check is a coarse cache invalidation. It does not account for:

- Changes to `packages/server/src/**` (the source that gets bundled)
- Changes to `packages/extension/src/**` (also bundled)
- Changes to `packages/dist/client/` (materialized as `pi-dashboard-web` into the bundle's `node_modules/@blackbelt-technology/`)
- Changes to `bundle-server.mjs` itself (script evolves; cached artifacts pre-date the materialization step)

The production user hit a case where the cached `resources/server/` was built before `bundle-server.mjs` learned to materialize `pi-dashboard-web`. Subsequent rebuilds happily reused the stale bundle. The shipped `.app` then logged `"No client build found — running in API-only mode"` and every `/` request returned the `"No client build found"` error envelope. There is no automated check that catches this.

## Goals / Non-Goals

**Goals:**
- A stale `resources/server/` is never reused.
- A bundle that fails to materialize `pi-dashboard-web` cannot be packaged.
- Build-time errors are loud and actionable.

**Non-Goals:**
- Changing the runtime server-side client search paths (separate concern; current 5-path strategy is acceptable once `pi-dashboard-web` materialization is reliable).
- Rewriting `bundle-server.mjs` end-to-end.
- Cross-platform changes (script is bash; Windows builds use docker-make.sh which goes through the same script path).

## Decisions

### D1. Stamp-file freshness check

Replace the directory-exists gate with a stamp-file mtime comparison:

```bash
STAMP="$ELECTRON_DIR/resources/server/.bundle-stamp"
NEEDS_REBUILD=0
if [ ! -f "$STAMP" ]; then NEEDS_REBUILD=1; fi
for src in "$PROJECT_DIR/packages/server/src" \
           "$PROJECT_DIR/packages/shared/src" \
           "$PROJECT_DIR/packages/extension/src" \
           "$PROJECT_DIR/packages/dashboard-plugin-runtime/src" \
           "$PROJECT_DIR/packages/dist/index.html" \
           "$ELECTRON_DIR/scripts/bundle-server.mjs"; do
    if [ -e "$src" ] && [ -n "$(find "$src" -newer "$STAMP" -print -quit 2>/dev/null)" ]; then
        NEEDS_REBUILD=1; break
    fi
done
```

Watched set MUST mirror `BUNDLED_WORKSPACE_PKGS` in `bundle-server.mjs` (`server`, `shared`, `extension`, `dashboard-plugin-runtime`) plus the built client. Omitting a bundled package (e.g. `shared`, the protocol package) would let edits to it ship stale — the exact failure class this gate prevents. `find -newer -print -quit` handles both directory and single-file watched paths under `set -euo pipefail`.

`bundle-server.mjs` writes the stamp file at exit-zero. Trade-off: mtime can lie under git-reset or pnpm cache restore, but in practice CI runs from a fresh checkout so mtimes are accurate; local devs occasionally re-bundle unnecessarily, which is preferable to silently shipping stale bundles.

**Alternative considered:** content-hash file. Rejected for now — adds complexity for marginal accuracy improvement. Can revisit if mtime-flapping causes noisy rebuilds.

### D2. Hard-fail when `clientSrc` is empty

`bundle-server.mjs` currently logs `"WARNING: No built client found — server will run in API-only mode"` and continues. There is no legitimate scenario where the Electron app's bundled server SHOULD ship without a client. Change the `else` branch of the `clientSrc` lookup to `console.error(...)` + `process.exit(1)`.

**Match the existing GO/NO-GO idiom.** `bundle-server.mjs` already hard-fails on missing native artifacts using a consistent shape — see the `node-pty prebuilds GO/NO-GO` block (`✗ node-pty prebuilds GO/NO-GO failed at <dir>` → `process.exit(1)`) and the `bundled git GO/NO-GO` block (`✗ bundled git GO/NO-GO failed at <dir>` → `process.exit(1)`). D2 reuses that style: `✗`-prefixed `console.error`, name the searched paths (the three `clientCandidates`), instruct `npm run build`, then `process.exit(1)`. Do not invent a new error format.

### D3. Post-bundle verification (third GO/NO-GO)

At the end of `bundle-server.mjs`, assert `<SERVER_BUNDLE>/node_modules/@blackbelt-technology/pi-dashboard-web/dist/index.html` exists. This is the canonical path resolved by `server.ts` (via `createRequire().resolve("@blackbelt-technology/pi-dashboard-web/package.json")`). If absent, exit non-zero. Lightweight, deterministic, catches the regression that motivated this proposal.

**Placement + idiom.** The code already gained a `// ── materialize pi-dashboard-web into node_modules ──` block (the regression *cause* is fixed on `develop`). D3 is the GO/NO-GO that pins it: add the assertion immediately after that materialize block, in the same `console.error("✗ … GO/NO-GO failed …") + process.exit(1)` shape as the node-pty and git guards. It becomes the third GO/NO-GO in the file, verifying the artifact the materialize block was supposed to produce.

### D4. Repo-lint test

A new vitest under `packages/shared/src/__tests__/` walks every `resources/server/` discovered in the workspace and asserts the materialized path exists. Cheap (single fs walk) and runs as part of the normal test suite, so PRs that ship a stale committed bundle fail CI.

## Risks / Trade-offs

- **mtime-based check can fall behind under git stash / reset** → Acceptable; CI always runs fresh.
- **Hard-fail on missing client breaks local "API-only" dev experimentation** → Negligible: nobody develops Electron builds in API-only mode; the build path that exercises this is `build-installer.sh`, not `pi-dashboard --dev`.
- **Per-build cost of the post-verify check** → < 1 ms; negligible.

## Migration Plan

1. Land the script + bundler changes.
2. First post-merge build re-runs the bundler automatically (no stamp file yet).
3. CI catches any future regression that re-introduces the missing materialization.
4. Local developers see a clean error message instead of a silent ship.

**Rollback:** revert the two scripts and the lint test. No artifacts to clean.

## Open Questions

None.
