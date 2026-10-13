# DOX — packages/context-mode-settings-plugin/src/client

Files in this directory. One row per source file. See change: add-context-mode-settings-plugin.

| File | Purpose |
|------|---------|
| `ContextModeSettings.tsx` | Slot component: thin wrapper with own `<Suspense>` around lazy `ContextModeSettingsForm` (keeps form out of cold index chunk). Suspense fallback `cms-loading` (`--text-secondary`). See change: retro-ux-plugin-settings-forms. |
| `ContextModeSettingsForm.tsx` | Grouped accordion form over `CONTEXT_SETTINGS`: DEFAULT badge, per-field reset, inline validation, new-sessions / exported-env-wins / storage-scope notices, raw JSON. Registers `plugin:context-mode-settings` draft source; commit rejects while invalid. Fields/groups/notices via runtime `NumberField`/`TextField`/`ToggleField`/`SettingsGroup`/`SettingsNotice`; status = `No changes` / warning pill `N unsaved changes`; no `--accent-*` text; roots `cms-root`/`cms-loading`. See change: retro-ux-plugin-settings-forms. |
| `context-api.ts` | `getSettings`/`putSettings` REST client. |
| `index.tsx` | Barrel: `ContextModeSettings` + `catalog`. |
