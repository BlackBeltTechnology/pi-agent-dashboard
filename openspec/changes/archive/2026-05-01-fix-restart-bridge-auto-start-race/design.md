# Design — fix-restart-bridge-auto-start-race

## Context

The dashboard has three independent restart paths today:

1. **CLI** — `pi-dashboard restart` runs in-process: `cmdStop()` then `cmdStart()`.
2. **HTTP** — `POST /api/restart` flushes state, calls `spawnRestart()` (a detached `node -e` orchestrator), then `process.exit(0)`.
3. **Bridge auto-start** — every connected pi bridge runs `server-auto-start.ts` whenever its WebSocket fails: mDNS discovery → health check → `launchServer(...)`.

Path 3 is the safety net that keeps the dashboard available when no one explicitly started it. It is also a saboteur of paths 1 and 2: the moment paths 1 or 2 cause the listening server to die, every bridge (potentially N ≥ 1, in practice 5–15 for a busy workspace) sees its WS close and races to spawn a replacement on the same port.

Concrete failure observed in `~/.pi/dashboard/server.log`:

```
[gateway] session unregistered: ... (explicit) × 12         ← cmdStop's broadcast
[gateway] connection closed: ... × 12
                                                            ← NO `pi-dashboard start` header
                                                            ← gap of ~3 hours
[2026-05-01T01:58:03Z] bridge auto-start (parent pid 85953) ← random terminal session resurrected it
```

`cmdStart()` exited early because `isServerRunning(port)` returned true — a bridge had already won the race and started something on port 8000. That bridge-spawned server then died (likely killed when the agent's bash tool returned), leaving the user offline.

The same race exists in path 2: `restart-helper.ts`'s orchestrator polls the port for free, then spawns. While polling, bridges' auto-start probes are running concurrently. Either path may bind first.

For Electron the consequence is worse: `launchServer()` deliberately uses `spawnDetached(..., {detach: false})` so the child server stays inside Electron's Job Object. Whoever wins the post-restart race (orchestrator or bridge) spawns with `detached: true`, so the new server is **outside** Electron's lifecycle supervision. Electron's `serverStartedByUs` flag is now stale; `stopServerIfNeeded()` only works because of the `/api/shutdown` HTTP fallback.

### Constraints

- Cannot remove bridge auto-start. It is the cold-start path that lets `pi` sessions bring up the dashboard without user intervention. Any solution must preserve that behaviour outside the restart window.
- Cannot couple the CLI to a running server when the server is down. `cmdStop`+`cmdStart` must remain the offline fallback.
- Protocol additions on the bridge channel must be backward-compatible — there are bridges in the wild on older builds.
- No new external dependencies.

### Stakeholders

- Anyone running `pi-dashboard restart` from an agent's bash tool (today: broken).
- Anyone clicking "Restart" in Settings while logged into the dashboard inside Electron (today: flaky; sometimes survives, sometimes orphans the new server).
- Bridge auto-start cold-start path (must remain functional outside the quiesce window).

## Goals / Non-Goals

**Goals:**

- A `pi-dashboard restart` invocation always results in exactly one running, supervised dashboard server within ≤ 5 s, regardless of how many bridges are connected.
- A `POST /api/restart` invocation has the same property.
- The Electron app's restart goes through the same orchestrator path the CLI does, so there is no second supervision regime to maintain.
- Bridges that pre-date this change (older builds in the wild) are no worse off than today.

**Non-Goals:**

- Application-level Electron relaunch (`app.relaunch()` after auto-update). Different code path; not affected by this race.
- Rendezvous tuning of mDNS or `isDashboardRunning` health-check timing. Discovery still runs during the quiesce window — only the *spawn* step is suppressed.
- Re-attaching Electron's Job Object lifecycle to a server it didn't directly spawn. A follow-up may have Electron observe `server_restarting` and adopt the orchestrator-spawned server, but that is out of scope here.
- Multi-host restart coordination (e.g. dashboard reachable via mDNS from a peer). Restart is local-machine-only.

## Decisions

### D1. CLI delegates to `/api/restart` when the dashboard is up

Mirror the existing `cmdUpgradePi` pattern in `cli.ts`: probe `isDashboardRunning(port)`; if up, POST `/api/restart`; otherwise fall back to local `cmdStop`+`cmdStart`.

**Why over alternatives:**

- *Alt A — fix the in-process race in `cmdStart`*: e.g. retry-on-race, force-kill anything on the port, force-spawn even if `isServerRunning` is true. Rejected: still racing N bridges on every restart, with N growing as workspaces grow. Unstable by construction.
- *Alt B — make CLI synchronously kill all bridges' auto-start*: impossible — bridges are independent processes, no IPC channel.
- *Alt C — current decision*: the orchestrator runs in a fresh detached Node child after the original server's `process.exit(0)`. By the time any bridge can probe, either the orchestrator has already SIGTERMed the old PID and is about to spawn (quiesce window in flight), or the new server is already listening (discovery succeeds, no spawn needed). One restart path, one orchestrator, identical behaviour CLI and HTTP.

### D2. `server_restarting` broadcast + bridge quiesce window

Add a one-line bridge-protocol message (`server_restarting { reason, quiesceMs }`) sent before `process.exit(...)`. Bridges that receive it suppress only the *spawn step* of `server-auto-start.ts` for `quiesceMs` ms (default 5000); discovery and reconnection are unaffected.

**Why over alternatives:**

- *Alt A — bridges sleep N ms after WS close before any reconnect*: rejected. This degrades the cold-start case (server crashed, no `server_restarting`) where we *want* the bridge to come back up fast.
- *Alt B — server-side mutex via lockfile*: rejected. Lockfile cleanup on crash is a known footgun (stale locks block recovery), and we'd reinvent what `isDashboardRunning` already does for free.
- *Alt C — current decision*: explicit, additive, observable. Older bridges that don't understand `server_restarting` ignore it and keep their old behaviour — strictly no worse than today, and the CLI fix in D1 already removes the worst case for them since they no longer have to race the in-process `cmdStart`.

`quiesceMs = 5000` rationale: `restart-helper.ts`'s orchestrator typically completes in < 2 s. Doubling that gives plenty of margin for cold-cache or slow-disk scenarios while keeping the bridge's cold-start path responsive when the restart actually fails (after 5 s, bridges resume normal auto-start).

### D3. Orchestrator kills the old daemon explicitly

Today's orchestrator polls the port for free for up to 10 s, then spawns. It assumes the dying server's `process.exit(0)` will release the port. In practice on macOS/Linux the port is released when the listening socket is closed during `process.exit`'s graceful shutdown — but if Fastify takes > 0 ms to drain in-flight requests, or if the server is wedged, the orchestrator wastes cycles polling.

New orchestrator behaviour:

1. Read `~/.pi/dashboard/dashboard.pid` (already managed by `server-pid.ts`).
2. If the recorded PID is alive, `kill(SIGTERM)`. Wait up to 3 s for the process to exit (poll `kill(0)`).
3. If still alive, `kill(SIGKILL)`.
4. Then poll `portFree(PORT)` for up to 5 s. (Reduced from 10 because step 2/3 already guarantees the server is gone.)
5. Spawn the new server. (Unchanged.)
6. Poll `/api/health`. (Unchanged.)

**Why over alternatives:**

- *Alt A — keep "wait for self-exit"*: works most of the time but has surprising latency when the server is wedged. The "explicit kill" approach is the same primitive `cmdStop` already uses (`platformKillProcess`).
- *Alt B — orchestrator manages the entire stop too, server doesn't `process.exit(0)`*: rejected. Adds new IPC, complicates `/api/shutdown` semantics. Today's "server politely exits, orchestrator confirms" is a clean handoff.

### D4. Single restart capability spec

Adopt `server-restart` as a NEW capability spec (not modifying any existing spec). The restart contract is currently undocumented and has drifted across CLI, HTTP, and Electron paths. A single capability spec with explicit scenarios for each path becomes the regression-test contract.

## Risks / Trade-offs

**[Risk]** Older bridges (pre-this-change) ignore `server_restarting` and continue racing.
**Mitigation:** D1 (CLI delegation to HTTP) eliminates the worst-case path even for old bridges. The HTTP path itself is no worse than today for old bridges — `restart-helper.ts`'s orchestrator already handles "another process bound the port first" by silent EADDRINUSE in the spawned child + successful health check. New bridges progressively eliminate the race over time as builds roll out.

**[Risk]** A bridge crashes and respawns *during* the quiesce window with the old quiesce-suppressed state lost.
**Mitigation:** Discovery still runs during quiesce. A bridge that respawned in mid-window will discover the new dashboard via mDNS or health check as soon as the orchestrator's spawn is up. Worst case: the respawned bridge fires its own auto-start a few seconds late and hits EADDRINUSE silently. Same outcome as today, no regression.

**[Risk]** `quiesceMs` is too short on a slow filesystem (e.g. Windows + antivirus + jiti cold compile).
**Mitigation:** Default 5 s is generous. Operators can tune via a future `~/.pi/dashboard/config.json` field; not in scope for this change. If we observe failures in CI on Windows, raise the default.

**[Risk]** `process.exit(0)` is called *before* the WS broadcast flushes the `server_restarting` frame to slow clients.
**Mitigation:** Reuse the existing 100–200 ms `setTimeout` delay before `process.exit` in `/api/restart` and `/api/shutdown`. WebSocket sends are non-blocking; broadcast immediately, exit after the deferred timeout. A bridge with a stuck/slow socket misses the message — same outcome as today (it falls back to its existing reconnect behaviour).

**[Risk]** Electron-supervised server gets respawned outside the Job Object, and Electron-quit fails to clean it up.
**Mitigation:** Today's behaviour already has this property after every `/api/restart`. `stopServerIfNeeded` falls back to `POST /api/shutdown` over HTTP, which works. Future work (out of scope) can have Electron observe `server_restarting` and adopt the new server. This change does not regress that path.

**[Trade-off]** Adding a protocol message increases the bridge surface area by one switch arm. Acceptable: the message is `server → bridge` only, additive, with a `Record<string, unknown>` payload pattern already used elsewhere. Wire format extension cost is negligible.

## Migration Plan

1. Land this change end-to-end in one PR. The four edits (cli.ts, restart-helper.ts, system-routes.ts, protocol.ts + connection.ts + bridge.ts + server-auto-start.ts) are individually small but interlock.
2. No data migration. No persisted-state schema changes. PID file format unchanged.
3. Older bridges continue working — they ignore the unknown `server_restarting` switch arm. New bridges gain the suppression behaviour. There is no flag day.
4. Rollback strategy: revert the PR. CLI returns to in-process `cmdStop`+`cmdStart`; HTTP returns to today's race-prone orchestrator; bridges drop the message handling. No persisted state to clean up.

## Open Questions

- **Q1** — Should `quiesceMs` be configurable via `~/.pi/dashboard/config.json`? **Working assumption:** no, hardcode 5000 for now. Revisit if Windows CI shows reliability issues.
- **Q2** — Should `/api/shutdown` (graceful, no restart) also use `reason: "shutdown"` and a quiesce window, given that we *don't* want bridges to bring the server back up after a deliberate shutdown? **Working assumption:** yes — `quiesceMs: 60000` for `shutdown` so bridges back off long enough for the user to notice. If the user wants to relaunch, they invoke a new pi session and the auto-start comes back online after the window. (Pinned in spec scenarios.)
- **Q3** — Should the Electron main process register a one-shot listener for `server_restarting` and adopt the orchestrator-spawned server into its Job Object? **Deferred** — out of scope. Tracked as follow-up if `serverStartedByUs` drift becomes a real issue.
