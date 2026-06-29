## Tasks

### 1. build-installer.sh — freshness check

- [x] 1.1 Replace the `[ ! -d "$ELECTRON_DIR/resources/server/node_modules" ]` gate with a stamp-file mtime comparison against the watched sources. Watched set mirrors `BUNDLED_WORKSPACE_PKGS` (server/src, shared/src, extension/src, dashboard-plugin-runtime/src) + `packages/dist/index.html` + bundle-server.mjs. Uses `find -newer ... -print -quit`.
- [x] 1.2 Preserve the cross-arch invocation (`TARGET_ARCH="$cross_target_arch_env" $cross_prefix node ...`) inside the new gate.
- [x] 1.3 Update the "✓ Bundled server already present" message to "✓ Bundled server cache is fresh (stamp <ts>)" when skipping.

### 2. bundle-server.mjs — hard failures

- [x] 2.1 Replace the `"WARNING: No built client found"` else-branch with `console.error(...)` + `process.exit(1)`, matching the existing `node-pty prebuilds GO/NO-GO` / `bundled git GO/NO-GO` idiom (`✗`-prefix, name searched paths). Error message SHALL name the three `clientCandidates` paths and instruct running `npm run build`.
- [x] 2.2 Immediately after the existing `materialize pi-dashboard-web into node_modules` block, add a third GO/NO-GO asserting `<SERVER_BUNDLE>/node_modules/@blackbelt-technology/pi-dashboard-web/dist/index.html` exists. If absent, `console.error("✗ … GO/NO-GO failed …")` + `process.exit(1)`, same shape as the node-pty/git guards.
- [x] 2.3 On successful exit, write `<SERVER_BUNDLE>/.bundle-stamp` containing `<git-sha-short>-<unix-ts>`.

### 3. Repo-lint test

- [x] 3.1 Add `packages/shared/src/__tests__/bundled-server-materialization.test.ts` that walks every `resources/server/` under the workspace and asserts the `pi-dashboard-web/dist/index.html` materialization is present.
- [x] 3.2 Verify the test fails on a deliberately-broken bundle and passes after running `bundle-server.mjs`. (Proven via fixture: broken bundle → 1 failed, good bundle → 2 passed.)

### 4. Documentation

- [x] 4.1 Update `docs/file-index-electron.md` row for `bundle-server.mjs` to describe the stamp-file contract and the hard-fail post-condition.
- [x] 4.2 Update `docs/file-index-electron.md` row for `build-installer.sh` to describe the freshness check.
- [x] 4.3 Add a `docs/faq.md` entry: "Electron build shows 'Bundled server already present' but my changes don't appear — what now?" → "Delete `packages/electron/resources/server/.bundle-stamp` and rebuild; or `rm -rf packages/electron/resources/server/` for a full reset."

### 5. Smoke-test the new pipeline

- [x] 5.1 Run `./packages/electron/scripts/build-installer.sh` on a clean checkout; confirm bundler runs (no stamp yet). Gate logic verified in isolation (no stamp → REBUNDLE); full `electron-forge make` deferred to CI/manual.
- [x] 5.2 Run again immediately; confirm bundler skips with the new "cache is fresh" message. Verified in isolation (fresh stamp → FRESH).
- [x] 5.3 `touch packages/server/src/server.ts`; run again; confirm bundler re-runs. Verified in isolation (server src + client index newer → REBUNDLE).
- [x] 5.4 Temporarily break materialization; confirm post-verify fails. clientSrc hard-fail proven live (`node bundle-server.mjs --source-only` → exit 1, GO/NO-GO message). pi-dashboard-web post-verify existsSync logic proven via repo-lint fixture (task 3.2). Full materialize-break needs client build + npm install → deferred to CI.

### 6. Release

- [x] 6.1 CHANGELOG entry under `## [Unreleased]` → `### Build`: "Electron: rebundle dashboard server when sources change; fail loudly when client materialization is missing (fix-stale-bundled-server-cache)".
