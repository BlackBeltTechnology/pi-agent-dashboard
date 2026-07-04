# DOX — packages/kb-plugin/src/client

Files in this directory. One row per source file. See change: add-kb-folder-slot.

| File | Purpose |
|------|---------|
| `FolderKbSection.tsx` | `sidebar-folder-section` claim. `deriveKbRowState` ordered five-state: error→indexing→not-indexed→stale→populated (error wins over chunks:0). `clientError = reindexError ?? error` forces `error` state (trigger reject OR poll outage) over the derived state; `indexing` spinner survives transient poll blips. Count tooltip `F files · N chunks`. `→` opens kb settings; reindex/Index now/Retry controls. See change: add-kb-folder-slot; fix-kb-index-feedback. |
| `index.tsx` | Client barrel. Exports `FolderKbSection`, `KbSettingsClaim` for plugin-registry. See change: add-kb-folder-slot. |
| `kb-api.ts` | REST client. `fetchKbStats`/`reindexKb`/`fetchKbConfig`/`saveKbConfig`. base64url folder-path codec `encodeFolderPath`/`decodeFolderPath`, `kbSettingsUrl`. Content-type guard: non-JSON body → typed error not parse crash. See change: add-kb-folder-slot. |
| `KbSettingsClaim.tsx` | `shell-overlay-route` claim `/folder/:encodedCwd/kb`. Decodes cwd param, renders `KbSettingsPanel`. See change: add-kb-folder-slot. |
| `KbSettingsPanel.tsx` | Per-folder KB path editor. Edits sources[] (add/remove/reorder priority)/include/exclude/dbPath only; other config round-tripped. Shows origin + count. `Save + Reindex`. Worktree bootstrap: `Create project config` + `Copy from parent repo` (`parentRepoOf` derives parent from `.worktrees/` path). See change: add-kb-folder-slot. |
| `useKbConfig.ts` | `useKbConfig(cwd)`. GET config, `save(patch)` PUT. Round-trips full config. See change: add-kb-folder-slot. |
| `useKbStats.ts` | `useKbStats(cwd)`. Fetch `/api/kb/stats`, `reindex()` POST (202→`refetch()` engages poll). Polls every 1000ms while `indexing`, stops on settle. Two error channels: `reindexError` (trigger POST rejected, no job) vs `error` (poll outage, surfaced only after `MAX_POLL_MISSES`=3 consecutive misses — a lone blip keeps the spinner, never `clearPoll`s). See change: add-kb-folder-slot; fix-kb-index-feedback. |
