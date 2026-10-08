# DOX — packages/context-mode-settings-plugin/src/server

Files in this directory. One row per source file. See change: add-context-mode-settings-plugin.

| File | Purpose |
|------|---------|
| `index.ts` | `registerPlugin(ctx)`. `registerContextModeRoutes` — `GET`/`PUT /api/plugins/context-mode-settings/config` in a rate-limited scope; PUT validates before write (400 per-key errors, 500 `write_failed`). `createSpawnEnvContributor` reads file fresh per spawn, both scopes, `{}` for `wsl-tmux`, warns on invalid/corrupt. Registers contributor with `supersede` marker. |
| `settings-io.ts` | Fixed path `resolveSettingsPath` (`~/.pi/context-mode/settings.json`). `readSettingsFile` sync tolerant (absent/corrupt → `{}`, never creates files). `readEffectiveSettings`. `writeSettingsFile` atomic temp+rename, tmp cleanup on failure. |
