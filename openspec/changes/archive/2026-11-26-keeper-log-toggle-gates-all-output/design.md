# Design

## Context

See proposal.md (Why). Current state with the toggle off:

```mermaid
flowchart LR
  PM[process-manager.ts:1128<br/>spawnHeadlessViaKeeper] -->|adds env var only when ON;<br/>never removes inherited| KM[keeper-manager.ts:339-341<br/>spawnKeeperFor]
  KM -->|openSync keeper-launch-id.log ALWAYS;<br/>parent fd never closed| L1[(keeper-launch-id.log<br/>almost always 0 B)]
  KM -->|spawnDetached logFd| K[keeper.cjs]
  K -->|openSync :114 + log() ALWAYS| L2[(keeper-id.log<br/>lifecycle lines)]
  K -->|stdio ignore :375| PI[pi]
```

- The toggle was added by `add-keeper-output-capture-toggle` (commit `0a9f14931`). It gated only pi's stdio (`keeper.cjs:366-378`).
- The lifecycle `log()` and the launch log date back to the original keeper (`e2cd03b3e`).
- `spawnDetached` already maps `logFd: undefined` to `"ignore"` for both streams (`packages/shared/src/platform/detached-spawn.ts:136`).

## Goals / Non-Goals

**Goals:**
- Toggle off means no keeper log file of any kind is created for a new spawn.
- Toggle on keeps today's behavior exactly, including rotation.
- The toggle is the only switch; inherited env cannot override it.

**Non-Goals:**
- Deleting existing log files by code. The sweep's never-unlink rule (`keeper-log-maintenance`) stays untouched. The existing empty launch logs get a manual one-time command in the release note.
- Bounding launch-log accumulation when the toggle is on. This is already documented out of scope in `keeper-log-maintenance`.
- Renaming `keeperLog.capturePiOutput` or its env var.
- `SpawnErrorBanner` / `spawn-error-persistence` copy. Its `PI_CRASHED` label "See log below" already shows no log block for keeper spawns today, because `stderr` is never set. This is a pre-existing mismatch; the server message carries the remedy.

## Decisions

**D1 — One switch, sanitized at the boundary.** `spawnHeadlessViaKeeper` (`process-manager.ts:1128`) sets `PI_KEEPER_CAPTURE_PI_OUTPUT="1"` when the config is on, and **deletes** every key matching it case-insensitively when it is off. Windows child env lookup is case-insensitive, so a `pi_keeper_capture_pi_output` variant would otherwise survive. The delete operates on a fresh spread (`env = { ...env }`) made inside `spawnHeadlessViaKeeper`. It must not rely on `buildSpawnEnv` returning a copy, because the test harness stubs it as identity (`process-manager-keeper-spawn.test.ts:55`) and the delete would otherwise mutate `process.env`. The env comes from `buildSpawnEnv(process.env, …)` (`process-manager.ts:1064,1091`), so without the delete, an exported shell var would turn logging on with the toggle off. Downstream readers (`keeper-manager`, `keeper.cjs`) trust the env var. *Alternative:* a new `PI_KEEPER_LOG_ENABLED`. Rejected: it is a second knob that could disagree with the first.

**D2 — The keeper has no log fd and no rotation when off.** In `keeper.cjs`:
- Compute `captureEnabled` once, before the logger block. It is currently computed inside `spawnPi()` at `:366`; `spawnPi` reuses the hoisted value.
- When off:
  - skip `fs.openSync(logPath)` (`:114`) together with its FATAL exit;
  - make `logRotation` `null` (it is a `const` at `:123`, so construction becomes conditional);
  - have `log()` return immediately. It is already crash-safe, since `:133` guards rotation and `:134-136` swallow the write error, so this change is for clarity and to avoid a pointless syscall.
- **The one load-bearing edit:** guard `logRotation.start()` (`:443`). If it is unguarded, the `TypeError` rejects `main()` and shuts down every default keeper.
- PID-sidecar writes in `main()` (`:456-462`) MUST stay outside any capture conditional.
- Update the now-conditional comments at `:46` and `:110-118`.

**D3 — The launch-log decision follows the env it is handed.** `spawnKeeperFor` opens `keeper-launch-<id>.log` only when `env.PI_KEEPER_CAPTURE_PI_OUTPUT === "1"` and otherwise passes `logFd: undefined`. A `try/finally` around everything after the open `closeSync`s the parent's fd when it is defined, whether `spawnDetached` returned, failed, or threw. The `closeSync` itself sits in its own `try/catch` (EBADF/EPERM/Win32 sharing) so the fix cannot turn a successful spawn into a rejection. Today `spawnKeeperFor` never rejects, and the caller at `process-manager.ts:1157` has no catch. The child keeps its inherited copy. This fixes the existing per-spawn fd leak (`keeper-manager.ts:340-379` never closes). A failed `openSync` already leaves `logFd` undefined; the `finally` must skip it, because `closeSync(undefined)` throws. *Alternative:* a new `captureOutput` parameter. Rejected: it duplicates D1's single source.

**D4 — When off, keeper startup errors go nowhere. They are not piped to the server.** The keeper is detached and outlives server restarts. A stderr pipe to a server that has died turns later keeper writes into EPIPE/SIGPIPE, which is a crash risk inside the keeper. The `PI_CRASHED` message carries the remedy instead (D5).

**D5 — The `PI_CRASHED` message derives from the env actually passed.** It branches on the same value D1 placed in the keeper env, not on a second `loadConfig()` read, and it always keeps the exit code. The `process-manager` delta drops the stderr-tail promise, which was never implemented (`process-manager.ts:1172` passes no `captureStderrBytes`). With capture on, the message names the files instead.
- On: name `keeper-<id>.log` and `keeper-launch-<id>.log`. Startup errors raised before the keeper opens its own log (`keeper.cjs:39`, `:116`) land only in the launch log.
- Off: tell the user to enable "Capture pi session output (debug)" in Settings and start a new session.

**D6 — Cleanup of the existing pile is manual.** A sweep-based unlink was considered and rejected during review:
- `listKeeperLogs()` labels launch rows `launch-<uuid>` (`keeper-manager.ts:561`), so the liveness check always reports them dead.
- A live keeper with the toggle on holds its 0-byte launch log open for its whole lifetime.
- Win32 refuses the unlink.

The CHANGELOG entry carries a one-time cleanup command. POSIX: `find ~/.pi/dashboard/sessions -name 'keeper-launch-*.log' -size 0 -mmin +60 -delete`. Windows PowerShell: `Get-ChildItem $HOME\.pi\dashboard\sessions\keeper-launch-*.log | Where-Object { $_.Length -eq 0 -and $_.LastWriteTime -lt (Get-Date).AddHours(-1) } | Remove-Item`. Restricting to `-size 0` is deliberate, because non-empty launch logs may hold a FATAL line someone wants. The age filter spares live keepers' fresh files. A live keeper's old file may still be deleted; the worst case is a lost future startup line from a keeper that has already started.

## Risks / Trade-offs

- [If `logRotation.start()` or `log()` stays unguarded, every headless spawn with the default setting crashes] → Task 1.1 adds a keeper test with capture off that asserts the keeper reaches ready state and serves an RPC line. The test fails before the fix.
- [A headless session that dies with the toggle off leaves no on-disk trace] → The `PI_CRASHED` message points at the toggle. The runbooks in `docs/faq.md` and `debug-dashboard` known-issues are updated.
- [A keeper that dies after the 300 ms crash window, with the toggle off, leaves neither a message nor a file] → This change does not fix it. The spawn-register watchdog still reports the failed start. Accepted: this is the trade-off the user chose.
- [With the toggle off, the keeper's `pi exited code=… elapsed=…` line no longer exists, so a `spawn_register_timeout` (keeper alive, pi never registered) has no on-disk evidence. That line is the diagnosis path in `debug-dashboard` known-issues] → The runbook is updated: enable the toggle and reproduce. Accepted as the user-chosen trade-off.
- [`/api/health` keeper-log stats read zero by default, so an operator cannot tell "capture off" from "capture on but broken"] → Accepted. With capture off there is nothing to bound, and when capture is on the stats mean exactly what they did before.
- [Tests that assert "no file" pass vacuously when the keeper crashed, or fail when the dev shell exports the var] → Negative keeper tests assert ready state plus a served RPC line, and the harness scrubs inherited `PI_KEEPER_CAPTURE_PI_OUTPUT` before merging `extraEnv`.
- [Users relied on the always-on lifecycle lines] → CHANGELOG "Changed" entry. The setting already says "leave off unless diagnosing".
- [Keepers already running when the change deploys keep logging until their session ends, because env is read at spawn] → The hint copy says "new sessions".

## Migration Plan

No config migration. Deploy is a server restart (`keeper.cjs` is spawned fresh per session). Running keepers keep their old behavior until the session ends. Rollback is a revert; files start appearing again.
