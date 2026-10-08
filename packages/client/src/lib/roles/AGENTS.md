# DOX — packages/client/src/lib/roles

Files in this directory. One row per source file. See change: add-role-aware-model-refs.

| File | Purpose |
|------|---------|
| `useRolePick.ts` | One-shot `@role` pick for session-model pickers (Kind A/C). `useRolePick({currentModel, models, selectModel, selectLevel})` → `{onSelect, viaRole, notice, clearNotice}`. Fresh `GET /api/roles` at pick time; applies `selectModel(model)` then `selectLevel(level)` (skipped + `level-skipped` notice when the model's `supportedThinkingLevels` lacks it); unassigned / unreachable → no change + notice. `viaRole` hint clears once the session model leaves the resolved value (after first confirmation) or on a direct pick. `rolePickNoticeText(notice, t)`. |
