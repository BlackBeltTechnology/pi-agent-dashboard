# DOX — packages/context-mode-settings-plugin/src/shared

Files in this directory. One row per source file. See change: add-context-mode-settings-plugin.

| File | Purpose |
|------|---------|
| `settings-descriptors.ts` | Pure (no node imports). `CONTEXT_SETTINGS` descriptor table `{key,kind,default,group,scope,label,help,env}`; `validateSettings`, `validateValue`, `projectEnv(settings,{scopes,home,onInvalid})`, `PROJECTED_MARKER_ENV`, `RUNTIME_ENV_NAMES`. Excludes bridge-internal + `CONTEXT_MODE_PROJECT_DIR`/`PLATFORM`. `storage.dir` `~`-expanded. `false` bool emits nothing. |
