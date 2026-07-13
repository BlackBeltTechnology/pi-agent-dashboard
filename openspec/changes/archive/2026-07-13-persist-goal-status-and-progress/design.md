# Design — persist-goal-status-and-progress

## Context

`goal-verdict-accumulator.ts` already consumes the `goal_status` snapshot stream
(bridge → server `registerPiHandler("goal_status")`) with a per-session `lastSeen`
dedupe, and appends `GoalVerdict` to the owning `GoalRecord` (looked up by the
session's `goalId`). It does not touch `status` or turn counts. This change adds a
**projection**: reflect the live snapshot into durable `GoalRecord` fields.

Extracted as P0 from the `add-goal-session-supervisor` doubt review (design P0 +
C2f/C2g). Kept deliberately free of any spawn/kill/respawn concern.

## Decisions

### 1. Projection lives beside the accumulator, keyed by the session's goalId
Same input stream, same `goalId` attribution (`session.goalId`), same store. Add
the status/turn projection either into `goal-verdict-accumulator` or a sibling
`goal-status-projector` sharing the store. No new transport, no new registry.

### 2. Turn accounting: per-driver baseline + cumulative delta (budget-truthful)
`totalTurnsUsed` is the future budget denominator, so it must not be gameable:
- On first snapshot for a driver session, record a per-driver baseline
  (`baseline = turnsUsed`); do not add the baseline to the total.
- On each later snapshot, `totalTurnsUsed += max(0, turnsUsed - lastForThisDriver)`.
- `lastKnownTurnsUsed = turnsUsed`; `lastProgressAt = now` only on a strict increase.

This closes the two hazards the supervisor review flagged: **missed zero baseline
→ undercount** (a first snapshot of `turnsUsed=1` still counts that turn because
the baseline is the first *observed* value only when it is 0; when the first
observed value is >0 with no prior baseline, count it as consumed — conservative)
and **double-count across drivers** (per-driver `lastForThisDriver` tracking).

### 3. Status mapping is idempotent
`active→pursuing`, `paused→paused`, `done→achieved`, `cleared→cleared`. Write to
the store only when the projected status actually changes (avoid redundant writes
+ broadcasts). This change does NOT add `failed`/`respawning` — those belong to
the supervisor change that introduces the states producing them.

### 4. Fire-and-forget stays fire-and-forget, but ordered per goal
The existing append is fire-and-forget. Keep that, but ensure status+turn writes
for a single goal do not interleave inconsistently — reuse the store mutex
(`goal-store` serializes updates per file). A dropped write self-heals on the next
snapshot.

## Non-goals
- No spawn / resume / kill / respawn / reaper / boot-reconcile (supervisor change).
- No `failed` / `respawning` status (supervisor change).
- No gating on "current driver" vs replaced driver — there is no `replaceDriver`
  yet; attribution is purely by the session's `goalId`. (The supervisor change
  adds current-driver gating when it introduces driver replacement — C2e there.)

## Open questions (non-blocking)
- First-observed `turnsUsed > 0` with no baseline: count as consumed
  (conservative, chosen above) vs treat as baseline (risks undercount). Chosen:
  conservative. Revisit if it over-counts in practice.
- Whether to persist `status` writes on every transition or debounce bursts
  (`goal-continuing` can be frequent). Default: write only on status *change*.
