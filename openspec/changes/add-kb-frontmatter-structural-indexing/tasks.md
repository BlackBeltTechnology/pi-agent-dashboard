## 1. Vendored YAML-subset parser

- [ ] 1.1 Add a new zero-dependency parser module in `packages/kb/src/` (e.g. `frontmatter.ts`): CRLF→LF normalize, detect `---\n…\n---`, parse `key: scalar`, inline `[a,b]`, block `- item` lists, bool/int/float, `YYYY-MM-DD`, `#` comments, quotes. Total (never throws) + pure.
- [ ] 1.2 Special-case a top-level `kb:` key: consume and discard its entire indented subtree; never emit it in the returned map.
- [ ] 1.3 Replace the line-regex `parseFrontmatter` in `chunker.ts` with the new parser; keep the `{ body, fm }` contract so existing chunking is unaffected.
- [ ] 1.4 Count files whose frontmatter failed to parse and expose the count in index stats (observability).

## 2. Store schema + reindex plumbing

- [ ] 2.1 Add `properties(root, path, key, value, value_num, value_date, value_raw)` DDL + indexes `idx_props_kv(key,value)`, `idx_props_path(root,path)` in `sqlite-store.ts` (`CREATE … IF NOT EXISTS`; `chunks`/`nodes`/`edges` DDL untouched).
- [ ] 2.2 Add a `SCHEMA_VERSION` const + `PRAGMA user_version` read/stamp and a stored facet-config hash; on index-open, force full reindex when either is stale, then stamp.
- [ ] 2.3 Extend `deleteByPath` to also delete the path's synthetic meta chunk and its `properties` rows (delete+reinsert-per-path contract).
- [ ] 2.4 Add `properties` write + dedup helper (`(path,key,value)` stored at most once) and a `facets(keys, filters?)` method (COUNT DISTINCT path).

## 3. Indexer emit

- [ ] 3.1 In `indexer.ts`, emit one synthetic meta chunk per file via existing `insertChunk`: `chunkId=<sha>:meta`, `title`→heading/heading_path, `description`+`aliases`+`keywords`→body (`tags` excluded); skip when no searchable key present.
- [ ] 3.2 Write `properties` rows for whitelisted facet keys (arrays → one row per distinct element); skip anything under `kb:`.
- [ ] 3.3 Mirror `docType` into `properties` (one row/file) so it is uniformly facetable.
- [ ] 3.4 Keep graph emit exactly `tags → has_tag`; do NOT widen `edges.rel` or `GraphNode.type`.

## 4. Query surface

- [ ] 4.1 Add `SearchOpts.filters?: Array<{key, op:'eq'|'in'|'gte'|'lte', value|values}>` to `types.ts`.
- [ ] 4.2 Apply filters in `search()` as an EXISTS subquery over `properties` intersecting FTS hits by `(root,path)`; `eq`/`in`→normalized `value`, `gte`/`lte`→`value_num`/`value_date` by declared type.
- [ ] 4.3 Bind ALL filter values as `?` parameters (never string-interpolated); no filters ⇒ query/output byte-identical to today.

## 5. Config

- [ ] 5.1 Add frontmatter config to `config.ts`: searchable-key list (default `title,description,aliases,keywords`), facet-key whitelist with optional declared type (string default / number / date), per-doc-type overrides.
- [ ] 5.2 Validate the frontmatter config (unknown type / malformed list → descriptive error); include it in the facet-config hash (task 2.2).

## 6. Tests (folded from test-plan.md — L1 vitest; exemplar `packages/kb/src/__tests__/kb.test.ts`)

- [ ] 6.1 CRLF frontmatter detected identically to LF. Triple: `---\r\ntitle: X\r\n---\r\n# H` · chunkMarkdown · fm detected, title=X, body at `# H`. (test-plan #E1)
- [ ] 6.2 Block list parsed to array. Triple: `tags:\n  - a\n  - b` · parse · tags=["a","b"]. (test-plan #E2)
- [ ] 6.3 Scalar type coercion. Triple: `draft: true`,`n: 42`,`s: hi` · parse · bool/number/string respectively. (test-plan #E3)
- [ ] 6.4 Declared-numeric strict boundary. Triple: version numeric; `1.0` vs `1.0.0` · index · value_num set only for `1.0`. (test-plan #E4)
- [ ] 6.5 Declared-date strict boundary. Triple: date; `2024-01-05` vs `2024-01` · index · value_date set only for full date. (test-plan #E5)
- [ ] 6.6 Unsupported construct → string fallback, no throw. Triple: multiline `|` value · parse · key skipped/raw, no exception. (test-plan #E6)
- [ ] 6.7 Malformed frontmatter → fm null, whole text body. Triple: no closing `---` · parse · fm=null. (test-plan #E7)
- [ ] 6.8 `kb:` subtree excluded. Triple: top-level `kb:` + `title` · index · nothing emitted from under kb:, title still indexed. (test-plan #E8)
- [ ] 6.9 Within-file array dedup. Triple: `tags: [x, x]` · index · exactly one `(path,tags,x)` row. (test-plan #E9)
- [ ] 6.10 Synthetic meta chunk + title ranking. Triple: `title: Widget Guide`, body `# Other` · search "Widget Guide" · file returned, headingPath=title, ranks ≥ body-only match. (test-plan #E10)
- [ ] 6.11 No searchable keys → no meta chunk. Triple: file w/o searchable keys · index · no `<sha>:meta` chunk. (test-plan #E11)
- [ ] 6.12 tags excluded from meta body, present as facet. Triple: `tags:[red]`,`title:T` · index · red not in meta body, red is a facet row. (test-plan #E12)
- [ ] 6.13 docType mirrored to properties. Triple: docType=agents file · index · `(path,docType,agents)` row; facets(['docType']) counts it. (test-plan #E13)
- [ ] 6.14 eq/in filter intersect. Triple: statuses [approved,draft,approved] · filter eq status=approved · only the 2 approved returned. (test-plan #E14)
- [ ] 6.15 Range filter on typed date key. Triple: dates {01-01,06-01,next-01} · filter gte 2024-06-01 · two ≥ bound returned. (test-plan #E15)
- [ ] 6.16 Filter param binding (injection guard). Triple: filter value `x' OR '1'='1` · search · treated as literal, 0 matches, no error. (test-plan #E16)
- [ ] 6.17 No-filter no-op parity. Triple: query w/o filters · search · hits/order/snippets byte-identical to baseline. (test-plan #E17)
- [ ] 6.18 Facet counts = distinct files. Triple: tag x in A(`[x,x]`),B,C · facets(['tags']) · x→3. (test-plan #E18)
- [ ] 6.19 Schema-version gate forces reindex. Triple: user_version < current · open/index · forced reindex, meta+properties populated, version stamped. (test-plan #E19)
- [ ] 6.20 Facet-config-hash change forces reindex. Triple: unchanged corpus, config changed · open/index · forced reindex, new hash stored. (test-plan #E20)
- [ ] 6.21 Reindex no duplicate rows. Triple: index→edit→reindex · reindex · old property rows + meta chunk removed, no dups. (test-plan #E21)
- [ ] 6.22 Orphan removal prunes new structures. Triple: index then delete file · reindex · chunks+meta+properties+edges+state pruned. (test-plan #E22)
- [ ] 6.23 Invalid frontmatter config rejected. Triple: facet type `bogus` · loadConfig · descriptive validation error. (test-plan #E23)
- [ ] 6.24 Defaults when no config. Triple: no frontmatter config · index · default searchable/facet keys, tag→has_tag preserved. (test-plan #E24)
- [ ] 6.25 [perf] Reindex overhead bound. Triple: fixed fixture corpus · full reindex · added wall-time ≤ 25% vs pre-change baseline (median of 3). (test-plan #P1)
- [ ] 6.26 [perf] Filtered-search latency bound. Triple: fixed query set, one eq filter · search · filtered p95 − unfiltered p95 ≤ 25ms over ≥200 queries. (test-plan #P2)
- [ ] 6.27 [error] Parser totality on adversarial input. Triple: random bytes / 100KB line / deep indent · parse · returns map|null, never throws, pure. (test-plan #X1)
- [ ] 6.28 [error] Filter on unknown key. Triple: filter unconfigured key · search · empty intersection, no error. (test-plan #X2)
- [ ] 6.29 [error] Forced-reindex atomicity. Triple: interrupt forced reindex on first index · reopen · atomic-first-index invariant holds, no partial DB. (test-plan #X3)

## 7. Validate

- [ ] 7.1 `npm test 2>&1 | tee /tmp/pi-test.log` — all kb tests green (tee→grep for FAIL/Error).
- [ ] 7.2 Run `review-code` on the diff before commit (security-hardening already covered by 6.16; observability by 1.4; performance by 6.25/6.26).
- [ ] 7.3 `openspec validate --changes add-kb-frontmatter-structural-indexing` passes; verify a legacy-schema DB reindexes once on open and search output is unchanged when no filters are passed.
