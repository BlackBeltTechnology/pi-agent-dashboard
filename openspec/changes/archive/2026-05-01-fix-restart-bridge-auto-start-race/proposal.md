# fix-restart-bridge-auto-start-race

## Why

Restart of the dashboard server is unreliable. Two surfaces are affected by the same root-cause race:

1. **CLI** — `pi-dashboard restart` (run from any context, including from inside an agent's bash tool) frequently leaves the server offline. Confirmed in the wild via `~/.pi/dashboard/server.log`:

   ```
   [gateway] session unregistered: 019de08d-... (explicit)        ← cmdStop's daemon shutdown broadcast
   [gateway] session unregistered: 019dc9f2-... (explicit)
   [gateway] session unregistered: 019de05f-... (explicit)
   [gateway] session unregistered: 019de13d-... (explicit)
   [gateway] connection closed: ...
                                                                  ← NO `pi-dashboard start (parent pid …)` header
                                                                  ← gap of ~3 hours
   [2026-05-01T01:58:03.898Z] bridge auto-start (parent pid 85953, port 8000)
   ```

   The user had to open a new terminal pi session — whose bridge auto-started the dashboard — to recover. `cmdStart()` never ran (or returned early without writing its log header) because of the race documented below.

2. **Settings UI / Electron** — clicking restart in the dashboard, or any caller of `POST /api/restart`, has the same flaw: `restart-helper.ts`'s detached orchestrator polls the port for free, then spawns. While it polls, every connected bridge's WebSocket has just closed and `server-auto-start.ts` is independently probing and racing to spawn a replacement on the same port. Loser hits `EADDRINUSE` silently; winner determines who supervises the new server.

   For Electron specifically the consequence is worse: `launchServer()` deliberately spawns the server with `detach: false` so it stays inside Electron's Job Object / process group; whichever bridge or orchestrator wins the post-restart race spawns with `detached: true`, so the new server is **outside** Electron's lifecycle supervision. `serverStartedByUs` is now stale and `stopServerIfNeeded()` only works because of the `/api/shutdown` HTTP fallback.

### Root cause (single sentence)

When the dashboard process exits intentionally (CLI `cmdStop`, `/api/restart`, `/api/shutdown`-during-restart), N connected bridges instantly fire `server-auto-start.ts` probes and race the intended restart path to bind the port; there is no signal telling bridges "this is a restart, hold off".

### Why the CLI fails specifically

`packages/server/src/cli.ts` (subcommand `restart`):

```ts
case "restart":
  await cmdStop();         // kills daemon → all bridges' WS die → bridges fire auto-start
  await cmdStart(config);  // checks isServerRunning(port) → bridge already won → returns early
                           // (logs "Dashboard server is already running" to stdout, NOT server.log)
  break;
```

`cmdStart` early-return path bypasses the log-header write, which is exactly the missing line we observed in `server.log`. Whoever the bridge spawned may itself be unstable (spawned from inside a transient tool-execution context with stdio inherited from the agent's shell), so the user observes "Server offline" even though the start log line never appeared.

## What Changes

Three small, independent fixes that together remove the race:

### 1. CLI: route `pi-dashboard restart` through `/api/restart` when the dashboard is up

Mirror the existing `cmdUpgradePi` pattern (`cli.ts`):

- New `cmdRestart(config)` probes `isDashboardRunning(config.port)`.
- If running → `POST http://localhost:<port>/api/restart` (with `{dev}` body matching the requested mode), then exit. The proven `restart-helper.ts` orchestrator is now the single restart path.
- If not running → fall back to the existing `cmdStop()` + `cmdStart()` sequence.

This eliminates the race between cmdStop and bridge auto-start because the orchestrator doesn't run inside the agent's bash-tool process; it runs after the original server's `process.exit(0)`, in a fresh detached node child, after every bridge has already had a chance to probe.

### 2. Protocol: `server_restarting` broadcast + bridge quiescence window

- **NEW message** in `src/shared/protocol.ts`: `ServerToExtensionMessage` adds `server_restarting { reason: "restart" | "shutdown"; quiesceMs: number }` (default 5000).
- `POST /api/restart` and `POST /api/shutdown` broadcast `server_restarting` to every connected bridge **before** `process.exit(0)` (already deferred 100–200 ms; reuse that window).
- `packages/extension/src/connection.ts` exposes a one-shot `pauseAutoStart(ms)` setter on `ConnectionManager`. `bridge.ts`'s server-message dispatch calls it on receipt of `server_restarting`.
- `autoStartServer(...)` is wired with a `shouldSuppressAutoStart()` predicate; while the quiesce window is active, the auto-start step is **skipped** — the connection just reconnects with normal exponential backoff. Discovery (mDNS + health check) still runs, so the bridge will pick up the new server as soon as it advertises.

Quiesce default 5 s is generous: `restart-helper.ts`'s orchestrator typically completes in <2 s.

### 3. Orchestrator hardening: kill the old PID explicitly + verify Electron-aware supervision

`restart-helper.ts::buildOrchestratorScript`:

- Read the PID file (`~/.pi/dashboard/dashboard.pid` — already managed by `server-pid.ts`) at orchestrator start; if alive, send SIGTERM, wait up to 3 s for it to exit, then SIGKILL. Removes the "wait for the daemon to self-exit" ambiguity and tightens the port-free poll.
- Document (and pin a unit test) that `process.execPath` for the orchestrator is the bundled/system Node binary and **not** Electron's `Electron.app/Contents/MacOS/Electron`. When the dashboard runs as a child of Electron, `execPath` is already correct because the dashboard server itself is a Node child, not the Electron main process — but a regression test guarding this prevents future drift if the lifecycle is reorganised.

## Capabilities

### Modified Capabilities

- `server-restart`: NEW capability spec (no existing spec). Defines the restart contract: how a restart is initiated, the `server_restarting` broadcast, the bridge quiescence window, and the supervision hand-off rules. Required because the existing protocol/server specs do not state a restart contract — every fix to date has been point-in-time and the contract has drifted.

## Impact

- **`packages/server/src/cli.ts`** — add `cmdRestart()` (~30 lines), wire `case "restart"`. Keeps `cmdStop`+`cmdStart` as the offline fallback.
- **`packages/server/src/restart-helper.ts`** — augment orchestrator script: read PID file, SIGTERM/SIGKILL old daemon. ~15 lines of generated JS.
- **`packages/server/src/routes/system-routes.ts`** — broadcast `server_restarting` to `piGateway` before `spawnRestart()` and before `/api/shutdown` exit.
- **`packages/shared/src/protocol.ts`** — add `server_restarting` to `ServerToExtensionMessage` union.
- **`packages/extension/src/connection.ts`** — add `pauseAutoStart(ms)` and a `suppressUntil` timestamp.
- **`packages/extension/src/bridge.ts`** — handle `server_restarting`, call `pauseAutoStart(quiesceMs)`.
- **`packages/extension/src/server-auto-start.ts`** — accept `shouldSuppressAutoStart` predicate; skip step 3 (auto-start) while suppressed.

### Tests

- **`packages/server/src/__tests__/cli-restart.test.ts`** (NEW) — verify `cmdRestart` POSTs `/api/restart` when dashboard is up, falls back to local sequence when down.
- **`packages/server/src/__tests__/restart-helper.test.ts`** (extend) — orchestrator script kills PID-file PID before polling.
- **`packages/extension/src/__tests__/connection-suppress-auto-start.test.ts`** (NEW) — `pauseAutoStart` blocks `autoStartServer` step 3 within window, allows after expiry.
- **`packages/server/src/__tests__/system-routes-restart.test.ts`** (extend) — `/api/restart` broadcasts `server_restarting` to every connected bridge before exit.
- **Integration**: a `vitest` scenario simulating N bridges + `/api/restart`; assert exactly one server respawn, `bridge auto-start` header NOT present in the test log, restart completes in <3 s.

### Out of scope

- The Electron app's *application-level* relaunch (Cmd+Q + reopen, auto-update post-install relaunch). Those go through `app.relaunch()` in `app-updater.ts` and are not affected by this race.
- mDNS rendezvous tuning. Bridges will still discover the new server via mDNS browse during the quiesce window — that path is correct; we are only suppressing the *spawn* step, not discovery.
- Removing `serverStartedByUs` lifecycle drift in Electron. Tracked separately if it surfaces; this change makes the post-restart server reach Electron via the same supervision channel as the original (both use the orchestrator now), which should reduce — but won't fully solve — the Job-Object detachment concern. A follow-up may have Electron register a one-shot listener for `server_restarting` to reattach lifecycle handles.

## Migration / Compatibility

- `server_restarting` is additive on the bridge protocol union. Older bridges (pre-this-change) ignore the message and continue to race auto-start as before — strictly no worse than today, and the CLI fix in (1) already removes the worst case for them.
- No persisted-state migrations.
- No client (browser) impact — `server_restarting` is on the extension protocol, not browser protocol. The browser already sees the disconnect/reconnect via WS close + `useWebSocket` retry.
