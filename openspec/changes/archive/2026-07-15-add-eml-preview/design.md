# Design — add-eml-preview

## Context

Extends the shipped `file-and-url-preview` capability. The pipeline is:
`ViewTarget` → `dispatchPreview` (pure, extension-based) → `RendererKind` → a per-format
component mounted in either `PreviewCard` (inline) or the `/view` overlay (which reuses
`PreviewBody`). Server helpers `/api/file/raw` (byte streaming, Range, anti-traversal) and
`/api/file/render` (AsciiDoc, `safe:"secure"`) already exist. EML slots in as one more
`RendererKind` + a component + two server routes, reusing `PdfPreview` and `ImagePreview`
(via blob URLs) for attachments.

**Trust-model note (load-bearing).** Unlike `HtmlPreview` — documented for **LOCAL, trusted
`.html` files only** — an `.eml` body is **sender-controlled untrusted HTML**. The posture is
therefore deliberately *stricter* than `HtmlPreview`, not "identical". See D2.

## Decisions

### D1 — Parse server-side with `mailparser`, not client-side

**Decision.** Add `GET /api/file/eml` that parses with `mailparser` (Node) and returns JSON
`{ headers, html, text, attachments[] }`. The client never parses raw `.eml` bytes.

**Deps (named + pinned in `packages/server`).** `mailparser` (`simpleParser`), and a
server-side sanitizer — `isomorphic-dompurify` (bundles `dompurify` + `jsdom`) — pinned with
an explicit keep-current obligation because DOMPurify has recurring mXSS CVEs; the sanitize
step is defense-in-depth and depends on DOMPurify being current. No new client deps.

**Why.** Real `.eml` files reach ~15 MB, dominated by base64-inlined attachments. Client-side
`postal-mime` would ship all bytes to the browser to decode; server-parse ships only the small
sanitized body + attachment metadata, mirrors the `/api/file/render` server-render pattern,
keeps mail deps out of the client bundle, and a server endpoint is required for attachment
streaming regardless. Rejected: `postal-mime` in-browser (bundle + memory cost, still needs a
server route for bytes).

### D2 — Body isolation: OPAQUE-origin sandbox (stricter than HtmlPreview) + server sanitize

**Decision.** Render the body inside `<iframe sandbox="" srcDoc={html}>` — an **empty**
`sandbox` (opaque/null origin), NOT `allow-same-origin`. Server-side sanitize with DOMPurify
before returning. Strip every resource reference that is not a resolved `cid:` (remote AND
same-origin), so the isolated body cannot issue requests to `/api/*` or third parties.

**Why this diverges from the shipped "sandbox EXACTLY allow-same-origin" invariant.** That
invariant was written for `HtmlPreview`'s **trusted local** content, where `allow-same-origin`
is harmless. For untrusted sender HTML, `allow-same-origin` would make the body same-origin
with the authenticated dashboard API — embedded `<img>`/CSS `url()` refs (no script needed)
could probe/GET `/api/*` (the CSP is report-only by default and `default-src 'self'` permits
same-origin subresources). Dropping `allow-same-origin` gives the body an opaque origin: no
same-origin API surface. `cid:` inline images are pre-resolved by the parent to `blob:` URLs
and passed into the srcdoc, so they render without any network origin at all. This is a
deliberate, documented divergence — the delta spec asserts `sandbox=""` for EML, distinct from
`HtmlPreview`'s `allow-same-origin`.

### D3 — Remote content blocked by default; browser-fetch only (no SSRF)

**Decision.** The server-sanitized body neutralizes remote resource references (remote
`<img src>`, CSS `url()` in `<style>` and inline `style`, `background`/`background-image`) so
nothing loads on render. `GET /api/file/eml?...&allowRemote=1` returns the body with remote
refs preserved; the client re-requests with that flag when the user activates "Load remote
content" (current view only, not persisted). The **browser** (inside the sandboxed iframe)
fetches the remote resources — the **server NEVER fetches remote URLs**, so there is no SSRF /
internal-port-scan vector from sender-embedded `http://localhost:...` refs.

**Why.** Remote images are the tracking-pixel / read-receipt vector; blocking by default is the
privacy baseline. Browser-fetch matches every mail reader and keeps the server out of the
resource-fetch business. `cid:` images are attachment-backed (not remote) → always resolved.

### D4 — Attachments dispatch by MIME, blob-backed, lazy-fetched

**Decision.** Each attachment row picks inline behavior from `mimeType`: `application/pdf` →
inline `PdfPreview`; `image/*` → inline `ImagePreview`; else → download-only row. Inline
previews fetch bytes from `GET /api/file/eml-attachment` into a **`blob:` URL** and hand THAT
to the renderer — never a top-level navigation to the route. Bytes are fetched only on expand,
`cid:` resolution, or download.

**Attachment response safety (C-B fix).** `/api/file/eml-attachment` ALWAYS sends
`X-Content-Type-Options: nosniff` and `Content-Disposition: attachment` (never `inline`), and
serves the part's declared MIME type. Because inline previews consume the bytes as a blob (not
by navigating the browser to the URL), an attacker-declared `text/html`/SVG part cannot execute
in the dashboard origin. Download-only rows download with the original filename.

**Why.** Reuses existing renderers + the "dispatch by shape" idea; blob-URL indirection is the
XSS firewall; lazy-fetch keeps the initial payload tiny.

### D5 — Anti-traversal via the SHARED helper; extension + index gates

**Decision.** Both routes CALL the exact `/api/file/raw` anti-traversal helper
(`isAllowed` + `path.resolve(cwd, rel)` against the session-cwd anchors) — they do NOT
re-implement it (avoids the relative-anchor footgun `/api/file/exists` warns about).
`/api/file/eml` lowercases the extension and rejects non-`.eml` with 400 (mirrors `/render`).
`/api/file/eml-attachment` parses `index` as a 0-based integer (NaN/negative → 400) and
validates it against the parsed attachment count (out-of-range → 404).

### D6 — Size cap before read; short-lived parse cache

**Decision.** Before reading a file, `/api/file/eml` checks `Content-Length`/`stat.size`
against a hard cap (default 25 MB); over-cap → HTTP 413, no read. A short-lived in-memory parse
cache keyed by `path + mtime + size` memoizes the `simpleParser` result so
`/api/file/eml-attachment` (and repeated `cid:` resolutions) reuse one parse instead of
re-decoding the full file N+1 times. The cache is a **small LRU (max 8 entries)**, evicted on
mtime change.

**Performance budget.** p95 of parse+sanitize for a 15 MB `.eml` SHALL be < 2000 ms
(measured, automated). This is the threshold the performance scenario asserts.

**Why.** The 15–50 MB regime is a different memory/CPU class than AsciiDoc (KB); an uncapped
read + per-request re-parse on the shared Fastify event loop is an OOM/DoS vector (a single
self-sent large `.eml` could pin the server all sessions share). Cap + cache bound both.

## Risks / Open Questions

- **Header injection.** Header values (from/to/subject/date), after `mailparser`'s RFC 2047
  decode, are sender-controlled and may contain `<`, `"`. They are rendered as **escaped JSX
  text nodes only** — never `dangerouslySetInnerHTML`. Asserted in the spec.
- **`cid:` robustness.** Content-ID match is case-insensitive with angle brackets stripped;
  rewrite→blob happens on the parent before the srcdoc is built; parts referenced by `cid:` but
  lacking a `Content-ID`, and duplicate IDs, degrade to a broken-image placeholder, not a crash.
- **CSS `url(cid:)` in `<style>` blocks.** cid: refs can appear in `<style>` and inline
  `style` (`background-image`, shorthand), not just `src`. The rewrite pass must cover style
  contexts, not only element attributes (scenario-design should enumerate these).
- **Charset / QP / RFC 2047.** Hungarian quoted-printable + non-UTF-8 charsets: `mailparser`
  decodes these; verify against real samples in `~/Documents/Kozmu/NAPELEM/emails/`.
- **Editor-pane split (non-goal).** Opening `.eml` from the editor-pane file tree uses a
  separate `ViewerKind`/`viewer-registry` dispatch; wiring EML there is out of scope for this
  change (documented non-goal) — it falls back to the existing binary/text handling, no regression.
