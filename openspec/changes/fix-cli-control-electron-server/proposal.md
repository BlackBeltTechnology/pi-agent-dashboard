## Why

Issue: https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/924

When the Electron app is running, it starts its own bundled dashboard server. The locally installed `pi-dashboard` CLI can see that a server is running, but it can't work with it: `status` and the default command fail, and `pi-dashboard stop` can't stop it.

The issue suspects an ownership or PID-file mismatch between the Electron-bundled server and the server a local install would start. Possible causes: a different install path, a different PID or lock file, or Electron adopting or respawning the process. Related: #531 (Electron zombie-adoption on macOS). Not yet diagnosed; the first task is root-cause.

Relevant code: `packages/server/src/cli.ts` (`readPid`, `removePid`, `killProcess`, `restart` delegating to `/api/restart`), `packages/server/src/spawn-process/server-pid.ts`, and the Electron supervisor (`electron-server-supervision` spec).

## What Changes

- Root-cause how the CLI resolves the running server: PID file location, port, health probe, ownership marker.
- The CLI detects a running server whoever started it, and its non-destructive commands (`status`, open UI) work against it.
- `pi-dashboard stop` either stops the server or reports clearly that Electron owns it. Supervisor respawn makes a plain kill pointless, so the message names the owner and says how to stop it (quit the app, or use a supervisor-aware stop).
- Decide whether the CLI should ask a supervised server to stop through `/api/...` instead of sending a signal to its PID.

## Capabilities

### Modified Capabilities
- `server-pid-file` — ownership/owner metadata for Electron-started servers.
- `electron-server-supervision` — external stop requests vs respawn.
- (Confirm exact capability names in planning.)

## Non-goals

- Changing which server binary Electron bundles.
- Fixing #531 zombie adoption itself. Coordinate with it if the root causes overlap.

## Discipline Skills

- `systematic-debugging` — cause unknown; reproduce first on macOS (and Windows if relevant).
- `doubt-driven-review` — stop semantics across owners. A wrong kill can leave Electron respawning, or orphan sessions.
- `review-code` — before commit.
- No security or perf triggers expected. Re-check if a new local stop endpoint is added (that would trigger `security-hardening`: local-only and authenticated).

## Impact

- `packages/server/src/cli.ts`, `packages/server/src/spawn-process/server-pid.ts`, `packages/electron` (main-process supervisor).
- Compatibility: the PID-file format may gain an owner field, so it must be read tolerantly. Rollback = revert.
