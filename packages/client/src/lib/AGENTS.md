# DOX — packages/client/src/lib

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `context-usage.ts` | Exports `buildContextUsageMap(sessionStates, sessions): Map<string, ContextUsageInfo>`. → see `context-usage.ts.AGENTS.md` |
| `i18n-en-source.json` | English source catalog (structured key → copy) for `scripts/i18n-migrate-auto-keys.mjs`. User-facing copy says new session / start / restart, never spawn; keys stay stable (gate: `__tests__/ui-copy-no-spawn.test.ts`). See change: align-ui-with-theme-tokens. |
| `settings-promotions.ts` | Pure settings-nav promotion resolver. Exports `resolveSettingsPromotions(rows, reserved)` → `Map<pluginId, SettingsPromotion>` in display order (`order`, `label`, id), `RESERVED_SETTINGS_LABELS` (static: built-in page + group labels, en + every locale via `translationsOf`, folded), `foldSettingsLabel` (NFKC+trim+lowercase), `PROMOTION_GROUP_ALLOWLIST` (`models`). Gate: settings-section `nav` + allowlisted group + `row.firstParty === true` + non-reserved label; first eligible claim per plugin; label de-dupe by (`order`, id). See change: promote-model-roles-settings. |
| `use-loopback-link-open.ts` | `useLoopbackLinkOpen()` → `(e,href)` click handler shared by `MarkdownContent.a()` + `UrlLink`. → see `use-loopback-link-open.ts.AGENTS.md` |
