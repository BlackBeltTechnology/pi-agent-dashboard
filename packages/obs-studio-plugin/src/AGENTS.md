# DOX — packages/obs-studio-plugin/src

| File | Purpose |
|------|---------|
| `i18n.ts` | Eager catalog: zh-CN/hu only (same key set as `en`). Kept small — cold entry chunk (mdi-chunk-size cap). |
| `messages.ts` | Lazy-only `en` fallback map, `MessageKey`, `tr(t,key,vars)` = `useT` with English fallback. |
