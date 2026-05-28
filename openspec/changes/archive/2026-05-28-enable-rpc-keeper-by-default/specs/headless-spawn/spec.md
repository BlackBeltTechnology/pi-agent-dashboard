## REMOVED Requirements

### Requirement: Headless spawn opt-in feature flag during rollout

**Reason:** The keeper-mediated spawn was gated behind `useRpcKeeper: boolean` in `~/.pi/dashboard/config.json` during phase-1 rollout (parent change `add-rpc-stdin-dispatch-with-keeper-sidecar`, shipped in v0.5.3). One full release cycle has passed (v0.5.3 → v0.5.4) without keeper-path regressions. The flag is removed and the keeper path becomes the unconditional behavior for headless spawns. Removing the flag eliminates the dual code paths in `process-manager.ts::spawnHeadless`, eliminates the default-broken Windows durability behavior, and fixes the default-broken slash-command experience (`/ctx-stats`, `/curator`, etc.) for all dashboard-spawned headless sessions.

**Migration:** Users who had `useRpcKeeper: false` or `useRpcKeeper: true` set in `~/.pi/dashboard/config.json` may delete those lines. The field is silently ignored by the config loader — no startup warning is emitted. The CHANGELOG `[Unreleased] → Changed` entry documents this. The keeper code itself (`packages/server/src/rpc-keeper/keeper.cjs`, `keeper-manager.ts`, `dispatch-router.ts`) is unchanged from v0.5.4; only the gating is removed.

## MODIFIED Requirements

### Requirement: Headless spawn survives server restart (Unix)
On macOS and Linux, headless pi sessions SHALL be spawned via the keeper sidecar (see `rpc-keeper-sidecar` capability). The dashboard server SHALL spawn the keeper as a detached child process; the keeper SHALL spawn pi with `stdio: ["pipe", logFd, logFd]` and own pi's stdin pipe.

The keeper SHALL outlive the dashboard server. When the dashboard server exits, the keeper SHALL continue running with pi attached. When the new dashboard server starts, it SHALL discover the keeper via the socket-scan reconnect path (see `rpc-keeper-sidecar` Requirement "Server reconnect to existing keepers on startup") and resume RPC dispatch routing.

The keeper path is unconditional. There is no feature flag and no legacy non-keeper fallback. The previous `sh -c "tail -f /dev/null | pi --mode rpc"` shell wrapper is retired. Durability is provided by the keeper. The `headlessPidRegistry` SHALL track BOTH the keeper PID and the pi PID per session; the existing `byCwd / byPid / byToken` indexing handles the spawn-PID-vs-session-PID correlation as today (see `spawn-correlation` capability).

#### Scenario: Server exits while headless agent is running (Unix)
- **WHEN** the dashboard server exits (graceful `/api/shutdown` or SIGTERM) on macOS or Linux while a headless session is active
- **THEN** the session's keeper process SHALL continue running
- **AND** pi SHALL continue running with stdin still held by the keeper
- **AND** the bridge extension inside pi SHALL continue forwarding events over WebSocket (with reconnection backoff)

#### Scenario: New server reconnects to existing keeper on startup
- **WHEN** the new dashboard server starts and finds a `<sessionId>.rpc.sock` whose keeper PID and pi PID are both alive
- **THEN** the server SHALL register the session as RPC-dispatch-ready
- **AND** the server SHALL NOT spawn a new keeper for this session
- **AND** the server SHALL NOT kill the existing keeper or pi

#### Scenario: No legacy fallback when keeper spawn fails
- **WHEN** the keeper spawn itself fails (e.g. `node <path>/keeper.cjs` ENOENT, UDS bind error)
- **THEN** `spawnPiSession` SHALL return `{ success: false, code: "PI_CRASHED", ... }`
- **AND** no fallback to a legacy `tail -f /dev/null` wrapper SHALL be attempted

### Requirement: Headless spawn on Windows uses keeper for durability parity
On Windows, headless pi sessions SHALL be spawned via the same keeper sidecar pattern as Unix. The keeper SHALL listen on a Windows named pipe (`\\.\pipe\pi-rpc-<sessionId>`) and own pi's stdin via `stdio: ["pipe", logFd, logFd]`. The keeper path is unconditional on Windows — there is no fallback to direct-stdin piping from the dashboard server to pi.

This replaces the previous Windows behavior where the dashboard server piped pi's stdin directly, which meant pi died with the dashboard server on every restart. With the keeper as the only path, Windows now matches Unix unconditionally: pi survives across dashboard server restarts.

#### Scenario: Server exits while headless agent is running (Windows)
- **WHEN** the dashboard server exits on Windows while a headless session is active
- **THEN** the session's keeper process SHALL continue running
- **AND** pi SHALL continue running with stdin held by the keeper
- **AND** when the new server starts, it SHALL reconnect via the named-pipe scan

#### Scenario: No direct-stdin pipe from dashboard server to pi
- **WHEN** any headless session is spawned on Windows
- **THEN** the dashboard server SHALL NOT open a stdin pipe directly to the pi child
- **AND** all stdin writes destined for pi SHALL be routed through the keeper's named pipe
