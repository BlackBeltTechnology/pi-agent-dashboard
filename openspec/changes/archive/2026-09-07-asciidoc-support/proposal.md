## Why

AsciiDoc files render as unstyled text soup in the dashboard preview and are invisible to the knowledge base. The server-side render leg exists (`GET /api/file/render` → asciidoctor `safe:"secure"`), but the client wraps the output in `.asciidoc-body prose prose-invert` — classes with **zero CSS behind them** (`@tailwindcss/typography` is not installed and no `.asciidoc-body` rules exist), so TOC, headings, tables, and admonitions all collapse into flat paragraphs. And the kb indexing pipeline walks only markdown (`.md/.mdx/.markdown` in the walk regex; the default `include: ["**/*.md"]` glob narrows the effective indexed set further), so AsciiDoc-heavy repos get no kb coverage at all (motivating corpus: an external AsciiDoc-only client repo used to validate the mockup).

## What Changes

- **Styled AsciiDoc preview (CSS-only on the render leg)**: add a `.asciidoc-body` stylesheet (~150 lines, validated in a live mockup against the real BETON offer doc) covering asciidoctor's class vocabulary — `#toc` panel (renders when the document declares `:toc:`; embedded-mode TOC output was validated in the mockup), `.sect*` heading hierarchy, `.tableblock` + `frame`/`grid`/`stripes` variants, `.admonitionblock` accent cards (NOTE/TIP/WARNING/IMPORTANT/CAUTION — nested-table markup flattened to block cards), `.ulist/.olist/.dlist`, `.listingblock`. All colors via existing theme vars (`--bg-surface`, `--accent-blue`, `--border-secondary`, …) so every registered theme (9 themes × dark/light) tracks automatically. `DocxPreview` html-mode shares the `.asciidoc-body` wrapper class today; it intentionally picks up the same typography (both surfaces are currently unstyled). Drop the dead `prose prose-invert` classes on both components; do NOT add `@tailwindcss/typography`.
- **Native AsciiDoc kb chunker**: split `.adoc`/`.asciidoc` bodies at AsciiDoc section titles (`=`, `==`, …), treating titles inside any delimited block (listing `----`, literal `....`, example `====`, sidebar `****`, quote `____`, passthrough `++++`, open `--`, table `|===`, comment `////`) as content, not boundaries. Document-attribute header handled analogously to frontmatter; breadcrumbs, parent linkage, tiny-merge/oversize-split normalization, stable chunk identity, and real line anchors match the markdown chunk contract. Link extraction covers `xref:`/`<<…>>` targets to `.adoc` files (the markdown wiki-link resolver stays `.md`-only).
- **Index `.adoc` sources**: every gate widens together — the walk regex, the default `include`/`extensions` config (`packages/kb/src/config.ts` defaults currently `["**/*.md"]`/`[".md"]`), and per-extension chunker dispatch. Widening only the walk regex would index zero `.adoc` files under default config. Markdown files keep the existing chunker.
- **Auto-reindex on adoc edit**: the kb-extension debounced reindex trigger fires for `.adoc`/`.asciidoc` edits, not just markdown. `.adoc` edits remain eligible for the DOX-nudge job (their AGENTS.md rows still need freshness checks) — widening the reindex trigger MUST NOT silently exempt them from nudges.

## Capabilities

### New Capabilities

- `kb-asciidoc-chunking`: chunking `.adoc`/`.asciidoc` documents into kb sections — section-title splitting safe w.r.t. all delimited block types, document-attribute extraction, breadcrumb/parent linkage, tiny-merge/oversize-split normalization, stable chunk identity, line anchors, xref link extraction.

### Modified Capabilities

- `file-and-url-preview`: new requirement — AsciiDoc preview renders with dedicated `.asciidoc-body` styling driven by theme variables (TOC panel, heading hierarchy, table frame/grid/stripes variants, admonition cards).
- `kb-indexing-pipeline`: source walk extension filter widens from `.md/.mdx/.markdown` to include `.adoc/.asciidoc`, dispatching per-extension to the matching chunker. `.adoc` files receive `doc_type` by the same location rules as markdown, and the title-fallback strips `.adoc`/`.asciidoc` extensions.
- `kb-extension-auto-reindex`: the debounced hash-gated reindex trigger fires on `.adoc`/`.asciidoc` edits in addition to markdown, while `.adoc` edits stay in scope for the DOX-nudge job (reindex eligibility and nudge eligibility are decided independently). This rewrites Job 2's current definition — the spec defines the nudge as firing on the exact complement of the reindex extension set ("non-md edit"), so the two jobs' predicates must be decoupled, not just widened.

## Impact

- `packages/client/src/index.css` (or a dedicated imported stylesheet): new `.asciidoc-body` rules; `packages/client/src/components/preview/AsciiDocPreview.tsx` and `DocxPreview.tsx` (shared `.asciidoc-body` wrapper): class cleanup — docx html-mode preview gains the same typography.
- `packages/kb/src/`: new AsciiDoc chunker module, extension dispatch in the indexing walk, and widened default `include`/`extensions` config (note: the `extRe` built from `opts.extensions` in `indexer.ts` is currently dead code — the walk regex and include globs are the live gates).
- `packages/kb-extension/`: reindex trigger extension-match widened.
- No new dependencies (asciidoctor, DOMPurify, jsdom already present). No breaking changes; markdown pipeline behavior unchanged.
- Diagram rendering inside `.adoc` ([mermaid]/[plantuml] blocks) is out of scope — see the separate `diagram-rendering` change. Sanitizing the adoc render output (DOMPurify on `/api/file/render`) is ALSO out of scope: the active change `sanitize-untrusted-rendered-content` (tasks 2.1/2.2) owns that exact work; this change only styles the (there-sanitized) HTML.

## Discipline Skills

- `review-code`: standard pre-commit review of the chunker + CSS changes.
- `security-hardening` is NOT triggered here: the untrusted-content sanitization leg lives in the active `sanitize-untrusted-rendered-content` change; this change adds no new untrusted-input surface.
- No latency-budget work (`performance-optimization` not triggered): asciidoctor is already lazy-loaded and the chunker follows the existing incremental-index path.
