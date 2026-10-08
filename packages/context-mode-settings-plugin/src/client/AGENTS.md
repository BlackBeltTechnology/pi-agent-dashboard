# DOX — packages/context-mode-settings-plugin/src/client

Files in this directory. One row per source file. See change: add-context-mode-settings-plugin.

| File | Purpose |
|------|---------|
| `ContextModeSettings.tsx` | Slot component: thin wrapper with own `<Suspense>` around lazy `ContextModeSettingsForm` (keeps form out of cold index chunk). |
| `ContextModeSettingsForm.tsx` | Grouped accordion form over `CONTEXT_SETTINGS`: DEFAULT badge, per-field reset, inline validation, new-sessions / exported-env-wins / storage-scope notices, raw JSON. Registers `plugin:context-mode-settings` draft source; commit rejects while invalid. |
| `context-api.ts` | `getSettings`/`putSettings` REST client. |
| `index.tsx` | Barrel: `ContextModeSettings` + `catalog`. |
