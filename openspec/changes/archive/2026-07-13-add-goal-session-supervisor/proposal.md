## Why

Today the `goal` feature *attaches* to a session but does not *own* it. The
continuation loop lives inside the `@ricoyudog/pi-goal-hermes` extension, which
runs **inside** the driver session. When that session dies (crash, user close,
`--mode rpc` keeper exit, server restart), the loop's owner dies with it — and
**nothing on the dashboard side notices**. The `GoalRecord` stays `active`
forever with a dangling `driverSessionId`, and the goal silently stops.

The root cause is not missing machinery — it is that **the goal engine does not
use the session-management the dashboard already provides.** The host exposes a
hardened, generic session lifecycle to every trusted plugin via
`ServerPluginContext` (`dashboard-plugin-runtime/src/server/server-context.ts`):

- `spawnSession(opts)` → returns a **`spawnToken`**.
- `onSessionEnded` → the death rail (`sessionManager.onUnregister` →
  `dispatchPluginSessionEnded` → `ctx.onSessionEnded`).
- `abortAutomationRun({sessionId?, spawnToken?, graceful?})` → hardened kill by
  token (pre-register window) or sessionId, with a graceful hint.
- Token-based spawn correlation, dashboard-wide: `event-wiring.ts` links a
  registering session via `headlessPidRegistry.linkByToken(spawnToken, …)`;
  **cwd-FIFO is the explicit legacy fallback** (`See change:
  spawn-correlation-token` / `fix-dashboard-spawn-correlation-by-token`).

The `automation` runner rides all of this. The goal engine rides a thin slice
and **reimplements the deprecated path** (verified against the running build):

1. **Correlation** — goal discards the `spawnToken` from `spawnSession` and links
   by `pendingGoalLinkRegistry.consume(cwd)` (cwd-FIFO head, `event-wiring.ts:385`)
   — the legacy fallback, not the token path the rest of the dashboard uses. A
   non-goal session registering in the same cwd consumes the head and is
   mis-linked.
2. **Death** — no `onSessionEnded` subscriber for goals (grep finds only the
   manual `unlinkSession` API). Dead driver → `GoalRecord` wedged `active`.
3. **Abort** — goal never calls `abortAutomationRun`; a driver that hangs before
   register cannot be killed.
4. **Reaper** — none (no `setInterval`/`stale`/`reap` in `goal-*.ts`).

This change makes the goal a **session supervisor built on the host's existing
session management**. The host owns the *mechanism* (spawn/token-correlate/
death-signal/abort/resume); the goal plugin adds only the *pursuit policy*:
classify why a session ended and, for unexpected crashes, **auto-respawn** to
keep pursuing — bounded by a crash-loop breaker and a cumulative budget so it can
never run away.

## What Changes

### Reuse the host session management (no new mechanism)
> Corrected by doubt-review cycle 1 (design S1–S12) — supersedes conflicts below.
- **USE** the spawn token end-to-end, but stamp `goalId` INTO the host spawn call
  BEFORE launch (design S4); recording it after `spawnSession` returns races a
  fast register. Supervisor spawn with a missing token PAUSES the goal — never
  cwd-links (C3). cwd-FIFO stays only as the host's legacy fallback for user spawns.
- **USE** `sessionManager.onUnregister` from MAIN SERVER (design S2) — the goal
  plugin server cannot reach `GoalStore`, so the supervisor is
  `packages/server/src/goal-supervisor.ts`, not plugin `ctx.onSessionEnded`.
- **USE** `ctx.abortAutomationRun({sessionId?, spawnToken?, graceful?})` for
  clear/pause aborts (pre-register window included); terminal-status-first +
  generation token guards the kill→onUnregister→respawn loop (design S6).
- **USE** `spawnPiSession({sessionFile, mode:"continue"})` for resume (design S3);
  there is no `--resume` flag. Boot-time reconcile replaces restart-quiesce (S10).
- **RENAME** `abortAutomationRun` → `abortSpawnedRun` across the shared runtime +
  callers: goal becomes a second caller, so the automation-specific name lies.
  Mechanical rename, no behavior change.

### Goal-specific policy (the only genuinely new code)
- **ADD** `packages/server/src/goal-supervisor.ts` (main server) — subscribes to
  `sessionManager.onUnregister`, classifies the death (terminal / paused /
  respawn), drives progress-gated respawn + breaker. Reaper + quiesce cut/gated
  for v1 (design S9/S10).
- **ADD** progress-gated respawn. `progress = turnsUsed advanced OR a new verdict
  appended since this driver spawned`.
  - Died **after** progress → transient; resume `driverSessionId` (keep the
    conversation). Reset counters + backoff.
  - `K = 2` consecutive no-progress *resume*-deaths → poisoned session; fresh
    spawn, re-prime `/goal <objective>` + `GoalRecord.verdicts` summary.
- **ADD** crash-loop breaker: `3` no-progress deaths in a rolling `5 min` →
  `GoalRecord.status = "failed"`, reason `"crash loop"`. **Silent** (chip/board
  surface it; no notification). Backoff `5s → 15s → 45s` cap; progress resets it.
- **MODIFY** `GoalRecord` (`packages/shared/src/types.ts`): `autoRespawn?: boolean`;
  `respawns?: GoalRespawn[]` (`{ at, sessionId, reason, madeProgress }`,
  FIFO-capped); cumulative `totalTurnsUsed` + `lastKnownTurnsUsed`; per-goal
  `generation` counter. `GoalRecordStatus` (real values
  `pursuing|paused|achieved|cleared`) gains `"failed"` AND `"respawning"`
  (visible non-terminal, no-live-driver — so backoff does not violate C1).
  See design S1–S12.
- **MODIFY** budget — route `goal-budget-guard.decideBudgetHalt` off cumulative
  `turnsUsed` so respawns cannot defeat it.
- **MODIFY** `GoalPluginSettings` — `autoRespawnDefault: boolean` (default off);
  new goals inherit it. Cumulative budget + breaker apply regardless of the flag.
- **MODIFY** `GoalChip` / board — surface `↻ Respawning n/m` and
  `✕ Failed · crash loop`.

## Impact

- Affected specs: `goal-supervisor` (new capability).
- Affected code: `packages/dashboard-plugin-runtime/src/server/server-context.ts`
  (+ callers) for the rename; `packages/shared/src/types.ts`;
  `packages/server/src/{goal-store.ts, event-wiring.ts, goal-routes.ts}`; new
  `packages/server/src/goal-supervisor.ts`; `packages/goal-plugin/src/{server,client}/*`.
- **Migration / compatibility**: `autoRespawn` + `respawns` optional, default off
  → existing `GoalsFile` records load and behave unchanged until explicitly
  enabled. `"failed"` status is additive. The `abortAutomationRun` rename is
  internal (no REST/wire change).
- **Rollback**: safe — with `autoRespawn` off the supervisor only *finalizes*
  dead goals (paused, "session ended"), strictly better than today's wedged
  `active`; the respawn path is dormant. The rename is mechanical.
- **Always-on hard caps** bound even opted-in goals: cumulative `maxTurns` +
  crash-loop breaker → the engine cannot infinite-loop or overspend.
- **Open dependency**: `--resume` fidelity depends on pi session-resume
  preserving the extension's in-session loop state; design.md gates the
  fresh-fallback for the poisoned-session case.

## Depends On

- **`persist-goal-status-and-progress`** (P0 prerequisite, ship first). Provides
  the durable `GoalRecord.status` + `lastKnownTurnsUsed`/`totalTurnsUsed`/
  `lastProgressAt` this change's classify/reconcile/budget logic reads. Surfaced
  as the root finding of this change's doubt review (design P0). This change layers
  respawn/abort/breaker/correlation on top of that solid base.

## Discipline Skills

- `doubt-driven-review` — autonomous respawn spends tokens/money unattended; the
  breaker + cumulative budget + opt-in-default-off must be stress-tested before it
  stands.
- `observability-instrumentation` — a supervisor that resurrects sessions
  silently is unacceptable; respawn/failed state must be visible on chip + board
  and logged.
