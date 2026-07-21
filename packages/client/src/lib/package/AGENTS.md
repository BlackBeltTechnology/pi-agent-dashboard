# DOX — packages/client/src/lib/package

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `installed-list-helpers.ts` | Pure client helpers for installed-packages UI. Exports `computeDestIdentity(source)` — mirrors server… → see `installed-list-helpers.ts.AGENTS.md` |
| `package-classifier.ts` | Pure helpers for unified packages settings UI. Exports `SourceType` (`npm`\|`git`\|`local`\|`global`),… → see `package-classifier.ts.AGENTS.md` |
| `package-queue.ts` | Package operation FIFO scheduler singleton — single source of truth for install/remove/update ops across… → see `package-queue.ts.AGENTS.md` |
| `packages-api.ts` | Fetch helpers for package endpoints not owned by `package-queue`. → see `packages-api.ts.AGENTS.md` |
| `plugins-api.ts` | Client-side fetch helpers: `listPlugins()` (`GET /api/plugins`), `togglePlugin(id, enabled)` (`POST… → see `plugins-api.ts.AGENTS.md` |
| `tool-install-deeplink.ts` | Deep-link bus between `MissingToolInlineError` and `ToolsSection`. → see `tool-install-deeplink.ts.AGENTS.md` |
