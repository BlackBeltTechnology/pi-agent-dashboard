## 1. Package scaffold

- [ ] 1.1 Create `packages/context-mode-plugin/` directory with `package.json` (name: `pi-dashboard-context-mode-plugin`, `type: "module"`, MIT license, peer-dep on React 19 and React-DOM 19).
- [ ] 1.2 Add `pi-dashboard-plugin` manifest field with `id: "context-mode"`, `displayName: "Context Mode"`, `priority: 100`, `client: "./src/client/index.tsx"`, `requires.piExtensions: ["context-mode"]`, and the 11 `tool-renderer` claims (one per `ctx_*` tool) each with `shouldRender: "ctxExtensionPresent"`.
- [ ] 1.3 Add `tsconfig.json` + `vitest.config.ts` matching the honcho-plugin layout.
- [ ] 1.4 Add dev-deps mirroring honcho-plugin: `@testing-library/react`, `@testing-library/jest-dom`, `@types/react`, `react`, `react-dom`, `vitest`.
- [ ] 1.5 Add runtime deps: `@blackbelt-technology/dashboard-plugin-runtime`, `@blackbelt-technology/pi-dashboard-shared`, `@mdi/js`, `@mdi/react`. Add `react-syntax-highlighter` only if the dashboard does not export a shared SyntaxHighlighter wrapper (check during 4.1).
- [ ] 1.6 Add `packages/context-mode-plugin/README.md` (concise — purpose + activation + renderer list).
- [ ] 1.7 Add `packages/context-mode-plugin/` to the monorepo workspace `workspaces` array in the root `package.json`.

## 2. `ctxExtensionPresent` sync cache (lifted from honcho)

- [ ] 2.1 Create `src/client/hooks.ts` mirroring `honcho-plugin/src/client/hooks.ts`: module-level `extensionPresentCache` (closed-by-default), `refreshExtensionPresentCache()` reading `/api/health.plugins[].requirements.piExtensions`, initial probe at module load, refresh on `plugin-config-update` window event.
- [ ] 2.2 Create `src/client/shouldRender.ts` exporting `ctxExtensionPresent(): boolean` reading the cache. Manifest claims reference this by exported name.
- [ ] 2.3 Add `src/client/__tests__/shouldRender.test.ts` covering: closed-by-default at module load, `/api/health` with `satisfied: true` flips cache, `satisfied: false` keeps cache false, `plugin-config-update` triggers refresh.

## 3. Shared internal primitives

- [ ] 3.1 Create `src/client/shared/CodeOutputCard.tsx`: title header, optional code/text body, optional output panel. Internal to plugin; NOT exported in `index.tsx`.
- [ ] 3.2 Create `src/client/shared/LanguagePill.tsx`: small badge rendering a language slug (`js`, `ts`, `py`, `sh`, `rb`, `go`, `rs`, `php`, `pl`, `r`, `ex`, `cs`) with appropriate color.
- [ ] 3.3 Create `src/client/shared/KbBadge.tsx`: small "indexed: <intent>" badge with database icon.

## 4. Bespoke renderers (3)

- [ ] 4.1 Create `src/client/CtxExecuteRenderer.tsx`: language pill + syntax-highlighted code (from `args.code`, language from `args.language`) + stdout panel (from `result`) + indexed badge when `args.intent` set + background pill when `args.background: true`. Handles `status === "running"` (loading state for output) and `status === "error"` (red border on output). Investigate whether to lift dashboard's SyntaxHighlighter wrapper or bundle `react-syntax-highlighter`.
- [ ] 4.2 Create `src/client/CtxBatchExecuteRenderer.tsx`: list of `{label, command}` chips (collapsible, click-to-expand each command); separate list of queries as chips; per-query result accordion (parses `result` text by per-query headers if structured, else falls back to a single result block); surfaces `concurrency` and `timeout` as small pills if set.
- [ ] 4.3 Create `src/client/CtxSearchRenderer.tsx`: one chip per query in `args.queries`; each query expandable to its hit list (parses `result` by per-query sections); each hit rendered as an expandable card with source label and snippet preview.

## 5. CodeOutputCard-based renderers (8)

- [ ] 5.1 `CtxExecuteFileRenderer.tsx`: path chip + language pill + processing code + output.
- [ ] 5.2 `CtxFetchAndIndexRenderer.tsx`: URL pill(s) (single `args.url` or batch via `args.requests[]`), source label, output preview (~3 KB).
- [ ] 5.3 `CtxIndexRenderer.tsx`: source label + content/path summary, "indexed" confirmation from `result`.
- [ ] 5.4 `CtxStatsRenderer.tsx`: parses `result` into KPI tiles (savings %, tokens, calls per tool); falls back to raw `result` text if parse fails.
- [ ] 5.5 `CtxDoctorRenderer.tsx`: status checklist rendered from `result` lines (✓/✗/? prefixes); falls back to raw `result`.
- [ ] 5.6 `CtxUpgradeRenderer.tsx`: single-line "command to run" panel; reproduces the shell command exactly.
- [ ] 5.7 `CtxPurgeRenderer.tsx`: ⚠ destructive callout (red border + warning icon) + scope chip (`session` / `project`) + `sessionId` chip if present.
- [ ] 5.8 `CtxInsightRenderer.tsx`: "Opened insight dashboard at :<port>" pill (port parsed from `args.port` or `result`).

## 6. Plugin entry

- [ ] 6.1 Create `src/client/index.tsx`: export all 11 renderer components by name (matches `component` field in each manifest claim) + export `ctxExtensionPresent` from `./shouldRender.js`.
- [ ] 6.2 Verify each exported name matches a `component` or `shouldRender` value declared in the manifest (mismatch = plugin fails to load).

## 7. Test coverage

- [ ] 7.1 `CtxExecuteRenderer.test.tsx`: renders with sample `args` + `result`; shows language pill; shows "indexed" badge when `intent` set; `running` state shows loading; `error` state shows error styling.
- [ ] 7.2 `CtxBatchExecuteRenderer.test.tsx`: renders with multi-command + multi-query args; commands are collapsible; queries are listed; result accordion expands per query.
- [ ] 7.3 `CtxSearchRenderer.test.tsx`: renders with multi-query args; each query expands to hit cards.
- [ ] 7.4 Smoke test for each CodeOutputCard renderer asserting it mounts without throwing for representative `args` + `result` fixtures.
- [ ] 7.5 Manifest discoverability test: vendors the plugin's `package.json` and validates against `validateManifest` from `dashboard-plugin-runtime` (per honcho-plugin's pattern in `manifest-discoverability.test.ts`).
- [ ] 7.6 `shouldRender` smoke test: with `ctxExtensionPresent` returning false, mounting `ToolCallStep` for a `ctx_*` toolName falls through to `GenericToolRenderer`; with true, the plugin renderer mounts. (Verifies end-to-end integration with `wire-tool-renderer-slot`.)

## 8. Integration

- [ ] 8.1 Verify `discoverPlugins()` picks the new plugin up (manual smoke: start dashboard, check `GET /api/plugins` includes `context-mode`).
- [ ] 8.2 Verify `/api/health.plugins[]` includes `context-mode` with its requirement probe result.
- [ ] 8.3 Skip `BUNDLED_EXTENSION_IDS` (in `packages/shared/src/recommended-extensions.ts`) addition — this plugin is user-opt-in like honcho, not bundled with Electron installers by default. Re-evaluate later if user demand justifies it.

## 9. Documentation

- [ ] 9.1 Add row in `docs/file-index-plugins.md` for `packages/context-mode-plugin/` (caveman style, alphabetical placement; delegate to subagent per AGENTS.md docs-write protocol).
- [ ] 9.2 No AGENTS.md edit (per AGENTS.md "Documentation Update Protocol" — per-file detail belongs in the splits, not the backbone).
- [ ] 9.3 Write `packages/context-mode-plugin/README.md` with: purpose, activation behaviour (auto-activates on `context-mode` install), full renderer list, dev/test commands.

## 10. Validation

- [ ] 10.1 `npm test -w pi-dashboard-context-mode-plugin` passes.
- [ ] 10.2 `tsc --noEmit` passes across all workspaces.
- [ ] 10.3 Manual smoke (with `wire-tool-renderer-slot` landed): install `context-mode` pi extension, invoke `ctx_execute` in a session, confirm the new renderer card appears (not `GenericToolRenderer`).
- [ ] 10.4 Manual smoke: uninstall `context-mode`, invoke a historical `ctx_*` from a replayed session, confirm graceful fall-through to `GenericToolRenderer` (no errors, no flicker, no console warnings).
- [ ] 10.5 `openspec validate add-context-mode-plugin` passes.
