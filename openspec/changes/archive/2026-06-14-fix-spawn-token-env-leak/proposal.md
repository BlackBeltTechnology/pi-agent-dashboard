# Fix `PI_DASHBOARD_SPAWN_TOKEN` env leak that breaks placeholder-card clearing

## Why

When a user spawns a worktree/OpenSpec session, the real session card appears
but the **placeholder loading card never clears** (it lingers ~30 s until the
safety timeout). Root cause: the single-use spawn-correlation token leaks down
the process tree.

```
server spawnPiSession(worktree)              mintSpawnToken() → 5ca45f23
buildSpawnEnv → env.PI_DASHBOARD_SPAWN_TOKEN = 5ca45f23
      │
      ▼ rpc-keeper holds 5ca45f23 for its whole lifetime
keeper.cjs spawnPi(): deletes PI_KEEPER_PI_ARGS/CMD, NOT the token   ❌ hop 1
      │
      ▼
pi process: bridge reads token, never scrubs process.env             ❌ hop 2
      │
      ▼ every respawn / subagent child inherits 5ca45f23
session_register{ spawnToken: 5ca45f23 } re-reported N times
      │
server: consume(5ca45f23) succeeds ONCE (first register); every reuse → undefined
        → session_added carries NO spawnRequestId
      │
client: Tier-1 clear can't fire; Tier-2 can't match worktree cwd → placeholder STUCK
```

Server-log evidence (`~/.pi/dashboard/server.log`): non-empty tokens are reused
across many sessions, always within a single worktree cwd — every reuse logs a
`cwd-FIFO fallback` even though `token=` is non-empty:

```
token=5ca45f23…  → 13 sessions, all in .worktrees/os-resolve-global-prompt-templates-from-dashboard
token=27b66c12…  →  7 sessions, all in .worktrees/os-relocate-view-menu-to-status-bar
token=51e44a63…  →  4 sessions, all in .worktrees/os-classify-process-list-entries
```

The token is **single-use by contract** (consumed once from
`pendingClientCorrelations`, `headlessPidRegistry.linkByToken`,
`pendingForkRegistry`). Nothing scrubs `PI_DASHBOARD_SPAWN_TOKEN` from any
process env, so respawns (keeper) and descendants (subagents, nested `pi`,
`npm run reload`) re-report a stale token and all fail correlation.

The same stale-token reuse also degrades **source labelling**: reused tokens
fall to the weak `cwd-FIFO source-stamp fallback`, mis-tagging `source`.

## What Changes

- **Scrub the single-use token at both leak points** so neither respawns nor
  descendant pi processes re-report it:
  - `keeper.cjs spawnPi()` passes the token to the **first** pi launch only,
    then deletes `PI_DASHBOARD_SPAWN_TOKEN` from the env used for every
    subsequent respawn.
  - The bridge **scrubs `process.env.PI_DASHBOARD_SPAWN_TOKEN`** after reading
    it on first register, so child pi processes never inherit it.
- **Decouple the `dashboardSpawned` boolean from the token's presence.** Today
  `dashboardSpawned = !!process.env.PI_DASHBOARD_SPAWN_TOKEN` is read on EVERY
  register. Scrubbing the token would otherwise regress source labelling. The
  bridge SHALL **capture `dashboardSpawned` once at startup, before scrubbing**,
  and reuse that captured boolean for all later registers — correctly making
  subagent **children** report `false` (they were not dashboard-spawned).

This is a bug fix to the existing `spawn-correlation` capability — no protocol
wire change (both `spawnToken` and `dashboardSpawned` are already optional).

## Non-Goals

- **Worktree card "not at top" is out of scope.** That is the by-design
  `resolveOrderKey` collapse of worktree sessions onto the parent-repo group
  (`simplify-session-card-ordering`), not a correlation bug. Any change to
  top-of-list placement for dashboard-originated worktree spawns is a separate
  proposal.
- No change to `PI_DASHBOARD_SPAWNED` semantics (it means "headless RPC keeper
  session" to `bridge-context.isHeadlessRpcSession`; reusing it for the
  source-flag would cross-wire slash-command routing).

## Capabilities

### Modified Capabilities
- `spawn-correlation`: token env-var is single-use and MUST be scrubbed after
  first read at both the keeper and bridge boundaries; `dashboardSpawned` is
  derived from a capture-once boolean, not live token presence.

## Impact

- **Server** (`packages/server/src/rpc-keeper/keeper.cjs`): `spawnPi()` deletes
  `PI_DASHBOARD_SPAWN_TOKEN` from the respawn env after the first launch.
- **Extension** (`packages/extension/src/session-sync.ts`, `bridge.ts`):
  capture `dashboardSpawned` once at startup; scrub the token env var after
  first-register read.
- **Shared** (`packages/shared/src/protocol.ts`): doc-only clarification of the
  single-use + scrub contract on `spawnToken`.
- **Validation**: covers BOTH spawn entry points — WS
  (`browser-handlers/session-action-handler.ts`) and REST (`session-api.ts`).
  Touches token consumers: `pendingClientCorrelations`,
  `headlessPidRegistry.linkByToken`, `pendingForkRegistry`,
  `spawn-register-watchdog` (`byToken`), `decideDashboardSource`.
