# DOX — packages/grammar-settings-plugin

First-party dashboard plugin: surfaces the CORE composer grammar/spell-check settings
(`config.grammar`) in the Settings UI via a `settings-section` slot claim. The grammar CHECK
stays core (change: `add-composer-grammar-check`); only the settings live here. Edits core
config through `GET`/`PUT /api/config` (NOT `plugins.<id>.*`). Auto-discovered under
`packages/*`. See change: `add-grammar-settings-plugin`.

| File | Purpose |
|---|---|
| `package.json` | Manifest `pi-dashboard-plugin` (id `grammar-settings`, priority 100, client-only, one `settings-section`/`general` claim → `GrammarSettings`, `i18nCatalog: catalog`). No `server`, no `configSchema` — core validates via `parseGrammarConfig`. |
| `src/index.tsx` | Client entry barrel. Re-exports `GrammarSettings` + `catalog` (names MUST match the manifest for the vite-plugin named-import generator). |
| `src/GrammarSettings.tsx` | Settings-section component. Controls for the full `GrammarConfig` (enabled, autoCheck, backend, debounceMs, minChars, maxChars, language, languagetool.url). For `backend: llm`, ONE model picker via the `ui:model-selector` primitive (`useUiPrimitive(UI_PRIMITIVE_KEYS.modelSelector)`) fed by the resolved `GET /api/models` catalog (`toModelInfo` splits each `provider/id` row); the chosen `provider/id` label is split back into core `llm.{provider,model}` on save — one UI param, core shape unchanged. Loads via `GET /api/config` (`data.grammar`), persists a `{ grammar }` partial via `PUT /api/config`, re-GETs to surface server clamping (PUT does not echo config). LanguageTool reachability via `GET /api/grammar/health`. Local Save/Reload + dirty marker (design Decision 3A). `FALLBACK_GRAMMAR` mirrors shared `DEFAULT_GRAMMAR` (runtime const not imported — `config.ts` pulls `node:fs`). |
| `src/i18n.ts` | `catalog` — unprefixed leaf keys, `hu` locale; English lives inline as `t(key, vars, English)` fallbacks. Merged under `plugin.grammar-settings.*`. |
| `vitest.config.ts` | jsdom + `@vitejs/plugin-react`; `globalSetup` = shared `setup-home.ts` (ephemeral HOME). |
| `src/__tests__/GrammarSettings.test.tsx` | Component tests: load from `GET /api/config`; absent-block defaults; backend-conditional LLM fields; Save PUTs a `{ grammar }` partial; server-clamp re-sync; reachable/unreachable indicator. Mocks `fetch`. |
| `src/__tests__/manifest.test.ts` | Manifest/barrel wiring: single settings-section/general claim; barrel exports the claimed component + catalog; no server/configSchema. |
