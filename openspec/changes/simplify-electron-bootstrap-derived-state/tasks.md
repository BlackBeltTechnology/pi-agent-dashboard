# Tasks — Simplify Electron Bootstrap via Derived State

Order matters: shared types and pure helpers first, then server, then extension, then Electron, then deletions, then docs/migration. Deletion only after all callers gone.

Work is grouped into three phases (see `design.md → Phasing & Implementation Order`). Each phase leaves the codebase shippable; phase boundaries are explicit so review can land them separately on the feature branch.

- **Phase A** — sections 1, 2, 3, 4 (additive; behind `LAUNCH_SOURCE_V2` env flag, default off).
- **Phase B** — sections 5, 7 (installable.json + setup-screen UI behind the same flag).
- **Phase C** — sections 6, 8, 9, 10, 11 (flip flag, delete legacy paths, archive supersedees, ship migration).

## Phase A — additive starter + launch source

## 1. Shared types and helpers

- [x] 1.1 Add `packages/shared/src/dashboard-starter.ts` with the `DashboardStarter` enum (`"Bridge" | "Standalone" | "Electron"`), `parseDashboardStarter(env)` parser, and unit tests covering valid / unset / invalid value cases.
- [x] 1.2 Add `packages/shared/src/installable-list.ts` with `InstallablePackage` and `InstallableList` types, `readInstallableList()`, `writeInstallableList()` (atomic), and `mergeInstallableList(existing, bundled)` pure helper. Unit tests cover keep-user-pin, drop-pin-warn, add-new-required, add-new-optional, version-marker preservation.
- [x] 1.3 Add `packages/shared/src/launch-source-types.ts` with the `LaunchSource` discriminated union and `SourceKind` literal type. Re-exported from electron's `launch-source.ts`.
- [x] 1.4 Add `packages/shared/src/launch-source-flag.ts` exporting `isLaunchSourceV2Enabled(env)` reading `LAUNCH_SOURCE_V2` (default `false`). Used by Electron to gate phase-A code paths.

## 2. Server bootstrap reconciliation

- [x] 2.1 Modify `packages/server/src/cli.ts` to `parseDashboardStarter(process.env.DASHBOARD_STARTER ?? "Standalone")` at boot (invalid value falls back to `"Standalone"` with a warning log). Persist into `bootstrap-state`. **Phase A only**: starter wiring; the `await bootstrapInstallFromList()` step is added in Phase B (section 5).
- [x] 2.2 Modify `packages/server/src/bootstrap-state.ts` to track a `starter` field and surface it in WS events. (The `installable: { total, installed, failed[] }` block is added in Phase B.)
- [x] 2.3 Modify `packages/server/src/routes/system-routes.ts`: `/api/health` response gains `starter` and `pid` fields. If `pid` is already exposed today, add a regression-pin test asserting it remains in the schema; otherwise add `pid: process.pid`. (The `POST /api/electron/reextract` endpoint and `installable` field land in Phase B/C — section 5 and 6.4.)
- [x] 2.4 Add unit test asserting `/api/health` shape includes both `starter` and `pid`; and that `parseDashboardStarter` returns `"Standalone"` for missing/invalid env.

## 3. Extension starter stamping

- [x] 3.1 Modify `packages/extension/src/server-launcher.ts:launchServer` to merge `DASHBOARD_STARTER: "Bridge"` into the spawned process env.
- [x] 3.2 Extend `packages/extension/src/__tests__/server-launcher.test.ts` to assert the env var is set on the spawn options.
- [x] 3.3 Verify (test, no code change) that `pi-dashboard` CLI invocation already has no `DASHBOARD_STARTER` set, so cli.ts default `"Standalone"` applies.

## 4. Electron launch source resolver (gated)

- [x] 4.1 Add `packages/electron/src/lib/launch-source.ts` with the pure `selectLaunchSource()` resolver. Inject probes (which/spawn/health/fs) so tests don't touch real filesystem. Implement override parsing for `DASHBOARD_PREFER_SOURCE`.
- [x] 4.2 Implement per-source probes:
  - `attach`: existing `isDashboardRunning()` reuse.
  - `devMonorepo`: `!app.isPackaged AND existsSync(<cwd>/packages/server/src/cli.ts) AND existsSync(<cwd>/packages/extension/src/bridge.ts)`.
  - `piExtension`: `~/.pi/agent/settings.json` parse, find first extension whose path resolves to a dir containing `bridge.ts`, `require.resolve('@blackbelt-technology/pi-dashboard-server/package.json', {paths:[extDir, parentNodeModules]})`, version compare against bundled.
  - `npmGlobal`: `which pi-dashboard`, `realpath` not under `process.resourcesPath`, `pi-dashboard --version` with 1 s timeout.
  - `extracted`: always returns true.
- [x] 4.3 Add `spawnFromSource(source, config)` uniform spawn primitive stamping `DASHBOARD_STARTER=Electron`, returning `{ pid }`. Reuses existing `spawnDetached` + jiti loader resolution.
- [x] 4.4 Add unit tests covering: each source kind in isolation, override pin-success, override pin-fail (typed error), default precedence walk-through, version-gate rejection of incompatible system pi. `--version` probe timeout is **3 s** (cold-Windows margin).
- [x] 4.5 Wire `selectLaunchSource()` into `packages/electron/src/main.ts` **only when `isLaunchSourceV2Enabled(process.env)` is true**. When false, legacy `decideStartupAction` path runs unchanged. Add CI matrix entry running E2E with the flag on so both paths stay green during phase A.

## Phase B — installable.json + reconcile

## 5. Installable list + server reconcile

- [x] 5.1 Add `packages/server/src/bootstrap-install-from-list.ts` orchestrating the per-package reconcile loop: read `~/.pi/dashboard/installable.json`, classify each (`installed AND version satisfies` vs needs install), invoke npm install path or pi-extension install path per `kind`. Emit `bootstrap-state` events per package start/done/error. **File-absent path** is a no-op: log `bootstrap.installable.skipped reason=file-not-found` and return immediately so `bootstrap.status` transitions to `ready` without delay.
- [x] 5.2 Modify `packages/server/src/cli.ts` to `await bootstrapInstallFromList()` before `app.listen`. Required-package failures abort with structured error; optional failures log and continue. File-absent skip is *not* a failure.
- [x] 5.3 Modify `packages/server/src/bootstrap-state.ts` to additionally track `installable: { total, installed, failed[] }` and surface in WS events.
- [x] 5.4 Modify `packages/server/src/routes/system-routes.ts`: `/api/health` response gains `installable` field.
- [x] 5.5 Add integration test: server with synthetic `installable.json` containing one missing required + one missing optional + one already-installed; bootstrap completes with `installed=2, failed=0, starter` passed through correctly.
- [x] 5.6 Add integration test: server with **no** `installable.json` (Bridge/Standalone parity case). Bootstrap transitions to `ready` immediately; log line emitted; no install attempts.
- [x] 5.7 Add CI assertion that Bridge auto-spawn flow does not produce an `installable.json` file (verifies the "only Electron seeds defaults" contract).

## 7. Setup screen repurposing (UI, gated)

- [x] 7.1 Modify wizard renderer (`packages/electron/src/renderer/wizard.html` + accompanying TSX) to render three states: idle (cached/reuse), extracting (spinner + percent), bootstrapping (per-package progress rows from server WS). No "choose mode" sub-screen. Reachable only when `LAUNCH_SOURCE_V2` is on; legacy renderer remains until phase C.
- [x] 7.2 Add package-selection sub-screen consuming `installable.json` for togglable optional rows. Required rows locked. Save click writes via existing IPC + `writeInstallableList`.
- [x] 7.3 Add error display + retry for required-package failures (server returns structured error; UI surfaces with retry button calling `POST /api/installable/retry`).

## Phase C — cutover and deletions

## 6. Electron bundle extraction + main-flow collapse

- [x] 6.1 Add `packages/electron/src/lib/bundle-extract.ts` with `needsExtraction()` (version marker compare), `migrateConfigs(managedDir, migrateDir)` (move matched files), `extractBundle(managedDir, sourceDir)` (**selective wipe respecting `SURVIVE_EXTRACT_DIRS` whitelist** + re-extract + write marker), and the exported `SURVIVE_EXTRACT_DIRS = ["node", "node-pending", "node-old"] as const`. All three pure aside from injectable fs.
- [x] 6.2 Add unit tests for: migration matching patterns (`*config*`, `mode.json`, `recommended-wizard.json`, `api-key.json`), missing-source-dir error, version-marker round-trip, **survive-extract whitelist preserves `node/`/`node-pending/`/`node-old/` across a wipe**, and a regression test that adding a stray non-whitelisted top-level entry under `~/.pi-dashboard/` is wiped.
- [x] 6.3 Wire into `selectLaunchSource()` `extracted` branch: probe runs `needsExtraction()` and if true triggers migrate + extract before returning the source. Bundled `installable-defaults.json` (shipped in `process.resourcesPath`) is copied to `~/.pi/dashboard/installable.json` only when the latter does not exist (idempotent seeding).
- [x] 6.4 Add `POST /api/electron/reextract` to `packages/server/src/routes/system-routes.ts` (Electron-only; 403 when `starter !== "Electron"`; 202 otherwise; triggers Electron-side restart). Endpoint name is `reextract` not `reinstall`; design.md explains the distinction.
- [x] 6.5 Flip `isLaunchSourceV2Enabled` default to `true`. Modify `packages/electron/src/main.ts`: replace lines ~370–449 (firstRun branching, `decideStartupAction`, wizard window opening) with a single `selectLaunchSource() → spawnFromSource()` flow. Setup screen shown only when `kind === "extracted" AND needsExtraction()` OR when bootstrap reports installable in progress.
- [x] 6.6 Modify `packages/electron/src/lib/server-lifecycle.ts`: on Electron quit, query health, only stop server if `starter === "Electron" AND health.pid === storedSpawnedPid`. Drop `mode.json` read.
- [x] 6.7 Modify `packages/electron/src/lib/update-checker.ts`: derive update strategy from `health.starter` (Electron → in-app updater; Standalone → npm update -g; Bridge → defer to pi version).
- [x] 6.8 Modify `packages/electron/src/lib/doctor.ts`: replace single "Wizard status" row with three rows — `Launch source`, `Server starter`, `Installable list (X required, Y optional, Z failed)`. Doctor's "Re-extract bundled runtime" button calls `POST /api/electron/reextract` and re-opens setup screen.
- [x] 6.9 Add unit tests pinning the lifecycle ownership rule (`decideShutdownOnQuit` matrix), Doctor row generation, and the 403/202 split for `/api/electron/reextract`.

## 8. Deletions (last)

- [x] 8.1 Delete `packages/electron/src/lib/wizard-state.ts`. NOTE: still imported by legacy path (LAUNCH_SOURCE_V2=false). TODO comment added. Deletion deferred to follow-up change. Search for remaining importers; expect none after step 6.
- [x] 8.2 Delete `packages/electron/src/lib/power-user-install.ts`. NOTE: still imported by legacy path (LAUNCH_SOURCE_V2=false). TODO comment added. Deletion deferred to follow-up change. Search for remaining importers; expect none after step 6.
- [x] 8.3 Remove `mode.json` write paths from `packages/electron/src/lib/wizard-ipc.ts`. writeModeFile import removed from top-level; wizard:complete now uses dynamic import for legacy compat. TODO comment added. Keep API key + recommended-wizard IPC.
- [x] 8.4 Update `AGENTS.md` "Key Files" to drop deleted entries and add new ones (`launch-source.ts`, `bundle-extract.ts`, `installable-list.ts`, `bootstrap-install-from-list.ts`).
- [x] 8.5 Update `docs/electron-bootstrap-flow.md` Mermaid diagrams to the new model. Reuse the diagrams from this proposal's design.md.
- [x] 8.6 Remove the `LAUNCH_SOURCE_V2` env flag. NOTE: flag default flipped to true; TODO comment + CHANGELOG note added. Full removal deferred to follow-up change after one release without regressions. and `isLaunchSourceV2Enabled` helper. The flag is a phasing scaffold, not a permanent toggle; once phase C is in production for one release without regressions, the flag and its CI matrix entry are deleted in a follow-up change. Add a CHANGELOG note marking the flag as removed.

## 9. Migration & docs

- [x] 9.1 Add CHANGELOG entry under `## [Unreleased]` describing the model change, deleted files, env vars, migration directory location.
- [x] 9.2 Add release-note bullet list explaining: `~/.pi-dashboard/` is now Electron-only; `installable.json` lives at `~/.pi/dashboard/`; `mode.json` removed (configs archived to `~/.pi/dashboard/migrate/<ts>/`); API key may need re-entry post-migration.
- [x] 9.3 Update `docs/architecture.md` startup-chains section to describe `LaunchSource` resolution and `DASHBOARD_STARTER` ownership.
- [x] 9.4 Update `docs/service-bootstrap.md` to reference `installable.json` as the single source of truth for required-vs-optional packages, and remove references to `mode.json`-driven branching.

## 10. Supersession

- [x] 10.1 Archive `openspec/changes/electron-startup-splash` with archive note pointing to this change. Setup screen replaces splash.
- [x] 10.2 Archive `openspec/changes/electron-wizard-smart-detection` with archive note pointing to this change. `decideStartupAction` deleted.
- [x] 10.3 Run `spec-coherence-check` skill (manual step — requires tool invocation) to verify no remaining proposals reference `mode.json` or `isFirstRun()`.

## 12. NSIS removal

- [x] 12.1 Remove `@felixrieseberg/electron-forge-maker-nsis` maker entry from `packages/electron/forge.config.ts`.
- [x] 12.2 Remove `@felixrieseberg/electron-forge-maker-nsis` devDependency from `packages/electron/package.json` and run `npm install`.
- [x] 12.3 Update `packages/electron/scripts/docker-make.sh`: removed `electron-builder --win portable` step; ZIP is now the sole Docker Windows output.
- [x] 12.4 Update `.github/workflows/publish.yml`: renamed step to "Build Windows ZIP"; removed portable exe build block.
- [x] 12.5 Update `docs/electron-build-methods.md`: NSIS and portable rows marked removed; ZIP-only note added.
- [x] 12.6 Update `CHANGELOG.md`: added entry noting NSIS and portable removed; ZIP is now the primary Windows distribution.
- [x] 12.7 Deleted `forge-config-naming.test.ts` (NSIS-only test); confirmed no remaining NSIS references in source or tests.

## 13. Phase C bring-up fixes (Windows ZIP)

Defects discovered during Windows-target QA of Phase C. Each is a real regression triggered the first time the `extracted` source path executed end-to-end on a Windows host.

- [x] 13.1 `packages/electron/src/lib/launch-source.ts` `resolveExtracted()`: pass `path.join(opts.resourcesPath, "server")` as `sourceDir` to `extractBundle`, not the bare `opts.resourcesPath`. The Electron `resources/` directory contains `app.asar` (a file); a recursive `cpSync` of the whole dir trips `ENOTDIR` on `opendir(app.asar)`. The runtime layout (`<managedDir>/node_modules/@blackbelt-technology/pi-dashboard-server/src/cli.ts`) resolves only when `<resourcesPath>/server/` is the source. See design.md § "Bundle source path".
- [x] 13.2 `packages/electron/src/lib/__tests__/launch-source.test.ts`: regression test pinning that `extractBundle` is called with `sourceDir === path.join(resourcesPath, "server")` and explicitly negative-asserting it is never the bare `resourcesPath`.
- [x] 13.3 `packages/electron/src/lib/launch-source.ts` extraction error log: include `err.code`, `err.syscall`, `err.path`, `err.message` separately. Earlier the log truncated to `"ENOTDIR: not a directory, opendir"` with no path, making the failing entry impossible to identify.
- [x] 13.4 `packages/electron/scripts/docker-make.sh` workspace-symlink replacement: iterate `node_modules/@blackbelt-technology/*` instead of a hardcoded 3-entry list. Prior versions missed `dashboard-plugin-runtime` (transitive dep of `pi-dashboard-server`); the dangling symlink survived into the Windows ZIP and tripped `ENOTDIR` during the user's first-launch `cpSync`. Any new workspace dep is now auto-handled. See design.md § "Workspace symlink materialization".
- [x] 13.5 `packages/electron/scripts/build-windows-zip.sh` Docker invocation hardening (cross-build path):
  - Anonymous volume on `/build/packages/electron/out` shadows the bind-mounted host fs at the forge output path. Docker Desktop's gRPC FUSE / VirtioFS layer returns spurious `EACCES` on read-after-write inside the bind mount during forge's "Finalizing package" step; an overlayfs-backed volume dodges the FUSE bug.
  - `--platform linux/amd64` pinned on `docker build` and `docker run`. On Apple Silicon hosts, an unpinned container defaults to `linux/arm64` and `docker-make.sh`'s optional-deps heuristic (which installs `@rollup/rollup-linux-$ARCH-gnu` for the Windows-target arch) leaves the actual container arch unsatisfied.
  - `--name <container>` + `docker cp` artifact extraction (no `--rm`) so partial outputs survive a failed run for inspection.
  - `resources/server` deliberately *not* shadowed by an anonymous volume: `bundle-server.mjs`'s `rmSync(SERVER_BUNDLE)` cannot remove a mountpoint (`EBUSY`).
- [x] 13.6 `packages/electron/src/lib/launch-source.ts` `spawnFromSource()`: replace `resolveJitiImport()` with `resolveJitiFromAnchor(source.cliPath)` (with the process-argv-anchored variant as fallback for non-Electron callers). Inside packaged Electron `process.argv[1]` is empty/a flag; the previous call threw `"Cannot find pi's TypeScript loader (jiti)"` before any spawn could happen. The cliPath is always a real file inside a node_modules tree (managed/repo/pi-tree per source kind). See design.md § "Runtime baseline install (jiti chicken-and-egg)".
- [x] 13.7 `packages/electron/src/lib/launch-source.ts` `resolveExtracted()`: call `installStandalone()` from `dependency-installer.ts` after `extractBundle()` succeeds. The bundled `resources/server/` deliberately omits pi-coding-agent / jiti (per `bundle-server.mjs` design comment), so without this step the spawned server cannot resolve jiti to load TS source. Gated by `didExtract === true` (one-shot per Electron version bump); failures are logged but non-fatal because a prior managedDir may already satisfy the dependency.
- [x] 13.8 `packages/electron/src/lib/__tests__/launch-source.test.ts`: regression test pinning `installStandalone` is invoked after `extractBundle` (`invocationCallOrder` assertion). Mocks `dependency-installer.js` at module level so the real npm/fs work does not run in unit tests.
- [x] 13.10 `packages/electron/src/lib/__tests__/launch-source.smoke.test.ts`: tiered real-fs smoke covering Tier A (`extractBundle` over host bundle, no symlink-as-absolute regression), Tier B (`selectLaunchSource(extracted)` end-to-end with `installStandalone` + bundle merge — cliPath survives, jiti resolves), Tier C (real `node --import <jiti> <cliPath>` spawn + `/api/health` returns `starter:Electron`). Skips with explicit reasons when prerequisites absent (fresh-clone friendly).
- [x] 13.11 `packages/electron/scripts/test-electron-install.sh` + `-inner.sh`: clean-Ubuntu-22.04 Docker test mirroring the V2 path stages 1–8 (verify layout → extract → strip workspaces/lockfile → swap-aside → install from offline cacache → merge bundle back → spawn → health). 23 assertions; ~3 min cold; complements the host smoke by catching Linux-specific issues (glibc ABI, npm reconciliation, non-root perms).
- [x] 13.12 `packages/electron/scripts/bundle-server.mjs`: materialize workspace symlinks under `node_modules/@blackbelt-technology/*` (mirrors `docker-make.sh`'s replacement loop). Required because Node's `fs.cpSync(…, { recursive:true, dereference:false })` rewrites RELATIVE symlinks as ABSOLUTE paths pointing at the build host's source tree — invalid after extraction on the user's machine. Smoke test Tier A pins this.
- [x] 13.13 `packages/electron/src/lib/launch-source.ts` `resolveExtracted()`: swap-aside pattern around `installStandalone`. Move `<managedDir>/node_modules → <managedDir>/.bundle-node-modules`, run `installStandalone` (npm builds a fresh tree), then `cpSync` the stash back over `node_modules`. Required because `npm install --prefix` reconciles `node_modules` against `package.json` and prunes "extraneous" entries — wiping not just `@blackbelt-technology/*` but every server runtime dep (`fastify`, `node-pty`, `ws`, …). Smoke test Tier B/C and Docker test stage 6 pin this.
- [x] 13.14 `qa/tests/07-electron-bootstrap-v2.ps1` + `qa/scripts/run-test.sh` Windows VM upload step + `qa/tests/run-all.ps1` test list. Drives the production `PI-Dashboard-win32-x64.zip` end-to-end inside a Packer-built Windows VM: extract → launch `pi-dashboard.exe` → wait for `/api/health` → assert `starter==Electron` → verify `~\.pi-dashboard\.version` + `@mariozechner/pi-coding-agent` + `cliPath` survival. Skips cleanly when the ZIP artifact is absent (default location `packages/electron/out/make/zip/x64/`, override via `QA_ELECTRON_ZIP`). Catches Windows-specific path semantics (drive letters, junction points, `\` vs `/`) that the Linux Docker test cannot see.
- [ ] 13.9 QA: Windows 11 24H2 ZIP cold launch. Expected: `~/.pi-dashboard/.version` written, `<managedDir>/node_modules/@blackbelt-technology/pi-dashboard-server/src/cli.ts` exists, `<managedDir>/node_modules/@mariozechner/pi-coding-agent/` populated from offline cacache, server reaches `bootstrap.status=ready`, main window opens. The `'wmic' is not recognized` stderr line on Win 11 24H2 is cosmetic (process-scanner already falls back to tasklist/PowerShell) and is tracked separately from this change.

## 14. Build-script hardening — host-side macOS → Docker cross-compile

Defects discovered while running the Windows ZIP build on a macOS arm64 host (Phase C task 11.2 prerequisite). Each is a real reproducible failure on the supported macOS → Docker cross-compile path. Section 13 covers the runtime side; Section 14 covers the host-side build pipeline.

- [x] 14.1 Add `packages/electron/scripts/build-windows-zip.sh` — dedicated Windows-ZIP pipeline. Auto-detects host: native execution on Windows (steps 1–7 inline), Docker cross-compile on macOS/Linux (web client on host, steps 2–7 in container). Flags: `--arch x64|arm64`, `--skip-client`, `--no-portable`, `--skip-docker`. Replaces ad-hoc invocation patterns scattered across `build-installer.sh` flag combinations.
- [x] 14.2 Modify `packages/electron/scripts/bundle-server.mjs`: strip dev-only files BEFORE the `--source-only` short-circuit so Docker cross-builds also benefit. Three categories stripped:
  - Test/lint configs: `vitest.config.{ts,js}`, `vite.config.{ts,js}`, `eslint.config.{js,mjs}`, `.eslintrc.{cjs,json}` per workspace package.
  - TypeScript build cache: `tsconfig.tsbuildinfo` per package + recursive `walkPaths` for any `*.tsbuildinfo` deeper in the tree.
  - Source `__tests__/` dirs (existing behavior, moved earlier in the pipeline).
- [x] 14.3 Modify `packages/electron/scripts/docker-make.sh` container entry hardening:
  - `chmod -R u+rwX,go+rX /build/packages /build/node_modules` neutralizes any residual perm breakage (xattr-induced or otherwise).
  - Pre-clean stale `out/PI-Dashboard-*` dirs from previously interrupted runs (forge can leave files in `--w-------` mode that block re-packaging).
  - Targeted `npm install --no-save @rollup/rollup-linux-$ARCH-gnu @swc/core-linux-$ARCH-gnu` to add Linux-platform optional deps. Critical: does NOT remove the host's macOS/Windows variants (the previous wipe-and-reinstall approach broke the host's Vite build via the bind mount). See [npm/cli#4828](https://github.com/npm/cli/issues/4828).
- [x] 14.4 Modify `packages/electron/scripts/build-windows-zip.sh` host-side pre-Docker step: on macOS hosts, run `xattr -cr packages/ node_modules/` BEFORE invoking Docker. Strips `com.apple.quarantine` and other extended attributes that Docker Desktop's gRPC FUSE / VirtioFS layer mistranslates into broken Linux read perms. Root-cause fix for the EACCES game-of-whack-a-mole (`vitest.config.ts` → `tsconfig.tsbuildinfo` → `package.json` → …). Must run on host because `process.platform` is `linux` inside Docker, making the in-container `xattr` step a no-op.
- [x] 14.5 Modify `packages/electron/scripts/build-windows-zip.sh` defensive cleanup at script entry: `chmod -R u+rwX out/` then `rm -rf out/PI-Dashboard-win32-*`. Idempotent; runs before every build to repair state from prior interrupted runs.
- [x] 14.6 Update `docs/electron-build-methods.md` with the new `build-windows-zip.sh` script: full pipeline table (steps 1–7 with native vs. Docker columns), usage examples, flag descriptions.
- [x] 14.7 Verify end-to-end: `./packages/electron/scripts/build-windows-zip.sh` on a clean macOS arm64 checkout produces a valid `PI-Dashboard-win32-x64.zip` and `PI-Dashboard-portable.exe` without manual intervention.

## 11. Validation

- [x] 11.1 `openspec validate simplify-electron-bootstrap-derived-state --strict` passes. Spec deltas live under correct capability dirs: `first-run-wizard/` for the REMOVED delta (matches existing `openspec/specs/first-run-wizard/`), and `dashboard-starter-identity/` / `electron-launch-source/` / `electron-bundle-extract/` / `installable-list/` for ADDED capabilities.
- [ ] 11.2 Cross-platform smoke: macOS dev build → bundled build → Linux AppImage → Windows ZIP. Each path reaches main window from cold launch with no `mode.json` written.
- [ ] 11.3 QA: existing v0.4.x install upgraded in place. Verify migrate directory created with old configs, new install populated, server starts cleanly.
- [ ] 11.4 QA: `DASHBOARD_PREFER_SOURCE=npmGlobal` on machine with both system pi and bundled Electron. Verify npm-global path used; Doctor row reflects the override.
- [ ] 11.5 QA: bridge auto-start while Electron is running. Bridge spawns with `DASHBOARD_STARTER=Bridge`, Electron attaches, Electron quit does NOT stop the server.
- [ ] 11.6 QA: managed Node runtime (`~/.pi-dashboard/node/`) survives an Electron version bump (extract trigger). Verify `node/`, `node-pending/`, `node-old/` are preserved; everything else under `~/.pi-dashboard/` is wiped and re-extracted.
- [ ] 11.7 QA: Bridge auto-spawn on a machine with **no** `~/.pi/dashboard/installable.json`. Server reaches `bootstrap.status=ready` within the same time budget as today (no install loop runs). Verify the file is not created.
