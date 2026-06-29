## Why

`packages/electron/scripts/build-installer.sh` skips re-running `bundle-server.mjs` whenever `resources/server/node_modules` already exists ("Bundled server already present"). This cache check ignores changes to either the bundled server source or the built client. In a real failure case, the bundler at one point did not materialize `@blackbelt-technology/pi-dashboard-web` into `node_modules/@blackbelt-technology/`; a subsequent rebuild kept that stale bundle, the resulting Electron app shipped without a resolvable client, and at runtime the server logged `"No client build found — running in API-only mode"` and every HTTP request to `/` returned `{"error":"No client build found. Run npm run build first."}`. The user has no way to know the bundle is stale, and `electron-forge make` happily packages it.

## What Changes

- Replace the "directory exists" check in `build-installer.sh` with a content-based freshness check: if any bundled-source is newer than `resources/server/.bundle-stamp`, the bundle script SHALL re-run. Watched sources are every workspace package `bundle-server.mjs` copies (`BUNDLED_WORKSPACE_PKGS` = `packages/server/src`, `packages/shared/src`, `packages/extension/src`, `packages/dashboard-plugin-runtime/src`), plus the built client `packages/dist/index.html` (Vite output, `outDir ../dist`), plus `bundle-server.mjs` itself. The script writes the stamp file at the end of every successful bundle.
- `bundle-server.mjs` SHALL fail loudly (non-zero exit, clear message) when `clientSrc` is not found, instead of printing a warning and continuing. A bundled server without a client is never a valid artifact for shipping.
- `bundle-server.mjs` SHALL verify, before exiting 0, that `<SERVER_BUNDLE>/node_modules/@blackbelt-technology/pi-dashboard-web/dist/index.html` exists. If absent, exit non-zero with a message identifying the materialization step that failed. (Catches the regression that motivated this proposal.)
- Add a CI / repo-lint test asserting that for every released `resources/server/` bundle, the materialized `pi-dashboard-web` exists.
- Document the cache invalidation rule in `docs/file-index-electron.md` next to the existing `bundle-server.mjs` row.
- No user-visible behavior change when bundle is already fresh. Stale bundles now rebuild instead of shipping broken.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `electron-build-pipeline`: add requirements covering bundle freshness invalidation and client-materialization post-condition.

## Impact

- **Code**: `packages/electron/scripts/build-installer.sh`, `packages/electron/scripts/bundle-server.mjs`.
- **Tests**: new repo-lint asserting materialization. No existing tests modified.
- **Migration / compat**: build-time only; no runtime change. First rebuild after merge re-runs the bundler regardless of cache state (because the stamp file does not yet exist).
- **Rollback**: revert the two scripts; existing artifacts are unaffected.
- **Risk**: low. The freshness check adds a single `find -newer` invocation and is bounded by source-tree size. The hard-fail on missing client is the desired behavior — a silent ship of a broken bundle is the failure mode we are eliminating.
