# DOX — packages/obs-studio-plugin/src

| File | Purpose |
|------|---------|
| `i18n.ts` | Eager catalog: zh-CN/hu only (same key set as `en`). Kept small — cold entry chunk (mdi-chunk-size cap). Wave 2 keys added (state words, `loadError`, `copyCommand`, `authRejected`); `provisionHint`/`authFailed`/`recoverySuspended` reworded, `{cmd}` placeholder. See change: retro-ux-plugin-settings-wave-2. |
| `messages.ts` | Lazy-only `en` fallback map, `MessageKey`, `tr(t,key,vars)` = `useT` with English fallback. Backticks removed; `authFailed`/`recoverySuspended` carry `{cmd}`. See change: retro-ux-plugin-settings-wave-2. |
