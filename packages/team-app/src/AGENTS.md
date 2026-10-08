# DOX — packages/team-app/src

One row per top-level file (subdirectories carry their own AGENTS.md). See change: add-team-plugin.

| File | Purpose |
|------|---------|
| `TeamApp.tsx` | Routes `/`, `/agent/:key[/c/:c]`, `/personas/new|:key`, `/skills[/new|/:name]` relative to the host router base; mirrors the target store ↔ `?project=`; folder view registers the "Teljes csapat" action via `host.setActions`; sets the title via `host.setTitle`. See change: add-team-plugin. See change: add-team-skill-access. |
| `standalone.tsx` | Standalone entry: `createStandaloneHost`, same-origin sign-in via the dashboard seam (`SeamIdentityProvider`) or app-kit OIDC for a foreign origin, `StandaloneBar` + `Gate` + `TeamApp`, user chip. See change: add-team-plugin. |
| `team-app.tsx` | Library entry: default `defineDashboardApp({id:"team", App, HeaderContext: TargetSelector})`; no React root, no global CSS. See change: add-team-plugin. |
