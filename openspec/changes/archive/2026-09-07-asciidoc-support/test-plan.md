# Test Plan — asciidoc-support

Stage: design   Generated: 2026-09-07

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | kb-asciidoc-chunking / Document-Attribute Header Extraction | EP | L1 | automated | `= Title\n:toc:\n:sectnums:\n\nbody` | chunk the document | attribute map `{toc:"", sectnums:""}` returned separately; doctitle "Title" is the level-0 heading; body excludes header |
| E2 | kb-asciidoc-chunking / Document-Attribute Header Extraction | EP (invalid class) | L1 | automated | header with `:!sectnums:` and `:attr: value` | chunk | no throw; negated + valued attrs both captured |
| E3 | kb-asciidoc-chunking / Document-Attribute Header Extraction | EP (empty class) | L1 | automated | file `notes.adoc` with no `= Title` first line | chunk | attribute map null; preamble chunk heading is `notes` (extension stripped) |
| E4 | kb-asciidoc-chunking / Document-Attribute Header Extraction | EP (CRLF) | L1 | automated | same document with `\r\n` line endings | chunk twice (LF and CRLF variants) | identical chunks, ids, hashes (parser pure + normalizing) |
| E5 | kb-asciidoc-chunking / Delimited-Block-Safe Section Splitting | decision-table (9 block types) | L1 | automated | a `== Fake Title` line embedded inside each of listing `----`, literal `....`, example `====`, sidebar `****`, quote `____`, passthrough `++++`, open `--`, table `\|===`, comment `////` | chunk each fixture | fake title stays body content; zero extra section boundaries in every block type |
| E6 | kb-asciidoc-chunking / Delimited-Block-Safe Section Splitting | BVA (title level) | L1 | automated | lines `====== L6 ok` and `======= L7 not-a-title` outside blocks | chunk | 6-`=` line starts a section at level 6; 7-`=` line is body content |
| E7 | kb-asciidoc-chunking / Delimited-Block-Safe Section Splitting | EP (empty) | L1 | automated | `== A` immediately followed by `== B` (A has no body) | chunk | no chunk emitted for empty section A |
| E8 | kb-asciidoc-chunking / Chunk Contract Parity (oversize split) | BVA + block-safety | L1 | automated | section > oversize threshold whose only blank lines sit inside a listing block | oversize split runs | split points all outside the block; when no safe point exists, one oversized chunk (never a mid-block split) |
| E9 | kb-asciidoc-chunking / Chunk Contract Parity (tiny merge) | BVA | L1 | automated | section below the tiny threshold followed by a sibling | normalization | tiny section merged using the same threshold constants as the markdown chunker |
| E10 | kb-asciidoc-chunking / Chunk Contract Parity (line anchors) | EP | L1 | automated | fixture with sections at known line numbers | chunk | each chunk's `startLine`/`endLine` equal the fixture's real line ranges |
| E11 | kb-asciidoc-chunking / Xref Link Extraction | EP (3 forms) | L1 | automated | body with `xref:other.adoc[L]`, `xref:other.adoc#frag[L]`, `<<anchor>>` | extract links | `other.adoc` reported twice (fragment stripped); `<<anchor>>` yields nothing |
| E12 | kb-asciidoc-chunking / Xref Link Extraction (graph edges) | EP | L1 | automated | two indexed adoc files, one xrefs the other | index the pair | a graph edge connects them; kb neighbors traversal returns the target |
| E13 | kb-indexing-pipeline / Source directory walk (widened) | decision-table (extensions) | L1 | automated | dir with `a.md`, `b.adoc`, `c.asciidoc`, `d.txt` under **default** config | index | a, b, c indexed; d skipped; b/c chunks show `=`-derived heading paths (adoc chunker dispatched) |
| E14 | kb-indexing-pipeline / Doc-type classification | decision-table | L1 | automated | `packages/x/src/y.adoc` (source-md enabled) and `docs/z.adoc` | classify | y typed `source-md`; z typed `doc` |
| E15 | kb-indexing-pipeline / title fallback | EP | L1 | automated | headerless `guide.asciidoc` | index | meta title falls back to `guide` (extension stripped) |
| E16 | design D3a lock / markdown pipeline unchanged | regression fixture | L1 | automated | existing markdown chunker test fixtures | run existing suite after change | all pass unchanged; markdown chunk ids byte-identical |
| E17 | design D3a / SCHEMA_VERSION bump | state-transition | L1 | automated | store created at previous SCHEMA_VERSION | open store post-change | automatic full reindex path runs; no crash; chunks readable with line-anchor columns |
| E18 | kb-extension-auto-reindex / AsciiDoc edit schedules reindex | state-transition | L1 | automated | `write` tool result with path `doc.adoc` (and `.ASCIIDOC` case variant) | event fires | reindex scheduled for cwd, debounced 800 ms; rapid successive edits collapse to one |
| E19 | kb-extension-auto-reindex / AsciiDoc edit stays nudge-eligible | decision-table (predicate decoupling) | L1 | automated | DOX enforcement on; `.adoc` file lacking a fresh AGENTS.md row | edit it | reindex scheduled AND stale/missing-row nudge sent (both jobs fire) |
| E20 | kb-extension-auto-reindex / md behavior unchanged | regression | L1 | automated | DOX enforcement on; ordinary `.md` edit | event fires | reindex scheduled, no nudge (current complement rule preserved) |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | file-and-url-preview / Headings render hierarchically | computed-style assert | L3 | automated | seeded `.adoc` with `=`/`==`/`===` sections | open preview in dashboard | computed font-size strictly decreasing h1→h2→h3, all > body font-size |
| F2 | file-and-url-preview / Admonition accent card | computed-style assert | L3 | automated | seeded `.adoc` with a `NOTE:` admonition | open preview | `.admonitionblock` has border-left-width ≥ 2px and background-color ≠ page background (block card, not bare table) |
| F3 | file-and-url-preview / frame=none key/value table | computed-style assert | L3 | automated | seeded `.adoc` with `[frame=none,grid=none]` table | open preview | cell border widths 0; cell padding > 0 |
| F4 | file-and-url-preview / stripes=even table | computed-style assert | L3 | automated | seeded `.adoc` with `[stripes=even]` table + header row | open preview | even-row background ≠ odd-row background; header-row background ≠ body rows |
| F5 | file-and-url-preview / TOC panel styled when declared | computed-style assert | L3 | automated | seeded `.adoc` declaring `:toc:` with nested sections | open preview | `#toc` present with distinct background/border; nested list items have greater padding/margin-left than parents |
| F6 | file-and-url-preview / Colors from theme variables | state-transition (theme switch) | L3 | automated | adoc preview open | switch active theme | `.asciidoc-body` heading color changes to the new theme's resolved value without reload |
| F7 | file-and-url-preview / prose classes removed | component render assert | L1 | automated | render AsciiDocPreview + DocxPreview (html mode) with stub HTML | inspect wrapper | className contains `asciidoc-body`, contains neither `prose` nor `prose-invert` |
| F8 | file-and-url-preview / Docx html-mode shares typography scope | component render assert | L1 | automated | DocxPreview html-mode with stub sanitized HTML | inspect wrapper | output wrapped in the same `.asciidoc-body` scope |
| F9 | file-and-url-preview / overall visual fidelity | visual/subjective | — | manual-only | real-world AsciiDoc document across several themes (dark + light) | human reviews rendered preview | [judgment: layout matches validated mockup quality — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | kb-asciidoc-chunking / parser totality | fault-injection (malformed input) | L1 | automated | listing block opened `----` never closed; stray delimiters; 0-byte file | chunk each | no throw; mis-closed block degrades to fewer/larger chunks; empty file yields zero chunks |
| X2 | kb-extension-auto-reindex / reindex failure swallowed | fault-injection (abort) | L1 | automated | reindex promise rejects on an `.adoc` edit | debounce fires | warning logged; session does not crash (existing md scenario extended to adoc) |

### Performance

None — the delta specs state no latency/throughput thresholds; reindex cost is bounded by the existing debounce + hash gate (covered by E18/E16 regression, not a perf scenario).

---

## Coverage summary

- Requirements covered: 8/8 delta requirements (4 kb-asciidoc-chunking, 1 kb-indexing-pipeline, 1 kb-extension-auto-reindex, 1 file-and-url-preview, + design locks D3a/SCHEMA_VERSION)
- Scenarios by class: edge 20 · perf 0 · frontend 9 · error 2
- Scenarios by level: L1 24 · L2 0 · L3 6 · manual 1
- Scenarios by disposition: automated 30 · manual-only 1

## New infra needed

None — L1 rows extend existing vitest suites in `packages/kb/src/__tests__/` and `packages/kb-extension/`; L3 rows extend the existing Playwright harness (`tests/e2e/`), which already supports seeding workspace files out-of-band.
