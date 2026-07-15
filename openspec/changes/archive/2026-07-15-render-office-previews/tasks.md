# Tasks — render-office-previews

## Server — deps

- [x] Add pinned `mammoth`, `xlsx` (SheetJS), `isomorphic-dompurify`, `chardet`, `iconv-lite` to `packages/server` deps (note DOMPurify mXSS keep-current obligation; share `isomorphic-dompurify` with add-eml-preview if both land)
- [x] Wire `@blackbelt-technology/pi-dashboard-document-converter` as a `packages/server` dep for the docx→PDF enhancement (used only when available; not a hard runtime dep)

## Server — docx on /api/file/render (two-tier, design D8)

- [x] Extend `GET /api/file/render` in `packages/server/src/routes/file-routes.ts` with a `.docx` branch: shared `/api/file/raw` anti-traversal gate (not a re-impl), extension gate (`.docx`/`.adoc`/`.asciidoc` only, else 400), `stat.size` cap check (>cap → 413 before read)
- [x] Cheap engine-availability probe (e.g. `docker image inspect pi-doc-engine`) memoized with a short TTL; result gates the mode branch (design D8)
- [x] `docxRender` config (`"pdf"|"html"|"auto"`, default `"auto"` = fidelity-first: prefer PDF when engine available); `"html"` skips the engine for latency-sensitive setups (design D8, resolved)
- [x] `mode:"pdf"` path: `dc.renderPdf(docx)` → cache PDF in a server temp dir keyed by path+mtime+size; return `{ mode:"pdf" }`. On ANY engine error (`DOCKER_UNAVAILABLE`/exit/timeout) fall through to `mode:"html"` — never fail the request
- [x] Add `GET /api/file/rendered-pdf?cwd=&path=`: shared gate, returns the cached (or freshly-rendered) docx→PDF bytes with `application/pdf`; regenerates on cache miss/stale
- [x] `mode:"html"` path: `mammoth.convertToHtml` with the mandatory `transformDocument` hyperlink-guard (null href AND null anchor → `href=""`) — fixes the 21% crash class (design D2)
- [x] DOMPurify-sanitize the HTML server-side; strip `<script>` + event-handler attrs
- [x] Bounded-preview (html mode only): if imageCount > cap OR html bytes > cap, strip images to placeholders; return `{ mode:"html", html, truncated, imageCount, note }` (design D3)
- [x] Catch corrupt/password/library-bug failures → `{ success:false, error }`, never crash the worker (design D5)

## Server — spreadsheet route

- [x] Add `GET /api/file/sheet?cwd=&path=&limit=`: shared gate, `.xlsx`/`.csv`-only extension gate (else 400), `stat.size` cap (>cap → 413 before read)
- [x] `.xlsx`: SheetJS parse → `{ sheets:[{name,header,rows,totalRows,totalCols,truncated}], activeSheet }`; bound rows (default 500, `limit`-overridable to a max) + cols per policy
- [x] `.csv`: detect encoding (`chardet`) → decode to UTF-8 (`iconv-lite`) → SheetJS parse; report `encoding` (design D6)
- [x] Catch password-protected / corrupt → `{ success:false, error }`, no worker crash

## Client — dispatch

- [x] Add `".docx":"docx"` and `".xlsx":"spreadsheet"`, `".csv":"spreadsheet"` to `RENDERER_BY_EXT`, and `"docx"` + `"spreadsheet"` to `RendererKind` in `packages/client/src/lib/preview-dispatch.ts`
- [x] Add `docx` + `spreadsheet` cases to `PreviewCard.tsx` `iconFor` (doc / spreadsheet icons), `bodyClassFor` (docx `max-h-[60vh] overflow-auto`; spreadsheet `max-h-[60vh] overflow-auto`), AND `PreviewBody` switch

## Client — DocxPreview

- [x] New `packages/client/src/components/preview/DocxPreview.tsx`: fetch `/api/file/render`, loading + error states, branch on `data.mode`
- [x] `mode:"pdf"` → mount existing `PdfPreview` (lazy pdfjs) against `/api/file/rendered-pdf?cwd=&path=`
- [x] `mode:"html"` → render sanitized `data.html` via `dangerouslySetInnerHTML` (mirror `AsciiDocPreview`) + shared truncation banner when `data.truncated` ("Images trimmed …" + download original)

## Client — SpreadsheetPreview

- [x] New `packages/client/src/components/preview/SpreadsheetPreview.tsx`: fetch `/api/file/sheet`, loading + error states, frozen-header row/col grid
- [x] Sheet tabs for multi-sheet workbooks; active-sheet switching (client-only within loaded data)
- [x] Shared truncation banner ("Showing first N of M rows · sheet i of k" + charset pill for `.csv` + download)
- [x] Any `{success:false}` → render existing `FallbackPreview`

## Client — shared

- [x] Extract the truncation banner as a small shared component reused by both renderers (DRY)

## Docs

- [x] Add `DocxPreview.tsx`, `SpreadsheetPreview.tsx` (+ banner component) rows to `packages/client/src/components/preview/AGENTS.md`
- [x] Add docx/xlsx/csv entry to `docs/faq.md` "How to preview …" (delegate per Rule 6 caveman style)
- [x] Update `RENDERER_BY_EXT` row in the dispatch file's AGENTS record

## Tests

Manifest: `test-plan.md`. Each task below = one automated scenario; exemplar pointer + Triple + `(test-plan #<id>)` inline.

### L1 unit — dispatch (extend `packages/client/src/lib/__tests__/preview-dispatch.test.ts`)

- [x] `.docx` file → `"docx"` (test-plan #1)
- [x] `.DOCX` upper-case → `"docx"` (ext lowercased) (test-plan #2)
- [x] `.xlsx` → `"spreadsheet"` (test-plan #3)
- [x] `.csv` → `"spreadsheet"` (test-plan #4)
- [x] `.dat` → `"fallback"` regression guard (test-plan #5)
- [x] URL target ending `.docx` → `PreviewBody` guards `kind!=="file"` → `FallbackPreview`, no crash (test-plan #6)

### L1 unit — docx render route (extend `packages/server/src/__tests__/file-raw-render-endpoints.test.ts`)

- [x] engine available → `mode:"pdf"`; `/api/file/rendered-pdf` streams `application/pdf` (test-plan #7)
- [x] engine unavailable → `mode:"html"`, valid docx (heading + table) → `data.html` has markup, no `<script>`/handlers (test-plan #8)
- [x] engine call throws `DOCKER_UNAVAILABLE` mid-request → falls through to `mode:"html"`, request succeeds (test-plan #9)
- [x] null-href-hyperlink docx (html mode) → `success:true` (guard applied, no crash) (test-plan #10)
- [x] image-heavy docx over cap (html mode) → `truncated:true`, images stripped, html < byte cap (test-plan #11)
- [x] corrupt/non-zip docx → `{success:false}`, no crash (test-plan #12)
- [x] ext `.pdf` on render → HTTP 400 (test-plan #13)
- [x] size = cap−1 → 200 (BVA below), size > cap → 413 not read (BVA above) (test-plan #14)
- [x] `path=../../../etc/passwd` → 403 via shared gate on render AND rendered-pdf (test-plan #15)

### L1 unit — spreadsheet route

- [x] multi-sheet xlsx → `sheets[]` per sheet, `activeSheet` = first (test-plan #14)
- [x] sheet over row cap → `rows.length==cap`, `truncated:true`, `totalRows` true count (BVA) (test-plan #15)
- [x] windows-1250 csv → accented chars decode, `encoding:"windows-1250"` (test-plan #16)
- [x] password-protected xlsx → `{success:false}`, no crash (test-plan #17)
- [x] ext `.txt` → HTTP 400 (test-plan #18)
- [x] oversize → 413 before read (test-plan #19)

### L2 component — renderers

- [x] `DocxPreview` `mode:"pdf"` → mounts `PdfPreview` against `/api/file/rendered-pdf` (test-plan #20)
- [x] `DocxPreview` `mode:"html"` → renders `data.html`; shows banner when `truncated` (test-plan #21)
- [x] `SpreadsheetPreview` renders grid + tabs; switches active sheet within loaded data (test-plan #22)
- [x] `{success:false}` → `FallbackPreview` shown (both renderers) (test-plan #23)

### Manual

- [x] Real-corpus spot check: a former-crash docx renders as PDF with engine up AND as guarded HTML with engine down; a 40-sheet xlsx, a CP1250 csv render correctly inline + expanded (test-plan #24, manual-only)
