# Tasks

## 1. Keeper writes no log when capture is off (keeper.cjs)

- [ ] 1.1 Make the `keeper.test.ts` harness hermetic: the env builder (around `:130-142`) deletes any inherited `PI_KEEPER_CAPTURE_PI_OUTPUT` key, matched case-insensitively, before merging `extraEnv`. Verify by running the file with `PI_KEEPER_CAPTURE_PI_OUTPUT=1` exported; the existing suite still behaves as with it unset.
- [ ] 1.2 Opt the existing log-reading tests into capture by adding `PI_KEEPER_CAPTURE_PI_OUTPUT: "1"` to their `extraEnv`: `:329`, `:386`, `:409`, `:538`, `:565`, `:618`, `:707`, `:721`, `:756` (E1 rotation), `:770` (E2 rotation), and any other `keeperLogFor`/`keeperLogIn` reader without it. Verify each still passes before any `keeper.cjs` change.
- [ ] 1.3 Write failing test, replacing the old-behavior test at `keeper.test.ts:475`: capture off writes no keeper log. Harness exemplar: the existing `:475`/`:492` capture tests. Triple: keeper env without the var, mock pi echoing stdout · start, wait ready, write one JSON line, SIGTERM · mock pi got the line, exit 0, no `keeper-<id>.log` while running or after exit (test-plan #E1). Verify it fails on current code.
- [ ] 1.4 Write failing test: no rotation is armed when capture is off. Harness exemplar: `keeper.test.ts:850` (E5 interval rotation). Triple: capture unset, `PI_KEEPER_LOG_CHECK_INTERVAL_MS="50"` · keeper runs ≥500 ms, then one RPC line · keeper alive, line forwarded, no log file, SIGTERM exit 0 (test-plan #E3). Verify it fails once rotation construction is skipped without guarding `start()`, or passes only with the D2 guard.
- [ ] 1.5 Write test: only exactly `"1"` enables capture. Harness exemplar: `keeper.test.ts:707` (E8 env partition loop). Triple: var ∈ {`""`,`"0"`,`"true"`,`"yes"`} · start keeper per value · no `keeper-<id>.log`, keeper reaches ready (test-plan #E4).
- [ ] 1.6 Write test: PID sidecars are still written with capture off. Harness exemplar: `keeper.test.ts:529` (E13) and `:538` (E18). Triple: capture unset · keeper ready · `.pid` holds the keeper PID integer and the `.pi-pid` sidecar holds the mock-pi PID (test-plan #E5).
- [ ] 1.7 Keep or extend the capture-on test at `keeper.test.ts:492`. Triple: `PI_KEEPER_CAPTURE_PI_OUTPUT="1"`, mock pi writes `MOCK_STDOUT` · start and forward a line · log contains `keeper starting:` and `MOCK_STDOUT` (test-plan #E2).
- [ ] 1.8 Write failing test: pi missing with capture off leaves no file. Harness exemplar: `keeper.test.ts:591` (X6 pi spawn failure). Triple: `PI_KEEPER_PI_CMD` points at a nonexistent binary, capture unset · start keeper · exit ≠ 0 within 2 s, no `keeper-<id>.log`, no `<id>.rpc.sock` (test-plan #X1).
- [ ] 1.9 Write test: stale-socket recovery with capture off. Harness exemplar: `keeper.test.ts:296` (3.4 stale socket). Triple: pre-created stale `<id>.rpc.sock`, capture unset · start keeper · binds and reaches ready, no log file (test-plan #X2).
- [ ] 1.10 Implement design D2 in `keeper.cjs`:
  - hoist `captureEnabled`, and reuse it in `spawnPi`;
  - when off, skip `openSync` and its FATAL, make `logRotation` `null`, and make `log()` return early;
  - guard `logRotation.start()` at `:443`;
  - keep PID-sidecar writes unconditional;
  - update the comments at `:46` and `:110-118`.

  Verify that 1.3–1.9 pass along with the full `keeper.test.ts`, `keeper-log-rotation.test.ts`, `keeper-env.test.ts`, and `keeper-shutdown-kills-pi.test.ts`.
- [ ] 1.11 Update the `keeper.cjs` row in `packages/server/src/rpc-keeper/AGENTS.md` (`See change: keeper-log-toggle-gates-all-output`). Verify the row text.

## 2. Launch log only when capture is on, and no fd leak (keeper-manager.ts)

- [ ] 2.1 Write failing test: capture off creates no launch log. Harness exemplar: `packages/server/src/__tests__/keeper-manager.test.ts:90` (`makeFakeSpawnDetached` + temp `sessionsDir`). Triple: env without the var · `spawnKeeperFor` returns · fake got `logFd === undefined`, no `keeper-launch-*` in `sessionsDir` (test-plan #E6).
- [ ] 2.2 Write failing test: capture on creates the launch log and closes the parent fd. Same exemplar. Triple: env `PI_KEEPER_CAPTURE_PI_OUTPUT="1"` · spawn returns success · `keeper-launch-<id>.log` exists, fake got a numeric fd, `fstatSync(fd)` throws `EBADF` (test-plan #E7).
- [ ] 2.3 Write failing test: fd is closed when spawn reports failure. Exemplar: `keeper-manager.test.ts:109` (`!ok` case). Triple: capture `"1"`, fake returns `{ok:false,error:"boom"}` · `spawnKeeperFor` · `{success:false}`, fd `EBADF`, no throw (test-plan #X3).
- [ ] 2.4 Write failing test: fd is closed when spawn throws. Exemplar: `keeper-manager.test.ts:109`. Triple: capture `"1"`, fake throws `Error("boom")` · `spawnKeeperFor` · rejects with "boom", fd `EBADF` (test-plan #X4).
- [ ] 2.5 Write test: a launch-log open failure is not fatal. Exemplar: `keeper-manager.test.ts:90`. Triple: capture `"1"`, `keeper-launch-<id>.log` pre-created as a directory · `spawnKeeperFor` · fake got `logFd === undefined`, `success:true`, no throw (test-plan #X5).
- [ ] 2.6 Implement design D3 in `spawnKeeperFor`: gate the open on `env.PI_KEEPER_CAPTURE_PI_OUTPUT === "1"`; add a `try/finally` with a guarded `closeSync` (defined fd only; close errors swallowed). Verify that 2.1–2.5 pass along with the full `keeper-manager.test.ts`.
- [ ] 2.7 Update the `keeper-manager.ts` row in `packages/server/src/rpc-keeper/AGENTS.md`. Verify the row text.

## 3. Env sanitizing and PI_CRASHED message (process-manager.ts)

- [ ] 3.1 Write failing test: inherited env cannot enable logging. Harness exemplar: `packages/server/src/__tests__/process-manager-keeper-spawn.test.ts:398` ("strips the dashboard's OWN inherited flag"). Triple: config capture off, `process.env` has `PI_KEEPER_CAPTURE_PI_OUTPUT="1"` and `pi_keeper_capture_pi_output="1"` · headless `spawnPiSession` · no key in `state.spawnCalls[0].env` matches case-insensitively, and `process.env` is unchanged afterward (test-plan #E8).
- [ ] 3.2 Write test: config on sets the var. Exemplar: `process-manager-keeper-spawn.test.ts:350`. Triple: config capture on, clean env · headless spawn · `env.PI_KEEPER_CAPTURE_PI_OUTPUT === "1"` (test-plan #E9).
- [ ] 3.3 Write failing test: `PI_CRASHED` message with capture off. Exemplar: `process-manager-keeper-spawn.test.ts:241` ("returns PI_CRASHED"). Triple: config off, fake keeper exits 1 at 20 ms · headless spawn · `PI_CRASHED`, message contains `code 1` and `Capture pi session output`, no `keeper-` substring, `stderr` undefined (test-plan #X6).
- [ ] 3.4 Write failing test: `PI_CRASHED` message with capture on. Same exemplar. Triple: config on, fake keeper exits 1 at 20 ms · headless spawn · message contains `code 1`, `keeper-<transportId>.log`, and `keeper-launch-<transportId>.log` (test-plan #X7).
- [ ] 3.5 Implement design D1 and D5 in `spawnHeadlessViaKeeper`: work on a fresh `{ ...env }`; set `"1"` or delete all case-insensitive matches; branch the `PI_CRASHED` message on that same value. Verify that 3.1–3.4 pass along with the full `process-manager-keeper-spawn.test.ts`.
- [ ] 3.6 Update the `process-manager.ts` row in the nearest `AGENTS.md`. Verify the row text.

## 4. Config doc and Settings copy

- [ ] 4.1 Update the `KeeperLogConfig.capturePiOutput` JSDoc in `packages/shared/src/config.ts` to say it gates all keeper logs. Verify that `packages/shared/src/__tests__/config-keeper-log.test.ts` passes unchanged.
- [ ] 4.2 Write failing test: the new hint copy appears in every locale. Harness exemplar: `packages/client/src/lib/__tests__/ui-copy-no-spawn.test.ts` (E8 locale key checks). Triple: en inline default in `SettingsPanel.tsx:2944`, `i18n-hu.ts`, `i18n-zh-CN.ts` · read `settings.capturePiOutputHint` per locale · each is non-empty and differs from the pre-change string; the en value says new sessions write no keeper log when off (test-plan #F1).
- [ ] 4.3 Update the hint text in all three locations ("new sessions", never "spawn"). Verify that 4.2 and `ui-copy-no-spawn.test.ts` pass, and that `npm run build` succeeds.

## 5. Docs and release note

- [ ] 5.1 Delegate to DocScribe (caveman style):
  - `docs/faq.md` keeper-log diagnostic entries (around `:2104-2110`): enable the toggle first;
  - `.pi/skills/debug-dashboard/references/known-issues.md:64-66`: same;
  - `docs/architecture.md` `### RPC keeper sidecar`: logging is off by default, with no keeper files.

  Verify that the three files show the edits.
- [ ] 5.2 Add a CHANGELOG `## [Unreleased]` → Changed entry: the toggle now gates all keeper logs; the fd leak is fixed; include the one-time cleanup commands from design D6 (POSIX + PowerShell). Verify the entry is present.

## 6. Integration check

- [ ] 6.1 Run `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and `grep -nE 'FAIL|Tests +[0-9]+ failed' /tmp/pi-test.log`. Verify there are no failures.
- [ ] 6.2 Run the `code-quality` changed-files check (`npm run quality:changed`) and the `review-code` pass on the diff. Verify there are no new Biome warnings and no unresolved review findings.
