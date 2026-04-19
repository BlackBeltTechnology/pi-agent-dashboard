## 1. Primitive — `platform/detached-spawn.ts`

- [x] 1.1 Create `packages/shared/src/platform/detached-spawn.ts` exporting `spawnDetached`, `waitForNoCrash`, `waitForReady`.
- [x] 1.2 `spawnDetached` always passes `detached: true`, `windowsHide: true`, `shell: false`, `stdio[0] = "ignore"`, `stdio[1] = "ignore"`, `stdio[2] = logFd ?? "ignore"`. Calls `child.unref()` before return.
- [x] 1.3 `spawnDetached` handles async spawn errors via `child.on("error")` within a 200 ms grace period; returns `{ ok: false, error }` when the child lacks a PID or errors synchronously.
- [x] 1.4 `waitForNoCrash` implements Promise.race between `child.on("exit")` and a timer; bounds stderr capture by `captureStderrBytes` when supplied; never throws.
- [x] 1.5 `waitForReady` polls `probe()` at `pollIntervalMs` (default 500 ms) until `true` or `deadlineMs`; short-circuits on `child.on("error")` or non-zero exit when `child` is provided.
- [x] 1.6 Create `packages/shared/src/__tests__/detached-spawn.test.ts` covering every scenario in `specs/platform-detached-spawn/spec.md`. 11 tests pass.
- [x] 1.7 Export `detached-spawn` from `packages/shared/src/platform/index.ts`.
- [x] 1.8 Run `npm test` in `packages/shared`; all new tests pass.

## 2. Primitive — `platform/spawn-mechanism.ts`

- [x] 2.1 Create `packages/shared/src/platform/spawn-mechanism.ts` exporting `SpawnMechanism` type, `selectMechanism`, `buildWtArgs`, `sessionFlagsToArgv`.
- [x] 2.2 `selectMechanism` implements the decision table.
- [x] 2.3 `buildWtArgs` returns argv form.
- [x] 2.4 Register `wt` as a tool with override + where chain.
- [x] 2.5 Create tests. 19 tests pass.
- [x] 2.6 Export from index.ts.
- [x] 2.7 Tests pass.

## 3. Primitive — `platform/process-identify.ts`

- [x] 3.1 Create `platform/process-identify.ts` with `findPidByMarker`, `isProcessLikePi`, `isPiCommandLine`.
- [x] 3.2 `findPidByMarker` via injected exec; Unix ps|grep + sentinel filter; Windows empty array.
- [x] 3.3 `isProcessLikePi` darwin ps / linux /proc + fallback; Windows true.
- [x] 3.4 `isPiCommandLine` pattern exported.
- [x] 3.5 Tests with injected fake exec. 16 tests pass.
- [x] 3.6 Export from index.ts.
- [x] 3.7 Tests pass.

## 4. Caller rewrite — `server/process-manager.ts`

- [x] 4.1 Injectable resolver seam via `setResolver` / `resetResolver`.
- [x] 4.2 spawnHeadlessWindows body replaced by `spawnDetached` + `waitForNoCrash(300ms)` + log-fd pattern.
- [x] 4.3 Unix headless routed through `spawnDetached` (tail -f wrapper kept as domain helper).
- [x] 4.4 WSL/cmd fallback block replaced with `selectMechanism` dispatch.
- [x] 4.5 `wt` mechanism branch implemented via `buildWtArgs` + `spawnDetached`.
- [x] 4.6 Every mechanism forwards options uniformly via `sessionFlagsToArgv` / `buildHeadlessArgs` / `buildInteractivePiArgs`.
- [x] 4.7 `PlatformInfo` and `detectPlatform` deleted — replaced by `selectMechanism` + `chooseMechanism`.
- [x] 4.8 Zero `process.platform === "win32"` branches remain in process-manager.ts. (One `process.platform` read in chooseMechanism to pass to selectMechanism.)

## 5. Caller rewrite — `server/browser-handlers/session-action-handler.ts`

- [x] 5.1 killHeadlessBySessionId now uses `findPidByMarker` — Windows branch deleted.
- [x] 5.2 isPiProcess now delegates to `isProcessLikePi`; `isPiCommandLine` re-exported from primitive.
- [x] 5.3 Zero `process.platform` branches in session-action-handler.ts.

## 6. Caller rewrite — `electron/lib/server-lifecycle.ts`

- [x] 6.1 Both spawns migrated to `spawnDetached`.
- [x] 6.2 Health-poll loops replaced with `waitForReady`.
- [x] 6.3 Both `isWin` declarations removed — zero `process.platform` references in file.

## 7. Caller rewrite — `extension/src/server-launcher.ts`

- [x] 7.1 Migrated to `spawnDetached`.
- [x] 7.2 Early-exit Promise.race replaced with `waitForNoCrash(2000ms)`.

## 8. Tool registry

- [x] 8.1 `wt` registered with override + where strategy chain (done in §2.4).
- [x] 8.2 Test extensions added — wt registered + resolves via where + returns ok:false when absent. 16 tests pass.

## 9. Invariant guard

- [x] 9.1 Created `no-direct-platform-branch.test.ts` mirroring child_process guard.
- [x] 9.2 Seed ALLOWLIST includes 10 documented entries + platform/** prefixes.
- [x] 9.3 Verified guard detects violations (injected test branch fails; revert passes).
- [x] 9.4 Guard passes with all rewritten callers.
- [x] 9.5 `// platform-branch-ok` opt-out marker handled.

## 10. Test extensions — `server/__tests__/process-manager.test.ts`

- [x] 10.1 detectPlatform tests removed (function deleted); dispatch authority is `selectMechanism` (tested in shared).
- [x] 10.2 Dispatch tests live in shared/spawn-mechanism.test.ts with injected availability matrix (19 tests covering wt/wsl-tmux/headless fall-through on Windows).
- [x] 10.3 Option-forwarding regression tests added: buildHeadlessArgs and buildTmuxCommand both cover fork/continue/omit cases.
- [x] 10.4 Regression guard for B1/B2 present: every builder gets the --fork flag; sessionFlagsToArgv is the uniform primitive.

## 11. Docs

- [x] 11.1 AGENTS.md: added 3 key-files rows for detached-spawn, spawn-mechanism, process-identify; updated process-manager.ts description.
- [x] 11.2 docs/architecture.md: added 3 rows to Platform primitives table + new "Session spawn dispatch" subsection.
- [x] 11.3 docs/architecture.md: documents detached:true lifecycle, invariant guard test, and allowlist.
- [x] 11.4 README.md: added "Windows session durability" behaviour-change note.
- [x] 11.5 README.md: added Windows Terminal recommendation + App Execution Aliases troubleshooting.

## 12. Release gate

- [ ] 12.1 Manual test on Windows 11 with Windows Terminal installed: spawn a session, verify new tab opens in existing WT window with correct title and starting directory.
- [ ] 12.2 Manual test on Windows: "Fork from here" on any message — verify the new pi session starts from the forked file (previous user message IS in context).
- [ ] 12.3 Manual test on Windows: "Continue ended session" — verify pi resumes with full history.
- [ ] 12.4 Manual test on Windows: spawn a headless session, kill the dashboard server process via Task Manager, verify the pi process continues running. Restart the dashboard, verify the session reappears in the sidebar.
- [ ] 12.5 Manual test on Windows without `wt.exe`: spawn falls through to headless; session card appears correctly.
- [ ] 12.6 Manual test on macOS or Linux: spawn / fork / continue all still work unchanged via tmux.
- [ ] 12.7 Run `npm run build` — clean build.
- [ ] 12.8 Run `npm run reload:check` — type-check passes + all pi sessions reload.
- [ ] 12.9 Verify QA VM matrix: `make test-linux-x86` and `make test-windows` (if available) green.
- [ ] 12.10 Confirm the invariant guard test passes with the expected allowlist — no spawn-related files on the list.
