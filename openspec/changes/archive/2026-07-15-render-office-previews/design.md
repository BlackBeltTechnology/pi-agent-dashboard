# Design — render-office-previews

## Context

Grounded in a 907-file real corpus (475 docx / 401 xlsx / 31 csv). See `proposal.md` for the
measured failure/size tails. This document records the decisions that shape the
implementation; each is traceable to corpus evidence or an existing repo pattern.

## D1 — In-process baseline; document-converter is an opt-in enhancement for docx only

**Decision:** xlsx/csv render **only** in-process (SheetJS). docx renders in-process by default
(`mammoth`) but **prefers a `document-converter` PDF render when the engine is available**
(D8). `document-converter` is never a hard dependency and is never used for xlsx/csv.

**Why:** xlsx/csv are tabular — structured JSON is a faithful, sub-second, zero-dependency
representation; the Docker engine only flattens them. docx is *mostly* flow content that
`mammoth` renders well, but its highest-fidelity representation (exact Word layout, native
images, no crash class) is a rendered PDF, which the engine already produces cheaply via
LibreOffice. So docx alone earns the opt-in enhancement, gated on availability with an
in-process fallback. `document-converter` otherwise stays reserved for kb ingestion and the
visual `.pptx` case (see `render-pptx-preview`).

## D2 — docx: mandatory hyperlink-guard transform

**Decision:** Every `mammoth.convertToHtml` call passes a `transformDocument` that walks the
document and sets `href=""` on any hyperlink node with `href == null && anchor == null`.

**Why:** Vanilla `mammoth` 1.12.0 crashes (`escapeHtmlAttribute(undefined)`,
`html-writer.js:155`) on hyperlinks with neither a URL target nor an internal bookmark. This is
**21% of the corpus** (100/475) — not an edge case. The guard lifts success to 99.8% (474/475).
The lone remaining failure is a corrupt zip (not a valid docx), handled by D5.

```
transformDocument: (doc) => {
  const walk = (n) => {
    if (!n) return;
    if (n.type === "hyperlink" && n.href == null && n.anchor == null) n.href = "";
    n.children?.forEach(walk);
  };
  walk(doc);
  return doc;
};
```

## D3 — Bounded-preview policy (shared across all three)

**Decision:** One policy, three parameterizations. The server caps before serialization; the
client shows a shared truncation banner; a download affordance always reaches the full file.

| Format | Cap (inline default) | Overlay | Trigger evidence |
|---|---|---|---|
| docx | strip images if imageCount > cap OR html > byte cap; text kept whole | same (docs are short) | max 16.3 MB html, 175-img file |
| xlsx | first 500 rows × N cols per sheet; first sheet active, rest as tabs | `?limit=` raises rows | 35 M cells / 35 k rows / 40 sheets |
| csv | first 500 rows (single sheet) | `?limit=` raises rows | 507 MB / 3.3 M lines |

**Why:** Unbounded input is the dominant constraint. Truncation lives server-side so the raw
bytes / full base64 never reach the browser. The banner ("Showing first N of M …") makes the
boundary honest; the download link is the escape hatch. docx uses cap+strip on images (not
URL-served extraction) because only 2–4% of files are image-heavy — URL-serving would be
over-engineering for the common case (56% have zero images).

## D4 — Two server surfaces: extend `/api/file/render`, add `/api/file/sheet`

**Decision:**
- **docx** extends the existing `GET /api/file/render` (which already renders `.adoc` → HTML).
  It returns `{ html, truncated?, imageCount?, note? }`.
- **xlsx/csv** get a new `GET /api/file/sheet?cwd=&path=&limit=` returning structured JSON
  (`{ sheets[], activeSheet, encoding }`), NOT HTML — the client builds the grid.

**Why:** docx output is sanitized HTML, structurally identical to AsciiDoc, so it belongs on the
same render endpoint (DRY, same sanitize posture). Spreadsheets need structured data (sheet
names, per-sheet dimensions, truncation flags, encoding) that HTML cannot carry cleanly, and the
client grid wants rows/cols, not a pre-baked `<table>`. Both routes reuse the shared
`/api/file/raw` anti-traversal gate helper (not a re-implementation), enforce an extension gate,
and reject oversize files (HTTP 413) via `stat.size` **before** reading into memory.

## D5 — Uniform degradation of the unrenderable tail

**Decision:** Corrupt archive, password-protected, and library-bug failures are caught
server-side and returned as `{ success:false, error }`; the renderer maps that to the existing
`FallbackPreview` (download card). No new failure UI, no worker crash.

**Why:** The ~0.5–1% tail is uniform in outcome (unpreviewable → download). Corpus examples:
`eclipse.docx` (64 MB, invalid zip), 1 password-protected xlsx, 2 SheetJS-bug xlsx. Reusing
`FallbackPreview` keeps failure handling in one place.

## D6 — csv encoding detection

**Decision:** For `.csv`, detect encoding with `chardet`, decode to UTF-8 with `iconv-lite`
before handing bytes to SheetJS, and report the decoded charset in the response
(`encoding: "windows-1250"`), surfaced as a small pill in the banner.

**Why:** 2 of 31 corpus csvs are non-UTF-8 (Hungarian → CP1250); naive UTF-8 read yields
replacement chars. Reporting the charset tells the user why the accented text looks right.

## D7 — Renderer wiring mirrors AsciiDocPreview

**Decision:** `DocxPreview` and `SpreadsheetPreview` are new components under
`packages/client/src/components/preview/`, wired through `PreviewBody` (so inline `PreviewCard`
and `/view` overlay share them) and `bodyClassFor` (size caps). `DocxPreview` mirrors
`AsciiDocPreview` (fetch → loading/error → `dangerouslySetInnerHTML`). `SpreadsheetPreview`
fetches `/api/file/sheet` and renders tabs + grid + banner.

**Why:** The render-file-previews architecture already defines this exact seam; following it
keeps inline/overlay parity and avoids new chrome.

## D8 — docx two-tier render: PDF when engine available, mammoth HTML otherwise

**Decision:** The `.docx` branch of `/api/file/render` returns a discriminated result:

```
mode "pdf"  — PREFERRED, when document-converter is available
            dc.renderPdf(docx) → cached temp PDF (key: path+mtime+size)
            client mounts existing PdfPreview against GET /api/file/rendered-pdf
            pixel-perfect; NO hyperlink-guard, NO image cap (images native)
mode "html" — BASELINE + FALLBACK, always available
            mammoth + hyperlink-guard (D2) + DOMPurify + bounded-preview (D3)
```

**Availability & fallback:** engine availability is probed cheaply (e.g. `docker image inspect
pi-doc-engine` / a guarded no-op) and memoized for a short TTL. `renderPdf` uses the **existing**
facade — its signature is `Markdown|DOCX → PDF`, so **no new engine command** is needed (unlike
pptx). ANY engine failure (`DOCKER_UNAVAILABLE`, non-zero exit, timeout) falls through to
`mode:"html"`; the request never fails because the engine is missing or slow.

**Why:** Honors "when document-converter available, use PDF render" while keeping the feature
dependency-free by default. The PDF path also *dissolves* two mammoth-path problems for free:
the 21% hyperlink crash class and the image-bloat tail (D3) — both are HTML-rendering artifacts
that don't exist when LibreOffice rasterizes the real layout.

**Cost & mitigation:** Docker cold start adds seconds on first view. Mitigated by caching the
rendered PDF (repeat views are instant) and by keeping `mode:"html"` instant when the engine is
absent. **Resolved: fidelity-first** — when the engine is available the endpoint DEFAULTS to
`mode:"pdf"` (accepting first-view latency for pixel-perfect output). A config flag
(`docxRender: "pdf" | "html" | "auto"`, default `"auto"` = fidelity-first) MAY force `mode:"html"`
for latency-sensitive setups; it never changes the fallback behavior.

**Client:** `DocxPreview` branches on `mode` — `pdf` → existing `PdfPreview` (lazy pdfjs) against
`/api/file/rendered-pdf?cwd=&path=`; `html` → `dangerouslySetInnerHTML` + truncation banner.

## Open sub-decisions (small, local — resolve during implementation)

- **Exact caps** (image count, HTML bytes, row/col counts). Start: images > 20 OR html > 2 MB;
  rows 500, cols 100, sheets unlimited-as-tabs. Tune against the corpus.
- **xlsx multi-sheet in v1** vs single-sheet-first. Leaning v1 (tabs are cheap; the data has
  40-sheet workbooks). Revisit if it complicates the grid.
- **csv encoding pill visibility** (always vs only-when-non-UTF-8). Leaning only-when-non-UTF-8
  to reduce noise.
- **Engine-availability probe mechanism + TTL** (`docker image inspect` vs a guarded warm-up
  call). (Fidelity-first default is RESOLVED — D8; the `docxRender` flag defaults to `"auto"`.)
- **PDF cache eviction** (temp-dir TTL / size budget for rendered docx PDFs).
