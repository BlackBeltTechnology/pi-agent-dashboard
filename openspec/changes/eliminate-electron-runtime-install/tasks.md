# Tasks — eliminate-electron-runtime-install

Sequenced across 10 phases. Each phase produces a coherent commit / PR.
Phases 3 and 4 may interleave; all others are strictly ordered.

## 0. Scaffold & pre-decisions

- [x] 0.1 Confirm Q1 — `streamline-electron-bootstrap-and-recovery` (91/97) is archived as-is. Group 16 Failures 1–5 retained where landed; Failures 1 & 2 (workspace-materialize, managed-dir resolver) become vestigial under this change.
- [x] 0.2 Confirm Q2 — wizard collapses to **one welcome step** (not zero). Skip welcome on second+ launches via `~/.pi/dashboard/first-run-done` marker.
- [x] 0.3 Confirm Q3 — bridge arm gets the same treatment in a follow-up exploration. Out of scope for this change.
- [x] 0.4 Record Q1/Q2/Q3 ratifications in `design.md` "Decisions ratified" section.
- [x] 0.5 `openspec validate eliminate-electron-runtime-install` passes (proposal + design + tasks + 10 spec deltas).

## 1. Foundation spike — extend `bundle-server.mjs` (GO/NO-GO)

- [x] 1.1 Extend `packages/electron/scripts/bundle-server.mjs` to `npm install --production` `@earendil-works/pi-coding-agent`, `@fission-ai/openspec`, `tsx` into `resources/server/node_modules/` at build time, pinned by versions in `packages/electron/offline-packages.json` (kept as build-time pin source until Phase 5).
- [ ] 1.2 Build `.dmg` on macOS arm64. Record size delta vs `PI-Dashboard-darwin-x64-0.5.3.dmg` (225 MB baseline).
- [ ] 1.3 Build `.deb` on Linux x86_64. Record size delta.
- [ ] 1.4 Build `.exe` (NSIS) on Windows x86_64. Record size delta.
- [ ] 1.5 Build `.AppImage` on Linux x86_64. Record size delta.
- [ ] 1.6 Smoke test on each of macOS / Linux / Windows: install, launch, spawn pi session via process-manager, verify `pi` resolves to bundled copy (no `~/.pi-dashboard/` access).
- [ ] 1.7 Smoke test: server-side `openspec` invocations succeed.
- [ ] 1.8 Smoke test: server runs under `node` from `resources/node/bin/node` with `node_modules` from `resources/server/node_modules/`.
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

## 3. Server-side deletions (topological, leaf-first)

- [ ] 3.1 Delete client-side consumers FIRST so dead endpoints have no callers:
  - [ ] `packages/client/src/hooks/useBootstrapStatus.ts`
  - [ ] `packages/client/src/components/BootstrapBanner.tsx`
  - [ ] Remove `<BootstrapBanner>` mount from `MobileShell` / parent layout
  - [ ] `rg "/api/(pi-core|bootstrap)/" packages/client/` → remove all fetch sites
- [ ] 3.2 Delete server route files and unregister from `packages/server/src/server.ts`:
  - [ ] `packages/server/src/routes/pi-core-routes.ts`
  - [ ] `packages/server/src/routes/bootstrap-routes.ts`
- [ ] 3.3 Delete server service modules:
  - [ ] `packages/server/src/pi-core-updater.ts`
  - [ ] `packages/server/src/pi-core-checker.ts`
  - [ ] `packages/server/src/bootstrap-install-from-list.ts`
  - [ ] `packages/server/src/bootstrap-state.ts`
  - [ ] `packages/server/src/bootstrap-queue.ts`
- [ ] 3.4 Trim `packages/server/src/pi-version-skew.ts` to pure comparator. Drop the bootstrap-compatibility writer. Keep `comparePiVersions(a, b)` for standalone arm usage.
- [ ] 3.5 Delete shared support modules (verify zero `import` references in surviving code first):
  - [ ] `packages/shared/src/managed-workspace-materialize.ts`
  - [ ] `packages/shared/src/installable-list.ts`
  - [ ] `packages/shared/src/managed-package-whitelist.ts`
  - [ ] `packages/shared/src/recommended-extensions.ts`
- [ ] 3.6 Delete regression tests:
  - [ ] `packages/shared/src/__tests__/managed-package-whitelist-parity.test.ts`
  - [ ] Any test importing the deleted modules
- [ ] 3.7 Run `npm test`. Fix imports / mocks broken by deletions.
- [ ] 3.8 Smoke verify: `pi-dashboard start` works; `curl /api/pi-core/update` returns 404; `curl /api/health` returns 200.

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
