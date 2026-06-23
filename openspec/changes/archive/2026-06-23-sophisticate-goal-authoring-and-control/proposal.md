## Why

The `goal` plugin wraps `@ricoyudog/pi-goal-hermes` — a Pi port of Hermes's
"Ralph loop with a judge". The judged loop has real knobs (judge model, turn
budget, acceptance criteria, lifecycle), and the dashboard's `GoalRecord`
already models most of them (`criteria[]`, `budget{maxTurns,maxSpendUsd}`,
4-state `status`). But the UI exposes a **single objective text box**: the model
is starving the UI, and the live loop is uncontrollable from the dashboard.

Two concrete gaps (validated against the running build + `pi-goal-hermes`):

1. **Authoring** — no UI to set acceptance criteria, budget, or judge model at
   create time. `criteria` + `budget` are already accepted by
   `POST /api/folders/goals` (`goal-routes.ts`) but never sent by any form.
2. **Live control** — `goalCommandFor` in `goal-plugin/src/server/index.ts`
   already maps `set / subgoal / pause / resume / done / clear` to `/goal …`
   commands, but those controls were demoted off the session card
   (`add-goals-folder-page`) and never rebuilt on the board/detail page. There is
   also no per-turn judge **verdict history** — the snapshot carries only
   `lastVerdict`.

Mockups: `mockups/goal/index.html` (4 themed screens) + `mockups/goal/README.md`.

## What Changes

- **MODIFY** `packages/shared/src/types.ts` — extend `GoalRecord`:
  - `judge?: { provider: string; modelId: string; sameModel?: boolean }` — judge
    model selection (cross-model by default; `sameModel` opts into self-judge).
  - `verdicts?: GoalVerdict[]` where
    `GoalVerdict = { turn: number; at: number; verdict: "continue"|"satisfied"|"paused"; note?: string }`
    — bounded per-turn judge history (cap N, e.g. 50, FIFO).
  - No change to `objective` / `criteria` / `budget` / `status` / session fields.
- **MODIFY** `packages/server/src/routes/goal-routes.ts` — accept + validate
  `judge` on POST/PATCH (same clamp-or-reject pattern as `parseBudget`).
- **MODIFY** `packages/goal-plugin/src/server/index.ts`:
  - `goalCommandFor` — pass budget + judge into the loop. Exact command syntax
    depends on what `@ricoyudog/pi-goal-hermes` accepts (see design.md Decision 2);
    if the extension only takes `/goal <text>`, this change introduces a thin
    set-config command or falls back to **dashboard-only** budget enforcement.
  - Accumulate `verdicts[]` from the incoming `goal_status` snapshot stream
    (append on each new `turnsUsed`/`lastVerdict` change) and persist to the
    `GoalRecord` via the goal store.
- **MODIFY** create/edit UI — replace the single-input create flow
  (`FolderGoalsSection.tsx`, `GoalsBoardClaim.tsx`) with the **Screen A** form:
  objective + editable criteria + judge-model picker + budget + self-judge toggle.
- **MODIFY** `packages/goal-plugin/src/client/GoalDetailClaim.tsx` — add the
  **Screen C** loop-control bar (pause/resume/done/subgoal/clear via existing
  `plugin_action`), dual budget gauges, editable criteria, and the verdict
  timeline.
- **MODIFY** `packages/goal-plugin/src/client/GoalsBoardClaim.tsx` — **Screen B**
  enriched cards (live ring, verdict, criteria progress, spend bar).
- **MODIFY** `packages/goal-plugin/src/client/GoalControl.tsx` — **Screen D**
  richer chip (`⚑ turns/budget · judge verdict` + inline pause + open).
- **MODIFY** detail + board UI — add a **delete affordance** (confirm) that calls
  the already-existing `deleteGoal()` / `DELETE /api/folders/goals/:id`. No server
  change; the endpoint already clears `goalId` on linked sessions. Pure surfacing
  of an endpoint that currently has no UI caller.
- **DOCUMENTATION** — `docs/file-index-plugins.md` rows for changed files;
  one-line note in `docs/architecture.md` if the verdict-history retention
  contract is non-trivial.

## Impact

- Affected specs: `goal-authoring` (new capability).
- Affected code: `packages/shared/src/types.ts`,
  `packages/server/src/routes/goal-routes.ts`,
  `packages/server/src/goal-store.ts`, `packages/goal-plugin/src/{server,client}/*`.
- **Migration / compatibility**: `judge` + `verdicts` are optional → existing
  `GoalsFile` records load unchanged; bump `GoalsFile.schemaVersion` only if a
  read-time normalization is added. No breaking REST change (additive fields).
- **Rollback**: revert is safe — optional fields are ignored by older clients;
  the verdict accumulation is append-only and bounded.
- **Open dependency**: the judge-model + budget-into-loop wiring depends on
  `@ricoyudog/pi-goal-hermes`'s actual command surface, which is not vendored
  locally. Design.md gates this behind a probe; the UI ships either way (Screen A
  records intent; enforcement degrades to dashboard-only if the extension can't
  take the config).
