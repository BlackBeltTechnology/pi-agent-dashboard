# Test Plan — fix-runaway-keeper-log-growth

Stage: design   Generated: 2026-11-19

Clarifications resolved before writing (HARD gate):
- **Windows verification vehicle** → qa VM only (`qa/tests/*.ps1`, manual QA cadence, not a CI gate).
- **Bounded-growth soak workload** → fast profile: tiny cap via `PI_KEEPER_LOG_MAX_BYTES` (64 KiB), ~10 MiB written, ~20 s.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Rotation at cap | BVA | L1 | automated | keeper with `PI_KEEPER_LOG_MAX_BYTES=65536`, log at 65 535 B | one size check fires | file size unchanged; no truncation occurred |
| E2 | Rotation at cap | BVA | L1 | automated | same keeper, log at exactly 65 536 B | one size check fires | file size drops to < 65 536 B |
| E3 | Inode preserved under shared fd | state-invariant | L1 | automated | keeper spawned with `PI_KEEPER_CAPTURE_PI_OUTPUT=1`, child holding the fd, cap 64 KiB | child writes past the cap, then writes marker `POST-ROT-<n>` | `stat().ino` identical before/after; `keeper-<sid>.log` contains `POST-ROT-<n>`; size < 64 KiB |
| E4 | No generation retained | EP | L1 | automated | keeper at cap 64 KiB driven through ≥3 rotations | after the third rotation | no `keeper-<sid>.log.1` / `.2` / dated sibling exists in `sessionsDir` |
| E5 | Child-only growth triggers rotation | state-transition | L1 | automated | capture on, keeper emits zero `log()` lines after startup, child writes 1 MiB | the unref'd interval timer fires | log size < 2× cap without any keeper-originated line appearing after the last child byte |
| E6 | Config → env plumbing | decision-table | L1 | automated | `config.keeperLog = {maxBytes: 65536, checkIntervalMs: 250}` | `spawnKeeperFor` builds the spawn env | env carries `PI_KEEPER_LOG_MAX_BYTES=65536` and `PI_KEEPER_LOG_CHECK_INTERVAL_MS=250` |
| E7 | `parseKeeperLogConfig` keeps new keys | EP+BVA | L1 | automated | config.json with `maxBytes: 1048576`, then variants `0`, `-1`, `"big"`, absent | `loadConfig()` | valid → `1048576`; each invalid variant → default `134217728`; `capturePiOutput` unaffected |
| E8 | Env fallback in the CJS keeper | EP | L1 | automated | keeper spawned with `PI_KEEPER_LOG_MAX_BYTES` unset / `""` / `"abc"` / `"0"` | keeper starts | keeper starts normally and rotates at 128 MiB (assert the resolved value it logs at startup, not a 128 MiB write) |
| E9 | Keeper-internal vars stripped from pi | decision-table | L1 | automated | keeper env carries both log vars | keeper spawns its pi child | child env contains neither `PI_KEEPER_LOG_MAX_BYTES` nor `PI_KEEPER_LOG_CHECK_INTERVAL_MS` (same assertion shape as the existing `PI_KEEPER_CAPTURE_PI_OUTPUT` strip) |
| E10 | Sweep threshold boundary | BVA | L1 | automated | dead session, aged log at `maxBytes - 1`, and a second at exactly `maxBytes` | `sweepKeeperLogs()` | the first keeps its size; the second is 0 bytes; both files still exist |
| E11 | Sweep age boundary | BVA | L1 | automated | dead session, oversized log with `mtime` 4 min old vs 6 min old (`sweepMinAgeMs` = 5 min) | `sweepKeeperLogs()` | 4-min file untouched; 6-min file truncated to 0 |
| E12 | Launch logs excluded from sweep | EP | L1 | automated | `keeper-launch-<uuid>.log` at 10× cap, aged, no live process | `sweepKeeperLogs()` | file size unchanged; it is not counted in `reclaimedBytes` |
| E13 | Launch logs counted separately in stats | EP | L1 | automated | two `keeper-launch-*.log` totalling 4 KiB plus one keeper log | stats refresh | `launchLogFiles == 2`, `launchLogBytes == 4096`; `fileCount`/`totalBytes` exclude them |
| E14 | `runawayFiles` threshold | BVA | L1 | automated | logs at `maxBytes`, `2×maxBytes − 1`, and `2×maxBytes` | stats refresh | `runawayFiles == 1` (only the last); `largestBytes == 2×maxBytes` |
| E15 | Options default resolution | EP | L1 | automated | `createKeeperManager()` with no threshold options | sweep + stats run | thresholds resolve to 128 MiB / 5 min / 60 s (assert via behaviour at those boundaries) |
| E16 | Windows truncation path | state-invariant | L2 | automated | Windows VM, keeper with cap 64 KiB, capture on, child writing | child drives the log past the cap | `keeper-<sid>.log` size drops below the cap; the file is not renamed or removed; keeper process still alive and still forwarding RPC (`qa/tests/*.ps1`, VM cadence — not a CI gate) |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Rotation never stalls the RPC path | tail-latency | L1 | automated | capture on, cap 64 KiB, child writing continuously while RPC lines are written via `writeRpc` | every `writeRpc` returns true (budget is `WRITE_RPC_ATTEMPT_TIMEOUT_MS` 350 ms × 3); zero dropped lines | 200 RPC writes across ≥5 rotations |
| P2 | Bounded growth under sustained capture | soak (fast profile) | L1 | automated | cap 64 KiB via env, child writes ~10 MiB continuously | `keeper-<sid>.log` never observed ≥ 2× cap at any 200 ms sample; inode constant throughout | ~20 s |
| P3 | Hot-path check is throttled | threshold | L1 | automated | 10 000 `log()` calls inside one `checkIntervalMs` window | at most one `fstat` per interval (spy/count syscalls or assert elapsed-time bound) | single interval |
| P4 | Health does not amplify into a directory scan | threshold | L1 | automated | 50 `GET /api/health` inside `KEEPER_LOG_STATS_TTL_MS` | exactly one `listKeeperLogs()` invocation | 60 s TTL window |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Health payload shape | state-convergence | L3 | automated | docker harness dashboard at the `.pi-test-harness.json` `dashboardPort` | `GET /api/health` | body has `keeperLogs` with numeric `totalBytes`, `fileCount`, `largestBytes`, `reclaimedBytes`, `runawayFiles`, `launchLogFiles`, `launchLogBytes` |
| F2 | Runaway signal reaches the API surface | state-transition | L3 | automated | harness `sessionsDir` seeded out-of-band with a `keeper-<uuid>.log` at 2× the configured cap | wait past the stats TTL, then `GET /api/health` | `runawayFiles ≥ 1` and `largestBytes ≥ 2× cap` |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Truncation refused → fallback | fault-injection (abort) | L1 | automated | `fs.ftruncateSync` stubbed to throw `EPERM` | size check fires at cap | `fs.truncateSync(logPath, 0)` is attempted and the log ends below the cap |
| X2 | Fallback refuses a swapped path | fault-injection (abort) | L1 | automated | `ftruncateSync` throws; `logPath` replaced with a different inode | size check fires at cap | the replacement file is NOT truncated; rotation recorded as failed |
| X3 | Both truncation paths fail | fault-injection (abort) | L1 | automated | both `ftruncateSync` and `truncateSync` throw | size check fires repeatedly for ≥3 intervals | keeper process still alive; RPC lines still forwarded; no shutdown; at most one attempt per interval |
| X4 | Interval-path throw does not end the session | fault-injection (abort) | L1 | automated | rotation throws from inside the `setInterval` callback (not from `log()`) | timer fires | no `uncaughtException` shutdown: keeper exit code is not 1 and the pi child is still running |
| X5 | Live keeper's log survives the sweep | fault-injection (state) | L1 | automated | live keeper process with a valid PID sidecar and an oversized, aged log | `sweepKeeperLogs()` | file size unchanged; counted as skipped-live, not reclaimed |
| X6 | Live keeper with a dead pi survives the sweep | fault-injection (state) | L1 | automated | keeper process alive, pi PID sidecar naming a dead pid, oversized aged log (`isKeeperAlive` would say false) | `sweepKeeperLogs()` | file size unchanged |
| X7 | Sweep never unlinks | invariant | L1 | automated | mixed fixture: live/dead × oversized/small × old/fresh, plus launch logs | `sweepKeeperLogs()` | every file present before the sweep is present after it (set equality on `readdir`) |
| X8 | Truncate failure does not fail startup | fault-injection (abort) | L1 | automated | `truncateSync` throws `EACCES` for one of three reclaimable files | server start runs the sweep | the other two are reclaimed; sweep resolves; startup completes |
| X9 | Unsafe test home blocks the sweep | fault-injection (env) | L1 | automated | `isUnsafeTestHomeScan()` forced true, oversized aged dead log present | server start | no `readdir` of `sessionsDir`, file untouched, startup normal |
| X10 | Missing sessions directory | fault-injection (abort) | L1 | automated | `sessionsDir` deleted before a stats refresh | `GET /api/health` | 200 response; `keeperLogs` equals the typed zero constant |
| X11 | `reclaimedBytes` survives a refresh | state-transition | L1 | automated | sweep reclaims 3 MiB, then the TTL expires and a rescan runs | second stats read | `reclaimedBytes` still reports 3 MiB (not zeroed by the rescan) |

---

## Coverage summary

- Requirements covered: 5/5 (rotation, config plumbing, sweep, health observability, options seam)
- Scenarios by class: edge 16 · perf 4 · frontend 2 · error 11
- Scenarios by level: L1 30 · L2 1 · L3 2
- Scenarios by disposition: automated 33 · manual-only 0

## New infra needed

- One new Windows qa script (`qa/tests/*.ps1`) for E16. It joins the existing `.ps1` tier and the VM cadence (`make test-windows`); it is explicitly **not** wired into the `windows-latest` CI leg, per the resolved clarification.
- No new harness or level. L3 rows reuse the docker harness; the F2 fixture is seeded out-of-band into the harness `sessionsDir`, matching how existing e2e specs mutate harness state.
