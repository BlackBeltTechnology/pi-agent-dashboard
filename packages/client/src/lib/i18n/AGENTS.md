# DOX — packages/client/src/lib/i18n

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `i18n-hu.ts` | Hungarian message catalog `huCatalog: Record<string,string>` consumed by the i18n runtime. |
| `i18n-legacy-aliases.ts` | `LEGACY_ALIASES: Record<string,string>` mapping retired i18n keys to current ones (back-compat lookup). |
| `i18n.tsx` | i18n provider + `t()` translator. Exports `Language` ("en"|"zh-CN"|"hu"), `LANGUAGE_OPTIONS`, `t(key, vars?,… → see `i18n.tsx.AGENTS.md` |
