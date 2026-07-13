# Tasks — add-kb-code-symbol-index

## 1. Extractor core (web-tree-sitter, WASM)
- [ ] 1.1 Add `web-tree-sitter` as an **optional/lazy** dep of `packages/kb` (imported only when `symbols.enabled`); keep `kb` core dep-free → verify: disabled build loads no WASM.
- [ ] 1.2 Vendor core-tier grammar `.wasm` + `<lang>-tags.scm` (from tree-sitter-wasms / tree-sitter-language-pack) for ~15–20 popular langs; NOT authored → verify: files present, licenses recorded.
- [ ] 1.3 Build a **data-driven language registry** `{ext, wasm, tagsScm, tier}`; language detection by extension resolves through it. Adding a lang = one row + two files.
- [ ] 1.4 Wire WASM lifecycle: `Parser.init()` once; cache `Language.load()` per lang; reuse one parser via `setLanguage`.
- [ ] 1.5 Implement `extractSymbols(path, source)` running the tags query; map `name.definition.*`→def, `name.reference.*`→candidate ref; emit {name, kind, line, col} + bounded leading-comment body.
- [ ] 1.6 `asarUnpack` the `.wasm` + `.scm` assets in the Electron build → verify: packaged app resolves a grammar at runtime.
- [ ] 1.7 Lazy-tier fetch: on first encounter of a non-core registered lang, download its `.wasm` and cache locally; offline core unaffected → verify: cache hit on 2nd run.
- [ ] 1.8 Unit tests: one fixture per core lang, assert a known def is found at the right line → verify: `npm test` green.
- [ ] 1.9 Tags-gate test: a registered parse-only lang (`tagsScm: null`) yields zero symbols, no error.

## 2. Graph + FTS5 write path
- [ ] 2.1 Insert one `type='symbol'` node per bare name (node = concept); model duplicate/overloaded defs as N distinct `defined_in` edges each carrying `path:line` → verify: two files defining same name = 1 node + 2 edges, no `UNIQUE(type,name)` collision.
- [ ] 2.2 Emit `defined_in` (symbol→file, w/ line) edges and candidate `references` edges labeled `references:candidate` (unresolved).
- [ ] 2.3 Index symbol chunks with `doc_type='symbol'`; a hit resolves to `path:line`.
- [ ] 2.4 Tests: `kb_search("<sym>")` returns name+kind+position; doc-type filter works.
- [ ] 2.5 Add `find_symbol(name, kind?, lang?)` querying `nodes`/`edges` directly (exact/qualified match, NOT BM25) → returns def `path:line` + candidate callers.
- [ ] 2.6 Register `find_symbol` as a `pi.registerTool()` in `kb-extension` with a `promptSnippet`; deterministic-top-result test.

## 3. Incremental lifecycle (reuse files gate)
- [ ] 3.1 Skip unchanged sha; replace symbols on changed file; drop nodes-as-source + outbound edges on delete, preserve inbound.
- [ ] 3.2 Tests mirror existing chunk-lifecycle tests for the symbol path.
- [ ] 3.3 Per-root scoping: symbols never span roots/worktrees; a monorepo's cross-package same-name defs carry package/path on the edge → verify: 1 node / 2 defined_in edges w/ distinct package/path; separate-worktree graphs stay disjoint.

## 4. Config
- [ ] 4.1 Add `symbols` block to kb config schema (enabled=false, engine, allowDownload=false, languages, ignore).
- [ ] 4.2 Disabled-by-default no-op test: index output identical to pre-feature.
- [ ] 4.3 Ignore-glob exclusion test.
- [ ] 4.4 Lazy-tier integrity: registry pins a SHA-256 per downloadable grammar; fetched `.wasm` verified, refused on mismatch; content-addressed cache → verify: bad-hash rejection test + offline-default (allowDownload=false) fetches nothing.

## 5. Settings + observability
- [ ] 5.1 KB settings panel section: per-language toggles.
- [ ] 5.2 Freshness readout: symbol count, stale count, last-index time (reuse index-health UI).

## 6. Discipline gates
- [ ] 6.1 performance-optimization: measure + record vs committed budget — disabled=0 (no WASM load), warm reindex (1 file) <50ms, per-file p95 (<2k LoC) <25ms, cold full index (~5k files) <30s single-thread WASM.
- [ ] 6.2 observability-instrumentation: emit symbol-index counts/timing to the health surface.
- [ ] 6.3 security-hardening: lazy-grammar download is executable-code fetch — audit SHA-pinning, opt-in gate, content-addressed cache, WASM sandbox assumptions.
- [ ] 6.4 doubt-driven-review: stress-test the tree-sitter-vs-SCIP/LSP engine choice, the WASM lazy-fetch reproducibility tension, and the nodes/edges seam before it stands.

## 7. Docs
- [ ] 7.1 Add `code-symbol-index` row to `packages/kb/AGENTS.md`; note `doc_type='symbol'`, `defined_in`/`references` rels. (Delegate any `docs/` prose per caveman rule.)

## Deferred (follow-up changes, behind the same seam — NOT this change)
- [ ] SCIP phase: per-language indexers (scip-typescript/python/go, rust-analyzer→SCIP, scip-java, scip-clang) parse SCIP protobuf → **upgrade** `references:candidate` edges to `references:resolved` for covered langs; tree-sitter candidates remain the fallback for uncovered langs. Additive, per-language, zero schema change (`edges.rel` free-text). Opt-in (per-language toolchain cost).
- [ ] Optional live-LSP enrichment for on-demand call hierarchy (incomingCalls), behind the same `nodes`/`edges` seam.
