## Why

The `add-claude-code-plugin` spike (2026-10-12) tested `pi-dashboard start` against an existing instance (temp HOME, ports 18555/18556). It never produced a second listening server, but it misreports state and can damage a running server's ownership records. That matters most on an overloaded server, the case the `unwedge-dashboard-event-loop` skill describes. Any caller that relies on the CLI is exposed: the bridge auto-start, scripts, and agents.

This stub records the scope so the fix has an owner. Design and tasks are written when it is scheduled. `add-claude-code-plugin` works around these flaws (it starts only on "connection refused") and does not depend on this change.

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

Out of scope, with a note for the design: a second instance under a *different* HOME can bind `127.0.0.1:8000` next to an existing `*:8000` on macOS (observed, without EADDRINUSE) and take over `localhost`. The per-HOME lock cannot see other HOMEs. The design decides whether a cross-HOME port probe belongs here or in the FAQ ("concurrent starts fail harmlessly" is not true across HOMEs).

## Capabilities

### Modified Capabilities

- `server-process-management`:
  - "Start subcommand": already-running detection by health identity; no false "started"; a not-responding holder is refused.
  - "PID file tracking": a live process's pid file is never removed on a health timeout.
  - "Status subcommand" / "mDNS as primary discovery": results filtered to the requested port.
- `home-lock-single-instance`: "Reclaim when the holder is unreachable" requires bounded retries before reclaiming from a live PID.

## Impact

- `packages/server/src/cli.ts` (`cmdStart`, status), `packages/server/src/spawn-process/server-pid.ts` (`isServerRunning`), `packages/server/src/lifecycle/home-lock.ts` (reclaim liveness), `packages/shared/src/server-identity.ts` (probe options only).
- Callers: the bridge auto-start (`packages/extension`), Electron attach, and `pi-dashboard restart`.
- No data migration. Behaviour change: `start` against a hung server exits non-zero instead of attempting a launch.

## Discipline Skills

- `systematic-debugging`: reproduce each observed flaw with an isolated-instance test (temp HOME, non-default ports, `SIGSTOP` for "hung") before changing code.
- `doubt-driven-review`: lock-reclaim semantics are shared by the CLI, the bridge auto-start and Electron. Review before changing them.
