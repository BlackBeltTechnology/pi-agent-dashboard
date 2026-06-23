# Tasks

## 1. Data model (shared)
- [x] 1.1 Add `GoalJudge`, `GoalVerdict` types + `judge?`/`verdicts?` to
  `GoalRecord` in `packages/shared/src/types.ts`. → verify: `tsc` clean,
  existing `GoalsFile` fixtures still parse.
- [x] 1.2 Decide on `schemaVersion` (bump only if normalization added). → verify:
  goal-store load test with a pre-change file passes unchanged.

## 2. Server — persistence + REST
- [x] 2.1 Validate `judge` on POST/PATCH in `goal-routes.ts` (clamp-or-reject,
  mirror `parseBudget`). → verify: route test rejects malformed judge, accepts
  valid, ignores absent.
- [x] 2.2 Append `GoalVerdict` to the record when a driver session's
  `goal_status` snapshot advances `(turnsUsed, lastVerdict)`; FIFO-cap at 50. →
  verify: unit test feeds 60 snapshots, expects 50 retained, newest last.

## 3. Server — loop coupling (probe-gated, Decision 2)
- [x] 3.1 Probe `@ricoyudog/pi-goal-hermes` command surface; record tier
  (full / criteria-only+dashboard-budget / intent-only). → verify: probe unit
  test with each simulated surface picks the right tier.
- [x] 3.2 In the chosen tier, extend `goalCommandFor` / dispatch to push budget +
  judge, OR enforce budget dashboard-side (suppress continuation past cap). →
  verify: with a stub extension, budget cap halts continuation.

## 4. Client — Screen A (create/edit)
- [x] 4.1 Replace single-input create in `FolderGoalsSection.tsx` +
  `GoalsBoardClaim.tsx` with the form: objective, editable criteria, judge
  picker, budget, self-judge toggle. → verify: component test submits full
  payload to `createGoal`.
- [x] 4.2 Wire judge-model options from the dashboard's known model list. →
  verify: picker renders models; cross-model badge reflects ≠ executor.

## 5. Client — Screen C (detail) + B (board) + D (chip)
- [x] 5.1 Detail: loop-control bar via existing `plugin_action`
  (pause/resume/done/subgoal/clear), dual budget gauges, editable criteria. →
  verify: clicking Pause dispatches `action:"pause"`.
- [x] 5.2 Detail: judge verdict timeline from `goal.verdicts`. → verify: renders
  newest-first, empty state when absent.
- [x] 5.3 Board: enriched `GoalCard` (ring, verdict, criteria progress, spend
  bar). → verify: card test shows live ring + verdict.
- [x] 5.4 Chip: `GoalControl` shows `⚑ turns/budget · verdict` + inline pause +
  open. → verify: chip test renders live state, pause dispatches.
- [x] 5.5 Delete affordance (detail control bar + board card overflow) with
  confirm, calling existing `deleteGoal()`. → verify: confirm calls
  `DELETE /api/folders/goals/:id`; cancel sends nothing; post-delete navigates to
  board.

## 6. Docs + verification
- [x] 6.1 Add/update `docs/file-index-plugins.md` rows for every changed file
  (caveman style, via subagent).
- [x] 6.2 Full plugin test pass green (`npm test` for goal-plugin + server
  goal-routes). → verify: tee→grep no FAIL.
- [x] 6.3 Manual: build + restart + reload; create a goal with criteria/budget/
  judge, confirm board/detail/chip render and pause works.
