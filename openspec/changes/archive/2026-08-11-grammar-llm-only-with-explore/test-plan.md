# Test Plan — grammar-llm-only-with-explore

Stage: apply   Generated: 2026-08-10

No blocking clarifications — every Triple slot filled from the locked spec.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | grammar-check-service → Single LLM grammar backend (legacy coercion) | EP | L1 | automated | `parseGrammarConfig({ enabled:true, backend:"languagetool", languagetool:{url:"http://x"}, llm:{provider:"p",model:"m"} })` | parse | result has NO `backend` and NO `languagetool` own-key; `llm` preserved; no throw |
| E2 | grammar-check-service → Single LLM grammar backend (defaults) | EP | L1 | automated | `parseGrammarConfig({})` | parse | `enabled:false, autoCheck:true, debounceMs:1200, minChars:12, maxChars:4000, language:"auto", correctionView:"redline", capitalizeFirstWord:false`; no `llm`; no `backend`/`languagetool` keys |
| E3 | grammar-check-service → A persisted legacy key never breaks config validation | decision-table | L1 | automated | on-disk `plugins.grammar = { enabled:true, backend:"languagetool", languagetool:{url:"…"}, llm:{provider,model} }` | write/migrate path → `validatePluginConfig` (schema `additionalProperties:false`) | validation does NOT throw an `additionalProperties` error; persisted object has no `backend`/`languagetool` |
| E4 | grammar-check-service → Single LLM grammar backend (no model) | decision-table | L1 | automated | `config = { enabled:true, llm:undefined }` | `checkGrammar` | `{ ok:false, code:"backend_unconfigured" }`; `streamSimple` never called |
| E5 | grammar-check-service → Grammar health probe | EP | L1 | automated | enabled config + model set | `GET /api/grammar/health` | body = `{ enabled:true, backend:"llm", autoCheck, debounceMs, minChars, language, correctionView }`; NO `languagetool` key; no model/creds |
| E6 | grammar-settings-plugin → model picker always shown and required | decision-table | L1 | automated | `plugins.grammar.llm` unset vs set | render `GrammarSettings` | unset → "pick a model" prompt + picker present; set → no prompt; BOTH cases: no backend `<select>`, no LT-URL field |
| E7 | grammar-settings-plugin → A persisted LanguageTool config renders as LLM-only | EP | L1 | automated | `GET /api/config` returns `plugins.grammar={ backend:"languagetool", languagetool:{url} }` | mount `GrammarSettings` | no backend selector, no URL field in the DOM; LLM-only controls render |
| E8 | grammar-settings-plugin → Correction view control persists | decision-table | L1 | automated | user sets **Correction view** = `list`, clicks Save | Save | `POST /api/config/plugins/grammar` body carries `correctionView:"list"` |
| E9 | grammar-settings-plugin → Legacy core config is migrated in once | state-transition | L1 | automated | `config.json` has core `grammar={backend:"languagetool",…}`, `plugins.grammar` absent | plugin server entry `registerPlugin` runs twice | 1st load: `updatePluginConfig` called with a `parseGrammarConfig` output (no `backend`/`languagetool`); 2nd load: NOT re-migrated |
| E10 | grammar-settings-plugin → linked guidance target resolves | static-lint | L1 | automated | the `href` the settings renders for the model-guidance link | resolve against repo | target is an existing file under `docs/` |

### Performance

_None._ The ~2 s LLM latency floor is documented guidance, not a spec threshold — no perf scenario invented.

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | openspec-dialogs → Explore dialog offers grammar checking over its prose | state-convergence | L1 | automated | Explore open, mocked `useGrammarCheck` returns a suggestion for `draft="teh cat"` | apply the correction | `onApplyText`/`setText` rewrites the textarea to the corrected text; `onSend` NOT called (no prompt sent) |
| F2 | openspec-dialogs → New Change description offers grammar checking | state-transition | L1 | automated | New Change dialog open, grammar claimed | render | a `ComposerPanelSlot` is mounted under the description textarea bound to `description`/`setDescription`; the name `<input>` has no slot |
| F3 | openspec-dialogs → Propose dialog is unchanged | state-transition | L1 | automated | Propose dialog open | render | no `ComposerPanelSlot` present in the tree |
| F4 | openspec-dialogs → Feature disabled leaves the dialogs unchanged | state-transition | L1 | automated | grammar plugin disabled / does not claim `composer-panel` | open Explore + New Change | slot renders null; no grammar affordance; no `/api/grammar/*` fetch issued |
| F5 | grammar-settings-plugin → unsaved status marker is semantic; no LT marker | decision-table | L1 | automated | `GrammarSettings` rendered; draft dirty | inspect DOM/styles | no `#rgb`/`rgba()`/`hsl()` literal; unsaved marker uses `--severity-warning-fg`; NO LanguageTool reachability marker anywhere |
| F6 | grammar-settings-plugin → hint and link render by the model picker | state-transition | L1 | automated | `GrammarSettings` rendered (llm section) | render | localized inline hint text present next to picker; a link element to the model-guidance doc present |
| F7 | grammar-settings-plugin → Model-candidate guidance (content quality) | visual/subjective | — | manual-only | the new `docs/` model-guidance page | human reads | [judgment: recommendations match the benchmark + read clearly — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | grammar-check-service → Backend failures are typed and non-leaky (unreachable) | fault-injection (abort) | L1 | automated | `streamSimple` throws ECONNREFUSED | `POST /api/grammar/check` | `502 { error:"backend_unreachable" }`; one structured log `level:"error"`; log contains NO draft text, no provider body, no creds |
| X2 | grammar-check-service → Backend failures are typed and non-leaky (non-JSON) | fault-injection | L1 | automated | model returns prose, not JSON | check | safe result (`suggestions:[]`, best-effort `correctedText`) OR `{ error:"backend_bad_response" }`; never a 500 with a raw body |
| X3 | openspec-dialogs → Enabled but no model configured surfaces the same state as the composer | fault-injection | L1 | automated | grammar enabled, `llm` unset; Explore open, `draft` typed | auto/manual check | panel surfaces the `backend_unconfigured` outcome exactly as the chat composer does; no correction applied to the field |

---

## Coverage summary

- Requirements covered: 7/7 (grammar-check-service ×3, grammar-settings-plugin ×3, openspec-dialogs ×1)
- Scenarios by class: edge 10 · perf 0 · frontend 7 · error 3
- Scenarios by level: L1 19 · L2 0 · L3 0 · manual-only 1
- Scenarios by disposition: automated 19 · manual-only 1

## New infra needed

- none — all automated rows land in existing vitest tiers (grammar-plugin server/config/component tests + client dialog component tests). No new qa/ or Playwright harness required. (A future L3 Playwright pass over the enabled dialogs is possible but not required for this change; the mocked-hook L1 pattern from `GrammarComposerPanel.test.tsx` covers the wiring.)
