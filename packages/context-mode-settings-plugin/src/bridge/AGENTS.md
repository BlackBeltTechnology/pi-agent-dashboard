# DOX — packages/context-mode-settings-plugin/src/bridge

Files in this directory. One row per source file. See change: add-context-mode-settings-plugin.

| File | Purpose |
|------|---------|
| `index.ts` | Pi extension entry. `applyRuntimeSettings(env,file)` sets absent runtime-scope env vars, records names in `PI_CONTEXT_MODE_SETTINGS_PROJECTED`; never projects storage scope; re-reads names an ancestor bridge projected; corrupt/absent file → no change; never throws. |
