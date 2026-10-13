## Why

The `add-claude-code-plugin` spike (2026-10-12) tested `pi-dashboard start` against an existing instance (temp HOME, ports 18555/18556). It never produced a second listening server, but it misreports state and can damage a running server's ownership records. That matters most on an overloaded server, the case the `unwedge-dashboard-event-loop` skill describes. Scripts and agents that call `pi-dashboard start` / `status` are exposed directly. The bridge auto-start bypasses `start` (it calls `launchDashboardServer`), but the server it spawns runs the same lock-reclaim code, so it can damage a frozen holder's lock record in the same way.

`add-claude-code-plugin` works around these flaws (it starts only on "connection refused") and does not depend on this change.

## What Changes

1. **A healthy dashboard counts as running even without `server.pid`.** Today `cmdStart` (`packages/server/src/cli.ts`) checks `isServerRunning` (which needs a live `server.pid`), then only `portConflict`. A healthy dashboard on the port with no pid file falls through to a launch. Observed: the CLI spawned a child, the child attached to the per-HOME lock and exited, and the CLI printed "Dashboard server started (pid A)". Fix: when `/api/health` identifies a dashboard, print "already running (pid N)" and do not spawn.
2. **No false "started".** When the launch loses to the lock or attaches, report "already running", not "started".
3. **A slow health check is not a stale pid.** `isServerRunning` (`spawn-process/server-pid.ts`) deletes `server.pid` after one 2 s health timeout while the process is alive. Observed against a frozen (`SIGSTOP`) instance:
   - `server.pid` was deleted;
   - the child process reclaimed the home lock ("holder unreachable") and overwrote the lock metadata with its own pid, then died on EADDRINUSE;
   - the live server was left with no pid file and lock meta pointing at a dead pid.

   `pi-dashboard stop` still found it via the health identity. Fix:
   - bounded retries (`isDashboardRunning` already supports `retries` / `timeoutMs`);
   - never remove the pid file of a live process whose port is still held;
   - a live-but-silent holder → report "running but not responding", exit non-zero, no spawn.
4. **`pi-dashboard status --port N` honours the port.** Observed: under a temp HOME with `--port 18555`, `status` reported the mDNS-discovered `:8000` server of another HOME. mDNS results must be filtered to the requested port (and HOME identity, when known).

5. **Reconcile spec text with shipped behaviour.** Found while planning `add-claude-code-plugin`. Each needs a decision: amend the spec, or fix the code.
   - `instance-coordination` "HOME canonicalization" says lock paths derive from the canonical home. The code deliberately roots the lock on the `$HOME`-honouring path (`packages/server/src/lifecycle/home-lock.ts:143-155`), while the Electron reader uses the canonical home (`packages/electron/src/lib/lock-metadata.ts:31-38`).
   - `instance-coordination` "Restart handoff" says the orchestrator waits ≤10 s for the old lock. The code kills, waits ≤5 s for the port, and spawns (`packages/server/src/spawn-process/restart-helper.ts:185-214`).
   - `bridge-auto-start-lifecycle` "Auto-start resolves ports with environment precedence" says usable = `Number(v)` finite and > 0. The code requires integers 1–65535 (`packages/shared/src/config.ts:1194-1203`). Also, the CLI's `start` reads only `--port` / `PI_DASHBOARD_PORT` (`packages/server/src/cli.ts:191`), not `DASHBOARD_PORT`.
   - `server-process-management` "Start fails" says 5 s; the code waits 30 s (`cli.ts:428`). "PID file tracking" says `server.pid` is written on startup; the code writes it after `listen` (`packages/server/src/server.ts:4122`; lock metadata is written earlier, at rendezvous, `:3143`).

In scope (decided during design): a second instance under a *different* HOME can bind `127.0.0.1:8000` next to an existing `*:8000` on macOS (observed, without EADDRINUSE) and take over `localhost`. The per-HOME lock cannot see other HOMEs. `start` probes the IPv4 loopback for any dashboard on the resolved port and refuses one that the current HOME does not own (design D2). The FAQ claim "concurrent starts fail harmlessly" gets corrected for the cross-HOME case.

## Capabilities

### Modified Capabilities

- `server-process-management`:
  - "Start subcommand": already-running detection by health identity; no false "started"; a not-responding holder is refused.
  - "PID file tracking": a live process's pid file is never removed on a health timeout.
  - "Status subcommand" / "mDNS as primary discovery": results filtered to the requested port.
- `home-lock-single-instance`:
  - "Stale-lock reclaim": bounded retries; a live holder that is unresponsive or still starting is never taken over; no takeover by lock-file age alone.
  - "Canonical HOME resolution" and "Lock and metadata paths": lock rooted on the `$HOME`-honouring dashboard dir (item 5).
  - "Lock release on signals and exit": a compromised hold releases nothing.
- `instance-coordination`: "Per-HOME advisory lock", "HOME canonicalization", "Restart handoff", "Server PID file remains advisory", "Graceful release", "Metadata sidecar robustness" (reconcile with code, item 5; unresponsive holder keeps the lock; compromised holder leaves the successor alone; missing metadata stolen only when the lock is not refreshed).
- `server-pid-file`: "Server Liveness Detection with Stale Cleanup": a live pid's file is kept when health does not answer.
- `server-process-management` "Stop subcommand": the pid file is kept when the process survives the kill.
- `electron-server-supervision`: "Lock metadata sidecar read": the reader uses the server's `$HOME`-honouring root (item 5).
- `bridge-auto-start-lifecycle`: "Auto-start resolves ports with environment precedence" (usable-port rule, item 5).

## Impact

- `packages/server/src/cli.ts` (`cmdStart`, status), `packages/server/src/spawn-process/server-pid.ts` (`isServerRunning`), `packages/server/src/lifecycle/home-lock.ts` (reclaim liveness, no mtime steal, non-throwing `onCompromised`), `packages/server/src/lifecycle/home-rendezvous.ts` (promotion tolerates the unresponsive error), new `packages/server/src/lifecycle/` port classifier, `packages/shared/src/server-identity.ts` (additive optional `timedOut` field on `DashboardStatus`), `packages/electron/src/lib/lock-metadata.ts` (lock root aligned with the server).
- Callers: the bridge auto-start (`packages/extension`), Electron attach, and `pi-dashboard restart`.
- No data migration. Behaviour change: `start` against a hung server exits non-zero instead of attempting a launch.

## Discipline Skills

- `systematic-debugging`: reproduce each observed flaw with an isolated-instance test (temp HOME, non-default ports, `SIGSTOP` for "hung") before changing code.
- `doubt-driven-review`: lock-reclaim semantics are shared by the CLI, the bridge auto-start and Electron. Review before changing them.
