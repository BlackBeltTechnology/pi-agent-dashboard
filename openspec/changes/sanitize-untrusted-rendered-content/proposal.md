# Sanitize Untrusted Rendered Content

## Why

The client renders untrusted content — LLM/tool output and agent-fetched
documents — as HTML in the dashboard origin. The security-boundary-audit verified
three injection sites (VD3 + V4):

1. **Markdown (VD3, confirmed):** `MarkdownContent.tsx` uses `rehypeRaw` (parses
   embedded raw HTML) **and** `urlTransform={(value) => value}` (line 421), which
   explicitly disables react-markdown's built-in scheme sanitizer. A
   `javascript:` link or an `<iframe srcdoc="<script>…</script>">` in model output
   executes in the dashboard origin.
2. **AsciiDoc preview (V4, confirmed):** `AsciiDocPreview` injects asciidoctor
   output via `dangerouslySetInnerHTML` with no DOMPurify. `safe:"secure"` blocks
   includes/docinfo but does **not** strip inline HTML passthrough
   (`+++<img onerror>+++`, `pass:[]`). It is the only document renderer missing
   DOMPurify (DOCX and EML are correctly sanitized).
3. **Mermaid (confirmed partial):** `MermaidBlock` injects rendered SVG after a
   hand-rolled **regex** sanitizer that strips only `<script>`/`on*=` and misses
   `<a xlink:href="javascript:…">`; it relies on mermaid's internal strict mode as
   the real defense.

**Why these are High, not Medium:** the paired-device REST bearer lives in
`localStorage` (`device-auth.ts:24`) and is auto-attached to every `/api/*`
request. Any of the three XSS sites reads that bearer and replays it → full
control-plane takeover. Closing the injection sites is the highest-leverage
mitigation; hardening the bearer storage is tracked separately (audit task B4).

## What Changes

- **Markdown:** add `rehype-sanitize` to the plugin chain **after** `rehypeRaw`,
  with a schema that preserves what the app legitimately needs (KaTeX output,
  `pi-asset:`/`data:image` image sources). Replace the identity `urlTransform`
  with one that **allowlists** `http`/`https`/`mailto`/`pi-asset`/`data:image`
  and drops `javascript:` and `data:text/html`.
- **AsciiDoc:** run the asciidoctor HTML through `isomorphic-dompurify`
  **server-side** before returning it (mirror the DOCX `renderDocx` path), or
  disable passthrough substitutions.
- **Mermaid:** replace the regex sanitizer with DOMPurify configured for SVG
  (`USE_PROFILES: { svg: true, svgFilters: true }`) so `<foreignObject>` is
  preserved while `xlink:href=javascript:` and event handlers are dropped.
- **CSP:** add a Content-Security-Policy (`script-src 'self'`, no
  `unsafe-inline`) as defense-in-depth for the cross-origin / tunnel case, so a
  missed vector cannot exfiltrate via inline script.

Out of scope (tracked in `security-boundary-audit/tasks.md`): moving the REST
bearer out of `localStorage` (B4); the EML/DOCX paths (already sanitized — do not
regress them).

## Impact

- **Closes:** VD3 markdown XSS, the AsciiDoc XSS (V4), the mermaid SVG vector.
- **Risk:** over-aggressive sanitization could strip legitimate rendered content
  (KaTeX math, `pi-asset:`/`data:` images, mermaid `<foreignObject>` labels,
  GFM tables). Each fix must pair an XSS-blocked assertion with a
  legitimate-content-preserved assertion. This is why `doubt-driven-review` +
  `scenario-design` gate the change.
- **Affected specs:** new capability `client-untrusted-content-sanitization`.
- **Affected code:** `packages/client/src/components/MarkdownContent.tsx`,
  `.../preview/AsciiDocPreview.tsx` + `packages/server/src/routes/file-routes.ts`
  (asciidoctor render), `.../components/MermaidBlock.tsx`, and the server response
  headers (CSP).

## Discipline Skills

- `security-hardening` — LLM05 improper output handling; treat model/document
  output as untrusted; verify each sanitizer against a payload set.
- `doubt-driven-review` — prove legitimate content (math, images, tables, mermaid
  labels) still renders after sanitization before merge.
- `scenario-design` — build the payload/legit matrix (javascript: link, iframe
  srcdoc, asciidoc passthrough, mermaid xlink:href vs KaTeX, pi-asset image, GFM
  table) as real tests.
