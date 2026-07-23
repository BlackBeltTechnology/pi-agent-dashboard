# Design — structural frontmatter indexing

## Context

The kb store (`packages/kb`) is a single SQLite file over `node:sqlite` (FTS5),
zero runtime deps, deterministic reindex. Frontmatter today: a line-regex parse
in `chunker.ts:26` (flat `key: value`, inline `[a,b]` only), of which the indexer
consumes only `tags → has_tag` edges (`indexer.ts:152`); the block is stripped
before chunking so nothing is searchable. Schema (`sqlite-store.ts:11`): FTS5
`chunks` + tables `files`, `nodes(UNIQUE(type,name))`, `edges(src,dst,rel)`.
`search()` weights columns via a **positional** `bm25(chunks, 0,0,0,0,0,0,0,
headingPath, heading, body)` and `snippet(chunks, 9, …)`; `insertChunk` has a
hardcoded 10-column `VALUES`. `KbHit` (`types.ts:34`) mandates
`headingPath`/`chunkId`/`snippet`/`docType`; the live agent caller
(`kb-extension/src/extension.ts:103`) spreads the whole hit (`{...h}`) and
`dox.ts:105` renders `h.headingPath` — so any hit that is not chunk-shaped
changes agent-facing output. `search()` also dedups by `body_hash` and runs
proximity/MMR/parent-expand over the hit's body. There is **no schema-migration
runner** — `init()` runs `CREATE … IF NOT EXISTS` once and `PRAGMA user_version`
is never set (`migrate-runner.ts` exists but is a content migration, not schema).

The in-flight `add-kb-semantic-annotation-plane` change owns the machine-written
`kb:` frontmatter block, typed `entity` nodes, and CURIE `edges.rel`, and it also
edits `chunker.ts`/`indexer.ts` and a deterministic "Tier-1a" edge extractor.
This change must not collide with it.

## Goals / Non-Goals

**Goals**
- Frontmatter `title`/`description`/`aliases`/`keywords` become full-text
  searchable, file-level, ranked.
- `status`/`docType`/`author`/`tags`/`date` (+ configured keys) become
  exact/`IN`/range filterable with facet counts.
- 100% deterministic, zero-LLM, zero new runtime deps.
- Additive: existing `chunks`/`nodes`/`edges` and every current `search()` caller
  are byte-for-byte unaffected.

**Non-Goals**
- No LLM/semantic extraction, no CURIE/ontology, no controlled vocabulary.
- **No graph-edge generalization** — emit stays `tags → has_tag`; `edges.rel` and
  `GraphNode.type` unions are not widened (that is the semantic plane's).
- No nested-map facets (scalars + arrays-of-scalars only).
- No per-key weighting inside the searchable-meta field.

## Decisions

### D1 — Searchable meta as a **synthetic "meta chunk" inside the existing `chunks` table**
Rejected: a `meta` **column** on `chunks` (FTS5 has no `ALTER ADD COLUMN`; forces
DROP+rebuild, shifts every positional `bm25()`/`snippet()` arg + `insertChunk`
VALUES). Rejected: a **separate `file_meta` FTS table** UNIONed into results —
its hits are not `KbHit`-shaped (no `chunkId`/`headingPath`/`body_hash`), so they
crash the `body_hash` dedup, the proximity/MMR body ranking, `expandParent`, and
the two callers that assume chunk shape; and a second FTS corpus makes BM25
scores incommensurable with `chunks` (no single weight normalizes across
corpora) with no stable cross-table tie-break.
**Decision:** the indexer emits **one synthetic chunk per file** into the
*existing* `chunks` table via the *existing* `insertChunk` (no DDL change, no
positional shift): stable `chunkId = "<fileSha>:meta"`, `level = 0`,
`parentChunkId = null`, `heading = headingPath = title` (so a title match gets
the existing **heading** weight — above body), `body = "<description> <aliases>
<keywords>"` (`tags` excluded — they are facets), `bodyHash = sha(meta)`. It is a
first-class chunk: single corpus, shape-identical hits, and it flows through
dedup / proximity / MMR / parent-expand and both callers unchanged. A title/desc
match surfaces the file (its `headingPath` is the title) — the intended UX.
*Alternatives:* `chunks` column and `file_meta` table — both rejected above.

### D2 — Facets/filters/sort in a **`properties` EAV table**
```sql
CREATE TABLE IF NOT EXISTS properties (
  root TEXT, path TEXT, key TEXT,
  value TEXT,        -- normalized: lowercased/trimmed (filters/facets match this)
  value_num REAL,    -- set only for keys declared numeric
  value_date TEXT,   -- set only for keys declared date, canonical ISO granularity
  value_raw TEXT     -- original, for display
);
CREATE INDEX IF NOT EXISTS idx_props_kv   ON properties(key, value);
CREATE INDEX IF NOT EXISTS idx_props_path ON properties(root, path);
```
EAV (the SQLite analog of an ES `keyword` field) keeps the facet set open-world
with zero migration per new key. Arrays → one row per element.
*Alternatives:* fixed columns on `files` (migration per key — rejected); JSON1 +
expression indexes (array faceting via `json_each` is awkward — rejected).

### D3 — **Declared** value types, not inferred
Blind inference fragments facets across files (`version: 1.0`→num vs
`1.0.0`→str; `title: 1984`→num). **Decision:** everything is a string unless the
facet-key config declares the key `number` or `date`; then coerce **only** on a
strict full-match pattern, else keep string + record raw. `value` (normalized)
always present for exact/`IN`; `value_num`/`value_date` present only for declared
typed keys, feeding range/sort. Filters and facets match on `value`; `value_raw`
is display-only.
*Alternative:* Obsidian-style inference — rejected for cross-file incoherence.

### D4 — Vendored zero-dep YAML **subset** parser
Preserves the no-runtime-deps DNA. **CRLF is normalized to LF before detection**
(`\r\n`/`\r` → `\n`) so frontmatter detection and results are line-ending
independent (today's `startsWith("---\n")` silently drops CRLF files).
Supported grammar (explicitly bounded): `key: scalar`, inline `[a, b]`, block
list (`- item` lines), `true/false`, integers/floats, `YYYY-MM-DD` dates, `#`
comments, single/double quotes. **Not** supported: anchors/aliases, multiline
block scalars (`|`/`>`), general nested maps, merge keys — encountering them →
the key is skipped (string fallback), never a throw. **`kb:` is special-cased:**
the parser recognizes a top-level `kb:` key and *consumes and discards its entire
indented subtree* (the semantic plane owns it) — it is never emitted as meta or a
property, and does not require nested-map support. The parser is pure and total
(same bytes → same output), satisfying determinism; the boundedness is a
trade-off (see Risks — silent miss). Contract pinned by unit tests enumerating
every grammar case + the `kb:`-skip + CRLF.

### D5 — Emit path & `kb:` boundary
`indexer.ts`, per changed file: (a) emit the synthetic meta chunk (D1) if any
configured searchable key is present; (b) write `properties` rows for whitelisted
facet keys (arrays → one row/element). **`docType` is mirrored into `properties`**
(one row/file) so `facets(['docType'])` and docType filters work uniformly — the
EAV table cannot otherwise see the `chunks.doc_type` column. The `kb:` subtree is
skipped (D4). Graph emit is untouched (`tags → has_tag` only) — no `edges.rel`
or `GraphNode.type` widening, removing every overlap with
`add-kb-semantic-annotation-plane`. The pre-existing `addEdge` name-only node
resolution (`sqlite-store.ts:117`) is inherited unchanged; this change adds no
new node types, so it does not worsen it.

### D6 — Schema versioning + reindex (wired, not assumed)
Use `PRAGMA user_version` (currently 0, never set — distinct from the content
`migrate-runner.ts`). The index-open path gains a check: if
`user_version < SCHEMA_VERSION` **or** the stored facet-config hash differs from
the current config hash, force a full reindex (the existing hash-gate rebuilds
every file, emitting synthetic meta chunks + `properties`), then set
`user_version = SCHEMA_VERSION` and store the new config hash. The config-hash
gate is required because reclassifying a facet key (D3 `string→number`) leaves
stale typed rows that neither structure-version nor per-file content hash would
invalidate. `deleteByPath` is extended to also delete the path's synthetic meta
chunk and its `properties` rows, preserving delete+reinsert-per-path (else
reindex duplicates facet rows).

### D7 — Query surface (parameterized)
`SearchOpts.filters?: Array<{key, op: 'eq'|'in'|'gte'|'lte', value|values}>`.
`eq`/`in` match `properties.value` (normalized); `gte`/`lte` match `value_num` or
`value_date` by the key's declared type. **All filter values are bound as `?`
parameters — never string-interpolated** (the current code interpolates only
`num()`-coerced weights/limit; filter values come from config/CLI and MUST NOT
take that path — SQL-injection guard). Applied as an `EXISTS` subquery
intersecting the FTS hit's `(root,path)`. New `facets(keys, filters?)` returns
`key → {value: count}` via `GROUP BY key, value`, counting over the current
filtered result set (Algolia convention). Both opt-in; omitting `filters` leaves
the current query plan and output byte-for-byte identical.

## Risks / Trade-offs

- **Forced one-time reindex blocks the first `kb_search` after upgrade**
  (`extension.ts:94` awaits `reindexNow` before searching) → mitigated: one-time,
  gated by `user_version`/config-hash, batched (already how reindex works);
  announced/logged. Cross-corpus BM25 risk is **eliminated** by D1 (single
  corpus, not a UNION).
- **Meta chunk ranks as a chunk** (title via heading weight, rest via body) → by
  design: a title/description match surfaces the file. No independent third
  weight, accepted as simpler than an un-normalizable second corpus.
- **EAV row growth on high-cardinality keys** → mitigated: only whitelisted facet
  keys get rows; unbounded keys (e.g. per-doc `id`) are not faceted.
- **Vendored parser drift / silent miss** → an unparseable `title`/`description`
  silently yields no meta chunk (a recall miss on the primary goal). Mitigated:
  bounded grammar + total fallback + enumerated tests, **and** the indexer counts
  files whose frontmatter failed to parse and surfaces the count in index stats
  (observability), so silent misses are countable.
- **Determinism caveats** → JS `toLowerCase()` and FTS5 `unicode61` folding are
  Node/ICU-build dependent; "same bytes → identical structures" holds within one
  Node build, not across ICU versions. CRLF is normalized (D4). `value_date`
  restricted to `YYYY-MM-DD` (lexical `BETWEEN` is correct for equal-format ISO);
  instants deferred.
- **Overlap with semantic plane** → mitigated by D5 (no graph widening, `kb:`
  subtree skipped, no new node types). `GraphNode.type` already contains
  `"entity"` as a shared literal — this change writes none, so it neither owns nor
  touches it; sequencing this change first is cleanest.
- **Declared-type config burden** → mitigated: sensible defaults (`date` for
  `date`/`updated`/`created`; everything else string); numeric declaration is
  opt-in and rarely needed.

## Migration Plan

1. Ship DDL as `CREATE … IF NOT EXISTS` for the **one** new table (`properties`);
   `chunks`/`nodes`/`edges` DDL untouched (meta chunks are ordinary `chunks`
   rows).
2. Set `SCHEMA_VERSION`; wire the index-open check (`user_version` or config-hash
   stale → force full reindex, then stamp). This is the only new plumbing.
3. Rollback: `DELETE FROM chunks WHERE chunk_id LIKE '%:meta'`, `DROP TABLE
   properties`, reset `user_version`. Existing chunks/graph untouched, so search
   degrades to today's behaviour with no data loss.

## Open Questions

- Config-hash scope: hash only the facet-key config (types + whitelist +
  searchable-key list), or the whole kb config? Lean: only the frontmatter-facet
  sub-config, so unrelated config edits don't force a reindex.
- Default searchable-meta key list — `title, description, aliases, keywords`
  proposed; confirm `summary` is aliased to `description`.
- `value_date` v1 is `YYYY-MM-DD` only; confirm deferring full RFC3339 instants
  is acceptable for the first cut.
