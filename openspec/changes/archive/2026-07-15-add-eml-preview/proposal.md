# Add EML (email) preview to the file content area

## Why

The dashboard's file-preview system (`render-file-previews`, archived) dispatches by
extension to per-format renderers (`markdown`, `pdf`, `html`, `image`, …). `.eml` files —
saved emails (MIME `message/rfc822`) — currently fall through to `FallbackPreview`
("we can't preview this file · Download"). Users who keep `.eml` archives (e.g. a project's
correspondence folder) cannot read an email or open its attachments without leaving the
dashboard and launching a separate mail client.

An `.eml` is a self-contained MIME tree: a `multipart/alternative` body (`text/plain` +
`text/html`) plus zero or more attachment parts (PDF, images, docx, …), the attachments
inlined as base64. Real archives contain files up to ~15 MB where the bulk is inlined
attachment bytes. This shape maps cleanly onto infrastructure that already exists — the
`dispatchPreview` extension map, the sandboxed-iframe HTML posture (`HtmlPreview`), the
lazy `PdfPreview`, and the inline `ImagePreview` — so the feature is mostly a new renderer
plus two server routes, not a new subsystem.

## What Changes

1. **Dispatch gains an `email` kind.** `dispatchPreview` maps `.eml` → `"email"`; the
   `RendererKind` union adds `"email"`. `PreviewCard` gets an email icon + body sizing.

2. **Server parses EML server-side.** A new `GET /api/file/eml?cwd=&path=` route parses the
   file with `mailparser` and sanitizes the HTML body with DOMPurify (server-side via
   `isomorphic-dompurify`), returning
   `{ success, data: { headers, html, text, attachments: [{ index, filename, mimeType, size, contentId, isInline }] } }`
   (metadata only — no attachment bytes). Parsing stays on the server so the ~15 MB base64 is
   never shipped to the browser. The route **calls the shared `/api/file/raw` anti-traversal
   gate** (not a re-implementation), rejects non-`.eml` extensions (case-insensitive) with
   HTTP 400, and **rejects files over a size cap (default 25 MB) with HTTP 413 before reading
   them** into memory. `mailparser` + `isomorphic-dompurify` are new pinned `packages/server`
   deps (DOMPurify carries a keep-current obligation for mXSS CVEs).

3. **Attachments stream on demand, safely.** A new `GET /api/file/eml-attachment?cwd=&path=&index=`
   route streams a single decoded MIME part with the part's `Content-Type`, always
   `Content-Disposition: attachment` (never `inline`) and `X-Content-Type-Options: nosniff`,
   so an attacker-declared `text/html`/SVG part cannot execute in the dashboard origin. It
   validates `index` (0-based integer; NaN/negative → 400; out-of-range → 404) and reuses the
   shared anti-traversal gate. A short-lived parse cache (keyed by path+mtime+size) avoids
   re-parsing the whole `.eml` on every attachment request.

4. **`EmlPreview` renders headers + isolated body + attachment list.** A new renderer
   component (sibling to `HtmlPreview`, wired through `PreviewBody` so inline + `/view` overlay
   share it) shows a collapsed expandable header (from/to/subject/date, rendered as **escaped
   text**, never `dangerouslySetInnerHTML`), and renders the sanitized body inside an
   **`<iframe sandbox="">`** — an *opaque-origin* sandbox (no `allow-scripts`, and deliberately
   NO `allow-same-origin`), which is **stricter than `HtmlPreview`** because `.eml` bodies are
   untrusted sender HTML (see design D2).

5. **Attachments reuse existing renderers by MIME, via blob URLs.** An attachment's `mimeType`
   selects its inline behavior: `application/pdf` → inline `PdfPreview`; `image/*` → inline
   `ImagePreview`; everything else → a download-only row. Inline previews fetch the bytes into
   a `blob:` URL and hand THAT to the renderer — never a top-level navigation to the route.

6. **Remote content blocked by default; browser-fetch only.** The sanitized body neutralizes
   remote resource references (remote `<img src>`, CSS `url()` in `<style>`/inline `style`,
   `background`) so nothing loads on render. `?allowRemote=1` returns the body with remote refs
   preserved; the client re-requests with it when the user activates "Load remote content"
   (current view only). The **browser** fetches remote resources — the **server never fetches
   remote URLs** (no SSRF). `cid:` inline images are attachment-backed, resolved to `blob:` URLs
   by the client, and always shown.

## Non-Goals

- No mailbox / message-list UI. This is a single-email reader in the existing content area,
  not an email client. Threading, folders, search, and compose are out of scope.
- No sending, replying, or forwarding. Read-only.
- No `.msg` (Outlook) or `.mbox` (multi-message) parsing. `.eml` (single `message/rfc822`)
  only; other mail container formats are a separate change.
- No new overlay/route chrome — `EmlPreview` mounts in the existing `PreviewCard` (inline)
  and `/view` overlay shells, per the shared-renderer invariant.
- No editor-pane split-viewer wiring. The editor-pane file tree uses a separate
  `ViewerKind`/`viewer-registry` dispatch; opening `.eml` there keeps its existing
  binary/text fallback (no regression). Wiring EML into the split editor is a later change.

## Coordinates With

This change modifies the shared `Renderer dispatch is purely shape-based` requirement and the
`RENDERER_BY_EXT` map, which three sibling changes also touch. Ordering matters:

- **`render-office-previews`** (adds `"docx" | "spreadsheet"`) modifies the *same* requirement.
  OpenSpec `MODIFIED` replaces the requirement wholesale on archive, so **whichever of the two
  archives second MUST rebase its union block to the superset**
  (`… "docx" | "spreadsheet" | "email" | "fallback"`) or it silently drops the other's kind. Code
  side is additive (no conflict).
- **`auto-canvas`** relocates `RENDERER_BY_EXT` + `dispatchPreview` from
  `packages/client/src/lib/preview-dispatch.ts` → `packages/shared/src/renderer-by-ext.ts` and
  defines `canvasTypes: Record<RendererKind, boolean>`. **Recommended: this change lands BEFORE
  `auto-canvas`**, which then extracts the larger map and enumerates `canvasTypes` over the new
  kinds. If `auto-canvas` lands first, retarget the dispatch tasks to the `packages/shared` path
  and add `email` to `canvasTypes`.
- **`render-pptx-preview`** (adds `"pptx"`) is a later stub in the same union family; same rebase
  rule applies.

## Discipline Skills

- **security-hardening** — parses untrusted email HTML + attachments; sanitization, iframe
  isolation, remote-content blocking, and the anti-traversal gate on both new routes are the
  core of the change.
- **performance-optimization** — ~15 MB inlined-attachment files; the server-parse +
  lazy-attachment-fetch design exists to keep large base64 off the client and the body
  payload small.
