## 1. Remove the LanguageTool backend (server)

- [ ] 1.1 Delete `packages/grammar-plugin/src/server/backends/languagetool.ts` and its tests (`__tests__/grammar-languagetool.test.ts`, `__tests__/grammar-languagetool-edgecases.test.ts`).
- [ ] 1.2 `grammar-service.ts`: remove the `languagetool` dispatch branch (always call `checkWithLlm`), delete `probeLanguageTool`, and drop the `languagetool` reachability block from `getGrammarHealth`. In `getGrammarHealth`, set `backend: "llm"` as a literal (the `config.backend` field is gone — task 2.1). Add the `backend_unconfigured` path when `config.llm` is unset.
- [ ] 1.3 Drop LT expectations + assert LLM-only dispatch + `backend_unconfigured` in `grammar-service.test.ts` AND `grammar-service-edgecases.test.ts` (asserts `h.languagetool` shapes), `grammar-routes.test.ts` (asserts `body.data.languagetool.reachable`), AND `grammar-routes-edgecases.test.ts`. Grep the four files for `languagetool`/`reachable` and remove every health/LT assertion.

## 2. Collapse the config + wire surface

- [ ] 2.1 `grammar-config.ts`: remove the `backend` and `languagetool` fields from `GrammarConfig` + `DEFAULT_GRAMMAR`; `parseGrammarConfig` drops any persisted `backend`/`languagetool` on read (no throw).
- [ ] 2.2 `configSchema.json`: remove the `backend` enum and the `languagetool` object.
- [ ] 2.3 `packages/shared/src/grammar-types.ts`: collapse `GrammarBackendKind` to the one-member `"llm"`; remove `GrammarHealth.languagetool?`. Update the `GrammarHealth` doc comment that still describes the LanguageTool reachability field.
- [ ] 2.4 Persisted-legacy-key prune (Ajv `additionalProperties:false` throws on unknown keys): make the server-entry `migrateLegacyConfig` (or a one-time load-time prune) strip any `backend`/`languagetool` already sitting in a persisted `plugins.grammar`, so a subsequent `updatePluginConfig`/`validatePluginConfig` on an existing LT user's config does NOT throw. `migrateLegacyConfig` already routes the absent-namespace case through `parseGrammarConfig` (safe once 2.1 lands); this task covers the already-populated namespace.
- [ ] 2.5 Update `config-grammar.test.ts` / `config-grammar-edgecases.test.ts` to cover legacy-config coercion (persisted `backend:"languagetool"` + `languagetool.url` → dropped, no throw), the persisted-namespace prune (2.4) not throwing on validate, and the LLM-only defaults.

## 3. Settings UI (client, in plugin)

- [ ] 3.1 `GrammarSettings.tsx`: remove the backend `<select>`, the LT-URL field, and the LT health dot/probe; render the model picker unconditionally; show a "pick a model" prompt when `llm` is unset. Also edit the component's own `FALLBACK_GRAMMAR` literal (drop `backend`/`languagetool`) and `normalize()` (stop spreading `raw?.languagetool`) — both reference removed `GrammarConfig` props and will not type-check otherwise. Retarget the theme-token status marker off LT reachability onto the unsaved/dirty state only.
- [ ] 3.2 Add the inline model-guidance hint + doc link next to the model picker (localized).
- [ ] 3.3 Strip dead settings i18n keys (`backendLanguagetool`, `backendLlm`, `ltUrl`, backend/URL labels) from the plugin `i18n.ts` (en + inline `hu`); add the new hint/link strings there. Separately, reword the composer error string `grammar.err.unreachable` in the client `i18n-hu.ts` (and its English counterpart in `grammar-panel-chrome.tsx`) to drop the "LanguageTool szerver" wording — it is the `backend_unreachable` message, the only LT mention left in the client catalog (there are NO backend/URL config keys there).
- [ ] 3.4 Update `GrammarSettings.test.tsx`: no backend picker / no URL field; model picker always present; model-required prompt; legacy config renders LLM-only; hint + link present.

## 4. Grammar in the OpenSpec prose dialogs (client)

- [ ] 4.1 `ExploreDialog.tsx`: mount `<ComposerPanelSlot draft={text} onApplyText={setText}/>` below the textarea.
- [ ] 4.2 `NewChangeDialog.tsx`: mount `<ComposerPanelSlot draft={description} onApplyText={setDescription}/>` below the description textarea (leave the name input untouched).
- [ ] 4.3 Confirm ProposeDialog is unchanged (no slot).

## 5. Documentation

- [ ] 5.1 (DocScribe, caveman style) New `docs/` model-guidance page: recommended grammar models + latency/quality/cost tradeoffs, derived from `HANDOFF-grammar-writing.md §5` (haiku-4-5 best; opus/sonnet slower; Gemini flash-latest ok, flash-lite too weak; ~2 s LLM floor).
- [ ] 5.2 (DocScribe) Rewrite `docs/architecture.md` §Composer grammar check for LLM-only + `plugins.grammar.*`; drop the LanguageTool paragraphs.
- [ ] 5.3 Update `packages/grammar-plugin/AGENTS.md` + `packages/shared/src/AGENTS.md` rows for the removed backend/config/wire surface (per Documentation Update Protocol).

## 6. Verify

- [ ] 6.1 `npm run lint` (tsc) clean; grammar-plugin vitest project green; grep shows no `languagetool` references remain outside archived changes.
- [ ] 6.2 Rebuild client + `POST /api/restart`; confirm `/api/grammar/health` has no `languagetool` key and Explore/New Change dialogs show the grammar panel.

## 7. Tests (folded from test-plan.md — 19 automated + 1 manual-only)

### 7a. L1 — grammar-plugin config (see `packages/grammar-plugin/src/__tests__/config-grammar-edgecases.test.ts`)

- [ ] 7.1 (test-plan #E1) Legacy coercion: `parseGrammarConfig({enabled:true,backend:"languagetool",languagetool:{url:"http://x"},llm:{provider:"p",model:"m"}})` · parse · result has no `backend`/`languagetool` own-key, `llm` preserved, no throw.
- [ ] 7.2 (test-plan #E2) Defaults: `parseGrammarConfig({})` · parse · `enabled:false`, `correctionView:"redline"`, `capitalizeFirstWord:false`, standard clamps, no `llm`, no `backend`/`languagetool` keys.
- [ ] 7.3 (test-plan #E3) Persisted-legacy-key prune: on-disk `plugins.grammar` with `backend`+`languagetool` · write/migrate → `validatePluginConfig` (schema `additionalProperties:false`) · does NOT throw `additionalProperties`; persisted object has neither key. (See also 7.4 exemplar for the validate path.)

### 7b. L1 — grammar-plugin service + routes (see `packages/grammar-plugin/src/__tests__/grammar-service.test.ts`, `grammar-routes.test.ts`)

- [ ] 7.4 (test-plan #E4) No model: `config={enabled:true,llm:undefined}` · `checkGrammar` · `{ok:false,code:"backend_unconfigured"}`, `streamSimple` never called.
- [ ] 7.5 (test-plan #E5) Health shape: enabled config + model · `GET /api/grammar/health` · body `{enabled,backend:"llm",autoCheck,debounceMs,minChars,language,correctionView}`, NO `languagetool` key.
- [ ] 7.6 (test-plan #X1) Provider unreachable: `streamSimple` throws ECONNREFUSED · `POST /api/grammar/check` · `502 {error:"backend_unreachable"}`, one `level:"error"` log with NO draft/provider-body/creds.
- [ ] 7.7 (test-plan #X2) Non-JSON: model returns prose · check · safe result (`suggestions:[]`, best-effort `correctedText`) OR `backend_bad_response`, never 500 raw body.

### 7c. L1 — grammar-plugin server entry migration (see `packages/grammar-plugin/src/server/index.ts`; exemplar `grammar-routes.test.ts` for the ctx harness)

- [ ] 7.8 (test-plan #E9) Legacy core migrate-once: `config.json` core `grammar={backend:"languagetool",…}`, `plugins.grammar` absent · `registerPlugin` twice · 1st: `updatePluginConfig` called with a `parseGrammarConfig` output (no `backend`/`languagetool`); 2nd: not re-migrated.

### 7d. L1 — grammar-plugin settings component (see `packages/grammar-plugin/src/__tests__/GrammarSettings.test.tsx`)

- [ ] 7.9 (test-plan #E6) Model picker required: `plugins.grammar.llm` unset vs set · render · unset → "pick a model" prompt + picker; set → no prompt; both → no backend `<select>`, no LT-URL field.
- [ ] 7.10 (test-plan #E7) Persisted LT renders LLM-only: `GET /api/config` → `plugins.grammar={backend:"languagetool",languagetool:{url}}` · mount · no backend selector / no URL field; LLM controls render.
- [ ] 7.11 (test-plan #E8) Correction-view persists: set **Correction view**=`list`, Save · click · `POST /api/config/plugins/grammar` body has `correctionView:"list"`.
- [ ] 7.12 (test-plan #F5) Theme tokens: render (draft dirty) · inspect · no `#rgb`/`rgba()`/`hsl()` literal; unsaved marker uses `--severity-warning-fg`; NO LanguageTool reachability marker.
- [ ] 7.13 (test-plan #F6) Guidance hint+link: render llm section · render · localized inline hint present next to picker + a link element to the model-guidance doc.
- [ ] 7.14 (test-plan #E10) Link target resolves: the doc-link `href` the settings renders · resolve against repo · target file exists under `docs/` (repo-lint file-existence check).

### 7e. L1 — client OpenSpec dialog components (see `packages/grammar-plugin/src/__tests__/GrammarComposerPanel.test.tsx` for the mock-`useGrammarCheck` pattern; `packages/client/src/components/__tests__/OpenSpecArtifactDialog.test.tsx` for dialog render harness)

- [ ] 7.15 (test-plan #F1) Explore apply-only: Explore open, mocked hook returns a suggestion for `draft="teh cat"` · apply · `setText` rewrites textarea to corrected text; `onSend` NOT called.
- [ ] 7.16 (test-plan #F2) New Change description slot: dialog open, grammar claimed · render · `ComposerPanelSlot` mounted under the description textarea bound to `description`/`setDescription`; name `<input>` has no slot.
- [ ] 7.17 (test-plan #F3) Propose unchanged: Propose open · render · no `ComposerPanelSlot` in the tree.
- [ ] 7.18 (test-plan #F4) Disabled = unchanged: grammar disabled/unclaimed · open Explore + New Change · slot renders null, no grammar affordance, no `/api/grammar/*` fetch.
- [ ] 7.19 (test-plan #X3) Enabled-no-model in dialog: grammar enabled, `llm` unset, Explore open, `draft` typed · auto/manual check · surfaces `backend_unconfigured` exactly as the composer; no correction applied.

### 7f. Manual-only (deferred post-merge by ship-change)

- [ ] 7.20 (test-plan: manual-only) Model-guidance content quality: read the new `docs/` model-guidance page · confirm the recommendations match the benchmark (haiku-4-5 best; flash-lite too weak; ~2 s floor) and read clearly. No automatable observable.
