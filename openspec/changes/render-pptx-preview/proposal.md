# Render PPTX (slide deck) previews — follow-up to render-office-previews

> **Status: planned.** Engine decision resolved to **A′** (pptx → PDF → existing `PdfPreview`,
> fidelity-first — see `design.md`). Depends on `render-office-previews` (reuses its PDF plumbing);
> land after it. One implementation-time unknown remains (does `renderPdf` accept `.pptx` input, or
> need a narrow widening) — verified by tasks.md §1.

## Why

`render-office-previews` adds in-process previews for `.docx`/`.xlsx`/`.csv`. `.pptx` is
deliberately excluded there because it is **categorically different**: a slide deck is
absolutely-positioned visual content (shapes, custom fonts, gradients, charts), not flow or
tabular text. There is no in-process, dependency-free library that renders `.pptx` to faithful
HTML — faithful rendering requires a real rendering engine. So `.pptx` currently falls through
to `FallbackPreview` (download).

Corpus evidence: 82 real decks, median 4.2 MB, max 258 MB; ~20% contain charts; heavy embedded
media and custom fonts — exactly the content a lossy text extraction would destroy.

## Key grounding (already proven)

- **`document-converter` is the right host, not standalone LibreOffice.** Its engine image
  **already bundles LibreOffice** (`engine/Dockerfile`: `libreoffice-writer`, `python-pptx`),
  Docker-quarantined. So the heavy dependency is *already in the repo* — no new host dep.
- **Pixel-perfect render is proven.** `soffice --headless --convert-to pdf` on a real 15-slide
  deck produced a faithful PDF (title slide with custom fonts/gradients/logos intact) in 8–11 s.
  That PDF can ride the **existing `PdfPreview`** (lazy pdfjs) — or be rasterized to per-slide
  PNGs for a carousel.
- **But the facade has a gap.** `document-converter`'s command surface today is
  `convertToMarkdown | renderDocx | renderPdf | extractForEdit | mergeBack | fillFrontmatter |
  profileTables`. `renderPdf`'s input is **Markdown/docx, not pptx**. There is no
  `pptx → PDF` or `pptx → slide-images` command. So the two viable paths are:

| Path | How | Fidelity | Work |
|---|---|---|---|
| **B′** | `dc.convertToMarkdown(pptx)` → existing `MarkdownPreview` | LOSSY — flat text + images, slide layout gone | zero new engine code |
| **A′** | add `pptxToPdf` / `renderSlides` command to engine + facade (LibreOffice already in image) → existing `PdfPreview` or slide carousel | pixel-perfect | small engine + facade extension |

**Lean: A′.** The fidelity B′ loses (charts, custom fonts, positioning) is exactly what a deck
is *for*, and LibreOffice is already sitting unused-for-this in the image.

## What Changes

1. **pptx → PDF via the existing `renderPdf` facade** (LibreOffice already in the engine image;
   `cmd_render_pdf` shells to `convert-pdf`). No new engine command — at most a narrow input-type
   widening if `renderPdf` currently assumes md/docx (tasks §1).
2. Dispatch `.pptx → "pptx"`; render **on-demand** (explicit "Render slides" affordance), NOT an
   inline auto-convert — conversion is seconds, not an inline budget. Show progress, then mount the
   existing `PdfPreview` against the shared `GET /api/file/rendered-pdf` (reused from
   `render-office-previews`).
3. Bounded-preview: size-gate oversize decks (HTTP 413) before convert; download-original escape
   hatch. Engine absent → `FallbackPreview` (no in-process fallback exists for pptx).

## Non-Goals

- No inline auto-render (Docker latency); pptx preview is user-initiated / overlay.
- No editing, no reflow, no speaker notes extraction (v1).

## Coordinates With

Adds `"pptx"` to the shared `RendererKind` union / `RENDERER_BY_EXT`, which sibling changes also
extend. Ordering: `render-office-previews` and `add-eml-preview` land first; this change reuses the
docx PDF plumbing (availability probe, PDF cache, `/api/file/rendered-pdf`) from
`render-office-previews`. If `auto-canvas` landed first, retarget §3.1 to
`packages/shared/src/renderer-by-ext.ts` and add `pptx` to its `canvasTypes`. Whichever preview
change archives last rebases its `MODIFIED` union block to the superset.

## Resolved / Remaining Questions

- **A′ vs B′ — RESOLVED: A′** (pptx → PDF → `PdfPreview`), fidelity-first, consistent with docx D8.
  B′ (`convertToMarkdown`) rejected for layout loss.
- **PDF vs PNG carousel — RESOLVED: PDF reuse** for v1 (`PdfPreview`); carousel a later enhancement.
- **Remaining (implementation-time):** does `renderPdf` accept `.pptx` today or need a narrow
  input-type widening (tasks §1); exact slide/size caps; where the "Render slides" affordance sits
  in the card/overlay chrome.

## Discipline Skills

- **performance-optimization** — Docker cold start + multi-second conversion drive the
  on-demand (not inline) UX and the slide/size caps.
- **doubt-driven-review** — extending the `document-converter` engine contract is a
  cross-boundary, not-easily-reversible step; review the command shape before it stands.
