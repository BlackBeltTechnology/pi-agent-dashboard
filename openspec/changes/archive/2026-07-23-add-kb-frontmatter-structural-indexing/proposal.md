# Add structural (deterministic) frontmatter indexing to the knowledge base

## Why

The kb chunker parses frontmatter with a line-regex that only sees flat
`key: value` and inline `[a, b]` arrays, and the indexer consumes **only**
`frontmatter.tags` (into `has_tag` graph edges). Every other key — `title`,
`description`, `aliases`, `status`, `author`, `date` — is parsed then discarded.
The block is also **stripped from the body before chunking**, so no frontmatter
value is full-text searchable. There is no way to search by title/description,
filter by `status`/`docType`/`author`, range-query dates, or get facet counts.

This is the **deterministic, zero-LLM** half of frontmatter handling. It is
distinct from and upstream of the in-flight `add-kb-semantic-annotation-plane`
change: structural indexing *consumes* frontmatter from any source; the semantic
plane *produces* a machine-written `kb:` block. Landing structural indexing first
gives the semantic plane a substrate to write into, and touches none of its
"indexer stays zero-LLM" invariant — this change is 100% deterministic.

Cross-system best practice (Elasticsearch text-vs-keyword, Algolia
searchable-vs-faceting, Pagefind meta/filter/sort, Obsidian typed properties) is
unanimous: frontmatter is not one thing — it plays **three roles** — and each key
must be routed to the role it serves:

| Role | Backing | Query | Example keys |
|---|---|---|---|
| searchable text | weighted FTS column | ranked full-text | `title`, `description`, `aliases`, `keywords` |
| facet / filter | relational key/value (the SQLite analog of an ES `keyword` field) | exact / `IN` / count | `status`, `docType`, `author`, `tags`, `category` |
| sort / range | typed columns on the same table | `>=` / `<=` / `ORDER BY` | `date`, `version`, numeric fields |

A value may serve two roles at once (ES "multi-field") — e.g. `title` is both
searchable text and a sortable key.

## What Changes

- **Typed frontmatter parser** replaces the line-regex in `kb-markdown-chunking`.
  A **vendored, zero-dependency YAML subset** (no `js-yaml` — preserves the repo's
  no-runtime-deps DNA) parses: scalars, inline `[a, b]` and block (`- item`)
  lists, booleans, numbers, and ISO-8601 dates. **Value typing is declared, not
  inferred**: a key is coerced to `value_num`/`value_date` only when config
  declares it numeric/date (validated by strict pattern); every other key stays a
  string. This avoids cross-file facet fragmentation (`version: 1.0` vs `1.0.0`,
  `title: 1984`). The raw string is retained alongside every coerced value.
  **Nested maps are out of scope** — only scalars and arrays-of-scalars feed the
  facet path (avoids an undefined nested→flat row mapping).
- **Searchable metadata → a synthetic "meta chunk" in the existing `chunks`
  table.** The indexer emits one synthetic chunk per file via the existing
  `insertChunk` (no DDL change): `title` → the `heading`/`heading_path` columns
  (so it gets the existing heading weight, above body), `description`+`aliases`+
  `keywords` → the `body` column (**`tags` excluded**, they are facets), stable
  `chunkId = "<fileSha>:meta"`. Chosen over a new `chunks` column (FTS5 cannot
  `ALTER ADD COLUMN`) and over a separate `file_meta` FTS table (its hits are not
  `KbHit`-shaped — they break dedup/proximity/parent-expand and the callers, and
  create an un-normalizable second BM25 corpus). A synthetic chunk is a
  first-class, shape-identical hit that flows through the whole pipeline
  unchanged; a title/description match surfaces the file.
- **Facet/filter/sort → a `properties` table.** New table
  `(root, path, key, value, value_num, value_date, value_raw)` with indexes on
  `(key, value)` and `(root, path)`. Deterministic exact-match, `IN`, and range
  queries plus facet counts via `GROUP BY`. A **configured facet-key whitelist**
  bounds cardinality (high-cardinality unbounded keys are not faceted).
  Normalization: `value` is lowercased/trimmed (filters/facets match `value`),
  `value_date` is canonicalized to a single ISO granularity (avoids mixed-length
  lexical range bugs), and `value_raw` preserves display fidelity.
- **Query surface: `SearchOpts.filters` + facet counts.** `search()` accepts
  structured filters (exact / `IN` / range on normalized `value`) applied via the
  `properties` table alongside the FTS `MATCH`. A `facets()` call returns
  value→count maps for the configured facet keys. Additive-optional —
  `filters`/facets are opt-in; existing `search()` calls are byte-for-byte
  unaffected.
- **Reindex + schema versioning.** `deleteByPath` is extended to also clear a
  path's `file_meta` and `properties` rows (CONTRACT: reindex = delete+reinsert
  per path). A stored `schema_version` bump gates a one-time forced full reindex
  so existing DBs pick up the new tables; `chunks`/`nodes`/`edges` are otherwise
  untouched.
- **No graph-emit change.** `tags → has_tag` stays exactly as shipped. This change
  does **not** generalize graph edges or widen `edges.rel`/`GraphNode.type` —
  typed/relational edges are owned by `add-kb-semantic-annotation-plane`. Keeping
  the graph emit frozen removes all overlap with that change.
- **Config.** New `kb-config-and-init` keys: searchable-meta key list, facet-key
  whitelist (with per-key declared type), and per-doc-type overrides; defaults
  keep behaviour a superset of today (existing `tags → has_tag` unchanged).

## Capabilities

### New Capabilities
- `kb-frontmatter-structural-indexing`: the deterministic pipeline that routes
  each frontmatter key to its role (searchable-text / facet-filter / sort-range),
  the vendored typed YAML-subset parser, the `properties` table + normalization,
  and the `SearchOpts.filters` + facet-count query surface.

### Modified Capabilities
- `kb-markdown-chunking`: Frontmatter Extraction requirement changes from
  line-regex flat parse to the typed vendored YAML-subset parser (block lists,
  bool/number/date typing, raw retained).
- `kb-fts5-search-store`: adds the `properties` table, the `filters`/facet query
  path on `search()` (values bound as `?` params), and a `PRAGMA user_version` +
  facet-config-hash schema gate; searchable meta is a synthetic `chunks` row (no
  new FTS table/column).
- `kb-indexing-pipeline`: writes `file_meta` + `properties` rows per file and
  extends `deleteByPath` to clear them on reindex. Graph emit is **unchanged**
  (`tags → has_tag` only); no `edges.rel`/`GraphNode.type` widening.
- `kb-config-and-init`: adds the searchable-meta key list, facet-key whitelist,
  and per-doc-type override config.

## Impact

- **Code:** `packages/kb/src/chunker.ts` (parser + synthetic meta chunk),
  `packages/kb/src/sqlite-store.ts` (DDL: `properties` table + `user_version`
  gate; `search()` filters + `facets()`; extend `deleteByPath`),
  `packages/kb/src/indexer.ts` (`properties` write, docType mirror),
  `packages/kb/src/config.ts` + `types.ts` (`SearchOpts.filters`, config keys),
  new vendored parser module.
- **Data:** additive schema — **one** new table (`properties`) plus synthetic
  `chunks` rows; no change to `chunks`/`nodes`/`edges` DDL. A `user_version` /
  facet-config-hash gate forces a one-time full reindex on existing DBs.
- **Dependencies:** none added (vendored parser; zero-runtime-deps preserved).
- **Interaction:** upstream substrate for `add-kb-semantic-annotation-plane`;
  the `kb:` namespace boundary keeps the two planes non-overlapping.
- **Non-goals:** no LLM/semantic extraction, no CURIE/ontology vocabulary, no
  controlled-vocabulary normalization beyond case/trim/ISO, **no graph-edge
  generalization** (graph emit stays `tags → has_tag`), and no nested-map facet
  support — those stay in / are deferred to the semantic plane.

## Discipline Skills

- `security-hardening` — filter values from config/CLI flow into SQL; they MUST be
  parameter-bound (injection guard, test #E16/6.16).
- `performance-optimization` — the reindex-overhead and filtered-search latency
  budgets (#P1/#P2) are measured, not asserted.
- `observability-instrumentation` — surface a parse-failure count in index stats
  so silent frontmatter misses are countable (task 1.4).
- `review-code` — run on the diff before commit (task 7.2).
