# DOX — packages/craft-web-plugin

Files in this directory. One row per source file. See change: edit-office-in-pane-with-craft-web.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. Edit `.docx` (WordCraft; GridCraft/DeckCraft later) in the editor pane via sandboxed web build. Opt-in, prepare-on-request, `serveApp` mount, OOXML validator, `<APP>_WEB_DIR`/`_WEB_VERSION` overrides. |
| `configSchema.json` | draft-07 plugin config `plugins['craft-web'].*`. `apps.<wordcraft\|gridcraft\|deckcraft>.enabled` (default true). Read live by status, prepare, validator `enabled()`. `apps.<app>.version` `pinned` (default) \| `latest`. See change: track-latest-craft-web-version. |
| `package.json` | `pi-dashboard-plugin` manifest. id `craft-web`, `defaultEnabled: false`, priority 400, client `src/client/index.tsx`, server `src/server/index.ts`. One `editor-pane-file-handler` claim per verified app (WordCraft only): id `wordcraft`, `.docx`, mode `edit`, label "Edit in WordCraft", `keepAlive {max:3}`, `maxBytes` 41943040 (`OFFICE_SIZE_CAPS.docx`), `firstOverwriteNotice` = registry `webFidelityNote`, `copySuffix wordcraft`, `validator true`. Component `CraftFrameHost`. Deps runtime, shared, craft-apps. `files` ships `src/` (shim + validator) sans tests. Bundled: listed in server `piDashboard.bundledPlugins` (grants `serveApp` trust). + `settings-section` claim `CraftWebSettings` (lazy `./src/client/CraftWebSettings.tsx`, tab general). See change: track-latest-craft-web-version. |
| `tsconfig.json` | Extends `../../tsconfig.base.json`. jsx react-jsx, noEmit. |
| `vitest.config.ts` | Vitest project. Default env `node`; DOM tests opt in with `// @vitest-environment jsdom`. Aliases runtime/shared/craft-apps to worktree-local src. Registered in ROOT `vitest.config.ts` `test.projects`. |
