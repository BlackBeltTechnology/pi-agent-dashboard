## Why

The durable `GoalRecord` does not reflect the live loop. `goal-verdict-accumulator.ts`
consumes the `goal_status` snapshot stream but only **appends verdicts** — it
never writes `GoalRecord.status` back, and it never persists turn counts. So:

- After a page reload or server restart, a goal that was pursuing/achieved shows
  stale state — the durable record still says whatever it was created as.
- The goals board cannot roll up accurate live status/turns from the record alone.
- Any budget or supervision logic that reads `GoalRecord` (cumulative turns,
  "is this goal actually done") has no truthful durable source.

This was surfaced as the **P0 root finding** of the `add-goal-session-supervisor`
doubt review: the supervisor's classify-by-`status`, boot-reconcile, and
cumulative-budget all assume durable status+progress that nothing maintains today.
It is a clean, smaller, independently-shippable prerequisite. Ship it first; the
supervisor layers on a solid base.

**Scope guard:** this change persists live loop state into the durable record.
It does NOT spawn, resume, kill, respawn, or supervise sessions — that is
`add-goal-session-supervisor`.

## What Changes

- **MODIFY** `GoalRecord` (`packages/shared/src/types.ts`), additive + optional:
  - `lastKnownTurnsUsed?: number` — latest `turnsUsed` seen from the driver.
  - `totalTurnsUsed?: number` — cumulative across drivers (per-driver deltas), the
    truthful budget denominator.
  - `lastProgressAt?: number` — timestamp when `turnsUsed` last strictly increased.
  - Durable `status` transitions maintained from the stream (map snapshot
    `active→pursuing`, `paused→paused`, `done→achieved`, `cleared→cleared`);
    existing `GoalRecordStatus` union unchanged by this change.
- **MODIFY** the goal status consumer (`goal-verdict-accumulator.ts`, or a sibling
  `goal-status-projector.ts`) to write these fields to the owning `GoalRecord`
  via the goal store, in addition to the existing verdict append:
  - Attribute each snapshot to a goal via the linked session's `goalId`.
  - `totalTurnsUsed` increments by the positive delta of a driver's `turnsUsed`;
    a first-seen or `turnsUsed=0` snapshot establishes a per-driver baseline and
    does NOT double-count.
  - `lastProgressAt` stamps only on a strict `turnsUsed` increase.
  - `status` writes are idempotent (no redundant store writes / broadcasts).
- **MODIFY** `goal-store.ts` — a projection update path (e.g. `applyStatus`) that
  sets these fields under the store mutex; legacy `GoalsFile` records load
  unchanged (all new fields optional).

## Impact

- Affected specs: `goal-status-persistence` (new capability).
- Affected code: `packages/shared/src/types.ts`,
  `packages/server/src/goal-verdict-accumulator.ts` (or new
  `goal-status-projector.ts`), `packages/server/src/goal-store.ts`.
- **Migration / compatibility**: all new fields optional → existing records load
  unchanged; the first snapshot after upgrade backfills them. No REST/wire change.
- **Rollback**: safe — fields are additive and ignored by older clients; behavior
  degrades to today's (verdict-only) accumulation.
- **Enables**: `add-goal-session-supervisor` (its P0 dependency), accurate
  restart-surviving board status, and a truthful cumulative-budget denominator.

## Discipline Skills

- `observability-instrumentation` — this change makes live loop state durable and
  restart-surviving; correctness of the projected status/turns is the whole point.
- `doubt-driven-review` — `totalTurnsUsed` is the budget denominator downstream;
  the baseline/delta accounting must be stress-tested (missed-first-snapshot and
  double-count hazards were flagged in the supervisor doubt review).
