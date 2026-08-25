# Tasks

## 1. Fix (llm.ts)

- [x] 1.1 `parseLlmResult`: when no itemized suggestion survives but `correctedText.trim()` differs
  from `text.trim()` (and input is non-empty), push one whole-text `GrammarSuggestion`
  (`id: "0:<len>:whole"`, `offset 0`, `length text.length`, `original` = input, `replacement` =
  corrected text, `kind: "grammar"`).
- [x] 1.2 Add + apply `stripTextTags` to `correctedText` (strip a single echoed `<text>…</text>`
  wrapper) before the changed/unchanged comparison.

## 2. Test infrastructure

- [x] 2.1 Register `packages/grammar-plugin` in the root `vitest.config.ts` `projects` array (it
  was missing, so `npm test` skipped all grammar tests).

## 3. Edge-case tests (97 → 225)

- [x] 3.1 `grammar-llm-edgecases.test.ts` — whole-text fallback regression (empty + non-substring),
  `stripTextTags`, out-of-order/duplicate/blank suggestion mapping, resilient `extractJsonObject`,
  request shaping (token cap / temp 0 / `<text>` wrap / creds / language), stream draining
  (string/mixed/no-done/empty/error), timeout/abort/generic-failure mapping.
- [x] 3.2 `config-grammar-edgecases.test.ts` — full `parseGrammarConfig` matrix: boolean coercion,
  clamp boundaries (±1, NaN/Infinity), backend selection, language/url handling, `llm` sub-block
  validation, defensive-copy + idempotence.
- [x] 3.3 `grammar-service-edgecases.test.ts` — dispatch across every config combo, truncation
  boundaries, language precedence (arg > config > auto), `capitalizeFirstWord` reaching both
  backends, error mapping, whole-text fallback through the service, `getGrammarHealth`.
- [x] 3.4 `grammar-languagetool-edgecases.test.ts` — multi-replacement, missing rule, non-numeric
  offsets, unicode UTF-16 offsets, adjacent/out-of-bounds `applyCorrections`, summary ordering,
  url normalization, language fallback.
- [x] 3.5 `grammar-routes-edgecases.test.ts` — body plumbing, registry resolved only for `llm`
  (+ throwing-resolver tolerance), thrown-check → 502, full code→HTTP table incl. unknown → 500,
  `llm` health omits `languagetool`.

## 4. Verify

- [x] 4.1 Full grammar-plugin suite green: 225 tests (97 existing + 128 new), 15 files.
- [x] 4.2 Biome clean on every changed/new file.
- [x] 4.3 (manual) Verified in the running dashboard with the `llm` backend: after a client
  rebuild + server restart, a clearly-wrong draft now surfaces a whole-text correction (was
  "No issues found").

## 5. Spec

- [x] 5.1 Add the "LLM corrections are never silently swallowed" requirement (+ scenarios) to
  `grammar-check-service`.

## 6. Docs

- [x] 6.1 Update `packages/grammar-plugin/AGENTS.md`: `llm.ts` row (whole-text fallback +
  `stripTextTags`) and rows for the 5 new test files.
