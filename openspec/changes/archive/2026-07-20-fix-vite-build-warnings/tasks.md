## 1. Baseline

- [x] 1.1 Capture current warnings + `dist/assets` chunk sizes: `npm run build 2>&1 | tee /tmp/build-before.log` (regression reference).

## 2. #1 CSS placeholder tokens

- [x] 2.1 Reword the `bg-[var(...)]` / `text-[var(...)]` literals in `packages/client/src/lib/session/session-status-visuals.ts` comments (lines ~118, ~128) so the three-dot placeholder no longer appears (use a real token name or the `…` char).
- [x] 2.2 Reword the same tokens in `session-status-visuals.ts.AGENTS.md` (via DocScribe per the docs-write protocol).

## 3. #2 Circular chunk — merge into markdown

- [x] 3.1 In `packages/client/vite.config.ts` `manualChunks`, move `react-syntax-highlighter` into the `markdown` array and remove the standalone `syntax` chunk entry.

## 4. #3 PdfPreview — align lazy (Option B)

- [x] 4.1 In `packages/client/src/components/editor-pane/viewer-registry.tsx`, convert the static `import { PdfPreview }` (line ~25) to `const PdfPreview = lazy(() => import("../preview/PdfPreview.js"))` and wrap the `PdfViewer` render in `<Suspense>` (mirror the existing `MonacoBuffer` lazy pattern in the same file). Leave the four already-lazy sites unchanged.

## 5. #3 known-servers-api — static in SettingsPanel

- [x] 5.1 In `packages/client/src/components/settings/SettingsPanel.tsx` (~line 1922), convert `await import("../../lib/api/known-servers-api.js")` to a static top-of-file import.

## 6. Tests (folded from test-plan.md — automated rows)

- [x] 6.1 S1 — L1 source-invariant test (see `packages/client/src/__tests__/no-jsx-slot-nullish-fallback.test.ts`): scan all client `.ts`/`.tsx`/`.md` source; assert ZERO literal `bg-[var(...)]` / `text-[var(...)]` three-dot placeholders repo-wide. Triple: scanned source · scan for placeholder · zero matches. (test-plan #S1)
- [x] 6.2 S2 — L1 build-artifact test (see `packages/client/src/__tests__/eml-bundle-exclusion.test.ts`): after build, assert NO `syntax-*.js` chunk exists AND a `markdown-*.js` chunk exists; skip-if-no-build. Triple: dist/assets · merged manualChunks · no syntax chunk + markdown chunk present. (test-plan #S2)
- [x] 6.3 S3 — L1 build-artifact test (extend `packages/client/src/__tests__/eml-bundle-exclusion.test.ts`): assert the main entry chunk (resolved from index.html) excludes the PdfPreview module and a lazy pdf/preview chunk exists. Triple: dist · all 5 pdf sites lazy · PdfPreview not in entry. (test-plan #S3)
- [x] 6.4 S4 — L1 size-cap test (see `packages/client/src/__tests__/monaco-chunk-size.test.ts`): gzip the emitted `markdown-*.js` chunk; assert ≤ 450 KB gz (warn 380 KB); skip-if-no-build. Triple: markdown chunk · gzip after build · ≤ 450 KB gz. (test-plan #S4)
- [x] 6.5 S5 — L2/ci build-log grep (add a step to the build job in `.github/workflows/ci.yml`): fail if the build log contains `Unexpected token`, `Circular chunk`, or a `dynamic import will not move module into another chunk` line naming `PdfPreview.tsx` or `known-servers-api.ts`. Triple: full build stdout+stderr · CI build step · none of the four substrings present. (test-plan #S5)
- [x] 6.6 S6 — L3 Playwright spec (see `tests/e2e/editor-pane.spec.ts` / `tests/e2e/eml-preview.spec.ts`): open a `.pdf` in the editor pane; assert the pdf page/canvas renders past the `<Suspense>` "Loading PDF viewer…" fallback with no error boundary. Triple: .pdf in editor pane · lazy PdfViewer routes · pdf renders, no perpetual fallback. (test-plan #S6)

## 7. Manual-only (test-plan.md — deferred to post-merge, no test folded)

- [x] 7.1 S7 — open Settings → known-servers section populates after the static import (covered by existing `known-servers-sections.test.ts`; import-style change is behavior-neutral). (test-plan: manual-only)
- [x] 7.2 S8 — a chat message with a fenced code block renders highlighted after the chunk merge (covered by existing `chat-render-fx.spec.ts`). (test-plan: manual-only)

## 8. Verify

- [x] 8.1 `npm run build 2>&1 | tee /tmp/build-after.log`; diff vs `/tmp/build-before.log` — the four targeted warning families are gone (CSS parse ×2, circular chunk, PdfPreview + known-servers dynamic-import). @mdi/js + oversized-chunk warnings intentionally remain (owned by `shrink-client-index-chunk`).
- [x] 8.2 `npm test 2>&1 | tee /tmp/pi-test.log`; grep for failures — S1–S4 green, existing suite green.
- [x] 8.3 `npm run quality:changed` clean — confirms no orphaned `lazy`/`Suspense`/unused imports introduced by #3.
