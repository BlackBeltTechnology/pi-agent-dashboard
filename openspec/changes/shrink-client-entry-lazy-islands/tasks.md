## 0. Baseline

- [ ] 0.1 On the branch base: `npm run build`; record entry `index-*.js` gz bytes and landing-graph total (entry + modulepreload closure) in this file.

## 1. Guards first (red)

- [ ] 1.1 `mdi-chunk-size.test.ts`: per-subsystem landing-graph absence + separate-chunk presence checks (katex, `hu`, `zh-CN`, Settings) with markers per design D5; assert each marker is unique to its subsystem's source.
- [ ] 1.2 Same test: entry stylesheet has no `.katex` rule.
- [ ] 1.3 Confirm 1.1/1.2 fail on the baseline build.

## 2. KaTeX on demand

- [ ] 2.1 Unit tests (`MarkdownContent`): no-math content never calls `loadMathEngine`; math content renders literal source before load, typeset after; load rejection keeps literal text, no throw; two mounted instances share one load.
- [ ] 2.2 `lib/preview/math-engine.ts`: memoized `loadMathEngine` (katex, rehype-katex, `katex/dist/katex.min.css`) + `useMathEngine(needed)`.
- [ ] 2.3 `MarkdownContent.tsx`: delimiter check, conditional `[rehypeKatex, { throwOnError: false }]` insertion; drop static `rehype-katex` import.
- [ ] 2.4 `AsciiDocPreview.tsx`: use `loadMathEngine()` instead of `import("katex")`.
- [ ] 2.5 `main.tsx`: remove `import "katex/dist/katex.min.css"`.
- [ ] 2.6 `vite.config.ts`: add `"katex": ["katex", "rehype-katex"]` manual chunk with a comment pointing at this change.

## 3. Lazy non-English catalogs

- [ ] 3.1 Unit tests (`i18n`): `loadCatalog` memoized per language; `en` no-op; plugin catalog registered before/after load resolves `plugin.<id>.*` in both orders; `setLanguage` applies only after load; load failure → English fallback.
- [ ] 3.2 Move `zhCN` verbatim to `i18n-zh-CN.ts`; `i18n-hu.ts` unchanged; `dictionaries` start with `en` only.
- [ ] 3.3 `loadCatalog` + pending plugin-block buffer in `i18n.tsx`; `I18nProvider.setLanguage` loads then sets.
- [ ] 3.4 `main.tsx`: `await loadCatalog(initialLanguage)` before render (non-`en` only).
- [ ] 3.5 D4: static `RESERVED_LABEL_TRANSLATIONS` table; `translationsOf` reads it; `settings-promotions` test asserts zh-CN/hu labels still reserved.
- [ ] 3.6 `scripts/i18n-parity.mjs`: read `zh-CN` from `i18n-zh-CN.ts`; add `--check` drift test for `RESERVED_LABEL_TRANSLATIONS`; `npm run i18n:parity` exits 0.

## 4. Lazy Settings panel

- [ ] 4.1 Tests: settings route renders loading state then panel; deep link to a canonical settings URL renders the page; import failure shows error + retry.
- [ ] 4.2 `App.tsx`: `React.lazy` + `Suspense` at both call sites, `ErrorBoundary` with retry.
- [ ] 4.3 Fix existing client tests that assumed a synchronous Settings render (`findBy…`).

## 5. Measure and lock in

- [ ] 5.1 `npm run build`; record entry gz + landing-graph total; both must drop vs 0.1.
- [ ] 5.2 Set `INDEX_GZ_CAP_BYTES` = measured rounded up to next 10 KiB (≤ 800 KiB); replace the "size win still owed" note with the measurement record.
- [ ] 5.3 Full client test suite + `npm run build` warnings unchanged (no new dynamic-import warning).
- [ ] 5.4 Manual: chat with a `$x^2$` message (typesets after load), switch to Magyar and back, open Settings via button and deep link — on throttled network.

## 6. Docs

- [ ] 6.1 AGENTS.md rows: `MarkdownContent.tsx`, `AsciiDocPreview.tsx`, new `math-engine.ts`, `i18n.tsx`, new `i18n-zh-CN.ts`, `App.tsx`, `vite.config.ts`, `mdi-chunk-size.test.ts`, `settings-promotions.ts`, `scripts/i18n-parity.mjs` — `See change: shrink-client-entry-lazy-islands`.
