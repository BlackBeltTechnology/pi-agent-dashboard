## Why

An automation run can finish its work and never settle: the run record stays
`running` until the 30-minute max-age reaper writes `run exceeded max age`. While
it is wedged it holds the automation's `concurrency: skip` slot, so the schedule
is starved and unfinished runs accumulate.

The finalize logic itself is correct and covered by tests. The loss is one layer
below it, in **who gets the `automationRun` stamp**.

`ServerPluginContext.spawnSession` enqueues the stamp into
`pendingAutomationRunRegistry` keyed by **cwd only**
(`packages/server/src/server.ts:1911`). Every `session_register` for that cwd
consumes the FIFO **head** (`packages/server/src/event-wiring.ts:402`,
`packages/server/src/pending/pending-automation-run-registry.ts:98`) — the
registry has no way to tell which spawn a registering session actually is.

Two independent first-party plugins spawn into the SAME cwd with
`automationRun` stamps:

- `packages/automation-plugin/src/server/engine.ts` (`startRunFor` → `spawnSession`)
- `packages/invoicebot-plugin/src/server/session-link.ts:304` and `:355`
  (`spawnAndBind` / `spawnScopedAndBind`, both stamping their own `runId`)

so the queue for a shared cwd interleaves stamps from different owners. The
session that registers first takes the head regardless of which spawn it is.
When the heads shift by one, an automation run session registers carrying
**another owner's `runId`**; the automation plugin then looks that runId up
(`engine.pendingForRunId(stampedRunId)`), finds nothing, and **silently never
delivers the action**. That run has no session it will ever hear from, so no
`flow_complete`, no `agent_end`, and no session death fires for it — only the
max-age reaper, 30 minutes later.

The consumer already refuses to bind by cwd (`fix-automation-run-correlation`),
and `automation-run-lifecycle` already requires "Action prompt delivered to the
correlated run session". The producer of the stamp never got the same treatment.
`spawnToken` — the exact correlation identity already minted per spawn, injected
as `PI_DASHBOARD_SPAWN_TOKEN` and echoed back on the first `session_register` —
is available at both ends and simply unused here.

Second, undelivered is currently indistinguishable from long-running: both wait
the full `maxRunAgeMs`. A run that never received its action is provably dead and
must not hold a concurrency slot for half an hour.

## What Changes

- **Bind the automation-run stamp to its spawn token.**
  `pendingAutomationRunRegistry` gains `bindToken(cwd, runId, spawnToken)`, and
  `consume(cwd, spawnToken?)` resolves in two tiers:
  1. exact `spawnToken` match — consume that entry wherever it sits in the queue;
  2. otherwise the oldest entry with **no** bound token (owner not yet known, or
     a spawn path that produced no token).
  An entry bound to a token SHALL NOT be consumable by a different token. This is
  the same token tier `headlessPidRegistry.linkByToken` already uses.
- **Thread the token through the register seam.**
  `piGateway.onSessionRegistered` gains a third `spawnToken?` argument (from
  `session_register.spawnToken`); `event-wiring` passes it to `consume`.
- **Bind after spawn returns.** The spawn hook keeps the race-safe pre-spawn
  `enqueue` (a fast bridge can register before `spawnPiSession` resolves) and
  calls `bindToken` with the returned token — the documented
  "enqueue by cwd-FIFO, re-record by token" pattern.
- **Bound reap for an undelivered run.** The automation engine reaps a `running`
  run whose action was never delivered after `undeliveredRunTimeoutMs`
  (default 60 s, `<= 0` disables), finalizes it `error`, frees the concurrency
  slot, and terminates its spawned process. The 30-minute `maxRunAgeMs` backstop
  is unchanged for delivered runs. The reaper sweep interval drops 60 s → 15 s so
  the bound is real.
- **The reaper terminates the process it reaps.** Both reap paths now call
  `abortSpawnedRun`; a reaped `--mode rpc` run session no longer survives its run.

## Capabilities

### Modified Capabilities

- `spawn-correlation`: add `Requirement: Automation-run stamps are consumed by spawn token`
  — the pending automation-run stamp is claimed by exact token, with the unbound-entry
  FIFO retained only as the legacy/racing fallback.
- `automation-run-lifecycle`: add `Requirement: An undelivered run is reaped on a short bound`,
  and modify `Requirement: A stale running automation run is reaped` to state that
  reaping terminates the spawned session.

## Discipline Skills

`review-code` (non-trivial cross-package diff before commit),
`systematic-debugging` (root-caused an already-attempted fix),
`observability-instrumentation` (the stamp-mismatch and undelivered-reap paths are logged).

## Impact

- `packages/server/src/pending/pending-automation-run-registry.ts` — `bindToken`,
  token-aware `consume`.
- `packages/server/src/pi/pi-gateway.ts` — `onSessionRegistered(sessionId, cwd, spawnToken?)`.
- `packages/server/src/event-wiring.ts` — pass the token to `consume`.
- `packages/server/src/server.ts` — `bindToken` after `spawnPiSession` resolves.
- `packages/automation-plugin/src/server/engine.ts` — undelivered-run reap,
  15 s sweep, abort on reap.
- `packages/automation-plugin/src/server/index.ts` — `undeliveredRunTimeoutMs` config.
- No protocol change (`session_register.spawnToken` already exists), no client
  change, no new dependency.
