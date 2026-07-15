# Tasks — add-eml-preview

## Server

- [ ] Add pinned `mailparser` + `isomorphic-dompurify` to `packages/server` deps (note DOMPurify mXSS keep-current obligation)
- [ ] Add `GET /api/file/eml?cwd=&path=&allowRemote=` to `packages/server/src/routes/file-routes.ts`: **call the shared `/api/file/raw` anti-traversal helper** (not a re-impl), `.eml`-only extension gate compared lowercased (else 400), size-cap check on `stat.size` (>25MB → 413 before read), parse with `mailparser`, DOMPurify-sanitize `html`, neutralize non-`cid:` remote+same-origin refs unless `allowRemote=1`, return `{ headers, html, text, attachments[] }` metadata-only
- [ ] Short-lived parse cache keyed by path+mtime+size so eml-attachment reuses one parse
- [ ] Add `GET /api/file/eml-attachment?cwd=&path=&index=`: shared gate helper, parse `index` as 0-based int (NaN/negative → 400; out-of-range → 404), stream decoded part with `Content-Type` + **always `Content-Disposition: attachment`** + `X-Content-Type-Options: nosniff`
- [ ] Body `cid:` rewrite: resolve to attachment parts (case-insensitive Content-ID, strip `<>`), covering `src` AND CSS `url()` in `<style>`/inline `style`; server NEVER fetches remote URLs
- [ ] Classify malformed MIME → HTTP 400 `{ success:false, error }`, never crash the worker

## Client — dispatch

- [ ] Add `".eml": "email"` to `RENDERER_BY_EXT` and `"email"` to `RendererKind` in `packages/client/src/lib/preview-dispatch.ts`
- [ ] Add `email` case to `PreviewCard.tsx` `iconFor` (email icon), `bodyClassFor`, AND `PreviewBody` switch (so inline + `/view` overlay both render — not the FallbackPreview default)

## Client — EmlPreview

- [ ] New `packages/client/src/components/preview/EmlPreview.tsx`: fetch `/api/file/eml`, loading + error states, collapsed→expandable header block (values rendered as **escaped text**, never `dangerouslySetInnerHTML`), body in **`<iframe sandbox="" srcDoc>`** (opaque origin, no `allow-same-origin`)
- [ ] Attachment list: dispatch by `mimeType` → inline `PdfPreview` / inline `ImagePreview` (via **`blob:` URLs**, never top-level nav) / download-only row; lazy-fetch bytes on expand/download
- [ ] `cid:` inline images resolved to `blob:` URLs on the client before building srcDoc
- [ ] "Load remote content" banner → re-request with `?allowRemote=1`; blocked-remote-image placeholder wiring

## Docs

- [ ] Add `EmlPreview.tsx` row to `packages/client/src/components/preview/AGENTS.md`
- [ ] Update `file-and-url-preview` spec pointer if needed

## Tests

Manifest: `test-plan.md` (32 automated · 1 manual-only). Each task = one automated scenario;
exemplar pointer + Triple + `(test-plan #<id>)` inline.

### L1 unit — dispatch (extend `packages/client/src/lib/__tests__/preview-dispatch.test.ts`)

- [ ] `.eml` file target → `dispatchPreview` returns `"email"` (test-plan #1)
- [ ] `.EML` upper-case → `"email"` (ext lowercased) (test-plan #2)
- [ ] URL target ending `.eml` → `PreviewBody` guards `kind!=="file"` → `FallbackPreview`, no crash (test-plan #3)
- [ ] `.dat` → `"fallback"` regression guard (test-plan #4)

### L1 unit — server routes (extend `packages/server/src/__tests__/file-raw-render-endpoints.test.ts`)

- [ ] valid multipart .eml → `{headers,html,text,attachments[]}`, no base64 in `data` (test-plan #5)
- [ ] body `<script>`+`onclick` → sanitized out of returned `html` (test-plan #6)
- [ ] ext `.pdf` → HTTP 400 `renderer not supported for extension` (test-plan #7)
- [ ] size = 25 MB−1 → parses OK 200 (BVA just-below cap) (test-plan #8)
- [ ] size > 25 MB → HTTP 413, full file NOT read into memory (BVA above cap) (test-plan #9)
- [ ] unknown `cwd` → HTTP 403 (test-plan #10)
- [ ] `path=../../../etc/passwd` → HTTP 403 via shared gate helper (test-plan #11)
- [ ] corrupt/truncated MIME → HTTP 400 `{success:false}`, no process crash (test-plan #12)
- [ ] eml-attachment PDF index 0 → `application/pdf` + `Content-Disposition: attachment` + `nosniff` + decoded bytes (test-plan #13)
- [ ] eml-attachment `text/html` part → `attachment` + `nosniff` (not rendered as document) (test-plan #14)
- [ ] eml-attachment `index=abc`/`-1` → HTTP 400 (test-plan #15)
- [ ] eml-attachment `index=5` of 2 → HTTP 404 (test-plan #16)
- [ ] body remote/localhost `<img>` + `allowRemote=1` → server makes NO outbound request (no SSRF) (test-plan #17)
- [ ] 15 MB .eml → parse+sanitize p95 < 2000 ms (timed) (test-plan #18)
- [ ] 3-attachment .eml, metadata + 2 attachment fetches → `simpleParser` called once (cache hit) (test-plan #19)
- [ ] cached parse + mtime change → cache invalidated, re-parse (LRU max 8) (test-plan #20)

### L1 — bundle assertion (extend the existing pdfjs lazy-chunk build test)

- [ ] main entry chunk excludes `mailparser` + `isomorphic-dompurify` (test-plan #21)

### L3 e2e — new `tests/e2e/eml-preview.spec.ts` (harness glue: see `tests/e2e/editor-pane.spec.ts`; security asserts: see `tests/e2e/csp.spec.ts`; docker port from `.pi-test-harness.json`)

- [ ] body iframe `sandbox` attribute is exactly `""` (no `allow-same-origin`), no body script executes (test-plan #22)
- [ ] Subject `<img onerror=alert(1)>` → shown as literal escaped text, no element/alert (test-plan #23)
- [ ] collapsed header → click meta line → full from/to/date/subject revealed (test-plan #24)
- [ ] inline card .eml → ⤢ expand → `/view` overlay mounts SAME `EmlPreview` same target (test-plan #25)
- [ ] PDF attachment expand → `PdfPreview` inline via `blob:` URL, no top-level nav (test-plan #26)
- [ ] `image/jpeg` attachment expand → `ImagePreview` inline (test-plan #27)
- [ ] `.docx` attachment → download-only row, no expand affordance (test-plan #28)
- [ ] 4 MB PDF attachment → zero `/api/file/eml-attachment` requests until expand/download (test-plan #29)
- [ ] remote `<img>` → no request to tracker on render, blocked placeholder (test-plan #30)
- [ ] "Load remote content" → client re-requests `?allowRemote=1`, remote loads (test-plan #31)
- [ ] `cid:` ref in `src` AND `<style>` `url()` → resolved to `blob:` URLs, shown by default (test-plan #32)

## Validate

- [ ] `openspec validate add-eml-preview` passes
- [ ] `npm run build` — pdfjs stays lazy; main bundle excludes mailparser + isomorphic-dompurify
- [ ] Manual: preview a real `.eml` from `~/Documents/Kozmu/NAPELEM/emails/` (Hungarian quoted-printable, RFC2047 subject, PDF attachments) — charset/render visual check (test-plan #33, test-plan: manual-only)
