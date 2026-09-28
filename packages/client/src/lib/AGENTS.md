# DOX — packages/client/src/lib

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `context-usage.ts` | Exports `buildContextUsageMap(sessionStates, sessions): Map<string, ContextUsageInfo>`. → see `context-usage.ts.AGENTS.md` |
| `i18n-en-source.json` | English source catalog (structured key → copy) for `scripts/i18n-migrate-auto-keys.mjs`. User-facing copy says new session / start / restart, never spawn; keys stay stable (gate: `__tests__/ui-copy-no-spawn.test.ts`). See change: align-ui-with-theme-tokens. |
| `use-loopback-link-open.ts` | `useLoopbackLinkOpen()` → `(e,href)` click handler shared by `MarkdownContent.a()` + `UrlLink`. → see `use-loopback-link-open.ts.AGENTS.md` |
