# Render docx / xlsx / csv previews in the file content area

## Why

The dashboard's file-preview system (`render-file-previews`, archived) dispatches by
extension to per-format renderers (`markdown`, `asciidoc`, `pdf`, `html`, `image`, …).
Office documents — `.docx`, `.xlsx`, `.csv` — currently fall through to `FallbackPreview`
("we can't preview this file · Download"). Users who keep Office archives (specs, offers,
spreadsheets, data exports) cannot read a Word doc or eyeball a spreadsheet without leaving
the dashboard and launching Office.

These three formats map cleanly onto infrastructure that already exists — the
`dispatchPreview` extension map, the server-side render route that already backs AsciiDoc
(`/api/file/render`), the sanitized-HTML `dangerouslySetInnerHTML` posture, the lazy
`PdfPreview`, and the `PreviewCard` → `PreviewBody` inline/overlay shells. `.xlsx`/`.csv`
render **in-process with no Docker** via SheetJS. `.docx` is **two-tier**: an in-process
`mammoth` baseline that always works, plus — **when the `document-converter` engine is
available** — a high-fidelity path that renders the docx to PDF (`dc.renderPdf`, whose engine
image already bundles LibreOffice) and shows it via the existing `PdfPreview`. The PDF path is
pixel-perfect (exact Word layout, native images, no crash class, no HTML-image bloat) and
degrades to the `mammoth` baseline whenever the engine is absent or errors. `document-converter`
otherwise stays reserved for kb ingestion and the visual `.pptx` case (separate change).

The design is grounded in a real 907-file corpus (475 docx / 401 xlsx / 31 csv from a live
Projektek folder), which surfaced the exact failure and size tails the feature must survive:

- **docx**: vanilla `mammoth` crashes on **21%** of files — one consistent bug
  (`escapeHtmlAttribute(undefined)` on a hyperlink with null href AND null anchor). A ~5-line
  `transformDocument` guard lifts render success to **99.8%** (474/475); the one holdout is a
  genuinely corrupt archive. Images inline as base64 → HTML balloons (max 16.3 MB, 175-image
  file @2.4 s), but only **2–4%** of files are image-heavy enough to matter.
- **xlsx**: SheetJS renders **99.3%** (398/401). Failures: 1 password-protected, 2 SheetJS
  bugs. Size tail is severe — one workbook has **35 M cells / 35 k rows / 40 sheets**.
- **csv**: parses cleanly, but the tail is a **507 MB / 3.3 M-line** file and **2 non-UTF-8**
  (Hungarian → CP1250) files that need encoding detection.

The unifying constraint across all three is **unbounded input**. The renderers are small; the
shared hard part is a **bounded-preview policy** (row/line/image/byte caps + a "showing first N
of M — download for full" affordance + graceful degradation of the ~0.5–1% unrenderable tail
to the existing `FallbackPreview`). Mockups for all states are UX-reviewed under
`openspec/changes/render-office-previews/mockups/`.

## What Changes

1. **Dispatch gains `docx` and `spreadsheet` kinds.** `dispatchPreview` maps `.docx → "docx"`
   and `.xlsx | .csv → "spreadsheet"`; the `RendererKind` union adds `"docx"` and
   `"spreadsheet"`. `PreviewCard` gets icons + body sizing for both. Dispatch stays purely
   shape-based (no MIME sniff, no read).

2. **The server render route renders `.docx` two ways, engine-gated.** `GET /api/file/render`
   (which already handles `.adoc`) gains a `.docx` branch that returns a discriminated result
   `{ mode: "pdf" | "html", … }`:
   - **`mode: "pdf"` (preferred, when `document-converter` is available)** — convert the docx to
     PDF via `dc.renderPdf` (cached by path+mtime+size in a server temp dir) and return a
     pointer the client streams through `PdfPreview`. Pixel-perfect; no hyperlink-guard, no
     image cap needed (images render natively).
   - **`mode: "html"` (baseline + fallback)** — parse with `mammoth` using a mandatory
     `transformDocument` **hyperlink-guard** (sets `href=""` on hyperlinks with null href AND
     null anchor — fixes the 21% crash class), sanitize with DOMPurify (server-side via
     `isomorphic-dompurify`, the AsciiDoc `safe:"secure"` posture), and apply the
     **bounded-preview policy** (strip images past a count/byte cap → `truncated:true`).

   Engine availability is probed cheaply and cached; any engine error (`DOCKER_UNAVAILABLE`,
   render failure) **falls back to `mode:"html"`**, never failing the request. The route reuses
   the shared `/api/file/raw` anti-traversal gate, rejects non-`.docx`/non-AsciiDoc extensions,
   and rejects files over a size cap (HTTP 413) before reading. A companion
   `GET /api/file/rendered-pdf?cwd=&path=` streams the cached docx→PDF bytes. `mammoth` +
   `isomorphic-dompurify` become pinned `packages/server` deps; `document-converter` is used via
   its existing facade (no new engine command — `renderPdf` already accepts docx input).

3. **A new endpoint parses spreadsheets to bounded, structured JSON.** `GET
   /api/file/sheet?cwd=&path=&limit=` parses `.xlsx`/`.csv` with SheetJS and returns
   `{ success, data: { sheets: [{ name, header, rows, totalRows, totalCols, truncated }],
   activeSheet, encoding } }` — bounded to the first N rows/cols per the policy (default 500
   rows inline, higher `limit` in the overlay). For `.csv` it **detects encoding**
   (`chardet` → `iconv-lite` decode to UTF-8, so Hungarian CP1250 renders correctly) and
   reports the decoded charset. It reuses the shared anti-traversal gate, `.xlsx`/`.csv`-only
   extension gate (else 400), and a size-cap check (413) before reading. `xlsx`, `chardet`,
   `iconv-lite` become pinned `packages/server` deps.

4. **`DocxPreview` renders whichever mode the server returned.** A new renderer (sibling to
   `AsciiDocPreview`, wired through `PreviewBody` so inline + `/view` overlay share it) fetches
   `/api/file/render`; on `mode:"pdf"` it mounts the existing `PdfPreview` against
   `/api/file/rendered-pdf`; on `mode:"html"` it renders the sanitized HTML via
   `dangerouslySetInnerHTML` (safe — server-sanitized) and shows the shared **truncation banner**
   when `truncated`. Loading/error states in both.

5. **`SpreadsheetPreview` renders sheet tabs + a bounded grid.** A new renderer fetches
   `/api/file/sheet`, renders a frozen-header row/column grid, sheet tabs for multi-sheet
   workbooks (`.csv` is single-sheet), the shared truncation banner ("Showing first 500 of
   35,173 rows · sheet 1 of 40", plus decoded charset for `.csv`), and a download affordance.

6. **The unrenderable tail degrades uniformly to `FallbackPreview`.** Corrupt archive,
   password-protected, and library-bug failures are caught server-side and surface as a
   `{ success:false, error }` the renderer maps to the existing download card — no new failure
   UI, no worker crash.

## Non-Goals

- **No `.pptx`.** Slide decks are absolutely-positioned visual content; faithful rendering
  needs a rendering engine (LibreOffice/docling), which the in-process design deliberately
  avoids. Tracked as follow-up **`render-pptx-preview`** (hosted on `document-converter`, whose
  engine image already bundles LibreOffice; on-demand overlay, not this inline path).
- **No Docker on the `.xlsx`/`.csv` path.** Spreadsheets render in-process (SheetJS). Only
  `.docx` opportunistically uses `document-converter` — and only when it is already available;
  it never becomes a hard dependency (mammoth baseline always works).
- **No new `document-converter` engine command.** The docx→PDF path uses the existing
  `renderPdf` facade (already accepts docx). No engine contract change (that is pptx's problem).
- **No editing, formulas, or round-trip.** Read-only preview. No cell editing, no formula
  recalculation, no export.
- **No URL-served docx image extraction.** In the `mode:"html"` fallback the 2–4% image-heavy
  tail strips images to placeholders + download (cap+strip); native images come free in the
  preferred `mode:"pdf"` path.
- **No new overlay/route chrome.** Both renderers mount in the existing `PreviewCard` (inline)
  and `/view` overlay shells, per the shared-renderer invariant.
- **No editor-pane split-viewer wiring.** The editor-pane file tree uses a separate
  `ViewerKind`/`viewer-registry` dispatch; opening these there keeps its existing fallback.

## Coordinates With

This change modifies the shared `Renderer dispatch is purely shape-based` requirement and the
`RENDERER_BY_EXT` map, which three sibling changes also touch. Ordering matters:

- **`add-eml-preview`** (adds `"email"`) modifies the *same* requirement. OpenSpec `MODIFIED`
  replaces the requirement wholesale on archive, so **whichever of the two archives second MUST
  rebase its union block to the superset** (`… "docx" | "spreadsheet" | "email" | "fallback"`) or
  it silently drops the other's kind. Code side is additive (no conflict).
- **`auto-canvas`** relocates `RENDERER_BY_EXT` + `dispatchPreview` from
  `packages/client/src/lib/preview-dispatch.ts` → `packages/shared/src/renderer-by-ext.ts` and
  defines `canvasTypes: Record<RendererKind, boolean>`. **Recommended: this change lands BEFORE
  `auto-canvas`**, which then extracts the larger map and enumerates `canvasTypes` over the new
  kinds. If `auto-canvas` lands first, retarget the dispatch tasks to the `packages/shared` path
  and add `docx`/`spreadsheet` to `canvasTypes`.
- **`render-pptx-preview`** (adds `"pptx"`) is a later stub in the same union family; same rebase
  rule applies.

## Discipline Skills

- **performance-optimization** — the whole design is driven by measured size tails (35 M-cell
  workbook, 507 MB csv, 16 MB docx HTML); the bounded-preview policy (server-side row/line/image
  caps, structured JSON not raw bytes) exists to keep large payloads off the client.
- **security-hardening** — parses untrusted Office files and renders docx HTML via
  `dangerouslySetInnerHTML`; server-side DOMPurify sanitization, the shared anti-traversal gate
  on both routes, and size caps before read are load-bearing.
