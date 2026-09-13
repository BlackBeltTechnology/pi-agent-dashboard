# DOX — packages/browser-plugin

Files in this directory. One row per source file. See change: add-browser-relay.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. CDP relay plugin: extension-dial-in per-guid instances, per-profile SSO tokens (writeOnly), screencast live-view tiles. Vendored playwright-core relay pointer. |
| `package.json` | pi-dashboard-plugin manifest. id `browser`, priority 500, `defaultEnabled: false` (opt-in — design Migration Plan step 2 / GAP B). Claims `settings-section`→`BrowserSettings`, `content-view`→`LiveViewTile` (predicate `isLiveViewActive`). server `./src/server/index.ts`, client `./src/client/index.tsx`, `configSchema: ./configSchema.json`. Deps: runtime, shared, `ws`, `debug` (declared properly — was phantom transitive). devDeps `@types/ws`+`@types/debug` (vendored code imports both). |
| `configSchema.json` | draft-07 plugin config, persisted `plugins.browser.*`. `enabled` (default false — kill switch), `defaultBrowser`, `allowMultipleInstancesPerProfile` (default false; user decision under task 2.2b — both busy/multi paths behind one flag), `browsers.<profileDirectory>.{token (writeOnly:true), zeroDialog, allowedDomains}`. `token` writeOnly → `redactWriteOnly` strips it from every client-facing payload (spec browser-plugin-settings F2). |
| `tsconfig.json` | Extends `../../tsconfig.base.json`. jsx react-jsx, noEmit. Bare vendor specifiers (`@isomorphic/*`, `@utils/wsServer`) resolve via `paths` in tsconfig.base.json (single source — a child `paths` key would clobber base's pi-* mappings). |
| `vitest.config.ts` | Vitest project. jsdom, forks pool, react plugin, `PARALLEL_MAX_WORKERS`. `resolve.alias` ARRAY form: shared→worktree-local src + anchored regex aliases for the four vendor bare specifiers (`@isomorphic/time` is a PREFIX of `@isomorphic/timeoutRunner` — regex keys are exact-match). Registered in ROOT `vitest.config.ts` `test.projects`. |
