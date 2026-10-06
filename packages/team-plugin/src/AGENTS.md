# DOX — packages/team-plugin/src

One row per file. See change: add-team-plugin.

| File | Purpose |
|------|---------|
| `configSchema.json` | Plugin config schema: `admins[{iss,sub}]`, `skillCatalog{name→abs path}`, `idleMinutes`, `maxConversations`, `teamHome`, `projects{id→{name,path,users,contextFiles}}`. See change: add-team-plugin. |
| `i18n.ts` | Plugin i18n catalog (`zh-CN`, `hu`, identical key sets; EN = call-site fallback) for the folder row + enable/settings/disable dialogs. Exported as `catalog` via `client/index.tsx`. See change: add-team-plugin. |
