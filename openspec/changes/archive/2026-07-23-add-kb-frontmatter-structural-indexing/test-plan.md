# Test Plan — add-kb-frontmatter-structural-indexing

Stage: design   Generated: 2026-07-24

Resolved clarifications (HARD gate, now closed):
- Facet counts = **distinct files**; array duplicates within one file de-dup to a
  single `(path,key,value)` row.
- Perf bounds: full reindex **≤ 25%** added wall-time vs pre-change on the same
  corpus; one `eq`/`in` filter adds **≤ 25ms p95** vs the same query unfiltered.

All scenarios are pure-logic / in-process (parser, store, indexer, config) → L1
vitest. No rendered-UI surface → no L3. No subjective observable → no manual-only.
Exemplar for L1 unit + store/indexer integration: `packages/kb/src/__tests__/kb.test.ts`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Frontmatter Extraction | BVA (line ending) | L1 | automated | `---\r\n title: X \r\n---\r\n# H` | chunkMarkdown | frontmatter detected; `title=X`; body starts at `# H` (identical to LF form) |
| E2 | Frontmatter Extraction | EP (block list) | L1 | automated | `tags:\n  - a\n  - b` | parse | frontmatter.tags = `["a","b"]` |
| E3 | Frontmatter Extraction | EP (scalar types) | L1 | automated | `draft: true`, `n: 42`, `s: hi` | parse | `draft`===true (bool), `n`===42 (number), `s`==="hi" (string) |
| E4 | Structured properties store | BVA (numeric strict) | L1 | automated | key `version` declared numeric; `1.0` vs `1.0.0` | index | `1.0`→value_num=1.0; `1.0.0`→value_num null, stays string |
| E5 | Structured properties store | BVA (date strict) | L1 | automated | key `date` declared date; `2024-01-05` vs `2024-01` | index | `2024-01-05`→value_date set; `2024-01`→value_date null, string |
| E6 | Frontmatter Extraction | error-guard | L1 | automated | `body: \|\n  multi\n  line` (unsupported) | parse | key skipped or raw string; NO throw |
| E7 | Frontmatter Extraction | EP (malformed) | L1 | automated | `---\ntitle: X` (no closing `---`) | parse | frontmatter=null; whole text used as body |
| E8 | Machine namespace exclusion | EP | L1 | automated | top-level `kb:\n  entity: Foo` + `title: T` | index | no meta/property/edge from under `kb:`; `title` still indexed |
| E9 | Structured properties store | dedup | L1 | automated | one file `tags: [x, x]` | index | exactly one `(path,tags,x)` property row |
| E10 | Searchable metadata via synthetic meta chunk | state | L1 | automated | file `title: Widget Guide`, body `# Other` | index + search "Widget Guide" | file returned; hit.headingPath === "Widget Guide"; ranks ≥ a body-only match |
| E11 | Searchable metadata via synthetic meta chunk | EP (empty) | L1 | automated | file with no searchable keys | index | no `<sha>:meta` chunk exists for that path |
| E12 | Role-based frontmatter routing | EP | L1 | automated | `tags: [red]`, `title: T` | index | `tags` NOT in meta chunk body; `red` present as a facet row |
| E13 | Chunk & Tier-1 graph extraction (docType mirror) | EP | L1 | automated | any indexed file, docType=agents | index | property row `(path, docType, agents)` exists; facets(['docType']) counts it |
| E14 | Property-filtered search | decision-table | L1 | automated | 3 files, statuses `[approved,draft,approved]` | search filter `eq status=approved` | exactly the 2 approved files returned, intersected with FTS hits |
| E15 | Property-filtered search | BVA (range) | L1 | automated | files `date` in {2024-01-01,2024-06-01,2025-01-01} | filter `gte 2024-06-01` | the two ≥ bound returned; earlier excluded |
| E16 | Property-filtered search (param binding) | security | L1 | automated | filter value `x' OR '1'='1` | search | treated as literal (0 matches); query not altered; no error |
| E17 | Property-filtered search (no-op) | EP | L1 | automated | a query with no filters/facets | search vs pre-change baseline | hits, order, snippets byte-identical to baseline |
| E18 | Facet aggregation | EP | L1 | automated | tag `x` in files A(`[x,x]`),B,C | facets(['tags']) | `x` → 3 (distinct files, within-file dup counts once) |
| E19 | Schema version gate | state-transition | L1 | automated | store with `user_version` < current | open/index | full reindex forced; meta chunks + properties populated; version stamped |
| E20 | Schema version gate / facet-config hash | state-transition | L1 | automated | unchanged corpus, facet-config changed | open/index | forced reindex; new config hash stored |
| E21 | Orphan removal (no dup rows) | idempotence | L1 | automated | index a file, edit it, reindex | reindex | prior property rows + old meta chunk removed; no duplicate property rows |
| E22 | Orphan removal | state | L1 | automated | index file then delete it on disk | reindex | its chunks, meta chunk, property rows, edges, file-state all pruned |
| E23 | Frontmatter facet configuration | validation | L1 | automated | config declares facet key type `bogus` | loadConfig | validation error with descriptive message |
| E24 | Frontmatter facet configuration | EP (defaults) | L1 | automated | no frontmatter config | index | searchable = title/description/aliases/keywords; tags faceted; tag→has_tag preserved |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Chunk & Tier-1 graph extraction | threshold vs baseline | L1 | automated | fixed fixture corpus (~N md files with frontmatter), full reindex | added wall-time ≤ 25% vs pre-change reindex of same corpus | single run, median of 3 |
| P2 | Property-filtered search | tail-latency delta | L1 | automated | fixed query set on a fixed corpus, one `eq` facet filter | filtered p95 − unfiltered p95 ≤ 25ms | ≥ 200 queries |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Frontmatter Extraction (totality) | fault-injection (adversarial input) | L1 | automated | adversarial frontmatter: random bytes, 100KB single line, deep indentation | parse | returns a map or null; never throws; pure (same bytes → same output) |
| X2 | Property-filtered search | fault-injection (bad key) | L1 | automated | filter on an unconfigured/unknown key | search | empty intersection, no error |
| X3 | Schema version gate (atomicity) | fault-injection (interrupt) | L1 | automated | forced reindex interrupted mid-run on first index | reopen | existing atomic-first-index invariant holds; no partial target DB with orphan meta/property rows |

---

## Coverage summary

- Requirements covered: 12/12 (all ADDED/MODIFIED requirements across the 5 specs)
- Scenarios by class: edge 24 · perf 2 · frontend 0 · error 3
- Scenarios by level: L1 29 · L2 0 · L3 0
- Scenarios by disposition: automated 29 · manual-only 0

## New infra needed

- none — all scenarios run in the existing `packages/kb` vitest tier. P1/P2 need a
  small fixed fixture corpus + a captured pre-change baseline (added as test
  fixtures, not new harness).
