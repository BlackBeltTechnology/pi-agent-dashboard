# DOX — packages/web-access-plugin/src

Files in this directory. One row per source file. See change: render-unclaimed-custom-entries.

| File | Purpose |
|------|---------|
| `i18n.ts` | Plugin i18n `catalog` (unprefixed keys, merged under `plugin.web-access.*`). `zh-CN` + `hu` blocks, identical key sets. English at call sites via `t(key, vars, fallback)`. Keys: labels, query/result/URL counts (`…One`/`…Other`), expand/collapse, loading, `detailsUnavailable`, `moreItems`, `skippedItems`, `sizeChars`. Adds `failedOne/Other`, `skippedItemsOne/Other` (replaces `skippedItems`), `opensInNewTab`; `loading`/`detailsUnavailable` reworded. See change: retro-ux-chat-rendering. |
