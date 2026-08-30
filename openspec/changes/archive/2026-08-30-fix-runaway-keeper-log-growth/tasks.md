## 1. Config + env plumbing (do first — everything else needs the test seam)

- [x] 1.1 Add `maxBytes` (default `134217728`) and `checkIntervalMs` (default `5000`) to `KeeperLogConfig` + `DEFAULT_KEEPER_LOG` in `packages/shared/src/config.ts`, and extend `parseKeeperLogConfig` to parse/validate both (it currently drops unknown keys).
- [x] 1.2 Test: config parse boundaries — see `packages/shared/src/__tests__/config-keeper-log.test.ts`. Triple: config.json with `maxBytes: 1048576` then `0` / `-1` / `"big"` / absent · `loadConfig()` · valid → 1048576, each invalid → default 134217728, `capturePiOutput` unaffected (test-plan #E7).
- [x] 1.3 Plumb both values into the keeper spawn env as `PI_KEEPER_LOG_MAX_BYTES` / `PI_KEEPER_LOG_CHECK_INTERVAL_MS` in `packages/server/src/spawn-process/process-manager.ts`, alongside the existing `PI_KEEPER_CAPTURE_PI_OUTPUT` block.
- [x] 1.4 Test: config → spawn env — see `packages/server/src/__tests__/keeper-manager.test.ts`. Triple: `config.keeperLog = {maxBytes: 65536, checkIntervalMs: 250}` · `spawnKeeperFor` builds the env · env carries `PI_KEEPER_LOG_MAX_BYTES=65536` and `PI_KEEPER_LOG_CHECK_INTERVAL_MS=250` (test-plan #E6).
- [x] 1.5 Read both env vars in `keeper.cjs` with defaults for unset/invalid, log the resolved values at startup, and `delete` both from the env handed to the pi child (mirroring the existing `delete env.PI_KEEPER_CAPTURE_PI_OUTPUT`).
- [x] 1.6 Test: env fallback — see `packages/server/src/rpc-keeper/__tests__/keeper.test.ts`. Triple: keeper spawned with `PI_KEEPER_LOG_MAX_BYTES` unset / `""` / `"abc"` / `"0"` · keeper starts · resolved cap logged as 128 MiB and keeper starts normally (assert the logged value, never a 128 MiB write) (test-plan #E8).
- [x] 1.7 Test: keeper-internal vars stripped from pi — see `packages/server/src/rpc-keeper/__tests__/keeper-env.test.ts`. Triple: keeper env carries both log vars · keeper spawns pi · child env contains neither var (test-plan #E9).

## 2. Rotation in keeper.cjs

- [x] 2.1 Write the failing rotation tests first and verify they fail against today's code — see `packages/server/src/rpc-keeper/__tests__/keeper.test.ts` for the spawn-a-real-keeper harness.
- [x] 2.2 Test: cap boundary, below — Triple: keeper with `PI_KEEPER_LOG_MAX_BYTES=65536`, log at 65 535 B · one size check fires · size unchanged, no truncation (test-plan #E1).
- [x] 2.3 Test: cap boundary, at — Triple: same keeper, log at exactly 65 536 B · one size check fires · size drops below 65 536 B (test-plan #E2).
- [x] 2.4 Test: inode preserved under the shared fd (the load-bearing one — a rename implementation would pass a size-only assertion) — Triple: `PI_KEEPER_CAPTURE_PI_OUTPUT=1`, child holding the fd, cap 64 KiB · child writes past the cap then writes marker `POST-ROT-<n>` · `stat().ino` identical across rotation, live log contains the marker, size < 64 KiB (test-plan #E3).
- [x] 2.5 Test: no generation retained — Triple: keeper driven through ≥3 rotations at cap 64 KiB · after the third · no `.log.1` / `.2` / dated sibling exists in `sessionsDir` (test-plan #E4).
- [x] 2.6 Test: child-only growth still rotates — Triple: capture on, keeper emits zero `log()` lines after startup, child writes 1 MiB · the unref'd interval fires · size < 2× cap with no keeper-originated line after the last child byte (test-plan #E5).
- [x] 2.7 Implement `rotateIfNeeded()` in `keeper.cjs`: throttled `fs.fstatSync(logFd)`; at/over cap → `fs.ftruncateSync(logFd, 0)`; no copy, no rename, no reopen, no generation. CJS-pure — `node:fs`/`node:path` only.
- [x] 2.8 Implement the Windows fallback: on `ftruncateSync` throw, compare `fstatSync(logFd).ino` with `statSync(logPath).ino` and only then `fs.truncateSync(logPath, 0)`; skip as failed when the inodes differ.
- [x] 2.9 Test: truncation refused → fallback — Triple: `fs.ftruncateSync` stubbed to throw EPERM · size check fires at cap · `truncateSync(logPath, 0)` attempted, log ends below cap (test-plan #X1).
- [x] 2.10 Test: fallback refuses a swapped path — Triple: `ftruncateSync` throws and `logPath` now names a different inode · size check fires at cap · replacement file NOT truncated, rotation recorded as failed (test-plan #X2).
- [x] 2.11 Wire both triggers: throttled call from `log()`, plus an `unref()`'d `setInterval`. Each call site carries its own `try/catch` — an unguarded throw from the timer hits `uncaughtException` → `shutdown(1)` and would end the session over a logging concern. Comment at the rotation site: why rename/reopen is wrong here, why no copy, and the `O_APPEND`-only invariant.
- [x] 2.12 Test: both truncation paths fail — Triple: `ftruncateSync` and `truncateSync` both throw · size checks fire for ≥3 intervals · keeper alive, RPC still forwarded, no shutdown, at most one attempt per interval (test-plan #X3).
- [x] 2.13 Test: interval-path throw does not end the session — Triple: rotation throws from inside the `setInterval` callback · timer fires · keeper exit code is not 1 and the pi child is still running (test-plan #X4).
- [x] 2.14 Test: rotation never stalls the RPC path — Triple: capture on, cap 64 KiB, child writing continuously while RPC lines go through `writeRpc` · 200 writes across ≥5 rotations · every `writeRpc` returns true within the 350 ms × 3 budget, zero dropped lines (test-plan #P1).
- [x] 2.15 Test: bounded growth soak (fast profile) — Triple: cap 64 KiB via env, child writes ~10 MiB continuously · ~20 s · log never observed ≥ 2× cap at any 200 ms sample, inode constant throughout (test-plan #P2).
- [x] 2.16 Test: hot-path check is throttled — Triple: 10 000 `log()` calls inside one `checkIntervalMs` window · single interval · at most one `fstat` (test-plan #P3).

## 3. Startup sweep (keeper-manager.ts)

- [x] 3.1 Add `maxBytes`, `sweepMinAgeMs`, `statsTtlMs` as optional `KeeperManagerOptions` with the documented defaults; the composition root passes `config.keeperLog` values. Do NOT import `loadConfig` into `keeper-manager.ts` — it has no config dependency today and that is what keeps its tests cheap.
- [x] 3.2 Implement the shared `listKeeperLogs()` helper: one `readdir`, match `keeper-<sid>.log` only, exclude `keeper-launch-*.log`, one `stat` per match, behind `isUnsafeTestHomeScan()`. Used by BOTH the sweep and the stats refresh so the measured set and the acted-on set cannot drift.
- [x] 3.3 Implement `sweepKeeperLogs()`: **truncate to zero, never unlink**. Gate = no live keeper *process* (PID sidecar → `isProcessAlive`, NOT `isKeeperAlive`) AND size ≥ `maxBytes` AND `mtime` older than `sweepMinAgeMs`. Return `{ scanned, reclaimedFiles, reclaimedBytes, skippedLive }`. Comment why unlink is forbidden (discovery unlinks sidecars unconditionally; the pi child is a second fd holder).
- [x] 3.4 Run the sweep once per server start after `discoverExistingKeepers()`, log the reclaimed total, and seed the stats snapshot from its result.
- [x] 3.5 Test: sweep size boundary — see `packages/server/src/__tests__/keeper-manager.test.ts`. Triple: dead session, aged logs at `maxBytes - 1` and exactly `maxBytes` · `sweepKeeperLogs()` · first keeps its size, second is 0 bytes, both files still exist (test-plan #E10).
- [x] 3.6 Test: sweep age boundary — Triple: dead session, oversized logs with `mtime` 4 min and 6 min old (`sweepMinAgeMs` 5 min) · `sweepKeeperLogs()` · 4-min untouched, 6-min truncated to 0 (test-plan #E11).
- [x] 3.7 Test: launch logs excluded from the sweep — Triple: `keeper-launch-<uuid>.log` at 10× cap, aged, no live process · `sweepKeeperLogs()` · size unchanged, not counted in `reclaimedBytes` (test-plan #E12).
- [x] 3.8 Test: option defaults — Triple: `createKeeperManager()` with no threshold options · sweep + stats run · thresholds behave as 128 MiB / 5 min / 60 s at those boundaries (test-plan #E15).
- [x] 3.9 Test: live keeper's log survives — Triple: live keeper process with a valid PID sidecar, oversized aged log · `sweepKeeperLogs()` · size unchanged, counted as skipped-live (test-plan #X5).
- [x] 3.10 Test: live keeper with a dead pi survives (the `isKeeperAlive` trap) — Triple: keeper process alive, pi PID sidecar naming a dead pid, oversized aged log · `sweepKeeperLogs()` · size unchanged (test-plan #X6).
- [x] 3.11 Test: the sweep never unlinks — Triple: mixed fixture (live/dead × oversized/small × old/fresh, plus launch logs) · `sweepKeeperLogs()` · `readdir` set equality before and after (test-plan #X7).
- [x] 3.12 Test: truncate failure does not fail startup — Triple: `truncateSync` throws EACCES for one of three reclaimable files · server start runs the sweep · other two reclaimed, sweep resolves, startup completes (test-plan #X8).
- [x] 3.13 Test: unsafe test home blocks the sweep — Triple: `isUnsafeTestHomeScan()` forced true, oversized aged dead log present · server start · no `readdir`, file untouched, startup normal (test-plan #X9).

## 4. Health observability

- [x] 4.1 Implement the cached keeper-log stats snapshot over `listKeeperLogs()`: `totalBytes`, `fileCount`, `largestBytes`, `runawayFiles` (≥ 2× cap), `launchLogFiles`, `launchLogBytes`; `reclaimedBytes` owned by the sweep and NOT recomputed on refresh. Lazy refresh at most once per `statsTtlMs`.
- [x] 4.2 Add `keeperLogs` to the `/api/health` payload in `packages/server/src/routes/system-routes.ts` next to `storeTrim`, with an explicitly typed `EMPTY_KEEPER_LOG_STATS` constant for the degraded case (per the documented `EMPTY_TRIM_STATS` convention).
- [x] 4.3 Test: launch logs counted separately — see `packages/server/src/__tests__/health-shape.test.ts`. Triple: two `keeper-launch-*.log` totalling 4 KiB plus one keeper log · stats refresh · `launchLogFiles == 2`, `launchLogBytes == 4096`, `fileCount`/`totalBytes` exclude them (test-plan #E13).
- [x] 4.4 Test: `runawayFiles` threshold — Triple: logs at `maxBytes`, `2×maxBytes − 1`, `2×maxBytes` · stats refresh · `runawayFiles == 1`, `largestBytes == 2×maxBytes` (test-plan #E14).
- [x] 4.5 Test: missing sessions directory — see `packages/server/src/__tests__/health-endpoint.test.ts`. Triple: `sessionsDir` deleted before a refresh · `GET /api/health` · 200 and `keeperLogs` equals the typed zero constant (test-plan #X10).
- [x] 4.6 Test: `reclaimedBytes` survives a refresh — Triple: sweep reclaims 3 MiB, TTL expires, rescan runs · second stats read · still reports 3 MiB (test-plan #X11).
- [x] 4.7 Test: health does not amplify into a directory scan — Triple: 50 `GET /api/health` inside the TTL · 60 s window · exactly one `listKeeperLogs()` invocation (test-plan #P4).
- [x] 4.8 Test (L3): health payload shape — see `tests/e2e/bridge-contention-health.spec.ts` for the harness glue; read the port from `.pi-test-harness.json` (`dashboardPort`), never `:18000`. Triple: harness dashboard · `GET /api/health` · body has `keeperLogs` with all seven numeric fields (test-plan #F1).
- [x] 4.9 Test (L3): runaway signal reaches the API — see `tests/e2e/ended-session-endedat.spec.ts` for out-of-band harness filesystem seeding. Triple: harness `sessionsDir` seeded with `keeper-<uuid>.log` at 2× cap · wait past the stats TTL, `GET /api/health` · `runawayFiles ≥ 1` and `largestBytes ≥ 2× cap` (test-plan #F2).

## 5. Windows verification (qa VM cadence, not a CI gate)

- [x] 5.1 Test (L2): Windows truncation path — new `qa/tests/*.ps1`, see `qa/tests/02-server-start.ps1` for the script harness. Triple: Windows VM, keeper with cap 64 KiB, capture on, child writing · child drives the log past the cap · log size drops below the cap, file not renamed or removed, keeper alive and still forwarding RPC (test-plan #E16).
- [x] 5.2 Register the new script in `qa/README.md`'s test list; do NOT wire it into the `windows-latest` CI leg (resolved clarification: VM cadence only).
- [ ] 5.3 (DEFERRED to Windows VM QA cadence by user decision at ship time 2026-11-19 — script written + registered per 5.1/5.2; run on the VM per qa/README.md item 9) Run it on the Windows VM and record the outcome — this is the pass that decides whether `ftruncateSync` on an `O_APPEND` handle works there or the path fallback carries every rotation.

## 6. Verification and docs

- [x] 6.1 Full suite: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then grep `FAIL|Error|✗|✘|Tests +[0-9]+ (failed|passed)`; confirm no regression in `keeper.test.ts`, `keeper-env.test.ts`, `keeper-manager.test.ts`, `health-*.test.ts`.
- [x] 6.2 Run the L3 specs against the docker harness per `.pi/skills/run-dashboard-e2e-local-changes/SKILL.md` so they exercise local code, not a cached image.
- [x] 6.3 Manual evidence run on a live dashboard: enable `keeperLog.capturePiOutput`, set a small `maxBytes`, run a real session, confirm the live log stays bounded while pi keeps writing into it, and capture `/api/health` `keeperLogs` before/after.
- [x] 6.4 Update the directory `AGENTS.md` rows for `keeper.cjs`, `keeper-manager.ts`, `system-routes.ts`, `config.ts`, and the new qa script with `See change: fix-runaway-keeper-log-growth`; delegate any `docs/` prose to DocScribe in caveman style.
- [x] 6.5 Run `openspec validate fix-runaway-keeper-log-growth --strict` and `node scripts/check-conventions.mjs`.
