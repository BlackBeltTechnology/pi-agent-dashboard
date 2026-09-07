## Context

See proposal.md — Why. Current state that shapes the approach:

- `/api/file/render` already converts `.adoc`/`.asciidoc` via a lazy asciidoctor singleton (`safe:"secure"`, `standalone:false`) in `packages/server/src/routes/file-routes.ts`; DOMPurify on that output is owned by the active `sanitize-untrusted-rendered-content` change.
- `AsciiDocPreview.tsx` and `DocxPreview.tsx` (html mode) both wrap output in `asciidoc-body prose prose-invert` — no CSS exists for any of these classes.
- `packages/kb/src/indexer.ts` has three selection gates: walk regex (`/\.(md|mdx|markdown)$/i`), include globs (default `["**/*.md"]` from `config.ts`), and a dead `extRe` built from `opts.extensions`. The markdown chunker (`chunker.ts`) defines the chunk contract (breadcrumbs, tiny-merge/oversize-split, stable ids). Markdown chunks carry NO line anchors today — line anchors are a new, adoc-first extension of the `Chunk` type.
- `packages/kb-extension/src/extension.ts` dispatches Job 1 (reindex) vs Job 2 (DOX nudge) through a single mutually-exclusive `isMd()` if/else.
- A validated mockup (real AsciiDoc corpus, exact server convert call) proves ~150 lines of theme-var CSS produce correct TOC/headings/tables/admonitions.

## Goals / Non-Goals

**Goals:**
- Styled preview via pure CSS, tracking every registered theme automatically.
- `.adoc` first-class in the kb: native chunker, all selection gates widened together, auto-reindex on edit.
- Chunk-contract parity so downstream kb consumers (search, dox, neighbors) need no changes.

**Non-Goals:**
- Sanitization of rendered HTML (owned by `sanitize-untrusted-rendered-content`).
- Diagram rendering in `.adoc` (owned by `diagram-rendering`).
- AsciiDoc editing support, include-resolution (`safe:"secure"` intentionally neutralizes includes), or attribute-driven server render options (`:toc:` remains document-declared).
- Reviving the dead `extRe` gate beyond what widening requires.

## Decisions

**D1 — CSS lives in a dedicated stylesheet imported by `index.css`, scoped under `.asciidoc-body`.**
Alternative: inline Tailwind utilities per element — impossible, the HTML comes from asciidoctor. Alternative: `@tailwindcss/typography` — rejected in mockup validation; it doesn't know asciidoctor's class vocabulary (admonition nested tables, `frame`/`grid`/`stripes` variants) and adds a dependency for worse output. Admonition nested-table markup is flattened to a block card with dedicated rules (`.admonitionblock > table`, `td.icon`, `td.content`).

**D2 — Keep the shared `.asciidoc-body` scope for DocxPreview html-mode.**
Both surfaces are unstyled today; mammoth emits plain semantic HTML that benefits from the same typography. Splitting classes would duplicate rules for zero behavioral gain. If docx-specific conflicts appear later, a `.docx-body` override layer can be added without migration.

**D3 — New AsciiDoc chunker as a sibling module of the markdown chunker, sharing the normalization helpers.**
Alternative: convert adoc→HTML→chunk — loses line positions and adds Opal cost to indexing. Alternative: regex-adapt the markdown chunker in place — the fence model differs fundamentally (9 delimited block types vs backtick/tilde fences; `=` titles vs `#`; attribute header vs YAML frontmatter), so a shared implementation would be conditional soup. Tiny-merge/id/hash helpers are extracted and reused where they are already pure. **Oversize-split is NOT reused verbatim**: the markdown splitter breaks at any blank line (`\n\s*\n`), which would split mid-block inside a listing containing blank lines — the adoc splitter breaks only at blank lines *outside* delimited blocks, falling back to an oversized single chunk when no safe split point exists.

**D3a — Line anchors are an additive optional extension of `Chunk`.**
The `Chunk` type gains optional `startLine`/`endLine` fields, populated by the adoc chunker and absent for markdown chunks. The FTS5 chunk table has a fixed column set (extra `Chunk` fields are silently dropped on insert), so persistence requires two new `UNINDEXED` columns — and FTS5 does not support `ALTER TABLE ADD COLUMN`, so this is a `SCHEMA_VERSION` bump that forces a one-time full reindex on existing stores (the existing, already-handled upgrade path). Without the columns the anchors would be chunker-ephemeral and no store consumer could observe them. Markdown chunker output is byte-identical before/after; the existing markdown chunker test suite passing unchanged is the lock on "markdown pipeline behavior unchanged".

**D3b — Attribute map reuses the frontmatter pipeline.**
The parsed attribute map flows into the same meta-chunk/property path the indexer already applies to frontmatter; the doctitle becomes the document title, and the title fallback regex widens to strip `.adoc`/`.asciidoc`. No attribute→tag mapping in v1 (AsciiDoc has no conventional tags attribute; deferrable without spec change).

**D4 — Widen all three selection gates in one commit; per-extension dispatch at chunk time.**
Walk regex, `config.ts` defaults (`include: ["**/*.md", "**/*.adoc", …]`, `extensions`), and dispatch land together — widening only the walk regex indexes zero files under default config (doubt-review finding). The dead `extRe` stays dead; noted in code comment only.

**D5 — Decouple Job 1 / Job 2 predicates in kb-extension.**
The current if/else makes reindex and nudge mutually exclusive. New shape: `isIndexable(path)` (md + adoc → Job 1) and independently `isNudgeEligible(path)` (everything non-markdown, including adoc → Job 2). `.adoc` edits therefore run both jobs; `.md` edits keep today's behavior (reindex only, no nudge — unchanged from the current complement rule). Alternative considered: widen `isMd()` in place — rejected because the if/else would then silently drop `.adoc` from nudge eligibility (doubt-review finding).

**D6 — Xref extraction is macro-level, file-component based, and feeds the existing link graph.**
`xref:target[]` and `<<target>>` refs whose *file component* (fragment stripped first) ends in `.adoc`/`.asciidoc` become outbound document-level links — so `xref:file.adoc#frag[]` counts; bare `<<anchor>>` refs are internal and skipped. Extracted links join the same file-level link aggregation that builds tier-1 graph edges from markdown links (small indexer addition), so `kb_neighbors` walks adoc→adoc references. Alternative considered: per-chunk link storage — rejected; no consumer exists and markdown links are file-level. The markdown wiki-link resolver is untouched.

## Risks / Trade-offs

- [Asciidoctor's embedded output classes drift across versions] → the CSS targets stable long-documented classes (`sect1`, `admonitionblock`, `tableblock`); asciidoctor.js is on a caret range, but these classes have been stable across the 2.x→3.x line.
- [Shared `.asciidoc-body` scope restyles docx previews] → intentional (D2); verified visually during implementation; override layer as escape hatch.
- [AsciiDoc block-nesting edge cases (nested example-in-open blocks)] → chunker treats any open delimiter as opaque until its matching closer; a mis-closed block degrades to fewer, larger chunks — never a crash. Combined with the delimiter-aware oversize-split (D3), no split point ever lands inside a delimited block.
- [Reindex volume grows in adoc-heavy repos] → same debounce + mtime/sha256 gating as markdown; no new cost for md-only repos.
- [Race with `sanitize-untrusted-rendered-content` on `AsciiDocPreview.tsx`] → both changes edit this small file (that change: injection path + comment; this change: wrapper `className`). Conflicts are line-local and mechanical; whichever lands second rebases trivially.

## Migration Plan

The `SCHEMA_VERSION` bump (D3a) triggers the existing automatic full-reindex path on first open of an old store — no manual migration step. Thereafter kb indexes pick up `.adoc` files on the next incremental reindex (new files are additive; no chunk-id changes for markdown — locked by the unchanged markdown chunker test suite). Rollback = revert; the deletion sweep on the next (incremental) reindex removes adoc chunks.

## Open Questions

None.
