# goal-verdict-accumulator.ts — index

`createGoalVerdictAccumulator({store,lookupSession,now?,warn?})`. Consumes `goal_status` snapshots. Appends `GoalVerdict` to owning GoalRecord when `(turnsUsed,lastVerdict)` advances. Per-session lastSeen dedupe. Maps status→verdict (paused→paused, done→satisfied, else continue). Cleared status resets tracking. Fire-and-forget append. Durable status+turn projection lives in peer `goal-status-projector.ts`. See changes: sophisticate-goal-authoring-and-control, persist-goal-status-and-progress.
