# Design — Fix `PI_DASHBOARD_SPAWN_TOKEN` env leak

## Context

`spawn-correlation` mints a per-spawn UUID token, injects it into the spawned
pi's env as `PI_DASHBOARD_SPAWN_TOKEN`, and the bridge echoes it back in the
first `session_register`. The server consumes it **exactly once** to resolve
the originating browser `requestId` (→ `spawnRequestId` on `session_added`),
to strong-link the PID, and to attribute fork parents. The client uses
`spawnRequestId` to clear its placeholder card and auto-select the new session.

The bug: nothing scrubs the env var, so the single-use token leaks to every
descendant and every keeper respawn, which re-report it; all reuses fail
correlation and the placeholder card is never cleared.

## The overload (root tension)

`PI_DASHBOARD_SPAWN_TOKEN` is read in two ways with **opposite lifetimes**:

```
(A) spawnToken     = isFirstRegister ? env.PI_DASHBOARD_SPAWN_TOKEN : undefined
    → SINGLE-USE correlation token. Must NOT survive to descendants/respawns.

(B) dashboardSpawned = !!env.PI_DASHBOARD_SPAWN_TOKEN   (read on EVERY register)
    → "was I dashboard-spawned?" boolean. Today relies on the token persisting.
```

A naive `delete env.PI_DASHBOARD_SPAWN_TOKEN` fixes (A) but collapses (B):
`dashboardSpawned` goes `false` on the 2nd+ register → `decideDashboardSource`
loses its strong signal → sessions mislabelled `source: "cli"` and the
`.meta.json#source` sidecar stops persisting. That regresses
`fix-dashboard-source-mislabelling` and `fix-dashboard-spawn-correlation-by-token`.

## Decision: capture-once boolean + scrub token

1. **Bridge captures `dashboardSpawned` once**, at module init / first register,
   **before** scrubbing — then reuses the captured boolean for all subsequent
   registers within the process. This preserves source labelling for the
   process while removing the live env dependency.
2. **Bridge scrubs `process.env.PI_DASHBOARD_SPAWN_TOKEN`** immediately after
   capturing the first-register token, so any child pi (subagent / nested `pi`)
   sees no token → its own captured `dashboardSpawned` is correctly `false`.
3. **Keeper scrubs the token for respawns.** `keeper.cjs spawnPi()` injects the
   token into the **first** pi launch only; on every subsequent (crash/restart)
   respawn it deletes `PI_DASHBOARD_SPAWN_TOKEN` from the child env. The keeper
   already sets `PI_DASHBOARD_SPAWNED=1` persistently, so a respawned pi's
   `dashboardSpawned` can still resolve true via the capture-once boolean — but
   it MUST NOT re-emit the consumed token.

### Why not a new persistent source env var?

Considered: set `PI_DASHBOARD_SPAWNED=1` (or a new `PI_DASHBOARD_SOURCE`) in
`buildSpawnEnv` for all strategies and derive `dashboardSpawned` from it.
Rejected for this change because:
- `PI_DASHBOARD_SPAWNED` already means "headless RPC keeper session" to
  `bridge-context.isHeadlessRpcSession` (slash-command routing). Overloading it
  for tmux/wt dashboard spawns would cross-wire that path.
- A brand-new env var is more surface than needed; the capture-once boolean
  solves (B) with no protocol/env additions.

## Behavior matrix

| Process | token in env at register | reports `spawnToken` | captured `dashboardSpawned` |
|---|---|---|---|
| First dashboard-spawned pi | yes | yes (once) | true |
| Same pi, reattach after restart | scrubbed | no (already first-only) | true (captured) |
| Keeper respawn of same session | scrubbed by keeper | no | false (token-only capture); source stays `dashboard` via persisted `.meta.json` (server never downgrades) |
| Subagent / nested `pi` child | scrubbed by parent bridge | no | **false** (correct — not dashboard-spawned) |
| User-launched pi (no dashboard) | absent | no | false |

## Blast radius (validate, do not regress)

| Area | Risk | Guard |
|---|---|---|
| `decideDashboardSource` strong signal + `.meta.json` persist | source mislabel if boolean breaks | capture-once boolean keeps it true for the spawned process |
| `bridge-context.isHeadlessRpcSession` (uses `PI_DASHBOARD_SPAWNED`) | mis-routed slash commands | do NOT touch `PI_DASHBOARD_SPAWNED` semantics |
| REST spawn path (`session-api.ts`) | second entry point also records correlations | assert scrub/capture holds for REST spawns too |
| `headlessPidRegistry.linkByToken` | more strong links, fewer cwd-FIFO fallbacks | expected improvement; assert kill-by-session still resolves |
| `pendingForkRegistry` consume/record | fork auto-select + attachedProposal inherit | fork mints fresh token; assert single round-trip still works |
| `spawn-register-watchdog` `byToken` recovery | recovery keyed by token | reused-token pollution removed; assert recovered/timeout events unchanged |
| Mixed old/new bridge × server | old bridges still leak | server already tolerates reused token (consume → undefined, no crash) |

## Verification

- Server log shows **no** `cwd-FIFO fallback for session … token=<non-empty>`
  lines after a worktree spawn + respawn cycle (empty-token CLI lines remain
  fine).
- Placeholder card for a worktree/OpenSpec spawn clears the instant the real
  card registers (not after the 30 s timeout).
- A subagent/nested-`pi` child registers with `dashboardSpawned: false` and no
  `spawnToken`.
- Keeper respawn keeps `source: "dashboard"` without re-emitting the token.
- `dashboard-source-decision` and `spawn-correlation` test suites stay green.
