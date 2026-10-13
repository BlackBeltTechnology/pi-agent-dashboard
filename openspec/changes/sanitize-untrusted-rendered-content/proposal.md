# Sanitize Untrusted Rendered Content

## Why

The client renders untrusted content — LLM/tool output and agent-fetched
documents — as HTML in the dashboard origin. The security-boundary-audit found
three injection sites (VD3 + V4); re-verified against `develop` (`8f170ef96`):

1. **Markdown (VD3):** `packages/client/src/components/preview/MarkdownContent.tsx:627`
   runs `rehypeRaw` (parses embedded raw HTML) with no sanitizer, and `:633`
   sets `urlTransform={(value) => value}`, disabling react-markdown's scheme
   filter. An `<iframe srcdoc="<script>…</script>">` in model output executes in
   the dashboard origin (a `srcdoc` iframe inherits its parent's origin; React
   does not sanitize `srcdoc`). `javascript:` hrefs are currently caught only by
   React 19's own URL guard — a single, implicit layer.
2. **AsciiDoc preview (V4):** `packages/server/src/routes/file-routes.ts:1186`
   converts with `safe:"secure"` and returns the HTML unsanitized;
   `AsciiDocPreview.tsx:74` injects it via `dangerouslySetInnerHTML`.
   `safe:"secure"` blocks includes/docinfo but does **not** strip inline HTML
   passthrough (`+++<img onerror>+++`, `pass:[]`). It is the only document
   renderer without DOMPurify (DOCX, EML, PlantUML SVG are sanitized).
3. **Mermaid:** `MermaidBlock.tsx:80` (`sanitizeMermaidSvg`) strips only
   `<script>` and quoted `on*=` with a regex, missing `<a xlink:href="javascript:…">`
   — contrary to the `mermaid-diagram` spec, which already requires DOMPurify.
   The SVG is injected via `dangerouslySetInnerHTML`, which bypasses React's URL
   guard; the comment at `:75-78` wrongly assumes the input is "not from user
   input" — diagram source is agent-authored markdown.

**Why High:** script in the dashboard origin acts with the operator's
authority. Same-origin browsers no longer hold the paired-device bearer in
`localStorage` — it is an httpOnly `pi_dash_device` cookie
(`packages/client/src/lib/pairing/device-auth.ts:16`) — so the bearer cannot be
exfiltrated, but injected script can still **ride the session**: the cookie is
attached to its `/api/*` requests, and genuine-loopback requests need no auth
at all. One such request, `POST /api/session/spawn`, starts an agent with shell
access — prompt-injected content becomes code execution on the host.

## What Changes

- **Markdown:** add `rehype-sanitize` (exact-pinned) to the plugin chain
  directly **after** `rehypeRaw` and **before** `rehypeKatex`, with a schema
  that replaces selected entries of the GitHub-default schema (no
  `picture`/`source`, active elements stripped with their content,
  `user-content-`-only `id`/`name`, math classes, `data`/`blob`/`pi-asset` on
  image sources only). Replace the identity `urlTransform` with one composed
  over react-markdown's `defaultUrlTransform` that also keeps lower-case
  `pi-asset:`/`blob:`/`data:image/` on `img src` only. A dropped link renders
  without `href` (no reload on click); `PiAssetImg` refuses non-image asset
  mime types and does not open the lightbox for a dropped `src`; an error
  boundary renders the message source as plain text if sanitization throws.
- **AsciiDoc:** sanitize asciidoctor output **server-side** with the shared
  `loadPurify()` (`packages/server/src/lib/purify.ts`), mirroring EML/DOCX,
  with a call-scoped hook that keeps `style` only on table column definitions.
  The client math rewrite becomes DOM-aware (text nodes only), so after the
  server pass only trusted KaTeX markup is added. `loadPurify()` rejects an
  unsupported (pass-through) DOMPurify instance.
- **Mermaid:** replace the regex with client-side DOMPurify (already a client
  dependency) using SVG profiles plus `foreignObject` as an HTML integration
  point, so labels survive and `javascript:` URIs / handlers are dropped; run
  it **after** default-node colorization so sanitization is the last step
  before caching and injection. Lock `themeCSS`/`fontFamily`/`altFontFamily`
  in mermaid's `secure` list so `%%{init}%%` directives cannot inject
  document-wide CSS through the diagram's `<style>`.
- **Out of scope — CSP.** The baseline CSP already shipped via
  `improve-content-editor` (`packages/server/src/auth/csp.ts`) is report-only by
  default and keeps `'unsafe-inline'`/`'unsafe-eval'` in `script-src`. Making it
  enforce and block inline script is a separate follow-up change; this change
  no longer carries a CSP requirement.
- Out of scope (tracked in `security-boundary-audit/tasks.md`): bearer storage
  (B4, largely addressed by `harden-trust-and-credential-boundaries`); the EML,
  DOCX and PlantUML paths (already sanitized — do not regress them).

## Impact

- **Closes:** VD3 markdown XSS, the AsciiDoc XSS (V4), the mermaid SVG vector.
- **Risk:** over-aggressive sanitization could strip legitimate rendered content
  (KaTeX math, `pi-asset:`/`data:` images, `<details>`/`<br>`/`<kbd>` in chat,
  GFM footnotes, mermaid `<foreignObject>` labels, AsciiDoc diagram blocks).
  Each fix pairs an XSS-blocked assertion with a legitimate-content-preserved one.
- **New dependency:** `rehype-sanitize` in `packages/client` (unified ecosystem,
  wraps `hast-util-sanitize`); see design D1 for the alternatives.
- **Affected specs:** new capability `client-untrusted-content-sanitization`
  (markdown, document preview, mermaid sanitization); MODIFIED
  `markdown-rendering` (plugin chain, image schemes, lightbox),
  `chat-math-rendering` (plugin order), `chat-asset-resolver` (`data:` limited
  to `data:image/*`, asset mime gate), `mermaid-diagram` (colorize before
  sanitize), `markdown-preview-view` (dropped schemes are not rewritten). The
  `chat-math-rendering` scenario "Embedded HTML alongside math" changes its
  input to the blank-line form: the compact one-line form never typeset math
  (remark treats the whole line as one HTML block), so the old scenario was
  unsatisfiable before this change too. "Mermaid diagram rendering" is deliberately not modified: the
  in-flight `retro-ux-chat-rendering` owns that delta.
- **Ship order:** after `retro-ux-chat-rendering` (both edit
  `MermaidBlock.tsx`); rebase onto it if it lands first.
- **Affected code:** `packages/client/src/components/preview/MarkdownContent.tsx`,
  new `packages/client/src/components/preview/markdown-sanitize.ts`,
  `packages/client/src/components/primitives/ErrorBoundary.tsx` (optional
  `resetKey`), `packages/client/vitest.node-tests.ts` (test moves to jsdom),
  `packages/client/src/components/preview/MermaidBlock.tsx`,
  `packages/client/src/components/preview/AsciiDocPreview.tsx` (client
  comment), `packages/client/src/lib/preview/adoc-math.ts` (DOM-aware
  rewrite), `packages/client/src/components/preview/mermaid-config.ts`
  (`secure` keys), `packages/server/src/routes/file-routes.ts` (asciidoctor
  render), `packages/server/src/lib/purify.ts` (`isSupported` guard).

## Discipline Skills

- `security-hardening` — LLM05 improper output handling; treat model/document
  output as untrusted; verify each sanitizer against a payload set.
- `doubt-driven-review` — prove legitimate content (math, images, tables,
  footnotes, mermaid labels, AsciiDoc diagrams) still renders after
  sanitization before merge.
- `scenario-design` — build the payload × legit-content matrix as real tests.
