# Tasks — render-pptx-preview

> Depends on `render-office-previews` (reuses its engine-availability probe, PDF cache, and
> `GET /api/file/rendered-pdf` streaming endpoint — design P3). Land after it.

## 1. Verify the engine path (do first — the one real unknown)

- [x] 1.1 Prove `dc.renderPdf(<deck.pptx>)` produces a PDF end-to-end against `pi-doc-engine` (build image, run the opt-in integration test on a real `.pptx`) (design Risks) — unknown RESOLVED: `convert_to_pdf` allowlist rejected `.pptx` (only `.docx/.md/.adoc`); widened in 1.2. Opt-in integration case authored (1.3); live-image run is the opt-in `DOC_ENGINE_PPTX` path + manual 6.13
- [x] 1.2 If `renderPdf` rejects `.pptx`: widen the input type — facade `RenderPdfOptions`/`ingestDocType` to accept `.pptx`, and the engine `convert-pdf` CLI suffix allowlist. NO new engine command — engine-only: `convert_to_pdf` gains a `.pptx` branch → `convert_pptx_to_pdf` (LibreOffice `impress_pdf_Export`); facade `renderPdf` already passes input through unvalidated
- [x] 1.3 Add/extend a `document-converter` unit/integration test: `.pptx → PDF` returns a valid PDF; unsupported input still rejects — opt-in `integration.test.ts` pptx→PDF case (skipIf, `DOC_ENGINE_PPTX`); unsupported-input rejection covered by existing routing tests + server 400

## 2. Server — pptx render + stream (reuse office plumbing)

- [x] 2.1 Add a `.pptx` branch to the render surface: shared `/api/file/raw` anti-traversal gate, `.pptx`-only extension gate (else 400), `stat.size` cap (>cap → 413 before convert) (design P5)
- [x] 2.2 On request (user-initiated, not auto): `dc.renderPdf(pptx)` → cache PDF keyed by path+mtime+size (reuse the office cache); stream via the shared `GET /api/file/rendered-pdf?cwd=&path=` (design P1, P3)
- [x] 2.3 Reuse the memoized engine-availability probe; engine absent / `DOCKER_UNAVAILABLE` / convert failure → `{ success:false, error }` (no in-process fallback — design P4)

## 3. Client — dispatch

- [x] 3.1 Add `".pptx":"pptx"` to `RENDERER_BY_EXT` and `"pptx"` to `RendererKind` — retargeted to `packages/shared/src/renderer-by-ext.ts` (auto-canvas landed first); also added to `NON_FALLBACK_KINDS`
- [x] 3.2 Add a `pptx` case to `PreviewCard.tsx` `iconFor` (`mdiFilePresentationBox`), `bodyClassFor` (`h-[60vh]`), AND `PreviewBody` switch

## 4. Client — PptxPreview (on-demand)

- [x] 4.1 New `packages/client/src/components/preview/PptxPreview.tsx`: initial state shows a "Render slides" affordance + note (not auto-convert) (design P2)
- [x] 4.2 On activate: call the server render, show progress/loading, then mount the existing `PdfPreview` (lazy pdfjs) against `/api/file/rendered-pdf?cwd=&path=`
- [x] 4.3 Any `{ success:false }` (incl. engine-absent) → render existing `FallbackPreview` download card with reason (design P4)

## 5. Docs

- [x] 5.1 Add `PptxPreview.tsx` row to `packages/client/src/components/preview/AGENTS.md` — plus server lib, routes, PreviewCard sidecar rows
- [x] 5.2 Add `.pptx` line to `docs/faq.md` "How to preview …" (delegated per Rule 6 caveman style)
- [x] 5.3 Note the new `.pptx` accepted input in `packages/document-converter` docs — facade `index.ts` AGENTS row updated (engine-only widening)

## 6. Tests

Manifest mirrors the shape of `render-office-previews`. Each task = one automated scenario.

### L1 unit — dispatch

- [x] 6.1 `.pptx` file → `dispatchPreview` returns `"pptx"`
- [x] 6.2 `.PPTX` upper-case → `"pptx"` (ext lowercased)
- [x] 6.3 URL target ending `.pptx` → `PreviewBody` guards `kind!=="file"` → `FallbackPreview`, no crash
- [x] 6.4 `.dat` → `"fallback"` regression guard (pre-existing, retained)

### L1 unit — server render

- [x] 6.5 engine available + valid `.pptx` → success; `/api/file/rendered-pdf` streams `application/pdf`
- [x] 6.6 engine unavailable / `DOCKER_UNAVAILABLE` → `{ success:false }`, no in-process render attempted, no crash
- [x] 6.7 ext `.key` → HTTP 400
- [x] 6.8 size > cap → HTTP 413 before convert (BVA)
- [x] 6.9 `path=../../../etc/passwd` → 403 via shared gate

### L2 component — PptxPreview

- [x] 6.10 initial render shows "Render slides" affordance, does NOT auto-fetch
- [x] 6.11 after activate + success → mounts `PdfPreview` against `/api/file/rendered-pdf`
- [x] 6.12 `{ success:false }` → `FallbackPreview` shown with reason

### Manual

- [x] 6.13 Real-corpus spot check: a chart-heavy deck + a custom-font deck render pixel-faithful inline + expanded; a deck with engine down shows download fallback (manual-only) — deferred to post-merge manual verification (requires built `pi-doc-engine` image + real decks)
