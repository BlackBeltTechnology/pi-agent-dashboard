## Context

### How the server bundle is built today

`packages/electron/scripts/bundle-server.mjs` (full mode) runs these steps in order:

1. Copy each `BUNDLED_WORKSPACE_PKGS` tree to `resources/server/packages/<dir>`.
   - Strip vitest configs, `src/__tests__` and `*.tsbuildinfo`. This strip runs before the `--source-only` exit (`bundle-server.mjs:325-345`).
2. Install dependencies.
   - Floating mode: `npm install --omit=dev`.
   - `--release-lock`: `npm ci` plus `auditInstalledTree` (`bundle-server.mjs:753-797`).
   - Either way npm creates `node_modules/@blackbelt-technology/<pkg> -> ../../packages/<dir>` links.
   - The release-lock audit requires those links to realpath to `packages/<dir>` (`scripts/lib/release-lock.mjs:211-220,293-294,363-365`).
3. Prune `node_modules` (`bundle-server.mjs:528-546`).
   - Files: `*.md`, `*.map`, `CHANGELOG*`, `LICENSE*` (except `LICENSE.third-party.md`), `*.d.ts`.
   - Directories: `__tests__`, `test`.
   - The walker does not descend into the workspace symlinks, so first-party trees are never pruned.
   - Its directory match has no package-root guard (`classifyPruneEntry`, `:862`).
4. Materialize each workspace symlink as a full copy (`:548-595`).
5. Copy `pi-dashboard-web` (`:597-626`).

Other build paths:

- **Docker cross-build.** `docker-make.sh` runs `bundle-server.mjs --source-only` (`docker-make.sh:82`), then its own install, node-pty prebuild strip and materialization. It has no `node_modules` prune.
- **Native local Windows build.** `build-windows-zip.sh` runs `bundle-server.mjs` (full) in Step 2, then a second `npm install --omit=dev` plus a node-pty prebuild strip in Step 3 (`build-windows-zip.sh:128-151`).
- **CI.** CI builds Windows natively in `_electron-build.yml`.

### Measurement and cost model

The v0.11.0 numbers below come from the release asset `PI-Dashboard-win32-x64.zip`. Its central directory was read over HTTP range requests, so the numbers cannot be reproduced from the repo.

- Tree size: 42,298 files, about 1 GB.
- Applying this design's rules to that file list removes an estimated 11,611 files (27.5%), in five disjoint groups (breakdown under "Measurements"). The list is what actually shipped, so files today's prune already removes count zero. Each group is new removal.

Install cost is assumed to scale with file count: one NTFS create plus one Defender scan per file. This is an assumption, and D4 reports the measured effect.

### Who reads each copy of a workspace package

Readers of `node_modules/@blackbelt-technology/<pkg>`:

- Electron launch: `getBundledCliPath` and `getOverlayCliPath` (`packages/electron/src/lib/launch-source.ts:269-295`).
- Overlay compat: `overlayRequiredPaths` (`packages/shared/src/runtime-overlay/compat.ts:52-59`).
- Overlay `extensionPathFor` (`packages/electron/src/lib/runtime-overlay.ts:52`).
- Bundled plugins and the native TS loader.

Readers of `resources/server/packages/<dir>`:

- `extensionPathFor(BUNDLED)` (`runtime-overlay.ts:50`).
- `findBundledExtension` (`packages/electron/src/lib/bridge-register.ts:21-33`).
- `doctor.ts:342,352`.
- `start-server.{sh,ps1,cmd}` (`scripts/server-launch-helpers/`).
- `assert-bundled-server-plugin-load.mjs:69`.
- `test-server-launch.sh`, `test-electron-install.sh:42,87` and `test-deb-install-inner.sh`.
- `bundle-watch-paths.mjs`.
- `launch-source.test.ts:463-465`.
- `tests/e2e-electron/runtime-overlay-update.electron.spec.ts:232`.

A repo-wide grep also finds `packages/server` in about 20 `qa/tests/*` files. Most of them likely target a repo checkout rather than the bundle; task 2 classifies each one.

The plugin-load gate and the app boot the same content from different paths. Path-dependent failures can therefore hide in CI.

## Goals / Non-Goals

**Goals**

- **Success criterion: file count.** At least 25% fewer packaged files on win32-x64, matching the estimate above. Task 6 measures the reduction per rule group on a locally built bundle (prune helper dry-run) and in CI.
- Install time is the motivation, not the acceptance metric. Before/after timing is reported as directional evidence (D4).
- No runtime behaviour change. All existing built-bundle gates stay green.

**Non-Goals**

- An esbuild single-file bundle.
- Replacing `jimp`.
- First-launch archive extraction.
- NSIS compression tuning.
- Defender exclusions.
- Pruning `docs`/`examples` directories.
- Pruning first-party files other than the `AGENTS.md` sidecars and tests.
- Shrinking the runtime-overlay tarball. `scripts/build-runtime-asset.mjs` and `runtime-stager.ts` stage it with `npm ci` from the published lock, so it never passes through `bundle-server.mjs`. This is a possible follow-up.

## Decisions

### D1 — One shared prune helper, run last, with two rule sets

New module `scripts/lib/prune-bundle.mjs` exports `pruneBundle(serverDir, {rm?, log?})` (no platform/arch: no rule is platform-specific; `rm` is the injection point the failure test uses) and `dropWorkspaceCopies(serverDir)`. Its CLI is `prune-bundle.mjs [--finalize] <serverDir>`, where `--finalize` runs `dropWorkspaceCopies` then `pruneBundle`. It has three callers:

- `bundle-server.mjs` (full mode), after materialization and the `pi-dashboard-web` copy.
- `docker-make.sh` (`--finalize`), after its materialization.
- `build-windows-zip.sh` (native path) gets its tree from `bundle-server.mjs`. Its Step 3 `npm install` is removed (see D2). The node-pty prebuild strip stays in Step 3 unchanged.

**Placement in `bundle-server.mjs`.** The helper runs after materialization and the `pi-dashboard-web` copy, and before the keyring GO/NO-GO (`:657-681`). The keyring gate keeps its role ("proves what ships").

The node-pty prebuild strip is not moved. Its per-platform rules differ: the macOS universal build needs both darwin triples, and Docker Linux copies a built `pty.node` first. Moving it is a separate concern.

**Third-party rule set.** Applies to every package under `node_modules` except `@blackbelt-technology/*`.

- Remove files: today's set plus `*.d.mts` and `*.d.cts`.
- Remove directories: `__tests__`, `test` and `tests`.
- Keep `LICENSE.third-party.md`.
- Never remove a directory that contains a `package.json`. This guard protects package roots at any nesting depth, such as `node_modules/a/node_modules/test`.

**First-party rule set.** Applies to `node_modules/@blackbelt-technology/*` and `resources/plugins/<id>/`, which holds about 130 more sidecars.

- Remove only `AGENTS.md` and `*.AGENTS.md` outside any `.pi/` directory, plus `__tests__` directories.
- Never remove skills, `SKILL.md`, `commands/*.md`, `references/*.md`, `agents/*.md` or `LICENSE`/`UPSTREAM.md`. The extension reads these at runtime (`packages/extension/src/prompt-expander.ts:52`, `command-handler.ts:335`). The vendored browser skill also ships an Apache-2.0 `LICENSE` that must travel with it.
- `pi-dashboard-web` and `packages/dist` are never touched. The served client keeps its maps and licences. The client ships twice today, about 454 files per copy. Removing the duplicate is out of scope.

Third-party `LICENSE*` stripping (except `LICENSE.third-party.md`) is pre-existing behaviour, and this change does not alter it. Revisiting notice obligations is out of scope.

Not added: `docs`, `example` and `examples` directories. These names are too likely to be runtime assets (pi resolves `getDocsPath`/`getExamplesPath`), and the estimate above does not need them.

The `tests` addition is unverified as a non-runtime input. Task 3 statically greps third-party code for runtime reads of a `tests`/`test` path before the rule lands.

### D2 — The node_modules copy is canonical; drop `packages/<dir>` from the shipped tree

The app's launch path and every overlay path already use `node_modules/@blackbelt-technology/<pkg>`. Overlays have no `packages/` at all.

**Ordering is load-bearing.**

1. Install, including the release-lock `npm ci` + `auditInstalledTree`, which needs the `packages/<dir>` link targets.
2. Materialize the workspace links.
3. Delete `resources/server/packages/<dir>` for every `packages/*` child except `dist` (`dropWorkspaceCopies`; "every child but `dist`" gives the same layout from every builder and is what the layout gate asserts).
4. Remove the `workspaces` field from the synthetic `resources/server/package.json`. It was the input to the install that has already run. No shipped code reads it afterwards, and `ci-electron-on-demand-build`'s "resolved locally via `workspaces:`" applies to that install, which is unchanged.
5. Prune (D1).

**Same final layout from every builder.**

- `docker-make.sh` applies steps 3–5 after its own materialization.
- `build-windows-zip.sh` drops its Step 3 `npm install`. Run after deletion without workspaces, it would treat `@blackbelt-technology/*` as extraneous and remove them. Before this change it ran after materialization and may have re-linked workspace entries; that behaviour is unverified. `build-windows-zip.sh` is a local developer path, while CI uses `bundle-server.mjs` alone (`_electron-build.yml:393`), so the shipped artifacts follow the CI shape.

**Repointed readers.**

- `extensionPathFor(BUNDLED)` and `findBundledExtension` → `node_modules/@blackbelt-technology/pi-dashboard-extension`.
- `doctor.ts` → `node_modules/@blackbelt-technology/pi-dashboard-server/{src/cli.ts,package.json}`.
- The `start-server.*` helpers (and their README) → `node_modules/@blackbelt-technology/pi-dashboard-server/src/cli.ts`.
- `assert-bundled-server-plugin-load.mjs`, `test-server-launch.sh`, `test-electron-install.sh` and `test-deb-install-inner.sh` → the same paths.
- `packages/extension/src/server-launcher.ts:66-67`: its relative fallback `<extension>/src/../../server/src/cli.ts` is resolved to the `node_modules` layout too (task 2 greps relative `../../server` paths as well).
- `bundle-watch-paths.mjs` reads the source tree, so it needs no repoint.
- `launch-source.test.ts` and the e2e-electron overlay spec get the new expected path.
- `qa/tests/*` files that target a bundle are updated; files that target a checkout are left alone.

**Upgrade migration is already covered** (`minShellVersion` unchanged). At startup the shell calls `registerBundledBridgeExtension` (`packages/electron/src/main.ts:185,277,828`), which calls the shared `registerBridgeExtension` (`packages/shared/src/bridge-register.ts:160-189`). That function drops local entries whose `package.json#name` matches the incoming one. It also drops dashboard-named paths that no longer exist (normalized `pidashboard`). After the upgrade, the old `…/server/packages/extension` no longer exists and its path is dashboard-named, so it is removed and the new path is added. No new code is needed; task 4 pins this with a test.

**Known pre-existing edges (not changed here).**
- Name-identity dedup also drops a developer's checkout `packages/extension` registration whenever the bundled extension registers. That already happens today.
- A stale path in a renamed install folder without `pi-dashboard` in its name is not cleaned up.

**Rollback.** The reverted shell re-registers `packages/extension`. The `node_modules` path still exists in the reverted bundle, so `registerBridgeExtension` removes it by name-identity dedup.

**Alternatives considered.**

- **(a) Stub entry files under `packages/<dir>`.** Rejected. `packages/extension` must be a whole extension directory that pi can load, and stubs keep two boot entries.
- **(c) Junctions recreated at install time.** Rejected. The extra install step can fail silently, and the ZIP path would need its own fallback.

### D3 — File-count budget gate

New script: `scripts/assert-bundle-file-budget.mjs <resourcesDir> --platform <p> --arch <a>`.

- **Counting.** It counts regular files only, using `lstat` and never following symlinks. D4 uses the same predicate.
- **Scope.** The whole `resources/` directory is counted. The `node/` and win32 `git/` trees are part of the budget, and changes to them are the expected source of drift.
- **Budgets.** One budget per CI leg (`darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `win32-x64`, `win32-arm64`; the CI matrix has no universal leg), pinned to that leg's measured post-change count plus 5%. A leg with no pinned budget reports and exits 0. Task 5 measures on the change branch and pins every leg in the same change, so the merged gate enforces everywhere.
- **Placement.** It runs on every Electron leg, after packaging and after the existing GO/NO-GO gates.
- **Failure output.** Exit 1 and print the 20 directories with the most files.
- **Not gated.** The Docker cross-build is a local developer path and is not budget-gated.

### D4 — Windows install timing (informational, directional)

The existing win32-x64 NSIS smoke step (`_electron-build.yml:982`, x64 only) times `Setup.exe /S` with a `Stopwatch`.

It writes three values to the job summary:

- `install_seconds`;
- `installed_file_count`, using the D3 predicate over the install directory;
- the runner image name.

The step never fails the job. One sample per run on a shared runner gives a directional number, not proof.

## Risks / Trade-offs

- **A pruned file is read at runtime.** The boot gates only check plugin-load verdicts. Mitigations:
  - first-party trees get a minimal rule set;
  - the third-party additions (`*.d.mts`, `*.d.cts`, `tests`) get a static-grep check in task 3;
  - the package-root guard protects packages named like a pruned directory.
- **A `packages/<dir>` reader is missed.** Mitigations:
  - task 2 classifies every grep hit;
  - the built-bundle layout scenario asserts that no `packages/<dir>` other than `dist` remains;
  - the plugin-load gate boots the canonical entry.
- **Same-platform builds differ by build path.** The shared helper (prune, workspace deletion) runs on every builder. The node-pty prebuild strip stays per-path, as it is today.
- **The install-time gain is smaller than the file-count gain** if large binaries dominate (`node/node.exe` is about 114 MB). D4 reports the actual effect.

## Migration / Rollback

- There is no user-data migration. The bridge-extension path is reconciled by the existing `registerBridgeExtension` (D2).
- An NSIS upgrade replaces the install directory.
- Rollback is a revert. See the D2 rollback note.

## Reader inventory (task 2.1, resolves Q1)

Grep scope: `server/packages/`, `"server", "packages"`, `packages\\server|extension`, `../../server`, `packages/(server|extension|shared)` over `packages/*/src`, `packages/electron/scripts`, `qa/`, `tests/`, `docker/`, `scripts/`, `.github/`.

| Class | Hits | Action |
|---|---|---|
| **Bundle reader** (repointed) | `runtime-overlay.ts` `extensionPathFor(BUNDLED)`; `bridge-register.ts` `findBundledExtension`; `doctor.ts` server-code row; `start-server.{sh,ps1,cmd}` + README; `assert-bundled-server-plugin-load.mjs` (+ its test fixture); `test-deb-install-inner.sh`; `launch-source.test.ts`; `tests/e2e-electron/runtime-overlay-update.electron.spec.ts`; `packages/extension/src/server-launcher.ts` sibling fallback; `qa/tests/08-electron-real-launch.sh` (+ `qa-dist-only-scripts.test.mjs` needle) | node_modules path |
| **Source-only intermediate** (unchanged) | `test-server-launch.sh`, `test-electron-install.sh` build their image from `bundle-server.mjs --source-only`, where `packages/<dir>` is the ONLY copy (no install has run). The latter's final image already reads the node_modules path (`test-electron-install-inner.sh`). Both are exempted by name in the leftover-reader lint | none |
| **Checkout reader / dev-only** (unchanged) | `launch-source.ts` `probeDevMonorepo` + `getLocalCliPath`; `runtime-overlay.ts` local-link branches; `shared/runtime-overlay/compat.ts` `localRequiredPaths`; `bundle-watch-paths.mjs`; `scripts/*` (lock tooling); all of `qa/tests/{26,28,30,35,36,42,45,54,55}-*` (they run against a repo checkout via `PI_DASHBOARD_REPO` / `packages/server/bin/pi-dashboard.mjs`) | none |
| **Not a path read** | `packages/*/src/**/__tests__` fixtures that build `packages/server` temp trees; `.github/workflows` path filters; docs prose | none |

A **new** reader found while implementing: `qa/tests/08-electron-real-launch.sh` asserted that `packages/mcp-core` sits beside `packages/server` in an extracted bundle (task 4.10).

## Measurements

**v0.11.0 `PI-Dashboard-win32-x64.zip`** (central directory read over HTTP range): 42,298 files; `resources/` 42,226 = `server` 39,847, `node` 1,981, `git` 386.

Rule groups applied to that file list (disjoint):

| Files | Group |
|---|---|
| 2,511 | `server/packages/<dir>` copies (not `dist`) |
| 5,027 | third-party `*.d.mts`/`*.d.cts` |
| 2,483 | third-party `test`/`tests` directory files |
| 853 | first-party `__tests__` files (`resources/plugins/*`, `@blackbelt-technology/*`) |
| 737 | first-party `AGENTS.md`/`*.AGENTS.md` outside `.pi/` |
| **11,611** | **27.5% of 42,298 → 30,687 files (72.5% of baseline)** |

The first estimate (10,635, 25.1%) did not count the 853 first-party `__tests__` files (the proposal assumed the existing `src/__tests__` strip also covered plugins; it only covers `BUNDLED_WORKSPACE_PKGS` `src/__tests__`). The ≤75% target has ~2.5 points of margin.

**Task 2.2 — why v0.11.0 shipped ~7.5k third-party files.** The premise was wrong. The v0.11.0 zip already has zero third-party `*.d.ts`, `*.map`, `*.md`, `CHANGELOG*`, `LICENSE*` (today's prune works). The 7,510 are the two NEW rule groups: `*.d.mts`/`*.d.cts` (5,027) and `test`/`tests` directory files (2,483; today only `test` and `__tests__` match, so `tests/` such as `zod/src/v4/core/tests` survives). No walker defect.

**Local before/after, macOS arm64 host, `bundle-server.mjs` floating install, stub client** (no `node/`, `git/`, real client): `resources/server` 34,476 files / 412 MB (develop script) → 24,787 files / 335 MB (this change) = **−28.1%**. The prune removed 23,268 files across both rule sets, including those the old prune also removed. The built bundle booted via `assert-bundled-server-plugin-load.mjs` with all 25 server plugins loaded, and `assert-bundle-layout.mjs` passed.

**Task 3.3 — runtime reads of third-party `test`/`tests` paths.** Static scan of the installed tree (regex over `.js/.cjs/.mjs` outside test dirs for `require`/`import`/`from` of a `/tests?/` specifier and for `readFile*/existsSync/readdir*/statSync/createReadStream/require.resolve/path.join|resolve(...'tests?')`; plus `package.json` `main`/`module`/`bin`/`browser`/`exports`/`files` values naming a `tests?/` segment). 9 hits, none a runtime read: `asap` `browser` override map (`./test/domain.js`, browser-only and already removed by the existing `test` rule), `jake` `existsSync('./tests')` (project-relative task-runner lookup), and three comments/examples (`@jimp/core` JSDoc, `glob/common.js` comment, `fastify/examples`). Keep-list: empty.

**CI numbers (tasks 1.2, 5.4, 6.3)** — `ci-electron.yml` `workflow_dispatch`, packaged `resources/` regular files (the gate's predicate):

| Leg | develop baseline (throwaway `tmp-slim-baseline` = develop + timing step + budget report, run 41044824494 / 41048263275) | this change (run 41044784633 / 41048744854) | ratio | pinned budget (+5%) |
|---|---|---|---|---|
| win32-x64 | 38,045 | 28,368 | 74.6% (−25.4%) | 29,787 |
| darwin-x64 | 37,155 | 27,478 | 74.0% | 28,852 |
| darwin-arm64 | — | 27,478 | — | 28,852 |
| linux-x64 | — | 27,480 | — | 28,854 |
| linux-arm64 | — | 27,478 | — | 28,852 |
| win32-arm64 | — | 28,500 | — | 29,925 |

The ≤75% target for win32-x64 holds with 0.4 points of margin (below the 2.5-point margin the v0.11.0 list projected: develop already carries fewer files than v0.11.0 — 38,045 vs 42,226 — because it has since dropped weight elsewhere, so the same removals are a smaller share). Only win32-x64 and darwin-x64 baselines were measured; the other legs have no baseline because the criterion is win32-x64. Per-rule-group counts from the CI bundle step: `Pruned 23,255 file(s) (third-party 21,672, first-party 1,583)`; `Dropped 16 workspace copy dir(s)`.

**Install time (informational, win32-x64, `windows-latest` runner image `win25-vs2026 20261021.278.1`):** `install_seconds=172.3`, `installed_file_count=28,439` on this change. The develop baseline step's summary did not print (a `$LASTEXITCODE` `$null` bug in the first draft of the timing step ended the step early; fixed in the same change). Its wall clock from the log (`Running silent install` → `Install dir present`) was ≈257 s, on a different runner. One sample each: directional, not proof.

**NSIS upgrade (X4) and smoke (X5), win32-x64 CI:** the previous release's (v0.11.0) Setup.exe installed, the app started and registered `…\resources\server\packages\extension` itself on the runner (so the legacy state was real, not seeded); after the new Setup.exe ran over it the install tree held no `resources\server\packages\<dir>` other than `dist` and the app's registration was replaced by the node_modules path (`PASS: upgrade keeps exactly the node_modules bridge extension registered`). `windows-nsis-install`, `-no-permachine`, `-branding` and `-uninstall` all pass on the new layout. `/api/health` is not reachable on the runner (no desktop session), as before; the step treats it as informational.

## Open Questions

None. Q1 is resolved by the reader inventory above.
