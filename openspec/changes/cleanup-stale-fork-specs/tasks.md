## 1. Pin the rewritten node-spawn contract (L1)

- [ ] 1.1 Assert the jiti/tsx arm of the entry-wrap rule: input jiti loader `C:\u\node_modules\jiti\lib\jiti-register.mjs` and tsx loader `/x/tsx/dist/esm/index.mjs` with entry `C:\srv\cli.ts`, platform win32/linux/darwin · trigger `buildNodeImportArgvParts` · observable argv[2] is the raw entry for all 6 combos and argv[1] starts with `file:///`. Verify the existing assertions in `packages/shared/src/__tests__/node-spawn.test.ts` cover every combo, add the missing ones (harness exemplar: the `buildNodeImportArgvParts` describe in that file), and the file passes (test-plan #E1)
- [ ] 1.2 Assert the other-loader arm: input loader `C:\x\loader.mjs` and entry `C:\srv\cli.ts` · trigger `buildNodeImportArgvParts` with platform win32 then linux · observable win32 argv[2] is `file:///C:/srv/cli.ts` and linux argv[2] is `C:\srv\cli.ts`. Add to `packages/shared/src/__tests__/node-spawn.test.ts` if missing (exemplar: the "tsx loader: entry RAW on any platform" case) and verify it passes (test-plan #E2)
- [ ] 1.3 Assert loader identity: input a tsx path, a jiti URL and `/usr/bin/node-loader.mjs` · trigger `isTsxLoader` / `isJitiLoader` · observable (true,false), (false,true), (false,false). Extend `packages/shared/src/__tests__/node-spawn-jiti-contract.test.ts` (exemplar: its `isJitiLoader` assertion) and verify it passes (test-plan #E3)
- [ ] 1.4 Assert toFileUrl boundaries: input `file:///C:/foo.ts`, `B:\Dev\cli.ts`, `B:/Dev/cli.ts`, `/usr/local/bin/cli.js` · trigger `toFileUrl` on a POSIX host · observable unchanged, `file:///B:/Dev/cli.ts` twice, `file:///usr/local/bin/cli.js`. Verify or add these in `packages/shared/src/__tests__/node-spawn.test.ts` (exemplar: its existing `toFileUrl` cases) and verify it passes (test-plan #E4)
- [ ] 1.5 Assert spawnNodeScript delegates: input `spawnNodeScript({ loader, entry, args })` with the exec layer stubbed · trigger spawn · observable the stub's argv equals `buildNodeImportArgvParts({ loader, entry, args })`. Verify or add in `packages/shared/src/__tests__/node-spawn.test.ts` (exemplar: its existing `spawnNodeScript` stubbing) and verify it passes (test-plan #E5)
- [ ] 1.6 Assert the JITI VERSION CONTRACT comment: input the source of `packages/shared/src/platform/node-spawn.ts` · trigger read · observable it contains `JITI VERSION CONTRACT`, a breakage marker and remediation guidance, and the test reads no `offline-packages.json`. Verify `packages/shared/src/__tests__/node-spawn-jiti-contract.test.ts` already pins this and passes (test-plan #E6)

## 2. Pin the raw-node-import lint (L1)

- [ ] 2.1 Make the scanner callable on a fixture (test-only refactor) and assert a staged violation: input temp file `spawn(process.execPath, ["--import", loader, rawPath])` · trigger run the scanner on it · observable one violation naming the fixture file and line 1. Change `packages/shared/src/__tests__/no-raw-node-import.test.ts` (exemplar: its existing real-tree `it`) and verify it passes (test-plan #E7)
- [ ] 2.2 Assert the exemptions: input the `ALLOWLIST` constant and the real `packages/*/src` tree · trigger lint run · observable `ALLOWLIST` equals exactly node-spawn.ts and server-launcher.ts, with 0 violations. Verify or add in `packages/shared/src/__tests__/no-raw-node-import.test.ts` and verify it passes (test-plan #E8)
- [ ] 2.3 Assert the opt-out marker scope: input `packages/{extension,server,electron}/src/**` excluding `__tests__` · trigger scan for `ban:raw-node-import-ok` · observable exactly one hit, `packages/server/src/attachments/fit-worker-pool.ts`. Add to `packages/shared/src/__tests__/no-raw-node-import.test.ts` (exemplar: the tree walk in that file) and verify it passes (test-plan #E9)

## 3. Pin bundle, launch and build contracts (L1)

- [ ] 3.1 Assert pi runtime declarations: input `packages/server/package.json` and the `bundle-server.mjs` source · trigger parse · observable:
  - server deps include `@earendil-works/pi-coding-agent`, `@fission-ai/openspec` and `tsx`, and no `@mariozechner/pi-coding-agent`;
  - `bundlePkg` has `workspaces` and no `dependencies`;
  - `BUNDLED_WORKSPACE_PKGS` = server, shared, extension, dashboard-plugin-runtime.

  Add to a new `packages/shared/src/__tests__/bundle-runtime-contract.test.ts`; keep `publish-workflow-contract.test.ts` to its two pinned invariants (exemplar: `publish-workflow-contract.test.ts` static source reads) and verify it passes (test-plan #E10)
- [ ] 3.2 Assert NSIS installs resolve to bundled: input probes with no attach/localLink/overlay and `resourcesPath` `D:\MyApps\PI Dashboard\resources`, then `%LOCALAPPDATA%\Programs\PI Dashboard\resources`, with the bundled cli.ts present · trigger `selectLaunchSource` · observable `{ kind: "bundled", cliPath: <resourcesPath>/server/node_modules/@blackbelt-technology/pi-dashboard-server/src/cli.ts }` for both. Add to `packages/electron/src/lib/__tests__/launch-source.test.ts` (exemplar: its injected-probe cases) and verify it passes (test-plan #E11)
- [ ] 3.3 Assert no hardcoded NSIS install path: input `packages/{electron,server,shared}/src/**/*.ts` excluding `__tests__` · trigger scan non-comment lines for `Programs\PI Dashboard` · observable 0 hits. Add a repo-lint test (exemplar: `packages/shared/src/__tests__/no-hardcoded-bundled-git-paths.test.ts`) and verify it passes (test-plan #E12)
- [ ] 3.4 Assert local-builder arch-cache invalidation: input the `packages/electron/scripts/build-installer.sh` source · trigger read · observable:
  - it wipes `resources/node` and `resources/server`;
  - it contains no `offline-packages`;
  - x64 cross builds run `bundle-server.mjs` under `arch -x86_64`.

  Add to `packages/shared/src/__tests__/bundle-runtime-contract.test.ts` (exemplar: `publish-workflow-contract.test.ts` static source reads) and verify it passes (test-plan #E13)
- [ ] 3.5 Assert Electron launches through the shared primitive: input no discovered server and a resolved `bundled` LaunchSource · trigger `spawnFromSource` · observable `launchDashboardServer` is called with `cliPath: source.cliPath`, and no tsx binary is resolved or spawned. Verify or add in `packages/electron/src/__tests__/server-lifecycle-spawn-options.test.ts` (exemplar: its existing spawn-option cases) and verify it passes (test-plan #E14)
- [ ] 3.6 Assert the Doctor row set: input a Doctor run with all probes stubbed ok · trigger build report · observable no row named or messaged "offline packages", and a "TypeScript loader" row is present. Verify or add in `packages/electron/src/__tests__/doctor.test.ts` (exemplar: its stubbed-probe report cases) and verify it passes (test-plan #E15)
- [ ] 3.7 Assert the `pi-dashboard start` call shape: input `cmdStart` with `launchDashboardServer` stubbed · trigger `start` · observable the stub is called with `cliPath`, `extraArgs`, `stdio.logFile`, `healthTimeoutMs: 30000`, `starter: "Standalone"`, `port`, and no `env` key. Verify or add in `packages/server/src/__tests__/cli-env-no-clobber.test.ts` (exemplar: that file) and verify it passes (test-plan #E16)
- [ ] 3.8 Assert the restart orchestrator env: input `NODE_OPTIONS="--max-old-space-size=1024"` and config `serverHeap.maxOldSpaceMb = 4096` · trigger `spawnRestart` with spawn stubbed · observable the spawn env equals `buildRestartEnv(process.env, 4096)`, with `--max-old-space-size=4096` in `NODE_OPTIONS`. Verify or add in `packages/server/src/__tests__/restart-helper.test.ts` (exemplar: its existing `buildRestartEnv` cases) and verify it passes (test-plan #E17)

## 4. Pin startup and CLI failure paths (L1)

- [ ] 4.1 Assert the CLI wrapper jiti miss: input the wrapper in a temp dir with no resolvable jiti · trigger `node pi-dashboard.mjs start` · observable:
  - exit 1;
  - stderr begins `pi-dashboard: cannot find jiti.` and contains `corrupted` and `npm install -g @blackbelt-technology/pi-agent-dashboard`;
  - no tsx resolution is attempted.

  Verify or add in `packages/server/src/__tests__/pi-dashboard-bin-wrapper.test.ts` (exemplar: its "exits 1 with install-hint" case) and verify it passes (test-plan #X1)
- [ ] 4.2 Assert the metadata short-circuit: input the same jiti-less install with sibling `package.json` version `9.9.9` · trigger `node pi-dashboard.mjs --version` · observable exit 0 with stdout `9.9.9`. Verify `packages/server/src/__tests__/cli-version.test.ts` case (a) covers it and passes (test-plan #X2)
- [ ] 4.3 Assert startup fails hard: input registry `resolve("pi")` → `{ ok: false, tried: [a, b] }` · trigger `runForeground` past `createServer` · observable rejection containing `corrupted node_modules/ tree` and `a, b`, with no install function invoked. Verify `packages/server/src/__tests__/cli-no-bootstrap-references.test.ts` ("throws hard on pi resolution failure") pins the message and strategies list, add assertions if not, and verify it passes (test-plan #X3)
- [ ] 4.4 Assert the startup ready log: input registry `resolve("pi")` → `{ ok: true, source: "bundled" }` · trigger `runForeground` · observable stdout contains `[bootstrap] ready (pi resolved via bundled)`. Verify the "[bootstrap] ready" case in `packages/server/src/__tests__/cli-no-bootstrap-references.test.ts` and verify it passes (test-plan #X4)
- [ ] 4.5 Assert the removed bundled-extensions step stays gone: input `.github/workflows/_electron-build.yml` and `publish.yml` · trigger read · observable no `bundle-recommended-extensions` or `bundle-server.sh` reference, and server bundling runs `bundle-server.mjs`. Add to `packages/shared/src/__tests__/bundle-runtime-contract.test.ts` (exemplar: `publish-workflow-contract.test.ts` workflow-step reads) and verify it passes (test-plan #X5)

## 5. Validate the spec change

- [ ] 5.1 Run `node_modules/.bin/openspec validate cleanup-stale-fork-specs --strict` and verify it passes. Use the local binary: the global `openspec` shim resolves into the app bundle and fails on missing templates.
- [ ] 5.2 Confirm the REMOVED code is gone. Run `rg` over `packages/` for: `installStandalone`, `resolveTsLoader`, `installRecommendedExtensions`, `installDashboardGlobal`, `resolveJitiFromPi`, `extractLaunchSource`, `extractedSourceIsHealthy`, `bootstrapInstall`, `api/bootstrap`, `upgrade-pi`, `bundle-recommended-extensions`. Exclude `node_modules/`, `dist/` and `packages/electron/out/`. Verify that hits are only comments, the stale `bootstrap-state` protocol types, or negative-guard tests.
- [ ] 5.3 Verify no live spec outside the change cites the retired capabilities: `` rg -n '`(bootstrap-install|dependency-installer)`' openspec/specs --glob '!**/bootstrap-install/**' --glob '!**/dependency-installer/**' `` returns nothing.
- [ ] 5.4 Run `npm test` piped to `/tmp/pi-test.log` with `set -o pipefail`. Verify `grep -nE 'Tests +[0-9]+ (failed|passed)' /tmp/pi-test.log` reports 0 failed.
- [ ] 5.5 Run `node scripts/check-conventions.mjs` and verify it reports no violations for the touched `proposal.md`.

## 6. Record follow-up drift

- [ ] 6.1 Create a draft change at `openspec/changes/cleanup-post-r3-spec-drift/proposal.md` with `node_modules/.bin/openspec new change cleanup-post-r3-spec-drift`. List the out-of-scope drift from `design.md` Non-Goals:
  - `@mariozechner` mentions in 11 other capabilities;
  - `bundled-recommended-extensions` "First-run activation…" (cites `dependency-installer.ts`) and "Build-time bundling script" (requires the deleted `bundle-recommended-extensions.sh`);
  - `electron-launch-source` deleted kinds;
  - `server-launch` "Removed predecessors" tense;
  - `dashboard-server` "Doctor does not probe for tsx" vs the `doctor-core.ts` TypeScript-loader row;
  - dead `bootstrap-state` protocol types;
  - stale comments in `bundle-server.mjs`, `tool-registry/definitions.ts` and `no-raw-node-import.test.ts`.

  Verify the file exists and links `cleanup-stale-fork-specs`.
