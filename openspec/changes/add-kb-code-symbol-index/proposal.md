# Index code symbols into the Tier-1 knowledge-base graph

> **SUPERSEDED by `add-codegraph-code-plane` — do not implement.** The
> code plane is now federated to the external CodeGraph tool behind a
> `kb-extension` router (separate store, kb core untouched) instead of absorbed
> into `packages/kb` via embedded tree-sitter. Kept for rationale/history only.
>
> Scope note: the shipped Tier-1 knowledge graph is **deterministic and
> zero-LLM** — `markdown-knowledge-base` mandates *"No LLM extraction SHALL be
> performed."* This change stays inside that contract. Symbol extraction is
> mechanical (parser output), never a model call. It reuses the existing
> `nodes`/`edges` tables, the content-hash incremental gate, and the
> pull-not-push retrieval rule already specified for the KB.

## Why

The KB indexes prose (docs, `AGENTS.md` rows) into FTS5 and builds a Tier-1
graph from *markdown structure only*. It cannot answer the most common
code-navigation question an agent has: **"where is method / type / function X
defined, and what calls it?"** Today the agent falls back to `rg` across source,
which is token-expensive, imprecise, and re-run on every lookup.

The `nodes` table already declares an `entity` kind and `edges.rel` is
free-text — the graph is *built to hold typed code symbols* but nothing
populates them. The gap is an extractor, not a schema.

The naive fix — a live LSP server per language per project — fights the LSP
protocol (LSP assumes an editor holding an open document), spawns a daemon zoo
(6 languages × N worktrees), and carries slow warm-ups and stateful crash
management. The cheaper, uniform answer for *navigation* is **tree-sitter tag
queries**: one embeddable grammar per language, milliseconds per file, zero
daemons — the same mechanism aider's repo-map and similar AI tools use.

Precise cross-file references (refactor-grade "every caller of X") genuinely
need resolved semantics (SCIP indexers or live LSP). That is deferred behind
the same `nodes`/`edges` seam so navigation ships now without blocking on it.

The context-safety worry is already answered by KB doctrine: symbols live in
SQLite and are reached **only via `kb_search`** (progressive disclosure). The
model pays zero tokens until it searches, then receives a handful of
`name → path:line` hits. This is strictly additive recall — it cannot bloat a
prompt.

## What Changes

- **Add a tree-sitter symbol extractor** to `packages/kb` that parses source
  files with per-language **tags queries** and emits definition symbols
  (functions, methods, classes, types, interfaces, constants) with their
  `path:line[:col]` position. MVP languages: TypeScript/JavaScript, Python, Go,
  Rust, Java, C/C++.
- **Populate the Tier-1 graph** deterministically: each symbol becomes a
  `nodes` row (`type='symbol'`, `name`, `path`); each definition emits a
  `defined_in` edge to its file node; heuristic same-file/same-name call and
  reference sites emit `references` edges (marked **candidate**, not resolved).
- **Index symbol rows into FTS5** as a new `doc_type='symbol'` so `kb_search`
  returns them alongside docs, filterable by doc type. A hit carries the symbol
  name, kind, and `path:line`.
- **Reuse the content-hash incremental gate**: symbols for a file reindex only
  when its `sha256` changes; deleting a file drops its symbol nodes + outbound
  edges (inbound preserved) — identical to the existing chunk lifecycle.
- **Per-project + global config** under the existing `kb` config layering: a
  `symbols` block selects enabled languages, the extraction engine
  (`tree-sitter` MVP), and ignore globs. Disabled by default → no behavior
  change for repos that don't opt in.
- **Settings surface**: a KB settings panel section to toggle symbol indexing
  per language and show symbol-index freshness/health, riding the existing
  KB index-health UI pattern.
- **Deferred behind the `nodes`/`edges` seam** (follow-up changes, no core
  rework): SCIP-based precise cross-references (`scip-typescript`,
  `scip-python`, `scip-go`, `rust-analyzer→SCIP`, `scip-java`, `scip-clang`),
  and optional live-LSP enrichment for on-demand call hierarchy.

## Capabilities

### Added Capabilities

- `code-symbol-index` — deterministic tree-sitter symbol extraction into the
  Tier-1 graph and FTS5, retrieved via `kb_search`, incremental by content
  hash, per-project configurable, LLM-free.

### Modified Capabilities

- `markdown-knowledge-base` — the `doc_type` union gains `symbol`; graph
  `nodes.type` gains `symbol` and `edges.rel` gains `defined_in` / `references`
  (candidate). No change to the zero-LLM or pull-not-push guarantees.

## Discipline Skills

- `performance-optimization` — whole-repo symbol extraction is a large-data
  path; measure per-file parse cost and cold full-index time against a budget.
- `observability-instrumentation` — symbol-index freshness/health must be
  visible (counts, stale files, last-index time) or staleness is invisible.
- `security-hardening` — the opt-in lazy grammar tier fetches executable WASM;
  SHA-256 pinning, the opt-in gate, content-addressed cache, and the WASM
  sandbox assumption need an audit.
- `doubt-driven-review` — the engine choice (tree-sitter vs SCIP vs LSP) and the
  `nodes`/`edges` seam are near-irreversible architecture; stress-test before it
  stands.
