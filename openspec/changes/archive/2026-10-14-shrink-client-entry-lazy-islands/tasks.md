## 0. Baseline

- [x] 0.1 On the branch base: `npm run build`; record entry `index-*.js` gz bytes and landing-graph total (entry + modulepreload closure) in this file.
  - Baseline: entry `index-BWQv5STN.js` 950,470 B gz; landing graph (6 chunks) 1,391,815 B gz.

## 1. Guards first (red)

- [x] 1.1 `mdi-chunk-size.test.ts`: per-subsystem landing-graph absence + separate-chunk presence checks (katex, `hu`, `zh-CN`, Settings) with markers per design D5; assert each marker is unique to its subsystem's source.
- [x] 1.2 Same test: entry stylesheet has no `.katex` rule.
- [x] 1.3 Confirm 1.1/1.2 fail on the baseline build.

## 2. KaTeX on demand

- [x] 2.1 Unit tests (`MarkdownContent`): no-math content never calls `loadMathEngine`; math content renders literal source before load, typeset after; load rejection keeps literal text, no throw; two mounted instances share one load.
- [x] 2.2 `lib/preview/math-engine.ts`: memoized `loadMathEngine` (katex, rehype-katex, `katex/dist/katex.min.css`) + `useMathEngine(needed)`.
- [x] 2.3 `MarkdownContent.tsx`: delimiter check, conditional `[rehypeKatex, { throwOnError: false }]` insertion; drop static `rehype-katex` import.
- [x] 2.4 `AsciiDocPreview.tsx`: use `loadMathEngine()` instead of `import("katex")`.
- [x] 2.5 `main.tsx`: remove `import "katex/dist/katex.min.css"`.
- [x] 2.6 `vite.config.ts`: add `"katex": ["katex", "rehype-katex"]` manual chunk with a comment pointing at this change.

## 3. Lazy non-English catalogs

- [x] 3.1 Unit tests (`i18n`): `loadCatalog` memoized per language; `en` no-op; plugin catalog registered before/after load resolves `plugin.<id>.*` in both orders; `setLanguage` applies only after load; load failure → English fallback.
- [x] 3.2 Move `zhCN` verbatim to `i18n-zh-CN.ts`; `i18n-hu.ts` unchanged; `dictionaries` start with `en` only.
- [x] 3.3 `loadCatalog` in `i18n.tsx` (no pending buffer needed — `registerPluginCatalog` writes straight into the live dict, plugin keys are `plugin.<id>.*` so order is irrelevant); `I18nProvider.setLanguage` loads then sets.
- [x] 3.4 `main.tsx`: `await loadCatalog(initialLanguage)` before render (non-`en` only).
- [x] 3.5 D4: static `RESERVED_LABEL_TRANSLATIONS` table; `translationsOf` reads it; `settings-promotions` test asserts zh-CN/hu labels still reserved.
- [x] 3.6 `scripts/i18n-parity.mjs`: read `zh-CN` from `i18n-zh-CN.ts`; add `--check` drift test for `RESERVED_LABEL_TRANSLATIONS`; `npm run i18n:parity` exits 0.

## 4. Lazy Settings panel

- [x] 4.1 Tests: settings route renders loading state then panel; deep link to a canonical settings URL renders the page; import failure shows error + retry.
- [x] 4.2 `App.tsx`: `React.lazy` + `Suspense` at both call sites, `ErrorBoundary` with retry.
- [x] 4.3 Fix existing client tests that assumed a synchronous Settings render (`findBy…`).

## 5. Measure and lock in

- [x] 5.1 `npm run build`; record entry gz + landing-graph total; both must drop vs 0.1.
  - After: entry 689,543 B gz (−260,927 B); landing graph 1,130,891 B gz (−260,924 B). After merging develop (retro-ux-credential-vault): entry 694,038 B gz; landing graph 1,135,386 B gz. Cap set to 690 KiB (measured + ~0.4% CI skew, next 10 KiB). New lazy chunks: `katex` (+ own CSS), `i18n-hu`, `i18n-zh-CN`, `SettingsPanel`.
- [x] 5.2 Set `INDEX_GZ_CAP_BYTES` = measured rounded up to next 10 KiB (≤ 800 KiB); replace the "size win still owed" note with the measurement record.
- [x] 5.3 Full client test suite + `npm run build` warnings unchanged (no new dynamic-import warning).
- [x] 5.4 Manual: chat with a `$x^2$` message (typesets after load), switch to Magyar and back, open Settings via button and deep link — on throttled network.

## 6. Docs

- [x] 6.1 AGENTS.md rows: `MarkdownContent.tsx`, `AsciiDocPreview.tsx`, new `math-engine.ts`, `i18n.tsx`, new `i18n-zh-CN.ts`, `App.tsx`, `vite.config.ts`, `mdi-chunk-size.test.ts`, `settings-promotions.ts`, `scripts/i18n-parity.mjs` — `See change: shrink-client-entry-lazy-islands`.
