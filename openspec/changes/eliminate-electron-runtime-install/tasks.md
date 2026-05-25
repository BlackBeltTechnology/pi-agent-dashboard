# Tasks — eliminate-electron-runtime-install

Sequenced across 10 phases. Each phase produces a coherent commit / PR.
Phases 3 and 4 may interleave; all others are strictly ordered.

## 0. Scaffold & pre-decisions

- [x] 0.1 Confirm Q1 — `streamline-electron-bootstrap-and-recovery` (91/97) is archived as-is. Group 16 Failures 1–5 retained where landed; Failures 1 & 2 (workspace-materialize, managed-dir resolver) become vestigial under this change.
- [x] 0.2 Confirm Q2 — wizard collapses to **one welcome step** (not zero). Skip welcome on second+ launches via `~/.pi/dashboard/first-run-done` marker.
- [x] 0.3 Confirm Q3 — bridge arm gets the same treatment in a follow-up exploration. Out of scope for this change.
- [x] 0.4 Record Q1/Q2/Q3 ratifications in `design.md` "Decisions ratified" section.
- [x] 0.5 `openspec validate eliminate-electron-runtime-install` passes (proposal + design + tasks + 10 spec deltas).

## 1. Foundation spike — dependency lift + bundle (GO/NO-GO)

- [x] 1.1 **Dependency lift.** Move `@earendil-works/pi-coding-agent`, `@fission-ai/openspec`, `tsx` from optional `peerDependencies` to regular `dependencies`. Implementation:
  - [x] 1.1.a Added `@earendil-works/pi-coding-agent@^0.74.0`, `@fission-ai/openspec@^1.3.0`, `tsx@^4.21.0` to `dependencies` of `packages/server/package.json` (floor versions taken from the now-vestigial `packages/electron/offline-packages.json`). Lockfile updated cleanly via `npm install` (140 packages added, pre-existing `subagents-plugin` drift unrelated).
  - [x] 1.1.b Not needed. Root `@blackbelt-technology/pi-agent-dashboard` depends on `@blackbelt-technology/pi-dashboard-server@^0.5.3`, which now transitively pulls pi/openspec/tsx via its regular `dependencies` block. npm hoists them to the root global-install `node_modules/` automatically. No separate root-level dep needed.
  - [x] 1.1.c Already done in a prior change (`enable-standalone-npm-install` task 1.1): `jiti@^2.7.0` is already a direct dep of `packages/server/package.json`.
  - [x] 1.1.d Verified: `packages/extension/package.json` `peerDependencies` block (pi-coding-agent, pi-tui, typebox — all optional) is unchanged by this dep lift. The bridge runs inside pi and keeps its existing optional-peer contract.
  - [x] 1.1.e Simplified `packages/electron/scripts/bundle-server.mjs`: removed the `PINS_FILE` read, the `PI_RUNTIME_DEPS` synthetic block, and the `dependencies: PI_RUNTIME_DEPS` field on the synthetic bundle pkg.json. The build-time `npm install --omit=dev` step now resolves pi/openspec/tsx automatically via `packages/server/package.json`'s regular deps. `offline-packages.json` is vestigial (still on disk; removed in Phase 5).
  - [x] 1.1.f Already done in a prior change (`enable-standalone-npm-install` task 2.1): `packages/server/bin/pi-dashboard.mjs` error message already reflects the post-fix shape ("This is unexpected: jiti ships as a direct dependency... your install may be corrupted... please report at <repo>/issues").
  - [x] 1.1.g Already done in a prior change (`enable-standalone-npm-install` task 4.1): `packages/shared/src/__tests__/binary-lookup-resolveJiti.test.ts` covers the "own-tree jiti, no pi peer" scenario.
  - [x] 1.1.h `npm install` clean; `npm test` green (594 test files / 6018 tests pass, 17 skipped); `npm run lint` (`tsc --noEmit`) green.
- [x] 1.1.i **Bump `node-pty` from `^1.1.0` to `1.2.0-beta.13`** in `packages/server/package.json` (commit `20d1a39c`). Verified: `packages/server/package.json` now pins `"node-pty": "1.2.0-beta.13"`. All six prebuild triples present in the tarball. See design.md F1.
- [x] 1.1.j Extended `scripts/verify-release-deps.mjs` with `minVersion` rules for `@earendil-works/pi-coding-agent` (≥0.74.0), `@fission-ai/openspec` (≥1.3.0), and `tsx` (≥4.21.0). Release-cut now blocks if any of pi/openspec/tsx/node-pty/jiti regress below their pinned floor.
- [x] 1.1.k Phase 1 GO/NO-GO threshold implemented in `packages/electron/scripts/bundle-server.mjs`: after `npm install --omit=dev` completes, asserts the four required `node-pty/prebuilds/{darwin-arm64,darwin-x64,linux-x64,win32-x64}/` triples exist. Build fails loudly if any is missing. `linux-arm64` + `win32-arm64` logged as advisory (non-blocking).
- [x] 1.1.l **F9 fixed.** Added `bareImportCliStrategy` to Unix chain in `piExecutorDef` (and `openspecExecutorDef`). Position: between `overrideStrategy` and `managedBinStrategy`. The `bareImportCliStrategy` itself was also fixed: both `@earendil-works/pi-coding-agent` and `@fission-ai/openspec` declare `exports` maps that omit `./package.json` — `createRequire.resolve(<pkg>/package.json)` returns `ERR_PACKAGE_PATH_NOT_EXPORTED` on modern Node. Added `findPackageJsonByDirWalk()` fallback that walks up from `import.meta.url` looking for `node_modules/<pkg>/package.json` on the filesystem directly (exports-map-immune). Honors injected `exists` predicate so unit tests stay deterministic. See design.md F9.
- [x] 1.1.m `@mariozechner/pi-coding-agent` alias preserved — the Unix chain composition uses `...piPkgAliases.map((pkg) => bareImportCliStrategy(pkg, cliEntry, deps))` identical to the Windows pattern. Both aliases probed in order.
- [x] 1.1.n Regression test added: `packages/shared/src/__tests__/tool-registry-definitions.test.ts > pi binary definition > bare-import wins over PATH when bundled cli.js exists (F9)`. Asserts `res.path` points at the bundled `dist/cli.js` and `res.tried.find(t => t.strategy === "bare-import")?.result === "ok"`. Plus chain-order test updated to reflect the new 5-strategy Unix chain.
- [x] 1.1.o Re-ran Phase 1.6 macOS arm64 smoke 2026-05-23: bundled `.app` from `PI-Dashboard-darwin-arm64-0.5.3.dmg` (240 MB) launched with `PATH=/usr/bin:/bin:/usr/sbin:/sbin` + empty `HOME`. Server log shows `[bootstrap] ready (pi resolved via bare-import)`. No `bootstrapInstall` triggered. No `~/.pi-dashboard/` write. Proposal's central architectural claim verified.
- [x] 1.2 Build `.dmg` on macOS arm64. **Result: 272 MB** (+47 MB vs 225 MB proposal baseline, +30 MB vs stale May-19 build; well under +150 MB threshold). Bundled pi 0.74.2 / openspec 1.3.1 / tsx 4.22.3 / node-pty 1.2.0-beta.13 with all 6 prebuild triples. 1.1.k guard fired cleanly. See design.md "macOS arm64 (host: macOS 26.2, Node 24.15.0, 2026-05-20)" spike row.
- [ ] 1.3 Build `.deb` on Linux x86_64. Record size delta. **Route to CI.** Local `bash scripts/build-installer.sh --linux --arch x64` produces no installer: `electron-forge make` resolves an empty makers list (logs `Making for the following targets: , ` with two unnamed entries, no `.deb` or `.AppImage` written, container exits clean). Pre-existing tooling drift between `docker-make.sh`'s `electron-forge make --platform linux --arch x64` and CI's `npm run electron:make -- --arch=x64` (no `--platform` flag). Server bundle stage (`bundle-server.mjs`) ran successfully inside container — pi/openspec/tsx resolve as regular deps, node-pty linux-x64 prebuild present — so the dep-lift mechanic is **independently verified at the npm-install layer**, just not at the maker layer locally. Track separately under a `fix-electron-docker-linux-makers` change. For now, run linux builds via `.github/workflows/publish.yml` Linux matrix leg.
- [ ] 1.4 Build `.exe` (ZIP + portable) on Windows x86_64. Record size delta. **Route to CI.** NSIS was removed in change `simplify-electron-bootstrap-derived-state`; Windows artifacts are ZIP + portable.exe via `electron-builder`. Local Docker cross-build for Windows shares the same tooling drift; route to CI.
- [ ] 1.5 Build `.AppImage` on Linux x86_64. Record size delta. **Route to CI.** Same blocker as 1.3.
- [ ] 1.6 Smoke test on each of macOS / Linux / Windows: install, launch, spawn pi session via process-manager, verify `pi` resolves to bundled copy (no `~/.pi-dashboard/` access). **Reference implementation**: `scripts/test-standalone-npm-install-docker.sh` + `scripts/lib/smoke-spawn-session.mjs` (inherited from `enable-standalone-npm-install` task 4.4). Port the WebSocket `spawn_session` step verbatim; swap `pi-dashboard start` for `open PI-Dashboard.app`. **NOTE**: curl from inside the test container/VM — `localhost-guard` returns 403 to docker-port-forwarded requests from the host. See design.md F3.
- [ ] 1.7 Smoke test: server-side `openspec` invocations succeed.
- [ ] 1.8 Smoke test: server runs under `node` from `resources/node/bin/node` with `node_modules` from `resources/server/node_modules/`.
- [ ] 1.8.a Verify `npm pack` patterns used in Phase 1 smokes work on the build host's `npm` version. **Known bad**: `npm pack -ws --include-workspace-root` exits with `ERR_OUT_OF_RANGE` on `npm@11.11.0` AFTER successfully producing tarballs. Workaround: loop over `find packages -maxdepth 2 -name package.json`, call `npm pack --workspace=<dir>` individually, filter `private: true`. See design.md F4.
- [ ] 1.9 Record spike findings in `design.md` "Spike results" section.
- [x] 1.10 **GO/NO-GO checkpoint** — abort and reassess if any platform's size delta > 150 MB or pi cannot spawn from bundled location. **macOS arm64 branch GREEN** per design.md F9 + task 1.1.o smoke (size +30 MB ≪ +150 MB; pi resolves via bare-import; no `~/.pi-dashboard/` write). Linux + Windows branches deferred to CI (`publish.yml` matrix) per tasks 1.3–1.5 routing. Proceeding to Phases 2–8 on the strength of the macOS spike; CI must confirm Linux + Windows before release-cut (Phase 9.12).

## 2. Cross-change coordination (parallel with Phase 1)

- [x] 2.1 Archive `streamline-electron-bootstrap-and-recovery`. **Not present in `openspec/changes/` as of 2026-05-23** — already archived/removed under a different name or never landed under this exact dir name. Group 16 Failures 3/4/5 fixes already on `develop` (`dashboard-paths.ts`, `server-identity.ts`, watchdog respawn in `server-lifecycle.ts`). No action needed.
- [x] 2.2 Close `fix-stale-bundled-server-cache` (0/16) with supersede note pointing to this change. Wrote `openspec/changes/fix-stale-bundled-server-cache/SUPERSEDED.md` (2026-05-23): runtime-extraction failure mode cannot occur under immutable-bundle architecture; close entirely, no salvage.
- [x] 2.3 Close `fix-electron-wizard-npm-root-enoent` (23/25) with supersede note. **Not present in `openspec/changes/` as of 2026-05-23.** No action needed.
- [x] 2.4 Re-scope `skip-affected-bundled-node` (12/17). Wrote `openspec/changes/skip-affected-bundled-node/SUPERSEDED.md` (2026-05-23): standalone-arm-relevant work salvaged via inherited CI matrix from archived `enable-standalone-npm-install`; Electron-side version-skip logic vestigial under bundled-Node-only path.
- [x] 2.5 Re-scope `fix-electron-server-launch-node-bin` (28/34). Wrote `openspec/changes/fix-electron-server-launch-node-bin/SUPERSEDED.md` (2026-05-23): 28 landed tasks survive on `develop`; 6 outstanding tasks absorbed into Phase 4 task 4.4 of this change.
- [x] 2.6 Confirm `fix-build-installer-stale-server-bundle` (21/22) continues independently. **Not present in `openspec/changes/` as of 2026-05-23** — already landed or archived. No action needed.
- [x] 2.7 Confirm `docker-packaging` continues independently; note that this change reinforces it. Present at `openspec/changes/docker-packaging/`; left untouched. This change's regular-dep lift simplifies the Docker recipe (no `~/.pi-dashboard/` install step) and reinforces docker-packaging as the reference standalone deployment.
- [x] 2.8 Confirm `npm-publish-first-party-extensions` (30/32) is unaffected. **Not present in `openspec/changes/` as of 2026-05-23** — already landed or archived. No action needed.
- [x] 2.9 Archive `enable-standalone-npm-install` with a supersede note pointing here. **Already archived at `openspec/changes/archive/2026-05-23-enable-standalone-npm-install/`** (commit `1bc50741`). Salvage already applied to Phase 1 tasks 1.1.c, 1.1.f, 1.1.g. No action needed.

## 3. Server-side deletions (topological, leaf-first)

> **Pre-decision (recorded 2026-05-20):** `packages/server/src/cli.ts` is
> NOT "unchanged" as the proposal originally listed. `runDegradedModeBootstrap`
> (cli.ts ~lines 297–350) imports and calls `bootstrapInstall` from
> `packages/shared/src/bootstrap-install.ts`, which IS in the delete list.
> Removing the latter without touching cli.ts breaks compile. The
> selected disposition is **delete the entire `runDegradedModeBootstrap`
> function**: under regular-dep lift pi is always resolvable, so the
> `if (initial.ok)` short-circuit always fires; the install branch is
> unreachable. See design.md F2.

- [x] 3.0.a `runDegradedModeBootstrap` and `maybeSeedDefaultInstallableList` deleted from `packages/server/src/cli.ts` (2026-05-23). Inlined ToolRegistry resolve into `runForeground`: success path logs `[bootstrap] ready (pi resolved via <source>)`; failure path throws a hard error citing corrupted node_modules/. Removed imports: `bootstrapInstall`, `bootstrapInstallFromList`, `defaultInstallableList`, `writeInstallableList`, `getManagedDir`, `updateBootstrapCompatibility`, `BootstrapStateStore`, `existsSync`. `upgrade-pi` subcommand removed (depended on deleted bootstrap-install module; pi-core upgrade path survives via `/api/pi-core/update`).
- [x] 3.0.b Added `packages/server/src/__tests__/cli-no-bootstrap-references.test.ts` (2026-05-25). 3 tests: (1) cli.ts source contains no references to any of 14 forbidden bootstrap symbols (`bootstrapInstall`, `bootstrapInstallFromList`, `installable-list`, `BootstrapStateStore`, etc.); (2) `[bootstrap] ready (pi resolved via` log line present, proving tool-registry resolve is wired; (3) hard-throw branch citing `corrupted node_modules` present, proving no degraded-mode fallback. All 3 pass.


> **Scope clarification (recorded during apply, pre-implementation):**
>
> Pi-core update machinery is **retained** for the standalone (`npm i -g`)
> and bridge (pi-extension) arms, where it has a writable target. Under
> Electron the bundled `resources/server/node_modules/` is read-only, so
> the pi-core update UI is **hidden via a `launchSource: "electron" |
> "standalone" | "bridge"` field added to `GET /api/health`**. The
> Electron arm's pi-version update path is `electron-updater` whole-app
> replacement.
>
> Pi-core retention preserves: `/api/pi-core/{versions,update,changelog}`,
> `pi-core-checker.ts`, `pi-core-updater.ts`, `changelog-parser.ts`,
> `usePiCoreVersions`, `usePiChangelog`, `pi-core-api.ts`, `PiUpdateBadge`,
> `WhatsNewDialog`, and the `Core` sub-group of `UnifiedPackagesSection`.
>
> Only `/api/bootstrap/*` + the entire runtime-install pyramid are
> deleted in this phase.

- [x] 3.1 Client bootstrap consumers deleted (2026-05-23):
  - [x] Deleted `packages/client/src/hooks/useBootstrapStatus.ts`
  - [x] Deleted `packages/client/src/components/BootstrapBanner.tsx`
  - [x] Deleted `packages/client/src/components/__tests__/BootstrapBanner.test.tsx`
  - [x] `App.tsx` — dropped imports + mount of `BootstrapBanner`, `useBootstrapStatus`.
  - [x] `useMessageHandler.ts` — removed `bootstrap_status_update` + `bootstrap_ticket_complete` branches. `pi_core_event` dispatch retained.
  - [x] Verification: `rg -n '/api/bootstrap/' packages/client/src/` returns zero matches.
- [x] 3.2 `launchSource` field added to `/api/health` (2026-05-23):
  - [x] Added `parseLaunchSource(env)` helper to `packages/shared/src/dashboard-starter.ts` (lowercase alias of `parseDashboardStarter`).
  - [x] `system-routes.ts` `/api/health` now returns `launchSource: "electron" | "standalone" | "bridge"` driven by `process.env.DASHBOARD_STARTER` directly (legacy `starter` + `installable` fields removed; both were `bootstrapState`-derived).
  - [x] `/api/electron/reextract` gate switched from `bootstrapState.get().starter` to `parseLaunchSource(process.env)`.
  - [x] No `HealthResponse` shared type exists — inline response object; no rest-api.ts change needed.
  - [x] `health-shape.test.ts` rewritten to assert `launchSource` for all three DASHBOARD_STARTER values.
- [x] 3.3 Client: hide pi-core UI under Electron (2026-05-23):
  - [x] Added `packages/client/src/hooks/useLaunchSource.ts` (module-level cache, fail-open, in-flight returns `null`, test-reset helper).
  - [x] `UnifiedPackagesSection.tsx` gates Core sub-group (header + rows + Update All) on `launchSource !== "electron"`. Recommended + Other still render.
  - [x] `App.tsx` gates `<PiUpdateBadge />` mount on `launchSource !== "electron"`.
  - [ ] Test updates for Electron-hidden assertions (deferred to Phase 3.9 npm-test sweep).
- [x] 3.4 Server bootstrap routes deleted + unregistered (2026-05-23):
  - [x] Deleted `packages/server/src/routes/bootstrap-routes.ts` + `__tests__/bootstrap-routes.test.ts`.
  - [x] `server.ts`: removed `registerBootstrapRoutes` import + call + the ~100-LOC `triggerUpgradePi` / `triggerRetry` orchestration block.
- [x] 3.5 Server bootstrap service modules + their tests deleted (2026-05-23):
  - [x] `bootstrap-install-from-list.ts`, `bootstrap-state.ts`, `bootstrap-queue.ts`, `legacy-pi-cleanup.ts`.
  - [x] Tests: `bootstrap-state.test.ts`, `bootstrap-queue.test.ts`, `bootstrap-install-from-list.test.ts`, `cli-bootstrap.test.ts`, `cli-seed-installable-list.test.ts`, `legacy-pi-cleanup.test.ts`, `post-install-rescan.test.ts`, `post-install-openspec-refresh.test.ts`, `system-routes-reextract.test.ts`.
  - [x] `pi-core-routes.ts`: `bootstrapState?` field + `bootstrapGate` preHandler removed; both routes now unconditionally available.
  - [x] `pi-changelog-routes.ts`: `bootstrapState?` field + gate removed.
  - [x] `openspec-routes.ts`: `bootstrapState?` field + the pi-resources empty-payload bootstrap gate removed.
  - [x] `session-api.ts`: `bootstrapState` + `bootstrapQueue` deps + `gateOrEnqueue` removed; spawn endpoint runs directly.

- [x] 3.5b `cli.ts` trimmed (2026-05-23). Imports of `defaultInstallableList`, `writeInstallableList`, `bootstrapInstallFromList`, `updateBootstrapCompatibility`, `getManagedDir`, `bootstrapInstall`, `BootstrapStateStore`, `existsSync`, `logCompatibilityWarning` all removed. `maybeSeedDefaultInstallableList()` + bootstrap orchestration block (~165 LOC) deleted. SUBCOMMANDS list now `["start", "stop", "restart", "status"]` (no `upgrade-pi`). CLI no longer installs anything at startup.

- [x] 3.5c `server.ts` trimmed (2026-05-23). `createBootstrapState`, `createBootstrapQueue`, `detectLegacyPiInstalls`, `bootstrapInstall`, `BootstrapStateStore`, `registerBootstrapRoutes`, `isOpenSpecDataEmpty` imports removed. `runPostInstallRepair`, `makeBootstrapTransitionHandler`, `PostInstallRepairDeps`, `BootstrapTransitionHandlerDeps` definitions removed. `bootstrapState` field removed from `DashboardServer` interface + server object. All `bootstrapState.subscribe`, `bootstrapQueue.flushAll`, `unsubscribeBootstrap`, `unsubscribeQueueComplete` wiring + their teardown deleted. Server.ts net 99 lines shorter.
- [x] 3.6 `pi-version-skew.ts` trimmed (2026-05-23). `updateBootstrapCompatibility` + `_resetVersionSkewCache` + `CacheEntry` interface deleted. `BootstrapCompatibility` interface moved inline from deleted `bootstrap-state.js` (kept for `readPiCompatibility`/`computeCompatibility` return types). Pure helpers `parseVersion`/`compareVersions`/`isBelow`/`isAbove`/`readPiCompatibility`/`readCurrentPiVersion`/`computeCompatibility` retained. Test updated to drop `_resetVersionSkewCache` import.
- [x] 3.7 Shared support modules deleted (2026-05-23):
  - [x] `managed-workspace-materialize.ts`
  - [x] `installable-list.ts`
  - [x] `managed-package-whitelist.ts`
  - [x] `bootstrap-install.ts`
  - [x] `scripts/test-standalone-npm-install.sh` — **deleted on 2026-05-23 (d3fe2163), recreated on 2026-05-25 (72166780) at post-bootstrap shape.** The new shape probes `/api/health` for `ok=true` with a 60s deadline (vs. the deleted bootstrap-polling loop on the removed `/api/bootstrap/status`). `.github/workflows/ci.yml`'s standalone-install-smoke job (Linux) re-enabled at the same commit. Companion `scripts/test-standalone-npm-install.ps1` rewired in the same commit; deadline 240s → 60s (no async install to wait for).
  - [~] `recommended-extensions.ts` — **NOT deleted** (proposal listed it but it powers the surviving Recommended Extensions UI sub-group; only `BUNDLED_EXTENSION_IDS` constant becomes dead under Electron, which Phase 5 cleans up). Retained for `RECOMMENDED_EXTENSIONS` manifest used by client + server routes.
- [x] 3.8 Regression tests deleted (2026-05-23):
  - [x] `managed-package-whitelist-parity.test.ts`, `installable-list.test.ts`, `no-installable-list-in-bridge.test.ts`, `bootstrap-install-resolve-npm.test.ts`, `install-managed-node.test.ts`, `bootstrap-install-cmd-shim.test.ts`.
  - [x] `packages/shared/src/__tests__/bootstrap/` directory recursively removed (in-memory resolution harness).
  - [x] Root `package.json` scripts `test:bootstrap` + `test:bootstrap:watch` removed.
  - [~] `managed-paths.test.ts` retained — verified its assertions cover non-bootstrap pure-helper code (Phase 7 may revisit when adding `legacy-managed-dir.ts`).
- [/] 3.9 `npx tsc --noEmit` server + shared side **green**. Electron side still references deleted modules (`installStandalone`, `installable-list`, `offline-packages`, `RecommendedExtension` from `bootstrap-install`-related code paths) — these cascade into Phase 5 deletions where the consumers themselves are removed/rewritten. `npm test` deferred until after Phase 5 lands.
- [ ] 3.10 Smoke verify (deferred until Phase 5 lands so the build can actually start):
  - [ ] `pi-dashboard start` works
  - [ ] `curl /api/bootstrap/status` returns 404
  - [ ] `curl /api/health` returns 200 with `launchSource: "standalone"` when started from CLI
  - [ ] `curl /api/pi-core/versions` returns 200 (pi-core retained)
  - [ ] Under an Electron build, `/api/health` returns `launchSource: "electron"` and the client renders no Core sub-group, no PiUpdateBadge
- [x] 3.11 **Bridge-register identity dedup (finding G from 2026-05-19 smoke).** Implemented (2026-05-25) in `packages/shared/src/bridge-register.ts`: new `readPackageName(dir)` helper reads `<dir>/package.json#name`; `registerBridgeExtension` computes new entry's identity, then filters out local entries with the same `name` (most-recently-asserted wins). Path-based stale cleanup retained for legacy entries without a readable package.json. `npm:`-scheme entries pass through untouched.
  - [x] Read each registered local path; resolve `path.join(p, "package.json").name`; treat entries with the same `name` as duplicates.
  - [x] Keep policy: the most-recently-asserted path wins (caller's intent). Older same-name local paths drop out.
  - [x] `npm:`-scheme entries remain untouched (no readable package.json to identity-check).
  - [x] Tests added in `bridge-register.test.ts`: identity-dedups across install layouts; preserves entries with different names; leaves npm:-scheme entries untouched. All 17 tests pass.

## 4. Resolver collapse (parallel with Phase 3 OK)

- [x] 4.1 No standalone `packages/server/src/resolve-client-dir.ts` exists; the resolver was always inline in `packages/server/src/server.ts`. Collapsed (2026-05-23) from a 5-strategy chain (npm-resolver → scoped-sibling → hoisted → monorepo → legacy) to a single npm-resolver-anchored strategy with a dev-monorepo sibling fallback when `require.resolve` misses.
- [x] 4.2 `packages/server/src/server.ts` static-file resolution simplified per 4.1 (2026-05-23). No separate `resolve-client-dir` module needed.
- [x] 4.3 `selectLaunchSource` collapsed from 5 strategies to 3 — `attach`, `devMonorepo` (ELECTRON_DEV / unpackaged only), `bundled` (2026-05-23). Deleted `probePiExtension`, `probeNpmGlobal`, `buildExtractedSource` (~400 LOC) plus their stash/install/merge dance. New helper `getBundledCliPath(resourcesPath)` returns the fixed `<resourcesPath>/server/node_modules/@blackbelt-technology/pi-dashboard-server/src/cli.ts` path. New `BundledServerMissingError` surfaces a corrupted-install signal when no source resolves. `parsePreferOverride` now accepts only `attach | bundled | devMonorepo`; pre-R3 kinds (`piExtension`, `npmGlobal`, `extracted`) are rejected with a warning. `LaunchSource`/`SourceKind` union narrowed in `packages/shared/src/launch-source-types.ts`.
- [x] 4.4 `packages/electron/src/lib/pick-node.ts` collapsed (2026-05-23) to `bundled | execpath-fallback` only. Deleted `isBundledNodeAffected`, `bundledNodeVersion` gating, `systemNode` input field, the nodejs/node#58515 skip logic. Fallback to `process.execPath` + `ELECTRON_RUN_AS_NODE=1` is now a corrupted-install signal, not a normal mode.
- [x] 4.5 `packages/electron/src/lib/bundle-extract.ts` deleted entirely (2026-05-23). The immutable bundle reads from `<resourcesPath>/server/` read-only; no extraction, no `migrateConfigs`, no `SURVIVE_EXTRACT_DIRS` whitelist. Test `bundle-extract.test.ts` + `launch-source-extract-stale-symlink.test.ts` deleted.
- [x] 4.6 Resolver tests rewritten (2026-05-23). `packages/electron/src/lib/__tests__/launch-source.test.ts` reduced to ~150 LOC covering attach + bundled + devMonorepo + parsePreferOverride. `packages/electron/src/lib/__tests__/pick-node.test.ts` rewritten for the two-branch shape. Deleted: `launch-source.smoke.test.ts`, `pick-node.test.ts` (root-of-tests version), `doctor-managed-node.test.ts`, `no-launch-source-extensions-field.test.ts`, `install-managed-node-bootstrap-order.test.ts`.

## 5. Electron-side deletions

- [x] 5.1 (2026-05-23) Orchestrator + lifecycle files deleted: `power-user-install.ts`. `main.ts` startup flow fully rewired (2026-05-23) to the 6-state machine: `checking-server-health` → `attach` | `wizard-welcome` (first-run only) → `launch-server` → `health-wait` → `done` | `loading-page-error`. `LAUNCH_SOURCE_V2` flag deleted; the legacy `ensureServer` + `decideStartupAction` + `runPowerUserManagedInstall` + `installStandalone` paths are gone. Wizard is currently degraded to **zero steps** (writes first-run marker silently) pending the Phase 6.1 wizard.html rewrite; this is the design-permitted “removed entirely” branch. `server-lifecycle.ts::ensureServer` rewritten as a thin `selectLaunchSource + spawnFromSource` shim so the loading-page “Start server” path keeps working. `launchViaCli`, `launchServer`, `findServerCli`, `checkVersionCompatibility`, `getExpectedVersion`, `readModeFile` import deleted. Tests `ensure-server-appimage-fallthrough.test.ts` + the structural-shape assertions in `server-lifecycle-spawn-options.test.ts` may need update under follow-up sweep.
- [x] 5.2 Deleted: `preflight-reconcile.ts`, `force-reinstall.ts` (2026-05-23).
- [x] 5.3 Deleted: `dependency-installer.ts`, `installable-catalog.ts`, `offline-packages.ts`, `wizard-badge.ts` (2026-05-23).
- [x] 5.4 Deleted: `resources/offline-packages/`, `resources/bundled-extensions/`, `scripts/bundle-offline-packages.{sh,mjs}`, `scripts/bundle-recommended-extensions.{sh,mjs}`, `offline-packages.json` (2026-05-23).
- [x] 5.5 `packages/electron/scripts/build-installer.sh` — `BUNDLE_OFFLINE_PACKAGES` env handling removed (2026-05-23). Arch-switch wipe no longer includes `resources/offline-packages`. `bundle-offline-packages.mjs` invocation deleted. Bundling pi/openspec/tsx is now unconditional via `bundle-server.mjs`'s regular `npm install`.
- [x] 5.6 `packages/electron/scripts/build-local.sh` — not present in the repository as of 2026-05-23. No action needed.
- [x] 5.7 `packages/electron/forge.config.ts` — `extraResource` already cleaned (no `offline-packages` or `bundled-extensions` entries; the relevant lines were dropped under Phase 5.4). Comment block added marking the deletion (2026-05-23).
- [x] 5.8 Pre-R3 IPC channels `dashboard:check-inventory`, `dashboard:reinstall-managed`, `dashboard:force-reinstall`, `dashboard:install-progress` are absent from the source tree as of 2026-05-23 (removed during Phase 5.2/5.3 module deletions). `main.ts` IPC registration during rewrite of 5.1 covers only `dashboard:request-launch`, `dashboard:read-server-log`, `dashboard:open-doctor`, `wizard:open-doctor`, and `wizard:complete`. The legacy install/detection wizard IPCs were collapsed via the slim `wizard-ipc.ts` rewrite (2026-05-23).
- [/] 5.9 `npm test` run (2026-05-23): **5894/5916 pass, 17 skipped, 5 failed**. Four of the five failures are pre-existing Phase 3 fallout (`cli-parse.test.ts > upgrade-pi` x2, `pi-changelog-routes.test.ts > returns 503 when bootstrap is not ready`, `honcho-plugin/llm-aggregate.test.ts` timeout) that the user explicitly deferred to the Phase 3.9 sweep. The fifth (`install-managed-node-bootstrap-order.test.ts`, `no-launch-source-extensions-field.test.ts`) referenced now-removed code paths and were deleted in this session. `tsc --noEmit` (root + electron workspace) is **green**.
- [ ] 5.10 Smoke: build `.dmg`, install on a clean VM, verify `~/.pi-dashboard/` is NOT created on first launch.

## 6. UI slimming

- [x] 6.1 Wizard collapse (Q2 = one welcome step). Completed 2026-05-25.
  - [x] `packages/electron/src/renderer/wizard.html` rewritten from 883 LOC → 179 LOC. Single welcome card: heading + lead paragraph + `[Launch dashboard]` CTA + `Advanced ▾` disclosure with remote-server probe (URL input → `[Test]` button → status pill + `[Use this server]` link on success). Remote probe is renderer-local (`fetch("/api/health")` with 4s AbortController timeout) — no IPC needed.
  - [x] `packages/electron/src/lib/wizard-window.ts` left as single-window factory (it was already collapsed in an earlier phase). No multi-step state machine remained.
  - [x] `packages/electron/src/lib/wizard-ipc.ts` already slim from Phase 5 work (only `wizard:complete` + `wizard:open-doctor`). Remote-test handled in renderer; no `wizard:test-remote-connection` IPC added (renderer-local fetch is simpler).
  - [x] First-run marker helper `getFirstRunMarkerPath()` already exists in `packages/shared/src/dashboard-paths.ts` returning `~/.pi/dashboard/first-run-done`. `main.ts::showWelcomeStep` now opens `openWizardWindow()` and waits for close; renderer calls `wizardApi.completeWizard()` (IPC → `writeFirstRunMarker`). Defensive fallback in main.ts writes the marker after window-close if absent.
- [x] 6.2 Loading page slim. Completed 2026-05-25.
  - [x] `packages/electron/resources/loading.html` already lean at 192 LOC — verified no force-reinstall / reinstall-managed / inventory / install-progress UI elements remain (regex sweep returned zero matches). Keeps `[Start server]`, `[Open Doctor]`, server-log tail, known-servers list.
  - [x] `packages/electron/src/lib/server-lifecycle.ts` install-progress orchestration already dropped under Phase 5.1 rewrite. Watchdog respawn + `decideShutdownOnQuit` retained.
- [x] 6.3 Doctor slim. Completed 2026-05-25.
  - [x] `packages/electron/src/lib/doctor.ts` — force-reinstall, audit panel, safe-wipe dialog already absent from earlier phases. Cleaned up dead `installable` block in `probeServer` (server no longer exposes `/api/health.installable` under R3). Added legacy-managed-dir advisory check (Phase 7.2).
  - [x] `packages/electron/src/renderer/doctor.html` — force-reinstall UI absent; advisory row renders via existing severity styling (warning section). No new component needed.
  - [x] `packages/electron/src/lib/doctor-bridge-contract.ts` — `doctor:force-reinstall` channel absent from `DOCTOR_IPC_CHANNELS` (already removed). Kept diagnostic channels.
  - [x] `packages/electron/src/preload/doctor-preload.ts` — force-reinstall bridge methods absent (already removed).

## 7. Migration handling (legacy `~/.pi-dashboard/`)

- [x] 7.1 Added `packages/shared/src/legacy-managed-dir.ts` (2026-05-25). Exports `detectLegacyManagedDir({ homedir? })` returning `{present:false}` or `{present:true, path, pkgCount, sizeMb}`. Uses split string literal `".pi-" + "dashboard"` to stay clean under the no-managed-dir lint. 5 unit tests in `legacy-managed-dir.test.ts` cover absent dir, file-not-dir, empty dir, pkgCount, sizeMb.
- [x] 7.2 Doctor advisory wired (2026-05-25). `runDoctorInner` in `packages/electron/src/lib/doctor.ts` imports `detectLegacyManagedDir` and pushes a warning-severity check titled "Legacy install directory" with message + suggestion text (`rm -rf <path>`). Section `diagnostics`. No new Doctor UI affordance needed — the advisory row renders via the existing severity styling. (Reveal-in-Finder button can be added in a follow-up if QA finds the text alone insufficient.)
- [x] 7.3 Server CLI one-time log added (2026-05-25). After the `[bootstrap] ready` line in `runForeground` (packages/server/src/cli.ts), the cli dynamically imports `detectLegacyManagedDir` and logs `[legacy] legacy install directory detected at <path> (<pkgCount> packages, ~<sizeMb> MB). No longer used — safe to delete.` when present. Writes to `~/.pi/dashboard/server.log` via the existing stdout pipe. Failures swallowed (`/* advisory only */`).
- [x] 7.4 Repo-lint test added at `packages/shared/src/__tests__/no-managed-dir-reference.test.ts` (2026-05-25). Walks `packages/electron/src/lib/`, `packages/server/src/`, `packages/shared/src/` (excluding `__tests__/`, `dist/`, etc.). Asserts every file containing the `\.pi-dashboard\b` literal is in an explicit allowlist with a one-line rationale. The allowlist documents three legitimate categories: (a) new `legacy-managed-dir.ts` detector, (b) standalone-arm-only pi-core update/checker writes (UI hidden on Electron per task 3.3), (c) read-only fallback probes (tool-registry strategies, binary-lookup, managed-paths) for standalone pi installs. **Migrated `packages/electron/src/lib/window-state.ts`** from `~/.pi-dashboard/window-state.json` to `~/.pi/dashboard/window-state.json` with one-shot move on first load; this fixed a genuine R3-violating Electron write found during lint authoring. `wizard-state.ts` allowlisted pending Phase 6.1 collapse.
- [ ] 7.5 Migration smoke test:
  - [ ] Create fake `~/.pi-dashboard/node_modules/foo` on a test machine
  - [ ] Install new `.app`
  - [ ] Launch — server uses bundled resources, legacy dir untouched
  - [ ] Doctor shows advisory row
  - [ ] Server log mentions legacy dir once
  - [ ] Delete legacy dir manually → next Doctor open hides advisory

## 8. Documentation rewrites (delegate every `docs/` write to subagent per AGENTS.md)

> **Includes reverting / updating `enable-standalone-npm-install`'s doc landings.**
> That change added a "Standalone npm install" section to `docs/service-bootstrap.md`, a FAQ entry in `docs/faq.md`, a CHANGELOG `## [Unreleased]` line claiming the dashboard "bootstraps pi + openspec into `~/.pi-dashboard/` on first run," and `docs/file-index-server.md` / `docs/file-index-shared.md` rows. All of those are wrong under R3 and need rewriting.

All Phase 8 docs work delegated to Explore subagent on 2026-05-25, completed in one pass. Subagent followed AGENTS.md caveman-style protocol verbatim.

- [x] 8.0 Reverted `enable-standalone-npm-install`'s incorrect doc landings: `service-bootstrap.md` standalone section rewritten under R3 (no bootstrapInstallFromList / 503), `faq.md` standalone-install entry rewritten, `CHANGELOG.md` `## [Unreleased]` bullet updated to credit R3 dep-lift + module deletions, `file-index-server.md` + `file-index-shared.md` rows for deleted bootstrap modules removed, `README.md` bootstrap-install mention rewritten.
- [x] 8.1 `docs/electron-bootstrap-flow.md` rewritten end-to-end: 6 states / 3 triggers / 3 end states, new Mermaid diagram, ~85 lines (was ~120).
- [x] 8.2 `docs/service-bootstrap.md` Chain 1 section rewritten for R3 launcher-only flow. ASCII diagram redrawn. "Standalone mode" section renamed to "Electron arm (immutable bundle)" with bundled-only layout.
- [x] 8.3 `docs/architecture.md` — Bootstrap & First Run + Post-install repair + Managed Node runtime + Legacy-pi-detection sections collapsed into single R3 section (immutable bundle, launchSource gate, legacy advisory). `/api/pi-core/update` literals neutralised. Bootstrap-resolution-harness section removed (harness deleted in Phase 3.8).
- [x] 8.4 `docs/file-index-electron.md` — rows removed for `bundle-extract.ts`, `dependency-installer.ts`, `offline-packages.{json,sh,ts}`, `wizard-badge.ts`, `bundle-offline-packages.sh`, `manifest.json`, `npm-cache.tar.gz`, `bundle-recommended-extensions.sh`, `installBundledExtensions`. Re-annotated `main.ts`, `launch-source.ts`, `pick-node.ts`, `server-lifecycle.ts`, `bundle-server.mjs`, `doctor.ts`. Added rows for `wizard.html` + `wizard-ipc.ts`.
- [x] 8.5 `docs/file-index-server.md` — removed `bootstrap-state.ts`, `bootstrap-queue.ts`, `bootstrap-routes.ts`, `legacy-pi-cleanup.ts` + its test. Re-annotated `server.ts`, `cli.ts`, `pi-version-skew.ts`. `docs/file-index-shared.md` — removed `bootstrap-install.ts`, `installable-list.ts`, `__tests__/bootstrap/`. Added rows for `legacy-managed-dir.ts` + two new tests. `docs/file-index-client.md` — removed `useBootstrapStatus.ts`, `BootstrapBanner.tsx`. Re-annotated `UnifiedPackagesSection.tsx` + `App.tsx` for `launchSource === "electron"` gate.
- [x] 8.6 New `docs/electron-immutable-bundle.md` written: invariant, path layout, electron-updater update path, legacy-dir advisory, regression rules.
- [x] 8.7 `AGENTS.md` Key Files section — removed rows for `bootstrap-install`, `bootstrap-state`, `bootstrap-queue`, `bootstrap-routes`, `bootstrap-install-from-list`, `installable-list`, `BootstrapBanner.tsx`, `useBootstrapStatus.ts`, bootstrap-test harness, `bundle-extract.ts`, `dependency-installer.ts`, `offline-packages.*`, `wizard-badge.ts`, `bundle-recommended-extensions.sh`. Re-annotated `main.ts`, `launch-source.ts`, `pick-node.ts`, `server-lifecycle.ts`, `pi-version-skew.ts`, `bundle-server.mjs`. Added `legacy-managed-dir.ts`. Removed `test:bootstrap*` from Commands block.
- [x] 8.8 `docs/file-index.md` splits table — no split files added or removed; row count changes are internal to existing splits, so the table is still accurate. Verified.
- [x] 8.9 `docs/qa-streamline-electron-bootstrap-and-recovery.md` does not exist in the repo. Skipped per task spec.
- [x] 8.10 Final sweep: `rg -i "(installable\.json|managed-package-whitelist|/api/pi-core/update|/api/bootstrap/|installStandalone|preflight-reconcile|force-reinstall|managed-workspace-materialize|BootstrapBanner|useBootstrapStatus)" docs/` returns zero matches (exit=1). Verified.

## 9. QA matrix + release

- [ ] 9.1 QA Linux x86_64 (Ubuntu via `qa/Makefile` Packer harness):
  - [ ] Clean install of `.deb`
  - [ ] Wizard welcome appears once
  - [ ] `[Launch dashboard]` → server up
  - [ ] Spawn pi session
  - [ ] Open pi session in browser at `http://localhost:8000`
  - [ ] Quit app → server shuts down (`DASHBOARD_STARTER=Electron`, `decideShutdownOnQuit`)
  - [ ] Relaunch app → no wizard (first-run marker present)
- [ ] 9.2 QA macOS arm64 (`.dmg`) — same checklist.
- [ ] 9.3 QA macOS x86_64 (`.dmg`) — same checklist.
- [ ] 9.4 QA Windows x86_64 (`.exe` NSIS) — same checklist.
- [ ] 9.5 QA Linux AppImage — same checklist; verify `/tmp/.mount_*` read-only paths work.
- [ ] 9.6 Electron-updater notification path:
  - [ ] Mock a new release in update-feed staging
  - [ ] Launch app → update notification appears
  - [ ] Accept update → whole-`.app` replaces → relaunch → new version active
- [ ] 9.7 Upgrade-path QA (every platform):
  - [ ] Install current released `.app` (with `~/.pi-dashboard/` populated)
  - [ ] Create pi sessions, install some pi extensions via `pi install`
  - [ ] Upgrade in place to new `.app` via electron-updater
  - [ ] Verify: `~/.pi-dashboard/` left alone; Doctor advisory row shown; new `.app` uses `resources/`; pi sessions still discoverable
- [ ] 9.8 Standalone arm regression — `npm i -g @blackbelt-technology/pi-dashboard@<new>`; `pi-dashboard start` works as before.
- [ ] 9.9 Bridge arm regression — `pi install <bridge>`; open pi session; bridge auto-starts server; no regression.
- [ ] 9.10 Docker arm regression — `docker-packaging` compose still builds and runs against the new server build.
- [ ] 9.11 Internal dogfood — run new `.app` internally for ≥1 week. Watch for crash reports, missing `/api/pi-core/update` complaints, surprise legacy-dir behaviors.
- [ ] 9.12 Cut release via `.pi/skills/release-cut/SKILL.md`:
  - [ ] Bump versions (minor bump recommended: 0.5 → 0.6)
  - [ ] Promote `## [Unreleased]` CHANGELOG entry to versioned section
  - [ ] Tag + push (CI publishes to npm + GitHub Releases)
- [ ] 9.13 Monitor first 48h post-release — issue tracker, telemetry, dashboard discord/forum if applicable.

## 9b. Post-implementation follow-ups (2026-05-25)

Work uncovered between d3fe2163 landing and the next QA dispatch. Tracked here because each item back-fills a gap left by the Phase 3 deletions / topology shift, but none of them warrant a standalone proposal.

- [x] 9b.1 `scripts/test-standalone-npm-install.sh` recreated (commit 72166780, 2026-05-25) at the post-bootstrap shape — see Phase 3.7 entry. Probes `/api/health` for `ok=true` with a 60s deadline (down from 240s; no async install to wait for).
- [x] 9b.2 `scripts/test-standalone-npm-install.ps1` rewired in the same commit; bootstrap-status polling loop removed; deadline 240s → 60s.
- [x] 9b.3 `.github/workflows/ci.yml` standalone-install-smoke-linux job re-enabled (was `if: false` while the harness was broken between d3fe2163 and 72166780). Vestigial TODO comment block removed.
- [x] 9b.4 `packages/shared/src/__tests__/no-direct-child-process.test.ts` allowlist amended (commit 19b31806) to cover `packages/server/src/recovery-server.ts`. The startup recovery HTTP server (introduced by commit e606e8b0 `feat(add-startup-recovery-server)`, 2026-05-24) deliberately imports `node:child_process` directly because importing the platform/exec wrapper would defeat the recovery flow (its transitive deps may be the very things that are missing). Same architectural-exception class as the already-allowlisted `packages/server/src/legacy-pi-cleanup.ts`. Surfaced by PR CI run 26406642427.
- [x] 9b.5 Plugin-registry portable import resolution (commit 0b10b7cf) — two-tier chain in `packages/dashboard-plugin-runtime/src/vite-plugin/index.ts`: tier 1 uses each plugin's package name (when `package.json#exports["."]` matches the manifest `client` entry); tier 2 falls back to a path relative to the generated `plugin-registry.tsx`. Both forms are checkout-agnostic, so the generated registry is portable across npm-install topologies — specifically across the dev workspace symlink, the bundled Electron `resources/server/node_modules/`, AND the `npm i -g` standalone install (the topology this proposal's standalone arm depends on). All 7 active plugins resolve via tier 1 today; tier 2 is the safety net. Companion: `scripts/generate-plugin-registry.mjs` CLI for off-Vite regeneration, and `packages/demo-plugin/package.json` gains `exports["."]` so the fixture exercises tier 1 too.
- [x] 9b.6 Cleanup of d3fe2163 residue (commit 45730a79) — stale workflow steps and TODO blocks pointing at deleted bootstrap scripts. Reference: see commit body.

## 10. Archive

- [ ] 10.1 `openspec validate eliminate-electron-runtime-install --strict` passes.
- [ ] 10.2 Run `.pi/skills/openspec-archive-change/SKILL.md` workflow.
- [ ] 10.3 Verify main specs updated:
  - [ ] `electron-bootstrap-flow` reflects 6-state machine
  - [ ] `electron-wizard` reflects one-step welcome
  - [ ] `dashboard-recovery` reflects slimmed loading-page
  - [ ] `bootstrap-preflight` removed from main specs
  - [ ] `loading-page-recovery` removed from main specs
  - [ ] `doctor-force-reinstall` removed from main specs
  - [ ] `installable-catalog` removed from main specs
  - [ ] `managed-package-whitelist` removed from main specs
  - [ ] `pi-core-update` removed from main specs
  - [ ] `build-local` removed from main specs
- [ ] 10.4 Move `openspec/changes/eliminate-electron-runtime-install/` → `openspec/changes/archive/<YYYY-MM-DD>-eliminate-electron-runtime-install/`.
- [ ] 10.5 Commit + push archive.
