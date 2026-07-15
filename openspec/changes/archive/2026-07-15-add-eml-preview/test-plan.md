# Test Plan — add-eml-preview

Standalone scenario catalog. `disposition` is the manifest source-of-truth for the
plan-proposal fold and the ship-change defer rule. Levels: L1 = vitest unit
(`packages/*/src/**/__tests__/*.test.ts`), L2 = qa smoke, L3 = Playwright e2e
(`tests/e2e/*.spec.ts`, docker harness port from `.pi-test-harness.json`).

No open clarification gaps — perf budget (p95 < 2000 ms / 15 MB) and cache bound
(LRU max 8, evict on mtime) resolved.

| # | class | technique | level | disposition | Triple (input · trigger · observable) |
|---|---|---|---|---|---|
| 1 | edge-case | EP | L1 | automated | `.eml` file target · `dispatchPreview` · returns `"email"` |
| 2 | edge-case | EP | L1 | automated | `.EML` (upper) file target · `dispatchPreview` · returns `"email"` (ext lowercased) |
| 3 | edge-case | state | L1 | automated | URL target ending `.eml` · `dispatchPreview` then `PreviewBody` · `PreviewBody` guards `kind!=="file"` → `FallbackPreview` (no crash) |
| 4 | edge-case | EP | L1 | automated | `.dat` file target · `dispatchPreview` · returns `"fallback"` (regression guard) |
| 5 | happy | — | L1 | automated | `multipart/mixed` .eml w/ HTML body + 1 PDF · `GET /api/file/eml` · `{headers,html,text,attachments:[{mimeType:"application/pdf",…}]}`, no base64 in `data` |
| 6 | error-handling | — | L1 | automated | .eml body has `<script>` + `onclick` · parse endpoint · returned `html` has neither |
| 7 | edge-case | EP | L1 | automated | path ext `.pdf` · `GET /api/file/eml` · HTTP 400 `renderer not supported for extension` |
| 8 | edge-case | BVA | L1 | automated | file size = cap−1 (25 MB−1) · parse endpoint · parses OK (200) |
| 9 | edge-case | BVA | L1 | automated | file size = cap+1 (>25 MB) · parse endpoint · HTTP 413, full file NOT read into memory |
| 10 | error-handling | — | L1 | automated | `cwd` not a known session · parse endpoint · HTTP 403 |
| 11 | error-handling | fault | L1 | automated | `path=../../../etc/passwd` under known cwd · parse endpoint · HTTP 403 (shared gate helper) |
| 12 | error-handling | fault | L1 | automated | corrupt/truncated MIME bytes · parse endpoint · HTTP 400 `{success:false}`, process does NOT crash |
| 13 | edge-case | — | L1 | automated | PDF attachment index 0 · `GET /api/file/eml-attachment?index=0` · `Content-Type: application/pdf` + `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff` + decoded bytes |
| 14 | error-handling | decision | L1 | automated | attachment declared `text/html` · eml-attachment · `Content-Disposition: attachment` + `nosniff` (does not render as document) |
| 15 | edge-case | BVA | L1 | automated | `index=abc` or `index=-1` · eml-attachment · HTTP 400 |
| 16 | edge-case | BVA | L1 | automated | `index=5` when 2 attachments · eml-attachment · HTTP 404 |
| 17 | security | fault | L1 | automated | body `<img src="http://localhost:8000/api/…">`, `allowRemote=1` · parse endpoint · server makes NO outbound request to that URL (no SSRF) |
| 18 | perf | tail-latency | L1 | automated | 15 MB .eml · parse+sanitize · p95 < 2000 ms (timed) |
| 19 | perf | — | L1 | automated | .eml w/ 3 attachments, request metadata then 2 attachments · `simpleParser` invoked once (cache hit), not 3× |
| 20 | edge-case | state | L1 | automated | cached parse, file mtime changes · next request · cache invalidated, re-parse occurs |
| 21 | edge-case | — | L1 | automated | build output · `npm run build` · main entry chunk excludes `mailparser` + `isomorphic-dompurify` |
| 22 | frontend-quirk | — | L3 | automated | rendered EML body · mount · body iframe `sandbox` attribute is exactly `""` (no `allow-same-origin`), no body script executes |
| 23 | security | — | L3 | automated | Subject header `<img src=x onerror=alert(1)>` · header render · shown as literal escaped text, no element/alert |
| 24 | frontend-quirk | state | L3 | automated | collapsed header · click meta line · full from/to/date/subject revealed |
| 25 | frontend-quirk | — | L3 | automated | inline `PreviewCard` .eml → click ⤢ expand · `/view` overlay mounts SAME `EmlPreview` w/ same target |
| 26 | happy | — | L3 | automated | PDF attachment row · expand · `PdfPreview` renders inline sourced from a `blob:` URL (no top-level nav) |
| 27 | happy | — | L3 | automated | `image/jpeg` attachment row · expand · `ImagePreview` renders inline |
| 28 | edge-case | decision | L3 | automated | `.docx` attachment · render · download-only row, no expand affordance |
| 29 | frontend-quirk | — | L3 | automated | 4 MB PDF attachment · first render (nothing expanded) · zero requests to `/api/file/eml-attachment` until expand/download |
| 30 | security | — | L3 | automated | body `<img src="https://tracker.example/pixel.gif">` · render · no network request to tracker.example, blocked placeholder shown |
| 31 | frontend-quirk | state | L3 | automated | blocked-remote banner · activate "Load remote content" · client re-requests `?allowRemote=1`, remote resources load |
| 32 | edge-case | — | L3 | automated | `cid:logo@x` ref in body `src` AND in `<style>` `url()` · render · resolved to `blob:` URLs (case-insensitive ID, `<>` stripped), shown by default |
| 33 | manual | — | — | manual-only | real Hungarian .eml from `~/Documents/Kozmu/NAPELEM/emails/` (quoted-printable, RFC2047 subject, PDF attachments) · open in dashboard · headers/body/attachments render correctly (charset visual check) |

## New infra needed

None. L1 extends `packages/server/src/__tests__/file-raw-render-endpoints.test.ts` +
`packages/client/src/lib/__tests__/preview-dispatch.test.ts`; L3 adds a new
`tests/e2e/eml-preview.spec.ts` against the docker harness.

## Summary

32 automated (21 L1 · 11 L3) · 1 manual-only.
