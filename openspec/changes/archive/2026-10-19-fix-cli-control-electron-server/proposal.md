## Why

Issue: https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/924

When the Electron app is running, it starts its own bundled dashboard server. The locally installed `pi-dashboard` CLI can see that a server is running, but it can't work with it: `status` and the default command fail, and `pi-dashboard stop` can't stop it.

The issue suspects an ownership or PID-file mismatch between the Electron-bundled server and the server a local install would start. Possible causes: a different install path, a different PID or lock file, or Electron adopting or respawning the process. Related: #531 (Electron zombie-adoption on macOS). Not yet diagnosed; the first task is root-cause.

Relevant code: `packages/server/src/cli.ts` (`readPid`, `removePid`, `killProcess`, `restart` delegating to `/api/restart`), `packages/server/src/spawn-process/server-pid.ts`, and the Electron supervisor (`electron-server-supervision` spec).

Planning-time findings (macOS, live Electron 0.9.0 server, same HOME):
- **Confirmed defect.** `/api/health` publishes `launchSource` / `launchSourceEffective` (`"electron"`) but no `starter`. Electron reads `health.starter` in four places: quit-time shutdown (`stopServerIfNeeded` → `decideShutdownOnQuit`), `update-checker.ts`, `doctor.ts`, and the `launch-source.ts` attach probe. So quitting the app never stops the server it spawned. That server outlives the app as an orphan, which is the precondition for #531 zombies. The removal was deliberate: `eliminate-electron-runtime-install` task 3.2 says "`launchSource` replaces the legacy `starter`". But that change amended neither the canonical `dashboard-starter-identity` spec (it still requires `health.starter`) nor the Electron consumers. Decided: keep `starter` removed, migrate the consumers to `launchSource`, and amend the spec.
- **Not reproduced: `status`.** The CLI's PID file, lock metadata and instance id all match the Electron server, and `pi-dashboard status` reports it running (exit 0). The reported failure probably depends on the environment (port, HOME, or version skew). It needs an isolated repro.
- **Likely: bare `pi-dashboard`.** Foreground mode does not classify the port first. With a server already running, it enters home-lock attach mode, the bind fails, and it exits as a generic "Failed to start".
- `stop` already kills the Electron server through the PID file. The app does not respawn it; its watchdog routes to the reconnect loading page. But the kill is an unannounced SIGTERM, so a non-pinned pi session started from a terminal can auto-start a replacement server (the race documented on `cmdRestart`). That would read as "stop can't stop it".

## What Changes

- Root-cause how the CLI resolves the running server: PID file location, port, health probe, ownership marker.
- The CLI detects a running server whoever started it, and its non-destructive commands (`status`, open UI) work against it.
- `pi-dashboard stop`, when health proves the server is owned, requests the existing loopback `/api/shutdown` first (it announces the shutdown to bridges, so nothing auto-starts a replacement). It falls back to today's SIGTERM. For a server the open desktop app started, it then prints a note that the app owns it and will show its reconnect page (Start server, or quit the app). Decided: stop + note. Not refuse-by-default, and no app-side "stopped from CLI" state.
- `pi-dashboard status` says when the desktop app started the running server.
- Bare `pi-dashboard`, with a dashboard already serving the port, prints the same verdict `start` would (already running, owner) instead of a generic bind failure. The exit status is unchanged, so spawning parents still classify a port conflict.
- Electron reads the server's launch source from the published `launchSource` field, falling back to legacy `starter`. Quit-time shutdown of the app's own server works again.
- No new endpoint and no PID-file format change. Owner facts come from the existing `/api/health` (`launchSource`, `bootParentAlive`, `bootParentPid`).

## Capabilities

### Modified Capabilities
- `server-process-management` — `stop`, `status` and foreground-mode behaviour against a desktop-app-started server.
- `electron-server-supervision` — quit-time ownership reads `launchSource`; every Electron health consumer reads `launchSource`, with a `starter` fallback.
- `dashboard-starter-identity` currently says `/api/health` publishes `starter`, and its quit and update rules read `health.starter`. Amended so `launchSource` replaces `starter`, with a legacy fallback.
- `server-pid-file` is NOT modified: no owner field is needed (owner facts come from health).

## Non-goals

- Changing which server binary Electron bundles.
- Fixing #531 zombie adoption itself. Coordinate with it if the root causes overlap.

## Discipline Skills

- `systematic-debugging` — cause unknown; reproduce first on macOS (and Windows if relevant).
- `doubt-driven-review` — stop semantics across owners. A wrong kill can leave Electron respawning, or orphan sessions.
- `review-code` — before commit.
- No security or perf triggers. No new endpoint is added. `/api/health` is already unauthenticated and the fields read are already published. `/api/shutdown` is an existing `networkGuard` (loopback) route the CLI now calls on itself; no auth change. Foreground mode adds no probe on the happy path (it classifies only after a startup failure).

## Impact

- `packages/server/src/cli.ts`, `packages/server/src/lifecycle/{stop-ownership,classify-dashboard-port}.ts`, `packages/shared/src/server-identity.ts` (`DashboardStatus` gains optional owner fields), `packages/electron/src/lib/{server-lifecycle,update-checker,doctor,launch-source}.ts`.
- Compatibility: data contracts change additively (optional fields only). Electron keeps reading legacy `starter` as a fallback, so an older server still works. An older CLI against a newer server is unchanged. No migration. Rollback = revert.
- Behaviour changes (intended, listed in CHANGELOG):
  - quitting the app stops the server it spawned again;
  - CLI `stop` of a health-proven server goes through `/api/shutdown`, so the exit intent is `"shutdown"` instead of `"signal"` (no recovery offer) and bridges suppress auto-start;
  - the Electron update checker picks its real strategy (Bridge → early return, Standalone → npm check).
