# DOX — packages/server/src/goal

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `goal-budget-guard.ts` | `decideBudgetHalt(snapshot,budget)` pure. Returns `{halt:true,command:"/goal pause"}` when active loop… → see `goal-budget-guard.ts.AGENTS.md` |
| `goal-session-primer.ts` | Kickoff `/goal` loop for goal-linked sessions. Exports `buildGoalPrimerCommands` (`/goal <objective>` or `[]`… → see `goal-session-primer.ts.AGENTS.md` |
| `goal-status-projector.ts` | `createGoalStatusProjector({store,lookupSession,warn?})`. Peer `goal_status` consumer beside the accumulator. → see `goal-status-projector.ts.AGENTS.md` |
| `goal-store.ts` | Per-cwd GoalRecord persistence. `GoalCreateBody`/`GoalUpdateBody` gain `judge?`+`autoRespawn?`. → see `goal-store.ts.AGENTS.md` |
| `goal-supervisor.ts` | Goal session supervisor (main-server; owns GoalStore). `createGoalSupervisor(deps)` rides… → see `goal-supervisor.ts.AGENTS.md` |
| `goal-verdict-accumulator.ts` | `createGoalVerdictAccumulator({store,lookupSession,now?,warn?})`. Consumes `goal_status` snapshots. → see `goal-verdict-accumulator.ts.AGENTS.md` |
