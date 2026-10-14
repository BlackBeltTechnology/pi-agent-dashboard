## Context

See proposal.md (Why) for the three sinks and the threat. Current state that
shapes the approach (develop `8f170ef96`):

- **Markdown** — `ReactMarkdown` in `packages/client/src/components/preview/MarkdownContent.tsx:616-637`:
  `remarkPlugins=[remarkGfm, remarkMath, remarkFrontmatter]`,
  `rehypePlugins=[rehypeRaw, [rehypeKatex,{throwOnError:false}], stripReactRefAttributes]`
  (order documented at `:619-626`, pinned by `markdown-rendering` and
  `chat-math-rendering`), `urlTransform={(value)=>value}` (`:633`) because the
  default transform blanks `pi-asset:`/`data:` before the `img` override
  (`PiAssetImg`, `:356`) sees them. `MarkdownAnchor` (`:546`) passes `href`
  through verbatim. React 19.2.8 blocks `javascript:` on React-rendered `href`,
  but nothing removes `<iframe srcdoc>` or other raw elements.
- **react-markdown 10** applies `urlTransform(value, key, node)` to every
  URL-bearing property in the final tree (`react-markdown/lib/index.js:382`;
  the attribute list from `html-url-attributes` does not include `srcset`,
  `srcdoc` or `xlink:href`) and exports `defaultUrlTransform` (`:421`; safe
  set `https?|ircs?|mailto|xmpp` at `:124`; colon-before-`/?#` parsing).
- **hast-util-sanitize** (wrapped by `rehype-sanitize`) shallow-merges options
  over `defaultSchema`; attribute lookup returns the **first** matching
  definition, so narrowing an allowed attribute requires **replacing** the
  list, not appending. `defaultSchema` allows bare `id`/`name` on `*`, admits
  `picture`/`source[srcSet]`, and clobber-prefixes `id`/`name` unconditionally
  (double-prefixing remark's already-prefixed footnote ids).
- **remark-math 6 / rehype-katex 7** mark math as `code.language-math` with
  `math-inline` / `math-display` classes; rehype-katex starts from
  `displayMode = mathDisplay` (`rehype-katex/lib/index.js:51-54`) and runs
  KaTeX with its default `trust:false`.
- **remark-rehype footnotes** emit `user-content-`-prefixed ids/hrefs plus an
  unprefixed `id="footnote-label"` referenced by `aria-describedby`
  (`mdast-util-to-hast/lib/footer.js`).
- **AsciiDoc** — `packages/server/src/routes/file-routes.ts:1183-1192`: inside a
  `try` that returns `{success:false}` on error, `getAsciidoctor()` (`:223`)
  then `convert(source,{safe:"secure",standalone:false,…})`; HTML returned
  as-is. The client (`AsciiDocPreview.tsx:59-74`; the "safe because server
  guarantees sanitization" claim is at `:4`) rewrites `\(…\)`/`\[…\]` to KaTeX
  markup with a tag-unaware string regex (`lib/preview/adoc-math.ts:14`), then
  splits with `lib/preview/adoc-diagram-splitter.ts` (regex on
  `<div class="listingblock">` at `:47`; `data-lang` / `class="language-*"` at
  `:103-107`); raw segments go to `dangerouslySetInnerHTML`. asciidoctor uses
  `style` for table column widths (`<col style="width: …">`).
- **DOMPurify** — server: `packages/server/src/lib/purify.ts` `loadPurify()`
  (lazy native-`require` of `isomorphic-dompurify` 3.18.0; checks only that
  `sanitize` is a function), used by `lib/eml.ts:186` and
  `lib/diagram-render.ts:33` (and `office-preview.ts:220`); hooks
  (`addHook`) are global to that shared instance — `sanitize()` has no
  per-call hook option. Client: `dompurify` ^3.3.3 (any 3.2+ supports
  `HTML_INTEGRATION_POINTS`). An instance with `isSupported === false`
  returns its input unchanged (`dompurify/dist/purify.cjs.js:2376`).
  `SANITIZE_DOM` (default on, `:1982`) drops `id`/`name` values that shadow
  `document`/form properties. `hast-util-sanitize` compares URL protocols
  case-sensitively (`HTTP://`, `PI-ASSET:` are stripped).
- **Mermaid** — `MermaidBlock.tsx` `renderOnce` runs
  `mermaid.render → sanitizeMermaidSvg (:80, regex at :83-84) → colorizeDefaultNodes`,
  then the outcome (including errors) is cached in `_outcomeCache`; the
  comment at `:75-78` assumes the SVG is "not from user input".
  `colorizeDefaultNodes` (`:153`) re-parses the SVG as `image/svg+xml`, so its
  input must be well-formed XML — mermaid's own output is (`<br/>`).
  `mermaidConfig` sets `flowchart.htmlLabels:true` and leaves `securityLevel`
  at mermaid's default `strict`. Mermaid's `secure` key list (diagram
  `%%{init}%%` directives cannot override listed keys) does not include
  `themeCSS`/`fontFamily`, which mermaid writes into the SVG's `<style>` with
  only a brace-balance check — and an inline SVG `<style>` applies to the
  whole document. A sanitizer throw inside `renderOnce` is routed to
  `renderRepaired` (`MermaidBlock.tsx:257-259`), as the base
  `mermaid-diagram` requirement mandates for any render failure.
- **Concurrent change** — `retro-ux-chat-rendering` (in implementation)
  MODIFIES `mermaid-diagram` "Mermaid diagram rendering" and edits
  `MermaidBlock.tsx`. This change therefore does not modify that requirement
  (its DOMPurify mandate already exists); the mermaid sanitizer rules live in
  an ADDED requirement of `client-untrusted-content-sanitization`.

## Goals / Non-Goals

**Goals:**
- One explicit, parser-based sanitizer at each of the three sinks, running
  after the last transformation of the HTML and before it is cached or
  reaches the DOM.
- Every legitimate feature listed in the specs keeps rendering.

**Non-Goals:**
- CSP changes (follow-up change; see proposal).
- Already-safe sinks, regression-guarded only: `DiagramPreview` (server
  DOMPurify), `EmlPreview` (script-less sandboxed iframe), `DocxPreview`
  (server-sanitized), `InlineMarkdown` (no `rehypeRaw`, default
  `urlTransform`), `HtmlPreview` (`sandbox="allow-same-origin"` without
  `allow-scripts`, `HtmlPreview.tsx:73`), `FrontmatterProperties` links (only
  `^https?://` values become anchors, `FrontmatterProperties.tsx:69`), and the
  plugin cards `OmEntryCard` / `WebSearchEntryCard` (text nodes only).
- Changing mermaid's `securityLevel` or the auto-repair / AI-repair flows
  (`add-mermaid-ai-repair` inherits this sanitizer path unchanged).

## Decisions

### D1 — Markdown: `rehype-sanitize` between `rehypeRaw` and `rehypeKatex`

Chain becomes `[rehypeRaw, [rehypeSanitize, MARKDOWN_SCHEMA], [rehypeKatex,…], stripReactRefAttributes]`.
`rehype-sanitize` is pinned to exactly `6.0.0` (resolving `hast-util-sanitize`
5.0.2); its clobber, `srcSet`, protocol and merge semantics are what this
design relies on. `ReactMarkdown` (which runs the unified pipeline
synchronously during render, `react-markdown/lib/index.js:175-178`) is wrapped
in the existing `primitives/ErrorBoundary.tsx`, extended with an optional
`resetKey` prop that clears the error state when it changes; `MarkdownContent`
passes `content`. The fallback renders the source as plain text. A throw never
falls back to the raw tree, and the next streamed token retries markdown —
without `key={content}`, which would remount on every token and violate the
no-remount requirement in `markdown-rendering`.

- **Before KaTeX**, so KaTeX's generated HTML never meets the schema; KaTeX
  runs with `trust:false`, which neutralizes `\href{javascript:…}` and escapes
  HTML in math.
- **`MARKDOWN_SCHEMA`**, exported from `markdown-sanitize.ts` next to
  `MarkdownContent.tsx`, starts from a clone of `defaultSchema` and **replaces**
  (never appends to) these entries:
  - `tagNames`: default minus `picture` and `source` (`srcSet` has no
    protocol check and no legitimate markdown producer).
  - `strip`: `script`, `style`, `object`, `embed`, `iframe`, `svg`, `math`,
    `picture`, `source`, `noscript`, `template`, `textarea`, `select` —
    removed with their content, so no inner text leaks.
  - `attributes['*']`: default minus bare `id`/`name`, plus
    `['id', /^user-content-/, 'footnote-label']` and `['name', /^user-content-/]`.
  - `attributes.code`: `[['className', /^language-./, 'math-inline', 'math-display']]`.
  - `clobber: []` (remark already prefixes footnote ids; unprefixed raw ids are
    dropped by the attribute rule instead).
  - `protocols.src`: the default `href` set (`http`, `https`, `irc`, `ircs`, `mailto`, `xmpp` — so every scheme `defaultUrlTransform` keeps on `img src` also survives the schema) plus `data`, `blob`, `pi-asset`;
    `protocols.href`: the default set (no `data`/`blob`/`pi-asset`).
- The schema is pinned by **behavior** tests (sanitize the payload set, assert
  the output), not by asserting its shape.
- **Alternatives:** drop `rehypeRaw` (zero deps, loses `<details>`/`<br>`/
  `<kbd>` agents emit routinely); DOMPurify on output (react-markdown renders a
  React tree, not a string); a hand-written hast filter (reinvents
  `hast-util-sanitize`). Chosen: `rehype-sanitize`.

### D2 — Markdown URLs: `safeUrlTransform` composed over `defaultUrlTransform`

`safeUrlTransform(value, key, node)` in `markdown-sanitize.ts`:

1. `node.tagName === "img" && key === "src"` and the value starts with the
   lower-case prefix `pi-asset:`, `blob:` or `data:image/` → keep. Lower-case
   only, because the schema's protocol check is case-sensitive: a value the
   schema would strip is never "kept" here, and an upper-case dangerous scheme
   can never pass either layer.
2. Everything else → `defaultUrlTransform(value)` (keeps scheme-less values
   and `https?|ircs?|mailto|xmpp`, returns `""` otherwise, with its own
   parsing of leading spaces and control characters), then `""` if the kept
   value has a scheme that is not all lower-case — `defaultUrlTransform`
   matches case-insensitively while the schema does not, and this makes both
   layers drop exactly the same values.

Trade-off, stated in the spec: a legitimate scheme written in upper case
(`HTTP://…`) and a relative name containing a colon (`photo:1.png`, as
`resolveLocalImageSrc` already treats it) are dropped.

`MarkdownAnchor` renders no `href` attribute (and no link styling) when the
transformed value is empty, and `PiAssetImg` maps `""` to no `src` attribute
and no lightbox: an `<a href="">` would navigate to (reload) the dashboard, whereas
today React's own guard makes a `javascript:` link inert.

The schema (D1) decides which elements/attributes may carry a URL at all and
admits `data`/`blob`/`pi-asset` only on `src`; the transform decides which
values survive. A behavior test asserts every value the transform keeps on
`img src` also survives the schema, so neither layer silently narrows the
other. `PiAssetImg` additionally renders the placeholder when a registered
asset's `mimeType` is not `image/*`, and does not open the lightbox for an
missing `src`.

### D3 — AsciiDoc: sanitize on the server; the client only adds KaTeX at text nodes

- **Server**, inside the existing `try` of the adoc branch
  (`file-routes.ts:1183`), after `convert`, `sanitizeAdocHtml(html)`:
  `purify.addHook("uponSanitizeAttribute", keepStyleOnColOnly)` → `try {
  purify.sanitize(html, { USE_PROFILES:{ html:true }, FORBID_TAGS:["style","form","input","button","textarea","select"] }) }
  finally { purify.removeHook("uponSanitizeAttribute", keepStyleOnColOnly) }`.
  `keepStyleOnColOnly` (a single module-scope function, so `removeHook`'s
  identity match cannot miss) drops `style` unless the element is
  `col`/`colgroup` (asciidoctor's column widths). Hooks are global to the
  shared `loadPurify()` instance; `sanitize` is synchronous and the
  add→sanitize→remove window contains no `await`, so it cannot interleave with
  an EML/DOCX/PlantUML sanitize. `removeHook` silently no-ops on a mismatch,
  so the leak scenario's test also asserts the hook table is restored. A throw falls into the
  existing catch → error response; raw HTML is never returned.
- **`loadPurify()`** additionally throws when `isSupported !== true` — checked
  before the instance is cached — so a pass-through instance is never used; EML, DOCX and PlantUML then fail closed
  through their existing error paths instead of serving unsanitized markup.
- **Client**, `lib/preview/adoc-math.ts`: replace the tag-unaware string regex
  with a DOM-aware rewrite — parse the sanitized HTML into a `<template>`,
  walk text nodes outside `pre`/`code`, replace `\(…\)`/`\[…\]` with KaTeX
  output (explicit `trust:false`, `throwOnError:false`) parsed into nodes —
  never string-spliced into serialized HTML — and serialize. Behavior deltas:
  a delimiter pair split across inline tags (`\(a <em>b</em>\)`, only
  reachable via passthrough) stays literal; math inside attribute values stays
  literal. The design relies on the server-sanitized HTML surviving the
  `<template>` parse → serialize → `innerHTML` round trip without gaining
  active content; a mutation-XSS payload set pins that.
  `src/lib/preview/__tests__/adoc-math.test.ts` moves from the DOM-free node
  test project (`packages/client/vitest.node-tests.ts:141`) to jsdom. Only trusted KaTeX markup is added after
  the server sanitize, and only at text positions, so attribute values cannot
  be broken open. No client re-sanitize: it would have to admit KaTeX's
  `svg`/`math`/`style` (radicals, wide accents), which a generic profile drops.
- DOMPurify keeps `class`, `id` and `data-*`, so the splitter's markers survive;
  the exact `<div class="listingblock"` serialization the splitter regex
  expects is pinned by a fixture test. `SANITIZE_DOM` (default on) drops
  `id`/`name` values that shadow `document`/form properties; asciidoctor's
  auto-generated `_`-prefixed ids are unaffected (an explicit anchor named
  after a document property loses its id — accepted).
- **Alternatives:** disabling passthrough in asciidoctor — no supported single
  switch for `+++`/`pass:[]` in `safe:"secure"`; a client re-sanitize after
  the string-based math rewrite — needs KaTeX-wide allowances (see above); a
  dedicated DOMPurify instance per consumer — more lifecycle code than a
  scoped hook. Rejected.

### D4 — Mermaid: colorize, then sanitize last with DOMPurify

`renderOnce` becomes `mermaid.render → colorizeDefaultNodes → sanitizeMermaidSvg`.
`sanitizeMermaidSvg(svg)` throws when `DOMPurify.isSupported !== true`, else
returns
`DOMPurify.sanitize(svg, { USE_PROFILES:{ svg:true, svgFilters:true, html:true }, ADD_TAGS:["foreignObject"], HTML_INTEGRATION_POINTS:{ foreignobject:true, "annotation-xml":true }, FORBID_TAGS:["form","input","button","textarea","select","iframe","object","embed"] })`.

- **Why the reorder:** DOMPurify returns an HTML serialization (`<br/>` →
  `<br>`), which is not well-formed XML, so `colorizeDefaultNodes`'
  `image/svg+xml` re-parse would fail on any multi-line label. Colorizing
  first runs on mermaid's well-formed output, and making the sanitizer the
  **last** step means no later mutation can reintroduce active content. This
  modifies `mermaid-diagram` "Default node auto-colorization".
- **Why the integration point:** without it, `<br>` line breaks inside
  `<foreignObject>` labels are stripped (label `<span>`s survive either way).
- **Fail closed:** a throw propagates from `renderOnce`; per the base
  requirement the block then tries the repaired source, which goes through the
  same `renderOnce` (and the same sanitizer), and otherwise resolves to an
  `error` outcome. Either way no unsanitized SVG is cached or injected.
- **Alternatives:** keep sanitize→colorize with
  `PARSER_MEDIA_TYPE:"application/xhtml+xml"` (keeps XML but leaves a
  post-sanitize mutation); server-side render (mermaid needs a DOM); relying on
  `securityLevel:"strict"` alone (governs mermaid's `click` interactivity, not
  what we inject). Rejected.

### D5 — Mermaid: directives cannot override theme CSS

`mermaidConfig` adds `secure: ["themeCSS", "fontFamily", "altFontFamily"]`,
which mermaid array-unions with its default secure keys (`assignWithDepth`),
so a diagram's `%%{init}%%` cannot set the values mermaid writes into the
SVG's document-wide `<style>` (mermaid's own `sanitizeCss` only blocks
unbalanced braces). Per-diagram keys such as `sequence.actorFontFamily` stay
directive-settable; they reach only inline `style` attributes on SVG text, not
the document-wide `<style>`, so they are out of D5's scope. The app's own theme values are unaffected (they
come from `mermaid.initialize`, not directives). DOMPurify keeps `<style>`
(theme styling needs it), so this config is the gate; a scenario pins it.

### Test seams

Scenarios that force a sanitizer failure mock the sanitizer module
(`vi.mock` of `rehype-sanitize`, of `dompurify`, and of `../lib/purify.js`) —
no production seam is added.

## Risks / Trade-offs

- [Mermaid keeps its theme `<style>`, which applies document-wide] → required
  for theme styling; directive-controlled values are locked by D5, so only the
  app's own theme config reaches it.
- [A sanitizer exception is cached as an error outcome for that code + theme]
  → deterministic like a parse error; a reload after fixing the environment
  clears the module cache. Accepted.
- [`data:image/svg+xml` in `<img>`] → an `<img>` context never executes
  script. Accepted.
- [Protocol-relative `//host/x` passes as scheme-less] → remote `http(s)`
  images and links are already allowed; no new exposure.
- [DOMPurify config drops a mermaid feature (markers, gradients, sequence /
  class / ER specifics)] → rendered-diagram checks across diagram types.
- [AsciiDoc splitter breaks on re-serialized HTML] → fixture test (D3).
- [Sanitizer cost on long chats] → linear hast walk per message;
  `MarkdownContent` is memoized per content. Watch the `chat-render-perf` e2e.
- [`rehype-sanitize` transitive packages] → exact pin + lockfile diff review.

## Migration Plan

Pure client/server code change; no data or config migration. Ship after
`retro-ux-chat-rendering` (both edit `MermaidBlock.tsx`); rebase on it if it
lands first. Rollback = revert the commit. No feature flag: a sanitizer behind
a flag would default-off an XSS fix.
