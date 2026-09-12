# goal-budget-guard.ts — index

`decideBudgetHalt(snapshot,budget)` pure. Returns `{halt:true,command:"/goal pause"}` when active loop `turnsUsed>=budget.maxTurns`. Never halts non-active, absent cap, or zero cap. See change: sophisticate-goal-authoring-and-control.
