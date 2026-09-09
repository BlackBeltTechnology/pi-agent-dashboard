# Tasks

## 1. AsciiDoc chunker (packages/kb)

- [x] 1.1 Add `Chunk.startLine`/`Chunk.endLine` optional fields in `packages/kb/src/types.ts`; add two `UNINDEXED` line-anchor columns to the FTS5 chunk table and bump `SCHEMA_VERSION` in `packages/kb/src/sqlite-store.ts` (design D3a).
- [x] 1.2 Implement `packages/kb/src/adoc-chunker.ts`: document-attribute header extraction, delimited-block-safe section splitting, delimiter-aware oversize split, tiny-merge reuse, line anchors, xref link extraction (design D3/D3a/D3b/D6).
- [x] 1.3 Test: header attributes extracted (test-plan #E1) — see packages/kb/src/__tests__/frontmatter.test.ts. Input `= Title\n:toc:\n:sectnums:\n\nbody` · chunk · attribute map returned separately, doctitle is level-0 heading, body excludes header.
- [x] 1.4 Test: boolean/negated attributes (test-plan #E2) — see packages/kb/src/__tests__/frontmatter.test.ts. Header with `:!sectnums:` and `:attr: value` · chunk · no throw, both captured.
- [x] 1.5 Test: headerless file fallback (test-plan #E3) — see packages/kb/src/__tests__/kb.test.ts. `notes.adoc` without doctitle · chunk · attribute map null, preamble heading `notes`.
- [x] 1.6 Test: CRLF purity (test-plan #E4) — see packages/kb/src/__tests__/frontmatter.test.ts. Same doc LF vs CRLF · chunk both · identical chunks, ids, hashes.
- [x] 1.7 Test: titles inside all 9 delimited block types stay content (test-plan #E5) — see packages/kb/src/__tests__/kb.test.ts. `== Fake Title` inside listing/literal/example/sidebar/quote/passthrough/open/table/comment blocks · chunk each · zero extra boundaries.
- [x] 1.8 Test: title level boundary 6 vs 7 (test-plan #E6) — see packages/kb/src/__tests__/kb.test.ts. `====== L6` and `======= L7` lines · chunk · level-6 splits, 7-`=` is body.
- [x] 1.9 Test: empty section dropped (test-plan #E7) — see packages/kb/src/__tests__/kb.test.ts. `== A` directly followed by `== B` · chunk · no chunk for A.
- [x] 1.10 Test: oversize split never lands inside a delimited block (test-plan #E8) — see packages/kb/src/__tests__/kb.test.ts. Oversized section whose only blank lines sit in a listing block · split · safe split points only, else one oversized chunk.
- [x] 1.11 Test: tiny-merge threshold parity (test-plan #E9) — see packages/kb/src/__tests__/kb.test.ts. Below-threshold section + sibling · normalize · merged with markdown thresholds.
- [x] 1.12 Test: line anchors are real (test-plan #E10) — see packages/kb/src/__tests__/kb.test.ts. Fixture with known line numbers · chunk · `startLine`/`endLine` match real ranges.
- [x] 1.13 Test: xref forms extraction (test-plan #E11) — see packages/kb/src/__tests__/kb.test.ts. `xref:other.adoc[L]`, `xref:other.adoc#frag[L]`, `<<anchor>>` · extract · `other.adoc` twice, anchor none.
- [x] 1.14 Test: chunker totality on malformed input (test-plan #X1) — see packages/kb/src/__tests__/kb.test.ts. Unclosed `----`, stray delimiters, 0-byte file · chunk each · no throw, graceful degradation.

## 2. Indexing pipeline (packages/kb)

- [x] 2.1 Widen all three selection gates together (design D4): walk regex, `config.ts` default `include`/`extensions`, and per-extension chunker dispatch in `packages/kb/src/indexer.ts`; widen the title-fallback regexes; route the attribute map through the frontmatter meta path (D3b); feed xref links into the file-level graph-edge aggregation (D6).
- [x] 2.2 Test: default config indexes adoc, dispatches per extension (test-plan #E13) — see packages/kb/src/__tests__/kb.test.ts. Dir with `a.md b.adoc c.asciidoc d.txt`, default config · index · a/b/c indexed with correct chunkers, d skipped.
- [x] 2.3 Test: adoc doc-type classification (test-plan #E14) — see packages/kb/src/__tests__/kb.test.ts (docTypeOf lives in packages/kb; the kb-extension pointer was a fold error). `packages/x/src/y.adoc` and `docs/z.adoc` · classify · `source-md` vs `doc`.
- [x] 2.4 Test: title fallback strips adoc extensions (test-plan #E15) — see packages/kb/src/__tests__/kb.test.ts. Headerless `guide.asciidoc` · index · meta title `guide`.
- [x] 2.5 Test: markdown pipeline regression lock (test-plan #E16) — see packages/kb/src/__tests__/kb.test.ts. Existing markdown fixtures · run suite post-change · all pass, markdown chunk ids byte-identical.
- [x] 2.6 Test: SCHEMA_VERSION bump triggers auto full reindex (test-plan #E17) — see packages/kb/src/__tests__/frontmatter-indexing.test.ts (home of the schema-version reindex gate; the engine-fingerprint pointer was a fold error). Store at previous version · open post-change · full reindex, no crash, line-anchor columns readable.
- [x] 2.7 Test: xref links become traversable graph edges (test-plan #E12) — see packages/kb/src/__tests__/kb.test.ts. Two adoc files, one xrefs the other · index pair · edge exists, neighbors traversal returns target.

## 3. kb-extension auto-reindex (packages/kb-extension)

- [x] 3.1 Decouple Job 1/Job 2 predicates (design D5): `isIndexable()` (md+adoc → reindex) and `isNudgeEligible()` (non-markdown incl. adoc → DOX nudge) in `packages/kb-extension/src/extension.ts`.
- [x] 3.2 Test: adoc edit schedules debounced reindex incl. case-insensitivity and collapse (test-plan #E18) — see packages/kb-extension/src/__tests__/{reindex,adoc-dispatch}.test.ts. `write` result `doc.adoc`/`X.ASCIIDOC` · event · reindex scheduled, 800 ms debounce, rapid edits collapse.
- [x] 3.3 Test: adoc edit fires both reindex and DOX nudge (test-plan #E19) — see packages/kb-extension/src/__tests__/adoc-dispatch.test.ts. DOX on, `.adoc` lacking fresh row · edit · reindex AND nudge.
- [x] 3.4 Test: md edit behavior unchanged (test-plan #E20) — see packages/kb-extension/src/__tests__/adoc-dispatch.test.ts. DOX on, `.md` edit · event · reindex only, no nudge.
- [x] 3.5 Test: adoc reindex failure swallowed (test-plan #X2) — see packages/kb-extension/src/__tests__/reindex.test.ts. Reindex rejects on adoc edit · debounce fires · warning logged, session alive.

## 4. Preview styling (packages/client)

- [x] 4.1 Add the `.asciidoc-body` stylesheet (dedicated file imported by `index.css`, theme vars only — design D1): TOC panel, `.sect*` hierarchy, tableblock frame/grid/stripes variants, admonition accent cards, lists, listing blocks.
- [x] 4.2 Remove `prose prose-invert` from `AsciiDocPreview.tsx` and `DocxPreview.tsx` html-mode wrapper (shared `.asciidoc-body` scope — design D2).
- [x] 4.3 Test: wrappers drop prose classes (test-plan #F7) — see packages/client/src/components/preview/__tests__/DocxPreview.test.tsx. Render both components with stub HTML · inspect wrapper · has `asciidoc-body`, no `prose`/`prose-invert`.
- [x] 4.4 Test: docx html-mode shares the typography scope (test-plan #F8) — see packages/client/src/components/preview/__tests__/DocxPreview.test.tsx. DocxPreview html-mode stub · inspect wrapper · wrapped in `.asciidoc-body`.
- [x] 4.5 E2E: heading hierarchy computed sizes (test-plan #F1) — see tests/e2e/asciidoc-preview.spec.ts (new spec; eml-preview.spec.ts was the exemplar, not the home). Seeded `.adoc` with 3 section levels · open preview · font-size strictly decreasing h1→h2→h3, all > body.
- [x] 4.6 E2E: admonition accent card (test-plan #F2) — see tests/e2e/asciidoc-preview.spec.ts (new spec; eml-preview.spec.ts was the exemplar, not the home). Seeded `.adoc` with `NOTE:` · open preview · `.admonitionblock` border-left ≥ 2px, background ≠ page background.
- [x] 4.7 E2E: frame=none key/value table (test-plan #F3) — see tests/e2e/asciidoc-preview.spec.ts (new spec; eml-preview.spec.ts was the exemplar, not the home). `[frame=none,grid=none]` table · open preview · zero cell borders, padding > 0.
- [x] 4.8 E2E: striped table (test-plan #F4) — see tests/e2e/asciidoc-preview.spec.ts (new spec; eml-preview.spec.ts was the exemplar, not the home). `[stripes=even]` table with header · open preview · even/odd row backgrounds differ, header distinct.
- [x] 4.9 E2E: TOC panel when `:toc:` declared (test-plan #F5) — see tests/e2e/asciidoc-preview.spec.ts (new spec; eml-preview.spec.ts was the exemplar, not the home). Doc declaring `:toc:` with nested sections · open preview · `#toc` panel styled, nested indentation increases.
- [x] 4.10 E2E: theme switch retargets colors (test-plan #F6) — see tests/e2e/asciidoc-preview.spec.ts (new spec; eml-preview.spec.ts was the exemplar, not the home). Preview open · switch theme · `.asciidoc-body` heading color changes without reload.

## 5. Manual verification

- [x] 5.1 Review rendered AsciiDoc preview against the validated mockup across several themes, dark + light (test-plan: manual-only, #F9).
