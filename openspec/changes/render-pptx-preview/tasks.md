# Tasks — render-pptx-preview

> Depends on `render-office-previews` (reuses its engine-availability probe, PDF cache, and
> `GET /api/file/rendered-pdf` streaming endpoint — design P3). Land after it.

## 1. Verify the engine path (do first — the one real unknown)

- [ ] 1.1 Prove `dc.renderPdf(<deck.pptx>)` produces a PDF end-to-end against `pi-doc-engine` (build image, run the opt-in integration test on a real `.pptx`) (design Risks)
- [ ] 1.2 If `renderPdf` rejects `.pptx`: widen the input type — facade `RenderPdfOptions`/`ingestDocType` to accept `.pptx`, and the engine `convert-pdf` CLI suffix allowlist. NO new engine command
- [ ] 1.3 Add/extend a `document-converter` unit/integration test: `.pptx → PDF` returns a valid PDF; unsupported input still rejects

## 2. Server — pptx render + stream (reuse office plumbing)

- [ ] 2.1 Add a `.pptx` branch to the render surface: shared `/api/file/raw` anti-traversal gate, `.pptx`-only extension gate (else 400), `stat.size` cap (>cap → 413 before convert) (design P5)
- [ ] 2.2 On request (user-initiated, not auto): `dc.renderPdf(pptx)` → cache PDF keyed by path+mtime+size (reuse the office cache); stream via the shared `GET /api/file/rendered-pdf?cwd=&path=` (design P1, P3)
- [ ] 2.3 Reuse the memoized engine-availability probe; engine absent / `DOCKER_UNAVAILABLE` / convert failure → `{ success:false, error }` (no in-process fallback — design P4)

## 3. Client — dispatch

- [ ] 3.1 Add `".pptx":"pptx"` to `RENDERER_BY_EXT` and `"pptx"` to `RendererKind` (retarget to `packages/shared/src/renderer-by-ext.ts` if `auto-canvas` landed first — see proposal Coordinates With)
- [ ] 3.2 Add a `pptx` case to `PreviewCard.tsx` `iconFor` (presentation icon), `bodyClassFor`, AND `PreviewBody` switch

## 4. Client — PptxPreview (on-demand)

- [ ] 4.1 New `packages/client/src/components/preview/PptxPreview.tsx`: initial state shows a "Render slides" affordance + note (not auto-convert) (design P2)
- [ ] 4.2 On activate: call the server render, show progress/loading, then mount the existing `PdfPreview` (lazy pdfjs) against `/api/file/rendered-pdf?cwd=&path=`
- [ ] 4.3 Any `{ success:false }` (incl. engine-absent) → render existing `FallbackPreview` download card with reason (design P4)

## 5. Docs

- [ ] 5.1 Add `PptxPreview.tsx` row to `packages/client/src/components/preview/AGENTS.md`
- [ ] 5.2 Add `.pptx` line to `docs/faq.md` "How to preview …" (delegate per Rule 6 caveman style)
- [ ] 5.3 Note the new `.pptx` accepted input in `packages/document-converter` docs if 1.2 widened the facade

## 6. Tests

Manifest mirrors the shape of `render-office-previews`. Each task = one automated scenario.

### L1 unit — dispatch

- [ ] 6.1 `.pptx` file → `dispatchPreview` returns `"pptx"`
- [ ] 6.2 `.PPTX` upper-case → `"pptx"` (ext lowercased)
- [ ] 6.3 URL target ending `.pptx` → `PreviewBody` guards `kind!=="file"` → `FallbackPreview`, no crash
- [ ] 6.4 `.dat` → `"fallback"` regression guard

### L1 unit — server render

- [ ] 6.5 engine available + valid `.pptx` → success; `/api/file/rendered-pdf` streams `application/pdf`
- [ ] 6.6 engine unavailable / `DOCKER_UNAVAILABLE` → `{ success:false }`, no in-process render attempted, no crash
- [ ] 6.7 ext `.key` → HTTP 400
- [ ] 6.8 size > cap → HTTP 413 before convert (BVA)
- [ ] 6.9 `path=../../../etc/passwd` → 403 via shared gate

### L2 component — PptxPreview

- [ ] 6.10 initial render shows "Render slides" affordance, does NOT auto-fetch
- [ ] 6.11 after activate + success → mounts `PdfPreview` against `/api/file/rendered-pdf`
- [ ] 6.12 `{ success:false }` → `FallbackPreview` shown with reason

### Manual

- [ ] 6.13 Real-corpus spot check: a chart-heavy deck + a custom-font deck render pixel-faithful inline + expanded; a deck with engine down shows download fallback (manual-only)
