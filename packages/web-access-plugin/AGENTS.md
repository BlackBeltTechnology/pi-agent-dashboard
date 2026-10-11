# DOX — packages/web-access-plugin

Files in this directory. One row per source file. See change: render-unclaimed-custom-entries.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. Client-only plugin rendering `web-search-results` custom entries (pi-web-access) as compact cards. Collapsed summary from body; expanded detail from payload; plain text + safe links. |
| `package.json` | pi-dashboard-plugin manifest. id `web-access`; no `server`. One claim: `custom-entry-renderer` for `customType: "web-search-results"` → `WebSearchEntryCard`. `i18nCatalog` `catalog`. `requires.piExtensions: ["pi-web-access"]` = advisory (plugins UI), NOT an activation gate — claim stays live so old sessions still render. |
| `tsconfig.json` | Extends `../../tsconfig.base.json`. `jsx: react-jsx`, `noEmit`, DOM libs. |
| `vitest.config.ts` | Vitest config. `@vitejs/plugin-react`, jsdom, `pool: forks`, `PARALLEL_MAX_WORKERS`, shared `setup-home` globalSetup. `resolve.alias` maps plugin-runtime (+ subpaths before the bare key) and shared to worktree-local src. |
