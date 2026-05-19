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
- [ ] 1.1.i **Bump `node-pty` from `^1.1.0` to `1.2.0-beta.13`** in `packages/server/package.json`. Required: `1.1.0` ships prebuilds only for `darwin-{arm64,x64}` + `win32-{arm64,x64}` (NO linux). Build-time `npm install` in `bundle-server.mjs` on linux runners would otherwise trigger `node-gyp rebuild` and fail without Python + C++ toolchain. **Already done** in branch (verified locally: `tar tzf ...node-pty-1.2.0-beta.13.tgz | grep prebuilds` shows all 6 triples). See design.md F1.
- [ ] 1.1.j Extend `scripts/verify-release-deps.mjs` (inherited from `enable-standalone-npm-install`, task 7.2) with `minVersion` rules for `@earendil-works/pi-coding-agent`, `@fission-ai/openspec`, and `tsx` once they are lifted to regular deps. Block release-cut if any of pi/openspec/tsx/node-pty/jiti regress below their pinned floor.
- [ ] 1.1.k Phase 1 GO/NO-GO threshold: explicitly assert prebuild presence for all four target platforms in `<bundle-root>/node_modules/node-pty/prebuilds/` after the build-time `npm install`. Required triples: `darwin-arm64`, `darwin-x64`, `linux-x64`, `win32-x64`. (`linux-arm64` + `win32-arm64` SHOULD also be present but are not blocking for v1.) Fail the build if any required triple is absent.
- [ ] 1.2 Build `.dmg` on macOS arm64. Record size delta vs `PI-Dashboard-darwin-x64-0.5.3.dmg` (225 MB baseline).
- [ ] 1.3 Build `.deb` on Linux x86_64. Record size delta.
- [ ] 1.4 Build `.exe` (NSIS) on Windows x86_64. Record size delta.
- [ ] 1.5 Build `.AppImage` on Linux x86_64. Record size delta.
- [ ] 1.6 Smoke test on each of macOS / Linux / Windows: install, launch, spawn pi session via process-manager, verify `pi` resolves to bundled copy (no `~/.pi-dashboard/` access). **Reference implementation**: `scripts/test-standalone-npm-install-docker.sh` + `scripts/lib/smoke-spawn-session.mjs` (inherited from `enable-standalone-npm-install` task 4.4). Port the WebSocket `spawn_session` step verbatim; swap `pi-dashboard start` for `open PI-Dashboard.app`. **NOTE**: curl from inside the test container/VM — `localhost-guard` returns 403 to docker-port-forwarded requests from the host. See design.md F3.
- [ ] 1.7 Smoke test: server-side `openspec` invocations succeed.
- [ ] 1.8 Smoke test: server runs under `node` from `resources/node/bin/node` with `node_modules` from `resources/server/node_modules/`.
- [ ] 1.8.a Verify `npm pack` patterns used in Phase 1 smokes work on the build host's `npm` version. **Known bad**: `npm pack -ws --include-workspace-root` exits with `ERR_OUT_OF_RANGE` on `npm@11.11.0` AFTER successfully producing tarballs. Workaround: loop over `find packages -maxdepth 2 -name package.json`, call `npm pack --workspace=<dir>` individually, filter `private: true`. See design.md F4.
- [ ] 1.9 Record spike findings in `design.md` "Spike results" section.
- [ ] 1.10 **GO/NO-GO checkpoint** — abort and reassess if any platform's size delta > 150 MB or pi cannot spawn from bundled location.

## 2. Cross-change coordination (parallel with Phase 1)

- [ ] 2.1 Archive `streamline-electron-bootstrap-and-recovery`. Cherry-pick Group 16 Failures 3/4/5 commits onto this change's branch if not already on `develop`. Write archive note documenting the 6 abandoned tasks.
- [ ] 2.2 Close `fix-stale-bundled-server-cache` (0/16) with supersede note pointing to this change.
- [ ] 2.3 Close `fix-electron-wizard-npm-root-enoent` (23/25) with supersede note. Salvage any standalone-arm fixes into this change's branch.
- [ ] 2.4 Re-scope `skip-affected-bundled-node` (12/17). Read remaining tasks; salvage standalone-arm-relevant work; close the rest.
- [ ] 2.5 Re-scope `fix-electron-server-launch-node-bin` (28/34). Salvage standalone-arm work; the bundled-node-only path simplifies the rest away.
- [ ] 2.6 Confirm `fix-build-installer-stale-server-bundle` (21/22) continues independently.
- [ ] 2.7 Confirm `docker-packaging` continues independently; note that this change reinforces it.
- [ ] 2.8 Confirm `npm-publish-first-party-extensions` (30/32) is unaffected.
- [ ] 2.9 Archive `enable-standalone-npm-install` with a supersede note pointing here. Its jiti direct-dep fix and `bin/pi-dashboard.mjs` error-message improvement are salvaged into Phase 1 tasks 1.1.c and 1.1.f. The bootstrap-from-empty-list machinery is no longer needed under R3 (regular-dep lift). Move `openspec/changes/enable-standalone-npm-install/` to `openspec/changes/archive/<YYYY-MM-DD>-enable-standalone-npm-install/` with an `ARCHIVED.md` explaining the supersedure.

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

- [ ] 3.0.a **Delete `runDegradedModeBootstrap()` and its call site in `runForeground`.** Inline the `if (initial.ok)` happy-path logging + the `updateBootstrapCompatibility` + `logCompatibilityWarning` calls into `runForeground` directly. Drop the `bootstrapInstall` import from cli.ts. The pi-resolved log line stays: `console.log("[bootstrap] ready (pi resolved via <source>)")`. If pi does NOT resolve, throw a hard error — under this architecture it means the bundled `node_modules/` is corrupted, not a bootstrap-state problem.
- [ ] 3.0.b Update the inline-block test (or add one) confirming `runForeground` no longer references `bootstrapInstall` or `bootstrapInstallFromList`, and that pi resolution failure raises (rather than degrading) the process.


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

- [ ] 3.1 Delete client-side bootstrap consumers FIRST so dead endpoints have no callers.
  - Files to delete entirely (purpose is `/api/bootstrap/*`):
    - [ ] `packages/client/src/hooks/useBootstrapStatus.ts`
    - [ ] `packages/client/src/components/BootstrapBanner.tsx`
    - [ ] `packages/client/src/components/__tests__/BootstrapBanner.test.tsx`
  - Files to edit:
    - [ ] `packages/client/src/App.tsx` — drop imports + mount of `BootstrapBanner`, `useBootstrapStatus`.
    - [ ] `packages/client/src/hooks/useMessageHandler.ts` — remove `bootstrap_status_update` + `bootstrap_ticket_complete` WS message branches and the matching `CustomEvent` dispatches. **Keep** the `pi_core_event` dispatch (pi-core update progress survives).
  - [ ] Verification: `rg -n '/api/bootstrap/' packages/client/src/` returns zero matches. `/api/pi-core/` references SHOULD still be found (pi-core UI survives).
- [ ] 3.2 Add `launchSource` field to `/api/health`. **Single source of truth for the Electron-hide gate.**
  - [ ] Server: extend the `/api/health` handler in `packages/server/src/routes/system-routes.ts` to return `launchSource: "electron" | "standalone" | "bridge"`. Detection rule (in priority order):
    - `process.env.DASHBOARD_STARTER === "Electron"` → `"electron"`
    - `process.env.DASHBOARD_STARTER === "Bridge"` → `"bridge"`
    - else → `"standalone"`
  - [ ] Shared types: extend `HealthResponse` in `packages/shared/src/rest-api.ts` with the new field.
  - [ ] Test: update `packages/server/src/__tests__/health-shape.test.ts` to cover all three values.
- [ ] 3.3 Client: hide pi-core UI under Electron.
  - [ ] Add `packages/client/src/hooks/useLaunchSource.ts` — thin hook calling `/api/health` once on mount, returning `launchSource`. Cache at module level (cannot change without server restart). Returns `null` while loading; consumers default to showing the UI (fail-open: pi-core stays visible if the probe is in-flight).
  - [ ] `packages/client/src/components/UnifiedPackagesSection.tsx` — gate the `Core` sub-group rendering (header + rows + `Update All` + `Check Now`-for-core) on `launchSource !== "electron"`. **Do not** strip imports or code paths; just gate JSX. `Recommended Extensions` + `Other Packages` continue to render in all arms.
  - [ ] `packages/client/src/App.tsx` — gate `<PiUpdateBadge />` mount on `launchSource !== "electron"`.
  - [ ] Update tests: `UnifiedPackagesSection.test.tsx`, `UnifiedPackagesSection.auto-check.test.tsx`, `PiUpdateBadge.test.tsx`, `WhatsNewDialog.test.tsx` — add Electron-hidden assertions. Existing standalone-arm assertions stay.
- [ ] 3.4 Delete server bootstrap route file and unregister from `packages/server/src/server.ts`:
  - [ ] `packages/server/src/routes/bootstrap-routes.ts`
  - [ ] `packages/server/src/__tests__/bootstrap-routes.test.ts`
  - [ ] In `packages/server/src/server.ts`: drop the `registerBootstrapRoutes` call and the `bootstrapState` argument plumbed to `registerPiCoreRoutes` (the `bootstrapGate` `preHandler` disappears with it; pi-core endpoints become unconditionally available).
- [ ] 3.5 Delete server bootstrap service modules (pi-core checker/updater + changelog-parser **survive**):
  - [ ] `packages/server/src/bootstrap-install-from-list.ts`
  - [ ] `packages/server/src/bootstrap-state.ts`
  - [ ] `packages/server/src/bootstrap-queue.ts`
  - [ ] Matching tests:
    - [ ] `packages/server/src/__tests__/bootstrap-state.test.ts`
    - [ ] `packages/server/src/__tests__/bootstrap-queue.test.ts`
    - [ ] `packages/server/src/__tests__/bootstrap-install-from-list.test.ts`
    - [ ] `packages/server/src/__tests__/cli-bootstrap.test.ts`
  - [ ] Update `pi-core-routes.ts` `PiCoreRouteDeps`: drop the optional `bootstrapState` field and the gate `preHandler`.
- [ ] 3.6 Trim `packages/server/src/pi-version-skew.ts` to pure comparator. Drop the bootstrap-compatibility writer. Keep `comparePiVersions(a, b)` for standalone arm usage. Update `packages/server/src/__tests__/pi-version-skew.test.ts` to cover only the comparator.
- [ ] 3.7 Delete shared support modules (verify zero `import` references in surviving code first):
  - [ ] `packages/shared/src/managed-workspace-materialize.ts`
  - [ ] `packages/shared/src/installable-list.ts`
  - [ ] `packages/shared/src/managed-package-whitelist.ts`
  - [ ] `packages/shared/src/recommended-extensions.ts`
  - [ ] `packages/shared/src/bootstrap-install.ts` (the `~/.pi-dashboard/` installer; bundled-runtime replaces it)
- [ ] 3.8 Delete regression tests:
  - [ ] `packages/shared/src/__tests__/managed-package-whitelist-parity.test.ts`
  - [ ] `packages/shared/src/__tests__/installable-list.test.ts`
  - [ ] `packages/shared/src/__tests__/no-installable-list-in-bridge.test.ts`
  - [ ] `packages/shared/src/__tests__/bootstrap-install-resolve-npm.test.ts`
  - [ ] `packages/shared/src/__tests__/install-managed-node.test.ts`
  - [ ] `packages/shared/src/__tests__/managed-paths.test.ts` (verify all assertions concern managed-dir paths; if any cover non-managed code keep them)
  - [ ] `packages/shared/src/__tests__/bootstrap/` (entire directory — the in-memory bootstrap resolution harness)
  - [ ] `package.json` scripts `test:bootstrap` + `test:bootstrap:watch` (and any vitest config referencing the bootstrap harness)
  - [ ] Any other test importing the deleted modules (sweep with `rg -l '(managed-workspace-materialize|installable-list|managed-package-whitelist|recommended-extensions|bootstrap-install|bootstrap-state|bootstrap-queue|bootstrap-install-from-list|useBootstrapStatus|BootstrapBanner)' packages/`)
- [ ] 3.9 Run `npm test`. Fix imports / mocks broken by deletions.
- [ ] 3.10 Smoke verify:
  - [ ] `pi-dashboard start` works
  - [ ] `curl /api/bootstrap/status` returns 404
  - [ ] `curl /api/health` returns 200 with `launchSource: "standalone"` when started from CLI
  - [ ] `curl /api/pi-core/versions` returns 200 (pi-core retained)
  - [ ] Under an Electron build, `/api/health` returns `launchSource: "electron"` and the client renders no Core sub-group, no PiUpdateBadge
- [ ] 3.11 **Bridge-register identity dedup (finding G from 2026-05-19 smoke).** Today `packages/shared/src/bridge-register.ts` dedupes by **literal path string**, not package identity. Each install layout (dev workspace / Electron .app / npm-global / `~/.pi-dashboard/`) registers as a distinct entry; cleanup removes only dashboard-named entries whose directory is gone. In mixed environments (user has Electron + npm-global + dev), the same `@blackbelt-technology/pi-dashboard-extension` is registered N times → pi loads bridge Nx per session. Even after this change collapses Electron's path count to 1, the cross-arm accumulation persists.
  - [ ] Read each registered local path; resolve `path.join(p, "package.json").name`; treat entries with the same `name` as duplicates.
  - [ ] Keep policy: the most-recently-asserted path wins (caller's intent). Older same-name local paths drop out.
  - [ ] `npm:`-scheme entries remain untouched (no readable package.json to identity-check).
  - [ ] Add test: register dev path then bundle path then standalone path → final array contains only the last one (when all three have the same `name`).
  - [ ] Add test: register two different extension packages → both preserved.

## 4. Resolver collapse (parallel with Phase 3 OK)

- [ ] 4.1 `packages/server/src/resolve-client-dir.ts` — 6 strategies → 1. Keep ELECTRON_DEV / dev-monorepo branch gated on env. Update tests.
- [ ] 4.2 `packages/server/src/server.ts` — simplify the static-file resolution chain to call the new single-strategy resolver.
- [ ] 4.3 `packages/electron/src/lib/launch-source.ts::selectLaunchSource` — 5 strategies → 2 (`attach`, `bundled`). Delete `npmGlobal`, `piExtension`, `extracted` source paths. `devMonorepo` gated by `ELECTRON_DEV`. Update `parsePreferOverride` accordingly.
- [ ] 4.4 `packages/electron/src/lib/pick-node.ts` — always return bundled node path. Delete `pickNodeForServer` system-vs-bundled logic.
- [ ] 4.5 `packages/electron/src/lib/bundle-extract.ts` — drop `migrateConfigs`, drop the `SURVIVE_EXTRACT_DIRS` whitelist for `node-pending/` and `node-old/`. Keep only what's needed to land bundled resources read-only (or delete the module entirely if extraction-then-mutate is no longer required — verify on each platform).
- [ ] 4.6 Update resolver tests; remove tests for deleted strategies.

## 5. Electron-side deletions

- [ ] 5.1 Delete the orchestrator first (breaks all callers cleanly):
  - [ ] `packages/electron/src/lib/power-user-install.ts`
  - [ ] Rewire `packages/electron/src/main.ts` startup flow: `checking-server-health` → `attach` OR `wizard-welcome` (first run only) → `launch-server` → `health-wait` → `done` | `loading-page-error`
- [ ] 5.2 Delete preflight + force-reinstall:
  - [ ] `packages/electron/src/lib/preflight-reconcile.ts`
  - [ ] `packages/electron/src/lib/force-reinstall.ts`
- [ ] 5.3 Delete installer + catalog + offline-cache helpers:
  - [ ] `packages/electron/src/lib/dependency-installer.ts`
  - [ ] `packages/electron/src/lib/installable-catalog.ts`
  - [ ] `packages/electron/src/lib/offline-packages.ts`
  - [ ] `packages/electron/src/lib/wizard-badge.ts`
- [ ] 5.4 Delete offline-cache resources and build scripts:
  - [ ] `packages/electron/resources/offline-packages/` (directory)
  - [ ] `packages/electron/scripts/bundle-offline-packages.sh`
  - [ ] `packages/electron/scripts/bundle-recommended-extensions.sh`
  - [ ] `packages/electron/offline-packages.json` (pin source migrated into `bundle-server.mjs` constant in 1.1, then file removed here)
- [ ] 5.5 `packages/electron/scripts/build-installer.sh` — remove `BUNDLE_OFFLINE_PACKAGES` env handling. Bundling is now unconditional.
- [ ] 5.6 `packages/electron/scripts/build-local.sh` — collapse to thin wrapper around `electron-forge make`, or delete if `npm run make` suffices.
- [ ] 5.7 Update `packages/electron/forge.config.ts` — drop offline-cache resource inclusion from `extraResource` arrays.
- [ ] 5.8 Delete the `dashboard:check-inventory`, `dashboard:reinstall-managed`, `dashboard:force-reinstall`, `dashboard:install-progress` IPC handlers in `packages/electron/src/main.ts`.
- [ ] 5.9 Run `npm test` in electron workspace. Fix breakage.
- [ ] 5.10 Smoke: build `.dmg`, install on a clean VM, verify `~/.pi-dashboard/` is NOT created on first launch.

## 6. UI slimming

- [ ] 6.1 Wizard collapse (Q2 = one welcome step):
  - [ ] `packages/electron/src/renderer/wizard.html` — reduce from ~620 LOC to ~100 LOC. Welcome message + `[Launch dashboard]` CTA + `Advanced ▾` disclosure containing "Connect to existing server: [URL] [Test]" remote-mode pattern from `docker-packaging`.
  - [ ] `packages/electron/src/lib/wizard-window.ts` — drop multi-step state machine. Single window, single IPC channel (`wizard:launch` + `wizard:connect-remote`).
  - [ ] `packages/electron/src/lib/wizard-ipc.ts` — delete install IPCs. Keep `wizard:test-remote-connection`.
  - [ ] First-run marker — create helper `packages/shared/src/dashboard-paths.ts::getFirstRunMarkerPath()` returning `~/.pi/dashboard/first-run-done`. Wizard writes it on completion. `main.ts` skips wizard when present.
- [ ] 6.2 Loading page slim:
  - [ ] `packages/electron/src/renderer/loading.html` — remove `[Reinstall managed packages]`, `[Force reinstall]`, Advanced disclosure, inventory diagnostic, install-progress streaming. Keep: `[Start server]`, `[Open Doctor]`, server-log tail, known-servers list.
  - [ ] `packages/electron/src/lib/server-lifecycle.ts` — drop install-progress orchestration. Keep watchdog respawn + `decideShutdownOnQuit`.
- [ ] 6.3 Doctor slim:
  - [ ] `packages/electron/src/lib/doctor.ts` + `doctor-window.ts` — remove force-reinstall section, audit panel, safe-wipe dialog. Keep all read-only diagnostics.
  - [ ] `packages/electron/src/renderer/doctor.html` — remove force-reinstall UI. Add advisory row component for Phase 7.
  - [ ] `packages/electron/src/lib/doctor-bridge-contract.ts` — remove `doctor:force-reinstall` channel from `DOCTOR_IPC_CHANNELS`. Keep diagnostic channels.
  - [ ] `packages/electron/src/preload/doctor-preload.ts` — drop force-reinstall bridge methods.

## 7. Migration handling (legacy `~/.pi-dashboard/`)

- [ ] 7.1 Add `packages/shared/src/legacy-managed-dir.ts`:
  ```ts
  export function detectLegacyManagedDir():
    | { present: false }
    | { present: true; path: string; pkgCount: number; sizeMb: number };
  ```
- [ ] 7.2 Wire Doctor advisory row consuming this. Renders "Legacy install directory detected at `~/.pi-dashboard/` — no longer used. Safe to delete manually." with a "Reveal in Finder/Explorer" button.
- [ ] 7.3 Add one-time server-startup log line in `packages/server/src/cli.ts` if legacy dir present, written to `~/.pi/dashboard/server.log` via `getDashboardServerLogPath`.
- [ ] 7.4 Verify no code path under `packages/server/`, `packages/shared/`, `packages/electron/src/lib/` reads from or writes to `~/.pi-dashboard/`. Add a repo-lint test (`packages/shared/src/__tests__/no-managed-dir-reference.test.ts`) that fails on any string-literal `.pi-dashboard` outside `legacy-managed-dir.ts`.
- [ ] 7.5 Migration smoke test:
  - [ ] Create fake `~/.pi-dashboard/node_modules/foo` on a test machine
  - [ ] Install new `.app`
  - [ ] Launch — server uses bundled resources, legacy dir untouched
  - [ ] Doctor shows advisory row
  - [ ] Server log mentions legacy dir once
  - [ ] Delete legacy dir manually → next Doctor open hides advisory

## 8. Documentation rewrites (delegate every `docs/` write to subagent per AGENTS.md)

- [ ] 8.1 Rewrite `docs/electron-bootstrap-flow.md` — state machine 12→6 states, 7→3 triggers, 10→3 end states. Update Mermaid diagram.
- [ ] 8.2 Rewrite `docs/service-bootstrap.md` Chain 1 section — drop `installable.json`, preflight, silent-install language. Replace with "Electron is a launcher; runtime install eliminated."
- [ ] 8.3 Update `docs/architecture.md` Electron-bootstrap subsection.
- [ ] 8.4 Update `docs/file-index-electron.md` — delete rows for removed files; re-annotate rows for simplified files.
- [ ] 8.5 Update `docs/file-index-server.md`, `docs/file-index-shared.md`, `docs/file-index-client.md` — same.
- [ ] 8.6 Write new `docs/electron-immutable-bundle.md` (≤200 lines, caveman style) — short doc explaining immutability invariant and update path.
- [ ] 8.7 Update `AGENTS.md` "Key Files" section — remove rows for deleted files (≤200 char per row). Add backbone rows for new files (`legacy-managed-dir.ts`).
- [ ] 8.8 Update `docs/file-index.md` splits table if any split's row count changed materially.
- [ ] 8.9 Update `docs/qa-streamline-electron-bootstrap-and-recovery.md` — mark obsolete, point to this change's QA artifact.
- [ ] 8.10 Verify `rg -i "(installable\.json|managed-package-whitelist|/api/pi-core/update|/api/bootstrap/|installStandalone|preflight-reconcile|force-reinstall|managed-workspace-materialize|BootstrapBanner|useBootstrapStatus)" docs/` returns zero matches.

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
