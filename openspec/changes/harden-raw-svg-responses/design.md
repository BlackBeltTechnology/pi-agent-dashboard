# Design

## Context

See proposal.md (Why). Facts that shape the approach:

- `/api/file/raw` sets `Content-Type` via `extToContentType` (`packages/server/src/lib/mime-types.ts:8-29`). `.svg` maps to `image/svg+xml` and `.html`/`.htm` to `text/html; charset=utf-8`. Nothing else in that table is a type a browser executes, and unknown extensions fall back to `application/octet-stream`. Every response is `Content-Disposition: inline` (`packages/server/src/routes/file-routes.ts:1233-1236`).
- The route admits a path in three ways: layers ①/② (cwd and git root), layer ③ (an image-only artifact root, where `IMAGE_EXTS` includes `svg`, `packages/server/src/lib/artifact-roots.ts:29`), and the grant layer (`evaluateContainment`, `viaGrant`). It returns 200, 206 (Range) or a body-less 416.
- The global CSP hook (`registerCsp`, `packages/server/src/auth/csp.ts:61-71`) runs on `onSend` and adds its header only when `reply.getHeader(header)` is unset. The default mode is `report` (`resolveCspMode`, `csp.ts:55-58`).
- Precedent: `packages/server/src/routes/attachment-routes.ts:75-76` serves untrusted bytes with `nosniff` + `default-src 'none'; sandbox`. `/api/file/eml-attachment` uses `attachment` + `nosniff` (`file-routes.ts` near `:1692`).
- Client consumers of `/api/file/raw`:
  - Image context: `ImagePreview`, `ImageLightbox` (fetched to a `blob:`), and markdown images via `resolve-local-image-src`.
  - `fetch` readers (response CSP and `nosniff` do not gate these): `HtmlPreview` (into a sandboxed `srcdoc`), `MermaidViewer`, `file-handler-host`, Monaco, `EmlPreview`.
  - `download` links: `FallbackPreview`, `TruncationBanner`.
  - Non-active media: `PdfPreview`, audio and video.
  - The one surface that navigates a tab to the raw URL is `TooLargePreview` "Open raw" (`packages/client/src/components/editor-pane/TooLargePreview.tsx:36,56`, `target="_blank"`). An over-cap `.svg`/`.html` opened there now renders sandboxed, which is the intended behaviour.
  - The MCP `getfile_raw` tool (`packages/mcp-server-plugin/src/server/tools.manifest.ts:140`) transports bytes and is unaffected.

## Goals / Non-Goals

**Goals:**
- A directly opened `.svg`/`.html`/`.htm` raw response cannot execute script with, or act as, the dashboard origin, whatever the dashboard CSP mode and however the path was admitted.
- Keep every existing in-app preview working, with no client change.

**Non-Goals:**
- Sanitizing file bytes (the response stays byte-exact; Range semantics unchanged).
- Hardening other routes that emit workspace bytes (`/api/file`, `/api/file/render`, plugin routes). These are JSON or already sanitized/sandboxed.
- Adding `nosniff` to non-active raw types (out of scope by decision. Only the sandbox CSP is forbidden on them, so a later change can add `nosniff` broadly).
- Content sniffing to catch an SVG/HTML payload behind another extension.

## Decisions

### D1: Per-response enforced CSP `sandbox`, not `Content-Disposition: attachment`

The policy is `sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-ancestors 'self'` plus `X-Content-Type-Options: nosniff`.
- `sandbox` (no tokens) gives the document an opaque origin and disables script, forms, popups and plugins. That alone removes access to the dashboard origin (cookies, storage, same-origin API calls).
- `frame-ancestors 'self'` (matching the baseline) stops a third-party page from framing a raw SVG/HTML on the dashboard URL.
- `default-src 'none'` stops a directly opened file from beaconing out (`<image href="https://…">`, CSS `url()`).
- `style-src 'unsafe-inline'`, `img-src data:` and `font-src data:; frame-ancestors 'self'` keep self-contained SVG/HTML rendering when opened directly.
- The policy goes out as the enforced `Content-Security-Policy` in every dashboard CSP mode, because the dashboard's default is report-only.
- Alternative `Content-Disposition: attachment` was rejected. It also neutralizes, but it turns "Open raw" and "open image in new tab" into downloads. Fallback trigger: if a browser the dashboard supports runs script from a sandboxed raw SVG/HTML, switch these types to `attachment`. Chromium/Electron is checked by Playwright, which runs Chromium only (`playwright.config.ts:67-71`). Firefox and Safari are checked manually.
- Alternative "attachment-routes policy verbatim (`default-src 'none'; sandbox`)" was rejected. It blocks inline styles, which breaks the appearance of directly opened SVGs, and script is already off under `sandbox`.

### D2: Key on the served media type, set in the raw route right after the content headers

Add a module-level `SCRIPTABLE_MEDIA_TYPES = new Set(["text/html", "image/svg+xml", "application/xhtml+xml", "application/xml", "text/xml"])` and the policy constant in `file-routes.ts`. In the raw handler, right after the `Content-Type`/`Content-Disposition` block (`:1233-1236`), set both headers when the media type of `contentType` is in the set. The media type is the value before any `;`, trimmed and lowercased.
- Keying on the computed `Content-Type`, not on an extension list, means the policy cannot disagree with what the browser receives. A future `mime-types.ts` entry that maps to a scriptable type is covered automatically, with no pin test against the private `TABLE`. A symlink named `x.txt` that points at an `.html` is served as `text/plain`. Supported browsers do not execute that, and this relies on their not sniffing `text/plain`, since `nosniff` on non-active types is a non-goal.
- The classifier is an exported pure helper (`isScriptableMediaType`), so the XML types the MIME table cannot emit today are still unit-tested.
- The headers are set before Range parsing, so 200, 206 and the body-less 416 all carry them (harmless on 416). All three admission paths share the code. The code does not depend on `registerCsp`, so `off` mode keeps the protection.
- Alternative: an extension set (`.svg`/`.html`/`.htm`). Rejected because it needs a separate invariant test to stay in sync with the MIME table.
- Alternative: a global Fastify `onSend` hook keyed on `Content-Type`. Rejected: a second, non-local place to reason about, and it would also catch unrelated routes.

### D3: Coexistence with the baseline CSP hook

The baseline hook skips a header that is already set (Fastify header names are case-insensitive), so in `enforce` mode the per-response policy wins. This is the same contract as the `serveApp` mount (D7 of `add-plugin-capability-routes`). In `report` mode the response carries the enforced sandbox policy plus the baseline `-Report-Only`, and browsers evaluate each one independently. `off` mode registers no hook, and the route's headers stand. No change to `csp.ts`.

The `baseline-content-security-policy` spec said report mode emits no `Content-Security-Policy` and that every emitted CSP carries the baseline directives. That text is already at odds with the `serveApp` precedent. The spec delta scopes those clauses to the baseline header and states that route-level per-response policies are independent of the mode. An L1 test asserts all three modes.

## Risks / Trade-offs

- [CSP on image-context loads] A browser might apply the response CSP to an SVG loaded through `<img>`. → SVG-as-image already runs without script or external fetches, and inline `<style>` and `data:` stay allowed. An L3 check renders an SVG with inline `<style>` through the image preview with the headers present.
- [A directly opened file loses non-self-contained parts] HTML loses scripts and external assets. SVG loses sibling refs (`<image href="./x.png">`, external CSS) because of `default-src 'none'`. → Intended. In-app previews are unaffected, and the "Open raw" tab shows a static rendering.
- [Residual navigation] A sandboxed document can still redirect its own tab (`<meta http-equiv="refresh">`). → It gains no dashboard-origin access, so the outcome equals the user following a link. Accepted.
- [Report-mode noise] In the default `report` mode, the baseline `-Report-Only` policy may log violations on directly opened SVG/HTML. → Harmless, because report-only never blocks.
- [Other executable types] `.xml`/`.xhtml` are not in the raw MIME table today, so they are served as `application/octet-stream` (downloaded). → If one is added with an XML/XHTML type, the D2 media-type keying sandboxes it automatically.
- [Browser coverage] Automated e2e runs on Chromium only. → A manual Firefox + Safari direct-open check is recorded before ship (test-plan manual-only row). A failure triggers the D1 `attachment` fallback.
