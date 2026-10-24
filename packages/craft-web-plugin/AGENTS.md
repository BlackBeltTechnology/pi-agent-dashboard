# DOX — packages/craft-web-plugin

Files in this directory. One row per source file. See change: edit-office-in-pane-with-craft-web.

| File | Purpose |
|------|---------|
| `README.md` | Package overview: app table (10 apps, files, how saves land), opt-in, adapter profiles, prepare-on-request, fixed version channels, `serveApp` mount, per-format validators, overrides. See change: extend-craft-web-to-all-apps. |
| `configSchema.json` | draft-07 plugin config `plugins['craft-web'].*`. `apps.<wordcraft\|gridcraft\|pdfcraft\|cadcraft\|designcraft\|soundcraft\|photocraft\|vectorcraft\|deckcraft\|lightcraft>` (`$ref` app): `enabled` (default true), `version` `pinned`\|`latest` (ignored for fixed-channel apps). Read live. See change: extend-craft-web-to-all-apps. `liveControl` (default true) kill switch. See change: add-craft-live-control. |
| `package.json` | `pi-dashboard-plugin` manifest. id `craft-web`, `defaultEnabled: false`, priority 400. `editor-pane-file-handler` claims generated from the profiles (one per profile claim; component `<Label><Suffix>Handler` in lazy `./src/client/handlers.tsx`; label `Edit in`/`View in <App>`; `keepAlive {max:3}`; `maxBytes` per `capForExtension`; edit: `firstOverwriteNotice` = registry note, prefixed by the unconfirmed-open check for no-title apps, `copySuffix` = app id, `validator: true`, `siblingExtensions` for type B). Pinned by `src/__tests__/manifest.test.ts`. + `settings-section` claim `CraftWebSettings`. Bundled (server `bundledPlugins`). See change: extend-craft-web-to-all-apps. Live control: `bridge` entry `./src/bridge/index.ts` (+ `./bridge` export), `.pi/` in `files`, `pi.skills` `craft-live-edit`, fixture claim `fakecraft` (`.fakecraft`). See change: add-craft-live-control. |
| `tsconfig.json` | Extends `../../tsconfig.base.json`. jsx react-jsx, noEmit. |
| `vitest.config.ts` | Vitest project. Default env `node`; DOM tests opt in with `// @vitest-environment jsdom`. Aliases runtime/shared/craft-apps to worktree-local src. Registered in ROOT `vitest.config.ts` `test.projects`. |
