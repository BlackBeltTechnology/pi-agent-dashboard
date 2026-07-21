# Test Plan — fix-vite-build-warnings

Adversarial scenarios for the mechanical build-warning fixes. Manifest — the
`disposition` column is the source of truth the `plan-proposal` fold and
`ship-change` defer both read. Stage: design (HARD gate). Two testability gaps
were resolved via `ask_user`: (1) size-regression → absolute-cap L1 guard on the
merged markdown chunk; (2) clean-build → CI build-log grep.

Repo test levels: **L1** vitest (`packages/*/src/**/__tests__/*.test.ts`) ·
**L2/ci** workflow assertion (`.github/workflows/ci.yml`) · **L3** Playwright
(`tests/e2e/*.spec.ts`, docker harness).

## Scenarios

### S1 — Placeholder token never re-enters scanned source
- **class:** edge-case · **technique:** source-invariant (repo lint) · **level:** L1 · **disposition:** automated
- **exemplar:** `packages/client/src/__tests__/no-jsx-slot-nullish-fallback.test.ts`
- **Triple:** INPUT: all scanned `.ts`/`.tsx`/`.md` client source · TRIGGER: scan for the literal placeholder tokens `bg-[var(...)]` / `text-[var(...)]` (three-dot form) · OBSERVABLE: **zero** matches (repo-wide, not just the two seed files) — a future comment/sidecar re-introducing the token fails the test.

### S2 — react-syntax-highlighter is merged, no standalone syntax chunk
- **class:** edge-case · **technique:** state (chunk topology) · **level:** L1 · **disposition:** automated
- **exemplar:** `packages/client/src/__tests__/eml-bundle-exclusion.test.ts`
- **Triple:** INPUT: `packages/client/dist/assets/` after `npm run build` · TRIGGER: build with the merged `manualChunks` · OBSERVABLE: **no** `syntax-*.js` chunk is emitted **and** a `markdown-*.js` chunk exists (highlighter folded in). Skip-if-no-build, per exemplar.

### S3 — PdfPreview stays lazy (Option B), not in the main entry chunk
- **class:** edge-case · **technique:** state (chunk topology) · **level:** L1 · **disposition:** automated
- **exemplar:** `packages/client/src/__tests__/eml-bundle-exclusion.test.ts` (extends its "pdfjs stays lazy" assertion to the PdfPreview component)
- **Triple:** INPUT: `dist/` after build · TRIGGER: build with all five PdfPreview sites dynamic · OBSERVABLE: the main entry chunk (resolved from `index.html`) does **not** contain the PdfPreview module marker; a lazy pdf/preview chunk exists.

### S4 — Merged markdown chunk stays within budget (no size regression)
- **class:** performance · **technique:** absolute threshold · **level:** L1 · **disposition:** automated
- **exemplar:** `packages/client/src/__tests__/monaco-chunk-size.test.ts`
- **Triple:** INPUT: the emitted `markdown-*.js` chunk · TRIGGER: gzip it after build · OBSERVABLE: gzipped size ≤ **450 KB** hard cap (warn at 380 KB); baseline today ≈ 328 KB gz (109 KB + 226 KB). Skip-if-no-build.

### S5 — Clean build: none of the targeted warning strings (authoritative gate)
- **class:** error-handling · **technique:** output assertion · **level:** L2/ci · **disposition:** automated
- **exemplar:** `.github/workflows/ci.yml` (existing build job) — NEW infra: a post-build grep step
- **Triple:** INPUT: full `npm run build` stdout+stderr · TRIGGER: the CI build step · OBSERVABLE: the log contains **none** of — `Unexpected token` · `Circular chunk` · a `dynamic import will not move module into another chunk` line naming `PdfPreview.tsx` **or** `known-servers-api.ts`. (This row also catches the design-H4 residual: a surviving 3-node cycle still prints `Circular chunk` and fails here.)

### S6 — PDF preview renders past the new Suspense boundary
- **class:** frontend-quirk · **technique:** state-convergence · **level:** L3 · **disposition:** automated
- **exemplar:** `tests/e2e/editor-pane.spec.ts` (viewer-registry surface) / `tests/e2e/eml-preview.spec.ts`
- **Triple:** INPUT: a `.pdf` opened in the editor pane · TRIGGER: viewer-registry routes to the now-lazy `PdfViewer` · OBSERVABLE: the pdf page/canvas renders (converges past the "Loading PDF viewer…" `<Suspense>` fallback) with **no** error-boundary — i.e. Option B's new lazy boundary resolves, not a perpetual fallback.

### S7 — Known-servers list still loads after the static import (regression)
- **class:** frontend-quirk · **technique:** regression reliance · **level:** — · **disposition:** manual-only
- **rationale:** converting SettingsPanel's `known-servers-api` import from dynamic to static is behavior-neutral and already covered by `packages/client/src/__tests__/known-servers-sections.test.ts`; no new test. Post-merge manual smoke: open Settings → the known-servers section populates.

### S8 — Markdown + code rendering unaffected by the chunk merge (regression)
- **class:** frontend-quirk · **technique:** regression reliance · **level:** — · **disposition:** manual-only
- **rationale:** the `markdown`/`syntax` merge is pure bundler config; existing `tests/e2e/chat-render-fx.spec.ts` already asserts markdown + highlighted-code rendering and runs in the e2e suite. Post-merge manual smoke: a chat message with a fenced code block renders highlighted.

## New infra needed
- S5: a build-log grep step in `.github/workflows/ci.yml` that fails on the four
  warning substrings. No new harness — extends the existing build job.

## Fold summary
- **automated → test task:** S1, S2, S3, S4, S5, S6 (6 rows)
- **manual-only → tagged manual task, no test:** S7, S8 (2 rows)
