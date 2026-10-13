# Test Plan — harden-dashboard-start-detection

Stage: design   Generated: 2026-10-13

Levels used:
- L1: vitest in `packages/*/src/**/__tests__/`. Real-process L1 rows follow `packages/server/src/__tests__/cli-stop-real.test.ts`: temp HOME under the repo tmp, `freePort()`, real `bin/pi-dashboard.mjs`, POSIX-only where `SIGSTOP` is used.
- L2: `qa/tests/*.sh|*.ps1` VM smoke.

Ports in real-process rows come from `freePort()`, never 8000/9999.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | server-process-management / Start: "Healthy dashboard without a PID file counts as running" | decision-table (owned row) | L1 | automated | temp HOME B with a real dashboard running on `freePort()`; `server.pid` deleted | `pi-dashboard start --port P --pi-port Q` (HOME=B) | stdout contains `already running (pid N)`, where N = `/api/health` pid; exit 0; no second process listening; `server.pid` still absent |
| E2 | Start: "Dashboard of another HOME on the port is refused" | decision-table (unowned row) | L1 | automated | dashboard of HOME A on P; HOME B empty (no `instances/`, no lock meta) | `pi-dashboard start --port P` with HOME=B | stdout/stderr contains `not owned by this HOME` and A's pid; exit 1; A still answers; after the run, no instance-id file exists under B |
| E3 | Start: classify table, conflict row | decision-table (conflict row) | L1 | automated | an HTTP server on P answering `/api/health` with 200 `{"foo":1}` | `cmdStart` with `port=P` | port-conflict message; exit 1; `launchDashboardServer` mock called 0 times |
| E4 | Start: "A stale PID file naming an unrelated live process does not block start" | decision-table (free row) | L1 | automated | `server.pid` = pid of a live `sleep 60` child; P refused; no lock meta | `cmdStart` (classifier deps injected) | `launchDashboardServer` called once; `server.pid` not removed by the classifier |
| E5 | Start: "A dashboard still starting is not launched twice" | BVA on `startedAt` grace (30 s) | L1 | automated | lock meta `{ pid: live, httpPort: P, startedAt: now-29s }`, P refused | `classifyDashboardPort` | kind `starting`, pid = meta.pid; `cmdStart` prints `starting (pid N)`, exit 0, launch mock not called |
| E6 | Start: `starting` grace boundary | BVA on `startedAt` grace (30 s) | L1 | automated | same as E5 but `startedAt: now-31s` | `classifyDashboardPort` | kind `free` (launch allowed) |
| E7 | Start ownership = stop ownership | decision-table (instanceId × lock-meta) | L1 | automated | 4 combos: instanceId match/mismatch × lock-meta pid+port match/no | `classifyDashboardPort` and `stop-ownership` predicate on the same fixtures | identical owned/unowned verdict for all 4 combos (owned iff either matches) |
| E8 | Start: "A slow first answer is not 'not running'" | BVA on retry budget | L1 | automated | `isDashboardRunning` stub: attempt 1 AbortError, attempt 2 owned health | `cmdStart` | `already running`, exit 0, launch mock not called, stub called exactly 2 times |
| E9 | Start: classifier probes both loopbacks | EP (address set) | L1 | automated | probe stub: `127.0.0.1` refused, `::1` answers owned dashboard | `classifyDashboardPort` | kind `owned`; stub invoked for both `127.0.0.1` and `::1` |
| E10 | Start: free port costs one attempt per address | EP (refused partition) | L1 | automated | probe stub returns refusal for every address | `classifyDashboardPort` | each address probed exactly once (no retries, no sleep calls) |
| E11 | Start: post-launch "started" only when the classifier sees the child | decision-table (childPid match) | L1 | automated | launch mock resolves `{ childPid: 111, reportedPid: 111 }`; classifier after readiness returns `owned` pid 111 | `cmdStart` | stdout `Dashboard server started (pid 111)`, exit 0, kill mock not called |
| E12 | Start: "A launch that loses to an existing dashboard is not reported as started" | decision-table (childPid mismatch) | L1 | automated | launch mock `{ childPid: 111, reportedPid: 222 }`; classifier returns `owned` pid 222; child 111 alive | `cmdStart` | no `started` line; stdout `already running (pid 222)`; exit 0; kill mock called with 111 |
| E13 | Status: "Status honours an explicit port" | EP (mDNS port filter) | L1 | automated | `discoverDashboard` stub returns a local record on 8000; P refused | `cmdStatus({ port: P, piPort: Q })` | stdout `Dashboard server is not running`; exit 1; stdout does not contain `8000` |
| E14 | Status: "Status of a same-port dashboard of another HOME" | decision-table | L1 | automated | mDNS local record on P; health instanceId `X`; no persisted id; no lock meta | `cmdStatus` | stdout contains `not owned by this HOME`; exit 1 |
| E15 | Status: "Status when running" with mDNS hostname | state (owned) | L1 | automated | mDNS record on P with host `h.local`; owned health | `cmdStatus` | stdout `Dashboard server is running (pid N) on port P`; exit 0 |
| E16 | server-pid-file: "Live process but dashboard not responding (recycled PID)" | state-transition | L1 | automated | `server.pid` = live pid; `isDashboardRunning` stub always `{running:false, timedOut:true}` | `isServerRunning(P)` | returns null; `server.pid` exists, byte-identical |
| E17 | server-pid-file: "Dead process PID" | state-transition | L1 | automated | `server.pid` = pid of an exited child | `isServerRunning(P)` | returns null; `server.pid` removed |
| E18 | Stop: "Stop that fails to terminate keeps the PID file" | fault-injection (abort) | L1 | automated | `readPid` = 4242; `isProcessAlive` true before and after; `killProcess` mock returns false | `cmdStop` (deps injected, as in `cli-stop.test.ts`) | `removePid` mock not called |
| E19 | Stop: "Stop with stale PID" regression | state | L1 | automated | `readPid` = dead pid | `cmdStop` | `removePid` called once; line begins `Dashboard server is not running` |
| E20 | DashboardStatus `timedOut` semantics (design D1) | EP (outcome partitions) | L1 | automated | fetch stub per case: AbortError ×3, ECONNRESET ×3, ECONNREFUSED, 200 foreign JSON, 200 health | `isDashboardRunning(P, h, {retries:2})` | `{running:false,timedOut:true}` for abort and reset; `{running:false}` (no `timedOut` key) for refusal; `{running:false,portConflict:true}` for foreign; `{running:true,pid}` for health |
| E21 | bridge-auto-start-lifecycle: "Fractional or out-of-range environment values are unusable" | BVA (1–65535, integer) | L1 | automated | `DASHBOARD_PORT` ∈ {`"8000.5"`, `"-1"`, `"0"`, `"65536"`, `"70000"`} plus `"1"` and `"65535"`; config port 8001 | `resolveDashboardPorts(env, {port:8001})` | invalid → 8001; `"1"` → 1; `"65535"` → 65535 |
| E22 | instance-coordination: "Electron reads the lock where the server wrote it" + electron-server-supervision: "Reader and server agree under a HOME override" | EP (HOME override) | L1 | automated | `HOME=<tmp>` | electron `getLockMetaPath()` vs server `getMetaPath()` | paths are equal and both under `<tmp>/.pi/dashboard/` |
| E23 | home-lock: "Lock and metadata paths" `bindHost` optional | EP | L1 | automated | metadata JSON without `bindHost`; metadata with `bindHost: "10.0.0.5"` | `readMetadataDetailed` | both `status: "ok"`; second exposes `bindHost` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Start: bounded retry budget on a silent port (design D2) | threshold (count) | L1 | automated | probe stub: every attempt AbortError, on 3 addresses (loopbacks + bindHost) | probe attempts = 3 per address (retries: 2), run in parallel: total injected sleep calls = 2 per address, and a fake clock shows ≤ 7 s elapsed | single call |

### Frontend-quirk

None. No client surface is touched.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Start: "Frozen dashboard is refused, not replaced" | fault-injection (delay: SIGSTOP) | L1 | automated | real dashboard on P under temp HOME B, then `kill -STOP <pid>` (POSIX only; skip on win32) | `pi-dashboard start --port P --pi-port Q` (HOME=B) | output contains `running but not responding (pid N)`; exit 1; `server.pid` and `server.lock.meta.json` byte-identical before/after; after `kill -CONT`, `/api/health` answers with the same pid |
| X2 | Status: "Status of a live but unresponsive server" | fault-injection (delay: SIGSTOP) | L1 | automated | as X1 | `pi-dashboard status --port P --pi-port Q` | contains `running but not responding`; exit 1; `server.pid` unchanged |
| X3 | home-lock: "An unresponsive live holder is never reclaimed" | fault-injection (delay) | L1 | automated | lock held in-process by holder A (meta pid = live child pid, httpPort = P); probe stub always times out | second `acquireOrAttach` | rejects with `E_INSTANCE_UNRESPONSIVE`, reason `timeout`; `<lockPath>.lock` dir still exists; meta byte-identical |
| X4 | home-lock: "A frozen holder past the lock-file stale window is not taken over" | fault-injection (stale mtime) | L1 | automated | `<lockPath>.lock` dir with mtime set to now-60s (`utimesSync`); meta pid = live pid; probe times out | `acquireOrAttach` | rejects `E_INSTANCE_UNRESPONSIVE`; dir and meta unchanged (proper-lockfile did not steal) |
| X5 | home-lock: "A holder still starting is not reclaimed" | fault-injection (abort: refused) + BVA | L1 | automated | meta `{pid: live, startedAt: now-5s}`; probe refused on both loopbacks | `acquireOrAttach` | rejects `E_INSTANCE_UNRESPONSIVE`, reason `starting`; dir and meta unchanged |
| X6 | home-lock: "Reclaim when the holder is unreachable" (recycled pid) | fault-injection (abort: refused) + BVA | L1 | automated | meta `{pid: live unrelated, startedAt: now-120s}`; probe refused on all addresses | `acquireOrAttach` | `mode: "acquired"`; new meta pid = `process.pid` |
| X7 | home-lock: verdict honours `bindHost` | fault-injection (abort on loopback only) | L1 | automated | meta `{pid: live, startedAt: now-120s, bindHost: "10.0.0.5"}`; loopbacks refused; bindHost probe answers matching identity | `acquireOrAttach` | `mode: "attach"`; lock not reclaimed |
| X8 | home-lock: "Reclaim when the holder PID is dead" (immediate) | state-transition | L1 | automated | `<lockPath>.lock` dir with mtime = now (fresh); meta pid = dead pid | `acquireOrAttach` | `mode: "acquired"` within one call, with no wait for the 10 s stale window; meta pid = `process.pid` |
| X9 | home-lock: compare-and-remove race | fault-injection (concurrent) | L1 | automated | dead holder recorded; two `acquireOrAttach` calls started concurrently (`Promise.all`) | both resolve | exactly one `acquired`; the other `attach` (or `E_INSTANCE_UNRESPONSIVE` reason `starting`); final meta identity = the acquirer's; the lock dir exists |
| X10 | home-lock: "Missing metadata with a freshly refreshed lock is not stolen" | fault-injection (missing sidecar) | L1 | automated | `<lockPath>.lock` dir mtime = now; no meta file | `acquireOrAttach` | rejects `E_INSTANCE_UNRESPONSIVE`, reason `starting`; dir still present |
| X11 | home-lock: "Force-steal when metadata is missing after polling" | fault-injection (missing sidecar + stale dir) | L1 | automated | `<lockPath>.lock` mtime = now-30s; no meta | `acquireOrAttach` | `mode: "acquired"`; meta written for `process.pid` |
| X12 | home-lock + instance-coordination: "A taken-over holder does not release its successor's lock" | fault-injection (compromise) | L1 | automated | holder A acquires; simulate takeover (remove A's lock dir, B acquires + writes meta); trigger A's `onCompromised` path | A calls `release()` | no throw / no uncaught exception; B's lock dir and meta still exist and are byte-identical |
| X13 | instance-coordination: "Metadata sidecar robustness / Unreadable metadata refuses takeover" regression | fault-injection (EACCES) | L1 | automated | meta file chmod 000 (POSIX) | `acquireOrAttach` | rejects with an error naming the meta path; lock dir untouched |
| X14 | home-rendezvous promotion tolerates the unresponsive error (design D5.7) | fault-injection | L1 | automated | attach-mode rendezvous; `acquireOrAttach` stub rejects `E_INSTANCE_UNRESPONSIVE` on each promotion tick | 3 ticks | rendezvous mode stays `attach`; no record written; no unhandled rejection |
| X15 | Start: "A crashing launch is reported as a failure" | fault-injection (abort: child exit) | L1 | automated | launch mock rejects `EarlyExitError(1)`; post-exit classifier returns `free` | `cmdStart` | message contains `Check logs at`; exit 1; no `started` / `already running` line |
| X16 | Start: "A launch that loses the bind race to this HOME's dashboard" | fault-injection (abort: child exit) | L1 | automated | launch mock rejects `EarlyExitError(1)`; post-exit classifier returns `owned` pid 333 | `cmdStart` | stdout `already running (pid 333)`; exit 0 |
| X17 | Start: unconfirmed child is terminated | fault-injection | L1 | automated | launch mock `{childPid: 111, reportedPid: 111}`; post-readiness classifier returns `unresponsive`; child 111 alive | `cmdStart` | kill mock called with 111 before the output; output contains `running but not responding`; exit 1 |
| X18 | instance-coordination: "Old server survives SIGKILL" | fault-injection (frozen holder + bind) | L1 | automated | real dashboard A on P (temp HOME), `kill -STOP` A (POSIX only); start a second foreground server B on the same ports and HOME | B runs until exit | B exits non-zero within 30 s; A's lock meta, lock dir and `server.pid` byte-identical; after `kill -CONT`, A answers `/api/health` |
| X19 | Start/Status across OSes (D4 pid equality, no false "started") | process smoke | L2 | automated | clean VM install (Linux `.sh`, Windows `.ps1`), temp-free default HOME | `pi-dashboard start`, then `pi-dashboard start` again, then `pi-dashboard status` | first: line `Dashboard server started (pid N)`, exit 0. Second: `already running (pid N)` with the same N, exit 0. Status: `running (pid N)`, exit 0 |

---

## Coverage summary

- Requirements covered: 14/14 modified requirements. These are the server-process-management requirements PID file tracking, Start, Stop, Status and mDNS; server-pid-file liveness; home-lock Canonical HOME, Lock and metadata paths, Stale-lock reclaim and Lock release; instance-coordination Per-HOME advisory lock, HOME canonicalization, Restart handoff, PID advisory, Graceful release and Metadata robustness; and bridge port resolution. Spec-only reconciliations (restart timings, Canonical HOME scenarios, PID written after the bind) need no new test: the code is unchanged, and existing tests pin it.
- Scenarios by class: edge 23 · perf 1 · frontend 0 · error 19
- Scenarios by level: L1 42 · L2 1 · L3 0
- Scenarios by disposition: automated 43 · manual-only 0

## New infra needed

- None. Real-process rows reuse the `cli-stop-real.test.ts` harness. X19 extends `qa/tests/02-server-start.sh` / `.ps1`.
