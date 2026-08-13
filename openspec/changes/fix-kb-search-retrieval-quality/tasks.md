## 1. Measurement baseline (land first — no behaviour change)

- [x] 1.1 Add `distinctSourcesAtK`, `duplicateSlotShare`, and `singleSourcePageRate` to `EvalMetrics` in `packages/kb/src/eval.ts`; compute them over the same top-K window as the ranking metrics
- [x] 1.2 Write failing tests for the three redundancy metrics (all-distinct page → share 0; all-one-source page → share (K-1)/K and singleSourcePageRate 1)
- [x] 1.3 Add the markdown-intent golden fixture (101 `query → expected path` pairs) under `packages/kb/src/__tests__/fixtures/`
- [x] 1.4 Add the source-intent golden fixture (84 pairs whose targets are source files reached via their `AGENTS.md` record)
- [x] 1.5 Write a fixture provenance header documenting derivation from implicit click feedback in session transcripts and the known bias toward searches that produced an opened file
- [x] 1.6 Record the pre-change baseline for both fixtures (P@1, P@5, Recall@K, MRR, nDCG@K, redundancy metrics) in the change folder as the regression reference

## 2. Source-level dedup and result limit (D1, D2, D6)

- [x] 2.1 Write failing tests: one hit per `(root, path)`; representative is the best-scoring chunk; suppressed count reported; zero when a source matches once
- [x] 2.2 Write a failing test that source dedup runs AFTER exact-content dedup, so cross-root duplicates still populate `akaPaths`
- [x] 2.3 Add `suppressedSections` (or equivalent) to `KbHit` in `packages/kb/src/types.ts`
- [x] 2.4 Implement source-level dedup in `SqliteFtsStore.search()`, ordered body-hash collapse → source dedup
- [x] 2.5 Add a `sourceDedup` config flag (default on) and honour it in `SearchOpts`
- [x] 2.6 Change the candidate fetch to scale with `limit` (multiple of `limit`, bounded by the existing 4000 ceiling); write a test asserting the pool exceeds `limit`
- [x] 2.7 Write a latency test asserting a default search over the fixture index completes within the 50 ms budget
- [x] 2.8 Re-run both fixtures; confirm Recall@K rises and duplicate-slot share falls versus the 1.6 baseline

## 3. Condensed render (D5)

- [x] 3.1 Write failing tests for `renderHits`: leaf heading only, no full breadcrumb, suppressed-section marker present when count > 0 and absent when 0
- [x] 3.2 Implement the leaf-heading + `(+N more sections)` render in `packages/kb/src/render.ts`, keeping the CLI and tool forms parameterised as today
- [x] 3.3 Keep `headingPath` intact in the JSON format and in `KbHit` so `kb_get(path, section)` addressing still works; test both formats
- [x] 3.4 Measure rendered page size across the fixture queries and assert it does not exceed the pre-change mean

## 4. Document-type lane quota (D3)

- [x] 4.1 Write failing tests: agents hits appear without a `docType` filter; explicit `docType` bypasses the quota; a starved lane yields its slots; share of zero disables the quota
- [x] 4.2 Add the lane-share config field (`ranking.laneQuota` or equivalent) with the measured 6/4 default, documented as untuned
- [x] 4.3 Implement two-lane retrieval and interleave in `search()`
- [x] 4.4 Re-run both fixtures; confirm the source-intent set improves and the markdown-intent set does not regress beyond the recorded loss budget
- [x] 4.5 Sweep the lane share over the fixtures and record the curve; keep or revise the default based on the result

## 5. PRF expansion and coverage rerank (D4 — must land after 4)

- [x] 5.1 Write failing tests for coverage rerank: broader IDF-weighted coverage outranks concentrated repetition; BM25 breaks ties; disabling restores BM25 order
- [x] 5.2 Implement IDF-weighted coverage reranking over the candidate pool
- [x] 5.3 Write failing tests for PRF: feedback terms are mined from a first pass, exclude query terms, exclude terms above the corpus-frequency ceiling, and are bounded in count
- [x] 5.4 Implement PRF inside `expandQuery`, replacing the pass-through stub and its stale "handled by callers" comment
- [x] 5.5 Write a failing test that PRF is skipped when coverage rerank is disabled
- [x] 5.6 Make coverage rerank weight the ORIGINAL query terms above appended terms; test that expansion cannot dominate the sort
- [x] 5.7 ~~Change the `queryExpansion` default to `prf`~~ **REVERSED ON EVIDENCE**: default stays `off` and `ranking.coverageRerank` ships `false`. D4 measured a net regression on the re-mined fixtures (markdown R@10 0.630→0.509 vs source P@5 0.337→0.481); both stages are implemented, tested and config-gated. Spec delta + proposal updated to match. See `measurements.md`
- [x] 5.8 Re-ran both fixtures. Combined stack does NOT beat the D3 line (0.533 vs 0.566) → not enabled by default. The SHIPPED stack does beat the 1.6 baseline: combined R@10 0.363→0.566, duplicate-slot share 0.48→0.00
- [x] 5.9 N/A — no per-source cap was implemented. Source dedup keeps exactly one hit per `(root, path)`, so the fitted-cap risk the design flagged does not arise

## 6. `kb_get` truncation (D7 — independent)

- [x] 6.1 Write a failing test: a path-only fetch against a multi-chunk file must not return a single section with no indication others exist
- [x] 6.2 Implement the non-silent path-only fetch in `getChunk`
- [x] 6.3 Surface the behaviour in the `kb_get` tool and the `kb get` CLI; update the tool description

## 7. `dox lint` source-file coverage (D9 — independent)

- [x] 7.1 Write failing tests: an undocumented source file in a covered directory reports `missing`; a file with a `<file>.AGENTS.md` sidecar does not; declaration/test/spec files and excluded trees never report
- [x] 7.2 Implement the source-file arm as a set difference over `sourceFiles()` and `parseRowPaths()` in `packages/kb/src/dox.ts`
- [x] 7.3 Make the arm independently enableable so an existing tree can adopt it incrementally
- [x] 7.4 Run it over this repo, record the finding count, and confirm it does not red-wall CI by default

## 8. Tool contract and consumers (BREAKING)

- [x] 8.1 Update the `kb_search` tool description: leaf-heading shape, suppressed-section marker, `limit` bounds distinct sources; remove the "prefer 2–5 terms" advice the ranking does not reward
- [x] 8.2 Audit `kb-plugin` and the `kb search` CLI for assumptions that `limit` counts chunks; fix any found
- [x] 8.3 Update `packages/kb/src/AGENTS.md`, `packages/kb-extension/src/AGENTS.md`, and the affected sidecars with purpose rows and `See change:` markers
- [x] 8.4 Delegate a DocScribe pass for `docs/architecture.md` (retrieval pipeline: lanes, dedup order, expansion) in caveman style

## 9. Discipline gates

- [x] 9.1 `limit` semantics + condensed shape reviewed before landing: full `headingPath` retained in `KbHit` and the json format so `kb_get(path, section)` still addresses a section; tool description states both changes; `kb-plugin` audited (never calls `store.search()`)
- [x] 9.2 `performance-optimization` on the fetch-depth change: measure, state the budget, confirm the 50 ms assertion holds on the real index
- [x] 9.3 `@review` subagent reviewed the full diff. 1 blocking (spec/default drift — resolved by updating the artifacts), plus a real IDF stemming bug and 3 vacuous tests, all fixed in be89177fc
- [x] 9.4 `npm run quality:changed` clean

## 10. Verification

- [x] 10.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` green
- [x] 10.2 Recorded in `measurements.md`. markdown R@10 0.537→0.630, source 0.183→0.500, MRR up on both, duplicate-slot share 0.48→0.00 on both
- [x] 10.3 Ran 3 real fixture queries through the rendered tool output: 10/10 distinct sources on every page, leaf headings, AGENTS records surfacing via the lane. No page dominated by one source.
- [ ] 10.4 QA (post-merge, manual): restart the dashboard and confirm `kb_search` in a live session. Deferred deliberately — the running dashboard loads the MAIN repo checkout, so restarting it from this worktree would exercise unchanged code and disrupt live sessions. Verify after merge to develop.
- [x] 10.5 `follow-ups.md` records 7 deferred items incl. the explicit DO-NOT-repoint-ab-context finding, `expandParent` (~180ms, the real latency lever), and dead `mmr()`.
