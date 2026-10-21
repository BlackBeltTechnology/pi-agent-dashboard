# DOX — tests/fixtures/runtime-canary-plugin

Runtime-delivery canary: prebuilt-ESM dashboard plugin (`fixture: true`) loaded through the import map. NOT a workspace member. Built by `scripts/build-runtime-canary.mjs` (`npm run build:canary`) via the SDK preset; `dist/` is never committed. Harness builds once, hashes the output, trusts that hash (task 7.5). Paths relative to this dir.

| File | Purpose |
|------|---------|
| `.gitignore` | Ignores `dist/`, `node_modules/` (preset cache dir lives in `node_modules/.cache`). |
| `package.json` | Manifest id `runtime-canary`: `hostApi ^1.0.0`, `clientBundle ./dist/client/index.js`, `clientStyles ./dist/client/client.css`, `i18nCatalog catalog`, server `./src/server/index.ts` (outside the asset root), `keywords:["pi-dashboard-plugin"]`. Claims: `settings-section` + `shouldRender`, lazy `settings-section` (`module ./dist/client/lazy-panel.js`), `shell-overlay-route` `/s6/*?` depth 1 content (`module ./dist/client/s6-route.js`), `sidebar-folder-section`. |
| `src/client/canary-app.tsx` | app-kit app (`defineDashboardApp`, wouter `/sub` route, renders `host.mode`). Only reached via `S6Route`. |
| `src/client/i18n.ts` | `catalog` (zh-CN, hu; unprefixed keys). |
| `src/client/index.tsx` | Entry module: `canaryShouldRender`, `CanarySettings`, `CanaryFolderEntry` (`useFolderMenuItem` → opens `/s6`), re-exports `catalog`. |
| `src/client/LazyPanel.tsx` | Lazy chunk `lazy-panel` (`CanaryLazyPanel`). |
| `src/client/S6Route.tsx` | Lazy chunk `s6-route`: `<EmbeddedApp>` claim, ~3 lines of plugin code. |
| `src/server/index.ts` | Server entry; broadcasts one global `plugin_intents` (`ui:markdown-content` in `settings-section`, `sessionId:null`). |
| `variants/bundled-app-kit/` | Failure variant: bundles its own app-kit (preset `unsafeBundleSpecifiers`, TEST ONLY). `useAppHost` has no host provider → throws in the claim boundary. |
| `variants/bundled-react/` | Failure variant: bundles its own React (guard bypassed, TEST ONLY) → invalid hook call in the claim boundary. |
| `variants/missing-export/` | Failure variant: imports `createSlotRegistry` (not on the public surface) → link-time SyntaxError on import. |
| `variants/throws-in-render/` | Failure variant: claim throws while rendering → slot error boundary contains it. |

Each variant dir = `package.json` (id `runtime-canary-<name>`, `fixture:true`, no server, no styles), `.gitignore`, `src/client/index.tsx` (claim `VariantPanel`). See change: decouple-plugins-from-core (tasks 7.4, 8.1).
