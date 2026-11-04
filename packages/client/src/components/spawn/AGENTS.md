# DOX — packages/client/src/components/spawn

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `SpawnChoiceChip.tsx` | Spawn model · thinking chip: `ModelSelector` with `allowRoles`, merged level group, dashed `default` entries via `renderPanelHeader` / `renderLevelPrefix` (clear one remembered field). Lazy-loaded by `AgentSpawnPicker`; on mount moves focus from its focused menu item to its trigger. Settings defaults via `useSyncExternalStore(subscribeSpawnDefaults, getSpawnDefaults)`. Edits the folder memory (`spawn-choice-memory.ts`); never spawns. Shows Settings default tagged `default` per field; `disabled` under ACP agent; `onChange(effective)`. Not a session picker. See change: add-spawn-model-choice. |
