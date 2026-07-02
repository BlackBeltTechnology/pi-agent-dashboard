## Why

GitHub issue #99: "fails to start, and there's no logfile as claimed."

When the **bridge extension** auto-spawns the dashboard server, two coupled defects in the `server-launch` primitive produce a dead-end diagnostic experience on slower hosts:

1. **The 2 s readiness window is too tight for a cold start.** `launchServer` (bridge) calls `launchDashboardServer({ healthTimeoutMs: 2000 })`. On a slow host (e.g. Fedora Silverblue/bootc, jiti compiling the TS server fresh, hundreds of skills loading), the server process *does* spawn and reaches `writePid()` — the user's `~/.pi/dashboard/server.pid` contained a live pid (1944674) — but is not health-OK within 2 s. The bridge declares `readiness timeout` and warns the user, yet the server comes up a few seconds later. This matches the maintainer's comment on the issue ("a few seconds after the warning, is the server actually up?" → yes).

2. **The warning points at a `server.log` the bridge path never writes.** The bridge spawns with `stdio: "ignore"` (server stdout/stderr → `/dev/null`), so `~/.pi/dashboard/server.log` is **never created** on the auto-spawn path. Yet two messages promise it:
   - `server-auto-start.ts` → `Dashboard server failed to start: <msg>\nSee log: ~/.pi/dashboard/server.log`
   - `server-launcher.ts` `EarlyExitError` branch → `… before health check. See ~/.pi/dashboard/server.log`

   The user follows the instruction and gets `cat: …/server.log: No such file or directory`. Zero diagnostics — exactly the issue title.

Root cause: the bridge auto-spawn deliberately disclaims log ownership (`stdio: "ignore"`) but the failure copy assumes the CLI convention (`stdio: { logFile }`). The timeout and the log promise contradict the actual spawn config.

## What Changes

- **Capture bridge auto-spawn output to a log file.** Change the bridge `launchServer` from `stdio: "ignore"` to `stdio: { logFile: <getServerLogPath()> }` so `~/.pi/dashboard/server.log` actually exists when the spawn is slow or crashes. The `server-launch` "Caller-owned log-file policy" already supports this; only the bridge caller and the spec's "Extension auto-spawn" scenario change. This makes the existing failure copy truthful.
- **Lengthen the bridge readiness window** from `healthTimeoutMs: 2000` to a cold-start-tolerant value (proposed 10000 ms; final value decided in design.md). The PID-file-exists-but-not-health-OK case is a slow boot, not a failure. The CLI path already uses 30 s and Electron 15 s; 2 s is the outlier.
- **Only promise the log when it exists.** The `server-auto-start.ts` warning and the `EarlyExitError` message SHALL reference `getServerLogPath()` (the same path now actually written) rather than a hardcoded string, and SHALL be emitted only on the path that owns a log file. No "see log" instruction when no log was written.
- Update `server-launch` spec scenarios for extension auto-spawn (stdio + timeout) and tests.

No protocol or API changes. Behavior change is limited to the bridge auto-spawn path.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `server-launch`: the "Extension auto-spawn" scenario changes from `stdio: "ignore", healthTimeoutMs: 2000` to `stdio: { logFile: getServerLogPath() }, healthTimeoutMs: 10000`. The "Caller-owned log-file policy" extension convention row changes from "no log" to the shared server log path. Failure-path copy (warning + `EarlyExitError`) references the actually-written log path.

## Impact

Affected code:
- `packages/extension/src/server-launcher.ts` — `launchServer` passes `stdio: { logFile }` (via `getServerLogPath()` from shared `dashboard-paths`) and `healthTimeoutMs: 10000`; `EarlyExitError` message references the resolved path.
- `packages/extension/src/server-auto-start.ts` — `logPath` derived from `getServerLogPath()` (shared) instead of an inline `path.join(os.homedir(), …)`; warning emitted only when a log file was owned.
- `packages/shared/src/dashboard-paths.ts` — reuse existing `getServerLogPath()` (no change expected; confirm export).
- Tests: `packages/extension/src/__tests__/` server-launcher + auto-start; `packages/shared` server-launcher scenario tests pinning the extension stdio/timeout contract.

## Open Questions
- Exact cold-start timeout value (8 s vs 10 s vs 15 s). Resolve in design.md against the slowest supported host class.
- Should the bridge log append (shared with CLI) or rotate? Current `{ logFile }` policy is append-only with a header line — likely fine; confirm no unbounded growth concern.
