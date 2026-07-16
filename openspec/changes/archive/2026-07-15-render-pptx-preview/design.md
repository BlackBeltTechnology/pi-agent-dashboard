## Context

`render-office-previews` adds docx/xlsx/csv previews and defers `.pptx` here because a slide deck
is absolutely-positioned visual content that no in-process, dependency-free library renders
faithfully. Grounding already gathered (see `proposal.md`): 82 real decks (median 4.2 MB, max
258 MB, ~20% with charts, heavy custom fonts); `document-converter`'s engine image already bundles
LibreOffice; `soffice --convert-to pdf` produced a pixel-perfect PDF of a real deck in 8–11 s.

The `renderPdf` facade command shells to `document_converter convert-pdf <in> <out>`, which routes
through LibreOffice (`find_local_libreoffice` / `_convert_with_local_libreoffice`). LibreOffice
converts `.pptx → PDF` natively, so the high-fidelity path is small — not a new engine command.

This design resolves the proposal's open **A′ vs B′** question in favor of **A′** (pptx → PDF →
existing `PdfPreview`), consistent with the **fidelity-first** decision already made for docx in
`render-office-previews` (D8).

## Goals / Non-Goals

**Goals:**
- Faithful `.pptx` preview (exact slide layout, fonts, charts, images) reusing the existing
  `PdfPreview` (lazy pdfjs) via a `document-converter` `pptx → PDF` render.
- On-demand (user-initiated) render — never auto-convert on the inline hot path (Docker + LibreOffice
  latency is seconds, not an inline budget).
- Graceful degradation to the existing `FallbackPreview` (download) when the engine/image is absent.
- No new preview subsystem: dispatch `.pptx → "pptx"`, mount `PdfPreview` against a streamed PDF.

**Non-Goals:**
- No lossy `convertToMarkdown` path (B′) — rejected; it destroys the layout a deck is for.
- No per-slide PNG carousel in v1 (PDF reuse is simpler; carousel is a possible later enhancement).
- No editing, speaker-notes extraction, or reflow.
- No engine change beyond widening `renderPdf` to accept `.pptx` input (verified cheap; see Risks).
- No inline auto-render; no change to the docx/xlsx/csv paths.

## Decisions

**P1 — A′: pptx → PDF → existing PdfPreview (fidelity-first).** When the user requests a render and
the `document-converter` engine is available, convert the deck to PDF via the `renderPdf` facade,
cache it (path+mtime+size), and mount the existing `PdfPreview` against a streamed
`GET /api/file/rendered-pdf` (the same companion endpoint `render-office-previews` introduces for
docx). Rejected B′ (`convertToMarkdown`) for fidelity loss.

**P2 — On-demand, not inline-auto.** `.pptx` dispatches to a `"pptx"` kind whose renderer shows a
"Render slides" affordance (in the `PreviewCard` / `/view` shells) rather than converting on mount.
Activating it calls the server render, shows progress, then swaps to `PdfPreview`. Rationale: a
15-slide deck took 8–11 s; auto-converting every `.pptx` on view would stall the inline path.

**P3 — Reuse the docx PDF plumbing.** The server `pptx` render reuses the availability probe, the
PDF cache, and the `/api/file/rendered-pdf` streaming endpoint defined by `render-office-previews`
(D8). This change adds the `.pptx` input branch, not a parallel PDF pipeline. → sequencing: lands
after `render-office-previews`.

**P4 — Uniform degradation.** Engine absent / `DOCKER_UNAVAILABLE` / render failure → the existing
`FallbackPreview` download card with a clear reason. No new failure UI. Unlike docx, there is **no
in-process fallback renderer** for pptx (none exists), so absent-engine means download-only.

**P5 — Bounded output.** Cap rendered slides / PDF size; oversize decks (the 258 MB tail) are
size-gated (HTTP 413) before conversion, with download as the escape hatch.

## Risks / Trade-offs

- **Engine input-type widening unverified.** `cmd_render_pdf` shells to `convert-pdf`, which uses
  LibreOffice (handles pptx), but the `convert-pdf` CLI / facade `RenderPdfOptions` may currently
  assume md/docx input. **Mitigation:** first implementation task verifies `renderPdf(pptx)` end-to-end
  against `pi-doc-engine`; if it rejects pptx, the fix is a narrow input-type widening (facade
  `ingestDocType`/type + a `convert-pdf` suffix allowance), NOT a new engine command. This is the one
  real unknown and is cheap either way.
- **Latency.** 8–11 s first render. Mitigated by on-demand invocation (P2) + PDF caching (P3);
  repeat views are instant.
- **Hard engine dependency for any preview.** Unlike docx (mammoth baseline), pptx has no in-process
  fallback — no engine means download-only. Accepted: faithful pptx preview is impossible in-process;
  download is the honest degradation.
- **Large decks.** 258 MB tail → large PDFs. Bounded by P5 size-gate + download escape hatch.
- **Ordering coupling.** Depends on `render-office-previews`' PDF plumbing (P3). If that changes shape,
  this rebases. Recorded under proposal `Coordinates With`.
