# DOX — packages/subagents-plugin/src

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `__tests__/heap-budget.test.ts` | `subagentHeapBudget` table: maxConcurrent 2..8 vs 512 MB ceiling, unlimited (0) warns, nonsense inert. Moved from shared `config-heap-limits.test.ts` (#E16). See change: move-subagents-to-plugin (9.3). |
| `__tests__/subagent-types.test.ts` | `readLiveTail` cap/clear, `countSteps`, `readSubagentDetails`, `setSubagentState` dual-index + no-shrink, `applyLiveBlockPiece` append/dup/gap/closed. Moved from shared. See change: move-subagents-to-plugin (9.3). |
| `heap-budget.ts` | `SUBAGENT_HEAP_GUIDANCE_MB` (100) + `subagentHeapBudget(maxOldSpaceMb, maxConcurrent)` → `{perChildMb: floor(mb/(n+1)), warn: perChildMb < 100}`; `0` = unlimited → warns. One formula for `SubagentsSettings.tsx` + tests. Moved from shared `heap-limits.ts`. See change: move-subagents-to-plugin (9.3). |
| `subagent-types.ts` | Subagent wire contract + pure fold helpers. Types `SubagentTimelineEntry`, `SubagentLiveTail`, `SubagentLiveBlock`, `SubagentState`; fns `readLiveTail` (cap 280), `countSteps`, `readSubagentDetails`, `setSubagentState` (dual-index by `id` + `agentSessionId`, timeline never shrinks), `applyLiveBlockPiece`, const `LIVE_BLOCK_GAP_MARKER`. Client files import it by relative path; `client/types.ts` re-exports. Moved from `shared/dashboard-plugin`. See change: move-subagents-to-plugin (9.3). |
