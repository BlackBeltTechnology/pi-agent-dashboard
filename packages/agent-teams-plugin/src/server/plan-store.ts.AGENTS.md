# plan-store.ts — index

Pure plan-request primitives over `Team.plans`: `planBounds`/`boundedText` (`planMaxChars`, 120 lines, core counting), `nextPlanId` `p<N>`, `appendPlan` (20 max, drop oldest decided, never pending), `patchPlan`. See change: add-agent-teams-templates-hooks.
