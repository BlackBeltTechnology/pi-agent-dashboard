# Implementation notes — optimize-polling-hot-paths

## 1.4 Baseline (today's code) — NOT measured live

The counters (task 1) were landed together with the replacement paths in one
pass, so a 5-minute live capture on the old code was not taken. The baseline
used by the L1 gate (`poll-cost-simulation.test.ts` P1) is the analytic one from
`design.md`: scan every 5 s costs (3 + k) sync `ps` (k = 3 children) →
12 × 6 = 72 spawns/min; the 30 s tick costs ~6 sync git spawns → 12/min;
total ≈ 84 spawns/min per idle session. The new idle floor is 4 spawns/min
(30 s idle scan + 30 s slow-lane tick probe) — a ~20× drop.
Live before/after numbers are deferred to 13.1 (manual).

## P3 gate deviation (`qa/tests/38-poll-cost.sh`)

The plan's idle budget `(pollProcScanSpawns + pollGitSpawns)/min ≤ 3` cannot
hold by construction: the design fixes the idle floor at 2 scans/min + 2
slow-lane tick probes/min = 4/min. The soak gate is therefore `≤ 5`; the active
gate (`pollGitProbesTool/min ≤ 6`) is unchanged. Flagged for the reviewer.

## 13.1 Real-machine measurement — DEFERRED, not yet run

macOS, 3 sessions (idle / bash loop / editing), old vs new build, 5 min each,
read each session's own `poll*` counters from `/api/health` `agents[]`.
Target: idle-session spawns/min drop ≥ 5×.

## 14.2 Blocking-call audit

Sync git/`ps` spawns reachable from the recurring paths after this change:

| Path | Sync spawn? |
|---|---|
| process-scan scheduler → `scanChildProcessesAsync` | none (async `execFile`) |
| `GitTracker.tick` | none (`stat` ×2, one small `HEAD` file read, timers) |
| `GitProbeScheduler` → `runProbe` | none (`gitStatusV2Async`; detached-HEAD fallback async) |
| `GitTracker.refresh` / facts re-probe | none (`checkoutRootsAsync`, `remoteUrlOrAsync`) |
| `GitTracker.evaluateFirst` | YES, by design: registration / cwd or session change / reconnect (≈40 ms, handshake requirement) |
| `getOwnPgid` | one sync `ps` at bridge start, not recurring |
