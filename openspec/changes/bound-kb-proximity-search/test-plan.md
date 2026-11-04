# Test Plan — bound-kb-proximity-search

Stage: apply   Generated: 2026-11-03

## Resolved decisions (owner 2026-11-03, all recommended answers accepted)

- **C1 = A** — warn denominator M = rows examined by `lane()` across both lanes; the line fires only when at least one row was actually skipped while proximity was applicable (boost on, ≥2 usable terms). `proximityBoost:false` or a <2-term query with budget 0 → no warn. Spec + design updated.
- **C2 = C** — `proximityBudgetMs` `null`/`""` left unpinned (test-only option, unreachable from config); sub-case dropped from E12.
- **C3 = A** — tests spy on global `performance.now`; implementation reads the clock via global `performance.now()` at call time (no module-level alias). Task 3.2 states this.

> Level key here: L1 = `packages/kb/src/__tests__/*.test.ts` (vitest, `pool: forks`). `ci` = release/CI gate scripts. Oracle DFS = test-local copy of the pre-change `walk` with a call budget (never a real hang).
> Harness exemplars (all exist): `packages/kb/src/__tests__/unicode-tokenizer.test.ts` (indexed store + proximity near/far, E16), `packages/kb/src/__tests__/lane-lead.test.ts` (two-lane corpus, raw score assertions), `packages/kb/src/__tests__/helpers/event-loop-lag.ts` (`withEventLoopLag`), `packages/kb/src/__tests__/helpers/lease-worker.mts` + `git-scope-lease.test.ts` (child/worker spawned and killed by a test), `packages/kb/src/__tests__/search-opts.test.ts` (opts key-list guard).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Proximity boost: smallest in-order window (exactness) | differential / property (random EP) | L1 | automated | 20 000 seeded random (query, body) pairs: alphabet of 4 tokens, body 1–25 tokens, query 2–5 terms, duplicate query terms allowed | `proximityDelta(q, body)` vs oracle DFS | strictly equal return value for every pair; 0 mismatches. Oracle self-check: same file asserts oracle == current DFS before task 3.1 lands. Exemplar: `unicode-tokenizer.test.ts` (style), new `proximity-bound.test.ts` |
| E2 | Smallest-window, BVA on window span | BVA | L1 | automated | body with query `a b` at distances span = 1, 2, 39, 40, 41 tokens (filler tokens between) | `proximityDelta("a b", body)` | returns `-(2 − 1/20)=-1.95`, `-1.9`, `-0.05`, `0`, `0` (clamp at `max(0, 2 − best/20)`; 40 and 41 both give 0) |
| E3 | Smallest-window: picks min over several chains | EP | L1 | automated | body `a x x x x b x a b` (first chain span 5, later chain span 1) | `proximityDelta("a b", body)` | `-1.95` (span 1, not 5) |
| E4 | Repeated query terms / equal positions preserved | decision table (dup × position) | L1 | automated | (a) query `foo foo`, body has one `foo`; (b) query `foo foo bar`, body `foo bar`; (c) query `foo foo`, body w/o `foo` | `proximityDelta` | (a) span 0 → `-2`; (b) `foo`@0 twice (equal pos allowed), `bar`@1 → `-1.95`; (c) `0` (missing term) — all identical to oracle DFS |
| E5 | Body missing any query term → no change | EP | L1 | automated | query `alpha beta gamma`, body contains alpha, beta only | `proximityDelta` | returns exactly `0` |
| E6 | Order matters (query order, not unordered window) | decision table (order × presence) | L1 | automated | query `a b`; body (i) `b a`, (ii) `b a b` | `proximityDelta` | (i) `0` (no non-decreasing chain); (ii) `-1.95` (a@1, b@2). Guards the rejected sliding-window alternative |
| E7 | <2 query terms → no proximity change | BVA (0,1,2 terms) | L1 | automated | queries `""`, `alpha`, stopword-only `the of` filtered to ≤1 term | `proximityDelta` and `store.search` | delta `0`; hit scores equal `proximityBoost:false` scores |
| E8 | Greedy early-exit correctness | EP + boundary | L1 | automated | (a) body where first `q0` has no admissible successor but later `q0`s also don't (`a b` vs body `b b a`); (b) body with `q0` occurrences after the last `q1` | `proximityDelta` | (a) `0`; (b) result equals span from the last viable `q0` only; both match oracle |
| E9 | Budget exhausted mid-list → remaining rows plain BM25 | decision table (budget × rows) + fake clock | L1 | automated | corpus of ≥8 docs ranking in distinct BM25 order, each with a proximity-sensitive body; `performance.now` spied so every `proximityDelta` call measures exactly 100 ms; `proximityBudgetMs: 250` | `search(q, {proximityBoost:true, proximityBudgetMs:250, limit:8})` | exactly the first 3 BM25-ordered rows carry boosted scores (`bm25 + Δ`); rows 4..N have `score === bm25` (== score from `proximityBoost:false`); hit count identical to `proximityBoost:false`; no throw. Exemplar: `lane-lead.test.ts` (score assertions) |
| E10 | Budget zero → every row plain BM25 | BVA (budget = 0) | L1 | automated | same corpus as E9 | `search(q, {proximityBoost:true, proximityBudgetMs:0})` | every `hit.score` equals the score under `proximityBoost:false`; same paths, same count; no throw |
| E11 | Budget counts proximity time only, summed across both lanes | state-convergence + fake clock | L1 | automated | two-lane corpus (doc rows + `AGENTS.md` rows, `lane-lead.test.ts` style); fake clock: each `proximityDelta` pair costs 100 ms, between-call time (dedup/MMR) jumps +10 000 ms; `proximityBudgetMs:250` | `search` | (a) between-call jumps do NOT exhaust the budget (3 rows boosted, not 0); (b) the 3-row allowance is shared: if main lane consumed it, agents-lane rows all score plain BM25 (Δ = 0) |
| E12 | Budget coercion via `num()` to `[0, 60000]` | EP + BVA | L1 | automated | `proximityBudgetMs` ∈ {`-5`, `0`, `NaN`, `Infinity`, `60001`, `undefined`, `"abc"`} with the pathological-free corpus of E9 | `search` | no throw in any case; `-5` ≡ `0` (all plain BM25); `NaN`/`Infinity`/`"abc"`/`undefined` ≡ default 250 (rows boosted); `60001` ≡ `60000` (rows boosted). `null`/`""` deliberately not asserted (C2). |
| E13 | Budget option is test-only: not mapped from config | regression guard | L1 | automated | `searchOptsFromConfig(cfg)` | existing key-list test | key list unchanged (no `proximityBudgetMs`). Exemplar: `search-opts.test.ts:121` |
| E14 | Ranking unchanged on bundled fixtures | regression (exact, not tolerance) | ci | manual-only | `tsx packages/kb/eval/run-fixtures.ts` before (task 1.1) and after change | diff `/tmp/kb-eval-before.log` vs `/tmp/kb-eval-after.log` | every metric (P@1, P@5, Recall@K, MRR, nDCG, duplicate-slot share) equal for every variant row; any diff blocks. One-off release gate run at apply time (tasks 1.1 / 5.1), not a vitest; exemplar `packages/kb/eval/run-fixtures.ts` |
| E15 | Existing proximity/lane behaviour intact | regression | L1 | automated | existing `unicode-tokenizer.test.ts` E16 (near < far), `lane-lead.test.ts`, `retrieval-quality.test.ts` | `npm test` in `packages/kb` | all green, unmodified. Exemplar: the three named existing files |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Pathological repeated terms complete promptly (direct) | tail-latency, worker + hard kill | L1 | automated | body: ≥10 distinct query terms × ≥100 repeats each, interleaved round-robin; also k=6×50 and k=8×100. Run in a worker thread/child terminated after a few-second cap (exemplar `helpers/lease-worker.mts` / `git-scope-lease.test.ts`) | `proximityDelta` wall time < 100 ms, worker not killed by the cap; value equals closed-form smallest window (k−1 for round-robin body ⇒ `-max(0, 2−(k−1)/20)`), not just "fast" | median of 5 runs, single process |
| P2 | Pathological repeated terms complete promptly (end-to-end) | tail-latency, worker + hard kill | L1 | automated | same body indexed as one chunk via `indexSource` (as `unicode-tokenizer.test.ts`), plus a large variant ≈450 KB chunk; default budget | `store.search(q, {proximityBoost:true})` < 100 ms, returns the chunk, boost equals P1 value (i.e. budget guard did not fire — assert `console.warn` not called) | median of 5 runs |
| P3 | Many-row pool stays bounded | scale / soak-lite | L1 | automated | 600 indexed docs (≈5 KB each, k=6 interleaved terms ×20) so the pool is large | `store.search(q, {limit:10, proximityBoost:true})` total < 100 ms (greedy: ≪1 ms/row); `console.warn` not called | median of 5 runs; thresholds re-tuned against task 5.1 all-chunks measurement |
| P4 | 250 ms default vs all-chunks cost | measurement (not assertion) | — | manual-only | synthetic ≈6000-chunk index equivalent to issue #1075 (`eval/measure-search-latency.ts`) | [judgment: confirm or retune 250 ms default against measured ceiling and record in design.md "Measured" — a recorded number, task 5.1, no automatable pass/fail] | one run per host |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Event loop / heartbeat not starved by a search (the #1075 symptom: heartbeats + Esc dead) | state-convergence + invariant (event-loop lag) | L1 | automated | pathological indexed chunk (P2 corpus) | `withEventLoopLag(async () => store.search(q, {proximityBoost:true}))` (helper `event-loop-lag.ts`) | `maxDelayMs` < 100 and `elapsedMs` < 100; at HEAD (DFS) this is unreachable (run via worker cap) |
| F2 | Model-facing tool output unchanged under degradation | contract invariant | L1 | automated | `proximityBudgetMs:0` search vs `proximityBoost:false` search | compare `KbHit` key sets / array shape | identical key set on every hit (no new/changed field, no label); array of `KbHit` |

*No rendered-UI surface touched ⇒ no L3 / Playwright rows; none belong in `qa/` either.*

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Budget expiry logged exactly once per call | fault-injection (budget exhausted) | L1 | automated | `proximityBudgetMs:0`, query with ≥2 terms, ≥5 candidate rows across lanes; `vi.spyOn(console,'warn')` | one `store.search` call | `console.warn` called exactly 1×; message matches `/^\[kb\] proximity budget 0ms exhausted; \d+ of \d+ rows scored without proximity$/`; skipped count == rows whose score equals plain BM25. Denominator M = rows examined by `lane()` across both lanes (C1=A). |
| X2 | Log is per call, no sticky state | state-transition | L1 | automated | same store; call sequence: search(budget 0) → search(default) → search(budget 0) | spy `console.warn` between calls | warn counts after each call: 1, 0 (delta), 1 (delta) — no suppression after first expiry, no leakage into the healthy call |
| X3 | No line when proximity work finishes within budget | decision table (boost × terms × budget) | L1 | automated | (a) default budget, normal 3-term query; (b) `proximityBoost:false` + budget 0; (c) 1-term query + budget 0 | `store.search` | (a) 0 warns; (b) 0 warns; (c) 0 warns (b),(c): nothing skipped while proximity applicable ⇒ no line (C1=A). |
| X4 | Expiry never drops or throws on hostile input | fault-injection + EP | L1 | automated | `proximityBudgetMs:0` with hostile queries from `unicode-tokenizer.test.ts` X1 (`ü" OR x* NEAR(`, `"\uD800"`, `közzé"tételek`) and empty-result query | `store.search` | no throw; results equal `proximityBoost:false` results; `[]` for no-usable-terms query |
| X5 | Dist artifact not stale | CI gate | ci | manual-only | `npm run build` in `packages/kb`, commit `dist` + `engine-fingerprint.json` | `node scripts/check-kb-dist-fresh.mjs` | exit 0 (fails if fingerprint lags source). Verified once at apply (task 4.2); already enforced on every PR by the existing CI gate; exemplar `scripts/check-kb-dist-fresh.mjs` |

---

## Coverage summary

- Requirements covered: 6/6 (exactness scenario; pathological-terms; exhausted-budget; zero-budget; expiry-logged; no-log-when-within-budget) + issue #1075 repro (P1/P2/F1)
- Scenarios by class: edge 15 · perf 4 · frontend 2 · error 5
- Scenarios by level: L1 23 · L2 0 · L3 0 · ci 2 (E14, X5; manual-only) · — 1 (P4)
- Scenarios by disposition: automated 23 · manual-only 3 (E14, X5, P4 — one-off verification steps)

## New infra needed

- none. Worker/child kill-cap harness reuses the `lease-worker.mts` pattern; oracle DFS is a test-local function in the new test file (`packages/kb/src/__tests__/proximity-bound.test.ts`, name suggested).
