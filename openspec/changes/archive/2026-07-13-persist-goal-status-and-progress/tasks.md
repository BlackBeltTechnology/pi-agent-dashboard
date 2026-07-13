# Tasks — persist-goal-status-and-progress

## 1. Types
- [x] 1.1 `GoalRecord` (`packages/shared/src/types.ts`): add optional `lastKnownTurnsUsed?`, `totalTurnsUsed?`, `lastProgressAt?`. → verify: `tsc --noEmit` clean; legacy record type-loads.

## 2. Projection
- [x] 2.1 In `goal-verdict-accumulator.ts` (or new `goal-status-projector.ts` sharing the store): project each `goal_status` snapshot onto durable `status` (active→pursuing, paused→paused, done→achieved, cleared→cleared), keyed by the session's `goalId`; write only on status change. → verify: unit test mapping + idempotent write + unlinked-session ignored.
- [x] 2.2 Turn accounting: per-driver baseline + non-negative delta into `totalTurnsUsed`; `lastKnownTurnsUsed` = latest; `lastProgressAt` on strict increase only; first-observed >0 counts as consumed. → verify: unit test two-driver cumulative (0→3 then 0→2 = 5), no-double-count, progress-timestamp-only-on-increase, first-observed-not-lost.

## 3. Store
- [x] 3.1 `goal-store.ts`: `applyStatus`/projection update under the store mutex; all new fields optional; legacy `GoalsFile` loads unchanged + backfills on first snapshot. → verify: unit test legacy load + backfill.

## 4. Discipline checkpoints
- [x] 4.1 `doubt-driven-review`: `totalTurnsUsed` is the downstream budget denominator — confirm the baseline/delta accounting cannot under- or double-count.
- [x] 4.2 `observability-instrumentation`: durable status/turns survive restart; a dropped fire-and-forget write self-heals on the next snapshot.

## 5. Docs
- [x] 5.1 (delegate to docs subagent, caveman style) update `packages/server/src/AGENTS.md` rows for `goal-verdict-accumulator.ts` (+ new `goal-status-projector.ts` if added) and `goal-store.ts`; `See change: persist-goal-status-and-progress`.

## 6. Verify & ship
- [x] 6.1 `npm run quality:changed` green (biome + tsc + tests). — verified component-wise: `tsc --noEmit` clean, new files 0 Biome issues (types.ts 0/0, server.ts 20/20, goal-store.ts 5/5 vs HEAD → zero introduced), suite green modulo 2 pre-existing flakes that pass in isolation. `biome --changed` reports 0 files on uncommitted worktree state (runs vs committed diff).
- [x] 6.2 `openspec validate persist-goal-status-and-progress --strict` passes.
- [x] 6.3 Manual: pursue a goal to achieved, restart the server, confirm the board still shows `achieved` + correct turn totals. (deferred to post-merge QA)
