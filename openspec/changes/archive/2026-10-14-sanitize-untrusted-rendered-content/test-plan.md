# Test Plan — sanitize-untrusted-rendered-content

Stage: design   Generated: 2026-10-13

Hard gate cleared: no unfillable Triple slots after doubt-review cycles 1–4
(payloads, allowlists, fail-closed behaviour, ordering and recovery are pinned in
specs/design). Mermaid cannot lay out in jsdom: every scenario that needs a real
`mermaid.render` is L3; the sanitizer and render pipeline themselves are L1 with
fixture SVGs and a mocked `mermaid` module. Sanitizer failures are forced by
`vi.mock` of `rehype-sanitize`, `dompurify` and `packages/server/src/lib/purify.ts`
(design: Test seams).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | client-untrusted — javascript: link neutralized | EP (scheme variants) | L1 | automated | markdown `[x](javascript:alert(document.domain))`, `[y]( JaVaScRiPt:alert(1))`, `<a href="java&#x09;script:alert(1)">z</a>` | render `MarkdownContent`, then `fireEvent.click` each anchor | each `<a>` has no `href` attribute and no `text-blue-400` class; `window.location.href` unchanged after the clicks |
| E2 | client-untrusted — iframe srcdoc neutralized | EP | L1 | automated | `<iframe srcdoc="<script>window.__pwned=1</script>">` | render `MarkdownContent` | `container.querySelector("iframe") === null`; `window.__pwned` undefined |
| E3 | client-untrusted — active elements removed without text leakage | EP (payload set) | L1 | automated | `a<style>p{}</style>b`, `<object data="x">fb</object>`, `<embed src="x">`, `<svg><a xlink:href="javascript:alert(1)">s</a></svg>`, `<picture>pt<source srcset="https://evil.example/t.png"></picture>`, `<div style="position:fixed;inset:0">o</div>`, `<img src="x" onerror="…">`, `<p onclick="alert(1)">c</p>` | render | no `style`/`object`/`embed`/`svg`/`picture`/`source` element; no element has `style`, `srcset`, `xlink:href` or any `on*` attribute; `textContent` contains `ab`, `o`, `c` but not `p{}`, `fb`, `pt` |
| E4 | client-untrusted — data URL restricted to images | EP | L1 | automated | `![ok](data:image/png;base64,AAAA)` + `[bad](data:text/html,<script>alert(1)</script>)` | render | `img.getAttribute("src") === "data:image/png;base64,AAAA"`; the `bad` anchor has no `href` |
| E5 | client-untrusted — upper-case scheme on image dropped | EP + documented trade-off | L1 | automated | `<img src="DATA:TEXT/HTML,x">`, `<img src="JAVASCRIPT:alert(1)">`, `![u](HTTP://example.com/u.png)`, `![c](photo:1.png)` | render | none of the four `<img>` has a `src` attribute |
| E6 | client-untrusted — DOM-clobbering prevented | EP | L1 | automated | `<img name="getElementById" id="config">` | render | the `<img>` has neither `id` nor `name`; `document.getElementById` is still a function |
| E7 | client-untrusted — footnotes keep working | contract | L1 | automated | `Text[^1]\n\n[^1]: Note` | render | reference `href="#user-content-fn-1"`; an element with `id="user-content-fn-1"` exists; `id="footnote-label"` exists; no id starts with `user-content-user-content-` |
| E8 | client-untrusted — legitimate content preserved | EP (feature set) | L1 | automated | one message with inline `$a^2$`, own-line `$$`…`$$` block, GFM table, `- [ ] task`, footnote, `<details><summary>S</summary>\n\nbody\n\n</details>`, `<kbd>K</kbd>`, ```` ```ts ```` block, ```` ```mermaid ```` block, `[l](http://localhost:8000/x)`, `[r](./a.md)`, `[f](#top)`, images `pi-asset:abc` (registered `image/png`), `blob:http://localhost/1`, `data:image/png;base64,AAAA`, `https://example.com/a.png` | render inside `SessionAssetsContext` | `.katex` (inline) and `.katex-display` present; `table`, checkbox `input`, `details`, `kbd` present; code block highlighted; `MermaidBlock` mounted for the mermaid fence; the 3 links keep their `href`; 4 images carry their `src` (pi-asset resolved to `data:image/png;base64,…`) |
| E9 | client-untrusted — URL transform decision table | decision-table (tag/key × value class) | L1 | automated | `safeUrlTransform` called with (`img`,`src`) and (`a`,`href`) × {`pi-asset:x`, `blob:x`, `data:image/png;…`, `data:text/html,x`, `https://a`, `HTTP://a`, `javascript:x`, `" javascript:x"`, `./rel`, `#frag`, `mailto:a@b`} | call | `img src` keeps pi-asset/blob/data:image/https/rel/#frag/mailto; `a href` keeps only https/rel/#frag/mailto; everything else `""` |
| E10 | design D2 — schema/transform parity | invariant | L1 | automated | the E9 value corpus on `img src` | for each value the transform keeps, run it through `rehype-sanitize` with `MARKDOWN_SCHEMA` | the `src` survives the schema for every kept value; for every value the transform drops, the schema result is irrelevant |
| E11 | chat-math-rendering — plugin order + math survives | contract | L1 | automated | `<details>\n\n<summary>Theorem</summary>\n\n$\forall n \geq 0$\n\n</details>`; inline `$a^2$` + own-line display block | render | `details` element contains a `.katex`; `$a^2$` inline (`.katex` not inside `.katex-display`), the block inside `.katex-display` |
| E12 | chat-asset-resolver — non-image asset mime | EP | L1 | automated | asset map `{abc:{data:"PHNjcmlwdD4=", mimeType:"text/html"}}`, markdown `![pic](pi-asset:abc)` | render | no `img[src^="data:text/html"]`; unresolved placeholder element visible |
| E13 | chat-asset-resolver + markdown-rendering — dropped-scheme image not clickable | state | L1 | automated | `![x](data:text/html;base64,AAAA)` | render, click the image | `<img>` has no `src`; no lightbox dialog in the document |
| E14 | markdown-preview-view — non-local schemes not rewritten | EP | L1 | automated | `imageBase={cwd:"/w",dir:"/w/doc"}`; images `file:///x.png`, `cid:x`, `pi-asset:abc` (registered image) | render | no `src` contains `/api/file/raw`; `file:`/`cid:` images have no `src`; `pi-asset:abc` resolves to `data:image/png;…` |
| E15 | client-untrusted doc — AsciiDoc passthrough stripped | EP (payload set) | L1 | automated | `.adoc` with `+++<img src=x onerror=fetch('//evil')>+++`, `pass:[<style>@import url(//evil)</style>]`, `+++<div style="position:fixed;inset:0">o</div>+++` | `GET /api/file/render?…path=x.adoc` via fastify inject | 200 HTML contains no `onerror`, no `<style`, and the `<div>` has no `style` attribute |
| E16 | client-untrusted doc — AsciiDoc legitimate formatting preserved (server) | EP (feature set) | L1 | automated | `.adoc` with `:stem: latexmath`, headings, list, `[cols="1,3"]` table, `stem:[a^2]`, `[source,mermaid]` block, `[plantuml]` block | render endpoint | `<col style="width: 25%;">`/`75%` kept; `\(a^2\)` text present; `splitAdocDiagramSegments(html)` returns a mermaid and a plantuml segment |
| E17 | client-untrusted doc — math rewrite never touches attributes | EP | L1 | automated | sanitized HTML `<a title="see \(x\)">l</a><pre><code>\(y\)</code></pre><p>\(z\) and \(a <em>b</em>\)</p>` | `renderAdocMath(html)` (jsdom) | `title` attribute still `see \(x\)`; code still `\(y\)`; `\(z\)` → `.katex`; split pair stays literal; output re-parses with no `parsererror` |
| E18 | design D3 — mutation-XSS round trip | EP (payload set) | L1 | automated | 11 mutation-XSS payloads (namespace confusion `<svg><style>`, `<math><mtext><table><mglyph><style>`, `<noscript>` nesting, comment breakouts, `<form><math><mtext></form><form><mglyph><svg><mtext><textarea>…`) through the server adoc sanitize | parse into `<template>` → serialize → assign to `innerHTML` | no live `script`/`style` element and no `on*` attribute in the final DOM |
| E19 | client-untrusted doc — AsciiDoc pass does not leak | state-transition | L1 | automated | an adoc render, then EML HTML and DOCX HTML each containing `<p style="color:red">` | adoc sanitize → EML sanitize → DOCX sanitize on the shared `loadPurify()` instance | EML and DOCX outputs keep `style="color:red"`; DOMPurify hook table for `uponSanitizeAttribute` has the same length before and after the adoc call |
| E20 | client-untrusted mermaid — SVG sanitizer payloads | EP (payload set) | L1 | automated | fixture SVG with `<a xlink:href="javascript:alert(1)">`, `onclick="x"`, `onload='x'`, `onmouseover=x`, `<script>`, `<foreignObject><div><span class="nodeLabel">a<br/>b</span></div></foreignObject>`, `<style>.node{}</style>` | `sanitizeMermaidSvg(svg)` | no `javascript:`; no `on*` attribute; no `script`; `foreignObject` keeps the `span` and the `br`; `<style>` kept |
| E21 | mermaid-diagram — colorize before sanitize | contract (ordering) | L1 | automated | mocked `mermaid.render` returning a flowchart fixture whose label contains `<br/>` and whose node shape has no `fill:` | mount `MermaidBlock` | injected SVG node shape has the accent `fill:rgba(…)` style; label text `a` and `b` present; no `on*` attribute |
| E22 | client-untrusted mermaid — repaired render sanitized | state-transition | L1 | automated | mocked `mermaid.render`: 1st call throws, repaired call returns SVG with `<g onclick="alert(1)">` | mount `MermaidBlock` with repairable source | repair badge shown; injected SVG has no `onclick` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | design Risks — sanitizer cost on long chats | regression (existing thresholds) | L3 | automated | the workload already defined in `tests/e2e/chat-render-perf.spec.ts` | that spec's existing thresholds still pass with `rehype-sanitize` in the chain | one run of the spec |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | client-untrusted — rendering recovers when content changes | state-transition | L1 | automated | `rehype-sanitize` mocked to throw only for content `"A <b>x</b>"`; two `MarkdownContent` siblings | render sibling S1 `"stable"` and S2 `"A <b>x</b>"`, then rerender S2 with `"A **y**"` | S2 first shows the raw source as plain text (no `<b>` element), then a `<strong>y</strong>`; S1's DOM node identity is unchanged across both renders |
| F2 | client-untrusted mermaid — diagram types keep their features | EP (diagram types) | L3 | automated | chat/preview markdown with a flowchart using `-->` arrows and a `A["one<br>two"]` label, a sequence diagram, a class diagram and an ER diagram | open the rendered surface in the browser | each `.mermaid-diagram svg` has its `<style>`, `marker` elements where arrows exist, and the label text; the flowchart label renders `one` and `two` on separate lines (distinct line boxes) |
| F3 | client-untrusted mermaid — init directive cannot inject theme CSS | EP | L3 | automated | diagram prefixed with `%%{init: {"themeCSS": "@import url(//evil.example/x.css); * {display:none}", "fontFamily": "x;*{display:none}"}}%%` | render in the browser | the SVG `<style>` text contains neither `@import` nor `display:none`; the page's chat composer is still visible; no request to `evil.example` |
| F4 | mermaid-diagram — colorization survives multi-line labels | contract | L3 | automated | flowchart `A["one<br>two"] --> B` with no `style`/`classDef` | render in the browser | node A's shape has the accent tint fill and the label shows both lines |
| F5 | client-untrusted — exploit attempts inert in a real browser | EP (payload set) | L3 | automated | an agent message containing `[x](javascript:window.__pwned=1)` and `<iframe srcdoc="<script>parent.__pwned=1</script>">` | open the session, click the link | `window.__pwned` undefined; page URL unchanged; no navigation/reload event |
| F6 | client-untrusted doc — AsciiDoc legitimate formatting preserved (browser) | EP | L3 | automated | the E16 `.adoc` file plus `stem:[\sqrt{\frac{a}{b}}]` | open it in the AsciiDoc preview | the radical renders a `.katex svg`; the mermaid block renders an `svg`; the plantuml block renders its diagram; table columns have the 25%/75% widths |
| M1 | all three sinks — visual parity | visual/subjective | — | manual-only | chat, markdown preview, AsciiDoc preview and mermaid diagrams in two themes | a human compares them with the pre-change build | [judgment: no visible styling regression — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | client-untrusted — rendering failure shows plain text | fault-injection (abort) | L1 | automated | `rehype-sanitize` mocked to throw | render `MarkdownContent` with `Hi <img src=x onerror=alert(1)>` | container shows the source as text; no `img` element; no uncaught error escapes the boundary |
| X2 | client-untrusted doc — AsciiDoc sanitizer unavailable fails closed | fault-injection (abort) | L1 | automated | `loadPurify` mocked to (a) throw, (b) return an instance with `isSupported:false`, (c) return one whose `sanitize` throws | render endpoint on an `.adoc` containing the marker `+++<b id=RAWMARK>+++` | each response `success:false`; body never contains `RAWMARK` |
| X3 | client-untrusted doc — EML/PlantUML fail closed | fault-injection (abort) | L1 | automated | `loadPurify` returns `isSupported:false` | EML render and PlantUML SVG sanitize | both report an error; neither output contains the unsanitized input marker |
| X4 | client-untrusted doc — unsupported instance never cached | fault-injection then recovery | L1 | automated | first `isomorphic-dompurify` load yields `isSupported:false`, second a working instance | call `loadPurify()` twice | 1st call throws; 2nd call returns the working instance (the bad one was not cached) |
| X5 | client-untrusted mermaid — sanitizer failure fails closed | fault-injection (abort) | L1 | automated | `dompurify` mocked (a) to throw, (b) with `isSupported:false` | mount `MermaidBlock` (mocked `mermaid.render` returns a fixture with `RAWMARK`) | error view (or repaired view) shown; no injected SVG contains `RAWMARK`; no `_outcomeCache` entry holds an svg containing `RAWMARK` |
| X6 | client-untrusted doc — existing sanitized previews unchanged | regression | L3 | automated | none (working sanitizer) | run `tests/e2e/eml-preview.spec.ts` and `tests/e2e/diagram-preview.spec.ts` | both pass; the EML body iframe still has `sandbox=""` and no `allow-scripts` |

---

## Coverage summary

- Requirements covered: 9/9 (client-untrusted ×3, markdown-rendering, chat-math-rendering, chat-asset-resolver, mermaid-diagram colorization, markdown-preview-view, plus design D2/D3 invariants)
- Scenarios by class: edge 22 · perf 1 · frontend 7 · error 6
- Scenarios by level: L1 28 · L2 0 · L3 7 · — 1
- Scenarios by disposition: automated 35 · manual-only 1

## New infra needed

none — L1 uses the existing vitest projects (`adoc-math.test.ts` moves from the
node project to jsdom, task 2.3); L3 extends existing Playwright specs.
