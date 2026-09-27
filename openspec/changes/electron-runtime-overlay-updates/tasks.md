## 1. Spikes (resolve design open questions)

- [ ] 1.1 (DEFERRED — interim decision recorded in design.md open question 1) Spike: `npm ci --omit=dev` from a generated `runtime-lock.json` on macOS arm64; copy the tree to linux-x64 and win32-x64 and start the server there. Record whether one platform-independent GitHub asset works (all native deps ship prebuilds for all 6 platform/arch combinations). Write the result into design.md open question 1.
- [ ] 1.2 (DEFERRED — interim decision recorded in design.md open question 2) Spike: run a pnpm-installed monorepo checkout under the shell's bundled Node (same and different major as the system Node). Record node-pty behaviour and decide between "preflight refuses on mismatch" and "link may use system Node". Write the result into design.md open question 2 and the D6 local rule.

## 2. Release declaration + runtime lock

- [x] 2.1 Test (test-plan #E22): extend `packages/electron/src/__tests__/build-config-parity.test.ts` (exemplar). Input: `packages/server/package.json#piDashboard.bundledPlugins`. Trigger: `bundle-server.mjs` plugin list + the runtime materialize helper. Observable: both derive exactly that list; removing an id removes it from both.
- [x] 2.2 Add `piDashboard.bundledPlugins` to `packages/server/package.json`. Extract a shared `materializeBundledPlugins(srcNodeModulesOrPackages, destResourcesPlugins, ids)` helper; `bundle-server.mjs` uses it and reads the field.
- [x] 2.3 Add the shared `RuntimeManifest` type + `parseRuntimeManifest()` / `writeRuntimeManifest()` (`version`, `minShellVersion`, `nodeEngines`, `origin`, `integrity`, `piVersion`). Stamp `runtime-manifest.json` (origin `bundled`) into the bundle at build time.
- [ ] 2.4 Release pipeline: generate `runtime-lock.json` (npm lockfile v3 over meta + server + web + extension + plugin-runtime + `bundledPlugins`, all at X) into the published `@blackbelt-technology/pi-dashboard-server` package `files`. It is not `npm-shrinkwrap.json`, so Standalone `npm i -g` is unaffected.
- [ ] 2.5 Release pipeline: publish prereleases under the npm `beta` dist-tag and as GitHub prereleases; attach the runtime asset(s) + `.sha512` per spike 1.1.
- [ ] 2.6 Test (test-plan #X16): add a workflow assertion step modelled on `packages/electron/scripts/assert-runnable-bundle.mjs` (exemplar). Input: release workflow on a prerelease tag. Trigger: publish job. Observable: asset + `.sha512` attached; `npm dist-tag ls` shows `beta` = tag version; runtime manifest version equals the tag.

## 3. Runtime state (shared, pure)

- [x] 3.1 Test (test-plan #E1): new `packages/shared/src/__tests__/runtime-state.test.ts`, harness from `packages/shared/src/__tests__/bridge-register.test.ts` (exemplar). Input: localPath set/unset × binding equal / seq-differs / epoch-differs / absent × request valid/missing/corrupt/legacy. Trigger: `deriveEffectiveSource`. Observable: `local` in exactly the one valid row, otherwise `request.source` (or `bundled` when the request is invalid).
- [x] 3.2 Test (test-plan #E2): same file. Input: binding `{E,1}`; request seq ∈ {0,1,2} × epoch ∈ {E,E'}. Trigger: derive. Observable: `local` only for `{E,1}`.
- [x] 3.3 Test (test-plan #E19): same file. Input: `request.json`/`state.json` containing `futureKey`. Trigger: a write through each writer. Observable: `futureKey` preserved byte-equal.
- [x] 3.4 Test (test-plan #E14): same file. Input: same realpath at commits A/B, dirty toggled, symlinked path. Trigger: derive the local id. Observable: always `local:<realpath>`; the snapshot reflects SHA/dirty.
- [x] 3.5 Implement `packages/shared/src/runtime-overlay/state.ts`: `request.json` (server writer: `sourceEpoch` uuid created with the file, `sourceSeq` starting at 1 and incremented per selection) and `state.json` (Electron writer). Atomic tmp+rename with Windows EPERM retry; preserve unknown keys; missing/corrupt → defaults; `deriveEffectiveSource()`; `runtimeId()`.
- [x] 3.6 Test (test-plan #E5): new `packages/shared/src/__tests__/runtime-compat.test.ts` (exemplar: `runtime-state.test.ts`). Input: shell 0.9.0 × `minShellVersion` {0.8.9, 0.9.0, 0.9.1}; Node 22.12.0 × `nodeEngines` {`>=22.11`, `>=22.12`, `>=22.13`, `^20`}. Trigger: `evaluateRuntimeCandidate`. Observable: ok / refusal reasons exactly as listed in the test plan.
- [x] 3.7 Test (test-plan #E6): same file. Input: overlay tree missing each required path; local checkout missing `packages/client/dist/index.html` or `node_modules`. Trigger: preflight. Observable: refusal names the missing path; local client miss mentions `npm run build`.
- [x] 3.8 Implement `evaluateRuntimeCandidate()` + overlay/local preflight (web `dist/index.html` resolved the same way as `client-dist.ts`).

## 4. Launch-source + switchRuntime (Electron)

- [x] 4.1 Test (test-plan #E4): extend `packages/electron/src/lib/__tests__/launch-source.test.ts` (exemplar). Input: health yes/no × unpackaged-monorepo yes/no × effective source × gate ok/fail. Trigger: `selectLaunchSource()` / `({skipAttach:true})`. Observable: order `attach → devMonorepo → localLink → overlay → bundled`; skipAttach never attaches; gate failure falls through with `lastFailure`.
- [x] 4.2 Test (test-plan #E23): same file. Input: kinds devMonorepo/localLink/overlay/bundled. Trigger: `getServerReadyDeadlineMs`. Observable: 60000/60000/15000/15000.
- [x] 4.3 Implement the `overlay` and `localLink` kinds, the `skipAttach` option, the `parsePreferOverride` values and the deadline mapping in `launch-source.ts`.
- [x] 4.4 Test (test-plan #E11): new `packages/electron/src/lib/__tests__/runtime-overlay.test.ts`, harness from `server-lifecycle.test.ts` (exemplar). Input: `pending=X`, `current=X`. Trigger: cold launch. Observable: X runs; `attempts[X]` unchanged; no activation flow.
- [x] 4.5 Test (test-plan #E12): same file. Input: `pending=X`, X never healthy. Trigger: 3 consecutive launches. Observable: attempts on launches 1 and 2, `bad[X]` after the 2nd, no attempt on the 3rd.
- [x] 4.6 Test (test-plan #E13): same file. Input: `bad["local:/r/co"]`. Trigger: (a) cold launch, (b) app-menu re-select. Observable: (a) not attempted; (b) bad + attempts cleared and activation attempted.
- [x] 4.7 Test (test-plan #E3): same file. Input: `request.json` missing or `{not json`. Trigger: app-menu pick of a valid checkout. Observable: error `request_unreadable`; no `localPath`/`localBinding` in `state.json`.
- [x] 4.8 Test (test-plan #P1): same file, fake timers. Input: `activateNonce` written. Trigger: `fs.watchFile` poll. Observable: `switchRuntime` invoked ≤ 2 s + 100 ms after the write.
- [x] 4.9 Test (test-plan #X4): same file. Input: candidate never healthy within 15 s. Trigger: `switchRuntime(X)`. Observable: `bad[X]` + `lastFailure`; extension re-pointed to previous **before** previous spawns; previous committed.
- [x] 4.10 Test (test-plan #X5): same file, fake clock. Input: old PID exits at 59 s / 61 s. Trigger: `switchRuntime(X)`. Observable: 59 s → candidate spawns; 61 s → abort `old_server_alive`, old current, X not bad.
- [x] 4.11 Test (test-plan #X6): same file. Input: old server still answers health with `pid=P_old`, version W. Trigger: candidate health gate. Observable: gate rejects; never commits.
- [x] 4.12 Test (test-plan #X7): same file. Input: candidate exits EADDRINUSE. Trigger: `switchRuntime(X)`. Observable: abort; X not bad; old current.
- [x] 4.13 Test (test-plan #X9): same file. Input: local bound `{E,2}`; `request.json` rewritten without `sourceEpoch`. Trigger: derive + launch. Observable: not local; the resolver never returns `localLink`.
- [x] 4.14 Test (test-plan #X8): extend `packages/electron/src/lib/__tests__/server-watchdog.test.ts` (exemplar). Input: (a) planned stop, (b) candidate exits pre-commit, (c) committed runtime exits, (d) abort then survivor crashes. Trigger: watchdog onExit. Observable: (a) graceful; (b) rollback only, watchdog silent; (c)(d) `onCrash` fires.
- [x] 4.15 Implement `packages/electron/src/lib/runtime-overlay.ts`: `request.json` watcher (2 s `fs.watchFile`), `switchRuntime()` in `server-lifecycle.ts` (health-PID probe, `SWITCH_OLD_EXIT_DEADLINE_MS = 60_000`, restart-intent stop, skipAttach resolve, gate, re-point before spawn, pid+version health gate, commit/prune, rollback, environmental abort), PID-scoped `expectExit` / `claimCandidate` in the watchdog, handled-pending/attempts/bad rules.
- [x] 4.16 `app-menu.ts`: "Runtime → Use local folder…" (native picker, validate, bind to `{epoch,seq}`, clear bad, `switchRuntime`) and "Stop using local folder". `main.ts`: non-blocking rollback notification.

## 5. Bridge extension + convergent reload

- [x] 5.1 Test (test-plan #E15): extend `packages/shared/src/__tests__/bridge-register.test.ts` (exemplar). Input: `packages[]` with bundled ext / local ext / unrelated package. Trigger: register for overlay X / local / bundled. Observable: exactly one dashboard-extension entry at the target path; unrelated entries preserved.
- [x] 5.2 Refactor `bridge-register.ts` onto one shared "register extension at path" helper (also used by the `switch-extension-source` skill); durable write (fsync) before spawn.
- [x] 5.3 Test (test-plan #F6): new `packages/server/src/__tests__/runtime-extension-reload.test.ts`, harness from `session-action-handler-headless-reload.test.ts` (exemplar). Input: bridge re-registers with a non-matching identity after its reload. Trigger: register handler. Observable: no 2nd `/reload` for the same runtime id; diagnostic `extension_mismatch` recorded.
- [x] 5.4 Bridge (`packages/extension/`): report extension identity (resolved package dir + version) on register. Server: compare with the active identity (env from Electron at spawn); send `/reload` once per session per runtime id; record the mismatch diagnostic.
- [x] 5.5 Test (test-plan #F5): new `tests/e2e/runtime-extension-reload-convergence.spec.ts`, harness from `tests/e2e/headless-reload-dispatch.spec.ts` (exemplar). Input: 2 sessions, one bridge reconnect delayed past the first reload. Trigger: activate a runtime whose extension identity differs. Observable: eventually (90 s test timeout) both report the active identity; each got exactly 1 `/reload`.

## 6. Server: check, stage, API, health

- [x] 6.1 Test (test-plan #E9): new `packages/server/src/__tests__/runtime-update-checker.test.ts`, harness from `pi-core-checker.test.ts` (exemplar). Input: mocked dist-tags/releases × channel. Trigger: `resolveTarget` for npm and github. Observable: stable→0.9.0, beta→0.10.0-beta.2, pin→0.8.5.
- [x] 6.2 Test (test-plan #E10): same file. Input: active 0.9.0, channel has 0.9.1. Trigger: scheduled check. Observable: `available: 0.9.1`; no `versions/0.9.1*`; `pending` unset.
- [x] 6.3 Test (test-plan #X3): same file. Input: network error / 30 s stall. Trigger: check. Observable: `check_failed` with reason; runtime untouched; cached result kept 24 h.
- [x] 6.4 Implement the runtime-update checker (24 h cache + "Check now"; notify-only).
- [x] 6.5 Test (test-plan #E8): new `packages/server/src/__tests__/runtime-stager.test.ts`, harness from `pi-core-updater-managed-path.test.ts` (exemplar). Input: fixture `runtime-lock.json` for X. Trigger: build the synthetic root twice. Observable: byte-identical roots; command is `npm ci --omit=dev`.
- [x] 6.6 Test (test-plan #E7): same file. Input: tree with one plugin at 0.8.0 while X=0.9.0. Trigger: lockstep check. Observable: fails naming `<plugin>@0.8.0`; `.partial` removed; `pending` unchanged.
- [x] 6.7 Test (test-plan #X1): same file. Input: asset bytes ≠ `.sha512`. Trigger: stage github X. Observable: `checksum_mismatch`; no `versions/X*`; current unchanged.
- [x] 6.8 Test (test-plan #X2): same file. Input: fetch/`npm ci` killed mid-way. Trigger: stage, then stage again. Observable: `.partial` never selectable; second run clean + succeeds.
- [x] 6.9 Implement the npm stager (`npm pack` server@X → `runtime-lock.json` → `npm ci`, bundled Node/npm, `.npmrc` honoured) and the GitHub stager (download + sha512 + extract), lockstep check, `materializeBundledPlugins`, manifest write, `.partial` → rename, `runExclusive` + progress WS events.
- [x] 6.10 Test (test-plan #E16): new `packages/server/src/__tests__/runtime-routes.test.ts`, harness from `pi-core-routes.test.ts` (exemplar). Input: starter electron/standalone/bridge. Trigger: POST `/api/runtime/{source,update,activate,rollback}`. Observable: 403 + `request.json` untouched for non-electron; accepted for electron.
- [x] 6.11 Test (test-plan #E17): same file. Input: bodies `{source:"local"}`, `{localPath}`, mixed, from 127.0.0.1. Trigger: POST `/api/runtime/source`. Observable: rejected; server never writes `state.json`; `localPath` ignored in the mixed body.
- [x] 6.12 Test (test-plan #E18): same file. Input: local active, binding `{E,3}`. Trigger: POST source `bundled`. Observable: `sourceSeq=4`; derived source `bundled`.
- [x] 6.13 Implement `/api/runtime/{status,source,update,activate,rollback}` behind `networkGuard` + the mutation-origin gate; Electron-only mutations; no local-enable path; explicit Update/Activate clear `bad[X]`.
- [x] 6.14 Test (test-plan #E20): extend `packages/server/src/__tests__/health-shape.test.ts` (exemplar). Input: starter × origin × lastFailure. Trigger: GET `/api/health`. Observable: `runtime.updatable` true only for electron with origin ≠ devMonorepo; pre-existing fields unchanged.
- [x] 6.15 Implement the `/api/health.runtime` block (origin, version, updatable, source, channel, gitSha, dirty, piVersion, lastFailure).

## 7. Client

- [x] 7.1 Test (test-plan #F1): new `packages/client/src/components/__tests__/RuntimeUpdatesSection.test.tsx`, harness from `UnifiedPackagesSection.test.tsx` (exemplar). Input: source local, `/r/co`, abc123 dirty. Trigger: render. Observable: path/SHA/dirty shown; no editable path input; "Set from the app menu".
- [x] 7.2 Test (test-plan #F2): same file. Input: `available 0.9.1`. Trigger: Update, progress events, Activate. Observable: Update → progress → Activate; Activate disabled until `pending=0.9.1`.
- [x] 7.3 Test (test-plan #F3): same file. Input: refusal `requires_app >=0.10.0`. Trigger: render. Observable: "Requires app update ≥0.10.0" + link calling the whole-app update check.
- [x] 7.4 Test (test-plan #F4): same file. Input: `lastFailure {0.9.1, "health timeout"}`. Trigger: render. Observable: failure line visible; Roll back / Use bundled enabled.
- [x] 7.5 Test (test-plan #E21): extend `packages/client/src/components/__tests__/PiUpdateBadge.test.tsx` + `UnifiedPackagesSection.test.tsx` (exemplars). Input: Electron starter, `runtime.updatable=true`. Trigger: render. Observable: Core group + `PiUpdateBadge` still hidden.
- [x] 7.6 Implement the Settings → Updates section (source, channel/pin, read-only local, status, pi version, Check now / Update / Activate / Roll back / Use bundled, last failure) and a runtime update badge driven only by `runtime.updatable`.
- [x] 7.7 Test (test-plan #X14): new `tests/e2e/runtime-updates-remote-local.spec.ts`, harness from `tests/e2e/blackhole-settings.spec.ts` (exemplar; port from `.pi-test-harness.json`). Input: remote client via the harness port. Trigger: UI + direct POST attempts. Observable: no path input; POST rejected; `/api/health.runtime.source` unchanged.
- [ ] 7.8 Manual QA (test-plan: manual-only, #F7): review the visual polish of Settings → Updates on all 4 themes.

## 8. Electron end-to-end

- [ ] 8.1 Add a local npm registry fixture (verdaccio) to the electron E2E job serving a fake X+1 with `runtime-lock.json` (test-plan "New infra needed").
- [ ] 8.2 Test (test-plan #X11): new `tests/e2e-electron/runtime-overlay-update.electron.spec.ts`, harness from `tests/e2e-electron/zombie-adoption.electron.spec.ts` + `electron-lifecycle.ts` (exemplars). Input: packaged 0.9.0 bundled, registry serves 0.9.1. Trigger: Check → Update → Activate. Observable: health `{origin:overlay, version:0.9.1}`; `settings.json` extension under `versions/0.9.1`; `/api/health.plugins[]` same first-party set as bundled.
- [ ] 8.3 Test (test-plan #X12): same spec file. Input: overlay 0.9.1 whose server exits at boot; no previous. Trigger: Activate. Observable: `origin=bundled`; `lastFailure.version=0.9.1`; bundled extension re-registered.
- [ ] 8.4 Test (test-plan #X10): same spec file. Input: app on overlay X. Trigger: kill the server PID. Observable: existing loading/recovery page appears.
- [ ] 8.5 Test (test-plan #X13): new `tests/e2e-electron/runtime-local-link.electron.spec.ts`, harness from `tests/e2e-electron/zombie-adoption.electron.spec.ts` (exemplar). Input: app-menu pick of the built repo checkout (menu invoked via the test hook). Trigger: pick, edit a server log string, POST `/api/restart`. Observable: `origin:local`, `gitSha`=HEAD; the new log string appears in server.log after restart.
- [ ] 8.6 Manual QA (test-plan: manual-only, #X15): Windows 11 + Linux AppImage installs: Update → Activate → Roll back (file locks, AppImage extension path rules).

## 9. Observability + Doctor

- [x] 9.1 Structured log lines for check / stage / activate / commit / rollback / abort (Electron log + server log) with runtime id, source and reason.
- [x] 9.2 Doctor row: active runtime origin/version/source/piVersion, last failure, `extension_mismatch` diagnostics, whether the bundled fallback is intact.

## 10. Docs

- [x] 10.1 DocScribe: `docs/electron-immutable-bundle.md` (bundle immutable, runtime overlay allowed, pi version follows the runtime for opt-in users), `docs/electron-bootstrap-flow.md` (new launch kinds, switchRuntime), FAQ "How do I run my checkout inside the Electron app".
- [x] 10.2 Update the `packages/electron/src/lib/AGENTS.md`, `packages/shared/src/**/AGENTS.md`, `packages/server/src/**/AGENTS.md` and `packages/client/src/components/AGENTS.md` rows for new and changed files.
