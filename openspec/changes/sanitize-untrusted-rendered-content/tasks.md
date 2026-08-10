# Tasks

## 1. Markdown sanitization

- [ ] 1.1 Add `rehype-sanitize` after `rehypeRaw` in `MarkdownContent.tsx` with a custom schema that keeps KaTeX classes/attributes and `pi-asset:`/`data:image` img sources.
- [ ] 1.2 Replace `urlTransform={(value)=>value}` with a scheme-allowlist transform (`http`/`https`/`mailto`/`pi-asset`/`data:image/*`; drop `javascript:`, `data:text/html`).
- [ ] 1.3 Verify KaTeX, GFM tables, code blocks, and `pi-asset:` images still render.

## 2. AsciiDoc sanitization

- [ ] 2.1 In `file-routes.ts` asciidoctor render path, run output through `isomorphic-dompurify` server-side (mirror the DOCX `renderDocx` sanitize) before returning.
- [ ] 2.2 Confirm `AsciiDocPreview.tsx` injects only the sanitized HTML; update the misleading "safe because server guarantees sanitization" comment.

## 3. Mermaid sanitization

- [ ] 3.1 Replace `sanitizeMermaidSvg` regex in `MermaidBlock.tsx` with DOMPurify (`USE_PROFILES:{svg:true,svgFilters:true}`).
- [ ] 3.2 Confirm `<foreignObject>` labels still render and `xlink:href=javascript:` is dropped.

## 4. CSP

- [ ] 4.1 Send a `Content-Security-Policy` header (`script-src 'self'`; allow styles/images/`connect-src` for WS) on the dashboard document response.
- [ ] 4.2 Load the app under the CSP and confirm no legitimate asset/WebSocket is blocked (browser console clean).

## Tests

- [ ] T1 Markdown: `[x](javascript:…)` → no `javascript:` href; `<iframe srcdoc=<script>>` → no in-origin execution.
- [ ] T2 Markdown legit: KaTeX block + GFM table + `pi-asset:` image all render.
- [ ] T3 AsciiDoc: `+++<img onerror=…>+++` stripped; headings/lists/table preserved.
- [ ] T4 Mermaid: `<a xlink:href=javascript:>` dropped; `<foreignObject>` label preserved.
- [ ] T5 CSP header present; inline `<script>` blocked; bundled assets + WS load.
- [ ] T6 Regression: EML (`iframe sandbox srcDoc`) and DOCX (DOMPurify) previews still render and remain sanitized (no regression).

## Discipline checkpoints

- [ ] D1 `doubt-driven-review` — enumerate every legitimate rendered feature (math, tables, images, mermaid labels, code, links) and prove each survives sanitization before merge.
- [ ] D2 `security-hardening` STRIDE the sanitizer schemas + CSP (no `unsafe-inline` script; allowlist has no `data:text/html`, no `*`).
- [ ] D3 `scenario-design` matrix (payloads × legit-content) realized as T1–T6.

## Validate

- [ ] V1 `openspec validate sanitize-untrusted-rendered-content --strict` passes.
- [ ] V2 `npm test` green; add renderer unit tests under `packages/client/src/components/__tests__`.
- [ ] V3 Manual: paste a malicious markdown payload into a chat turn and confirm no script runs and `localStorage['pi-dashboard:device-bearer']` is not exfiltrated.
