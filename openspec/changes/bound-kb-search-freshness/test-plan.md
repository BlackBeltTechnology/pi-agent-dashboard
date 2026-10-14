# Test Plan — bound-kb-search-freshness

Stage: design   Generated: 2026-05-08

Decisions applied: K1 (max event-loop delay ≤ 250 ms), K2 (warm regression: median of 5 runs ≤ baseline +10 %), K3 (deep/wide/rename → scaled-down L1 timed tests; full scale recorded once in design.md), K4 (budget edge: 1499 / 1501 ms with fake timers; exact tie not asserted), K5 (cold start → explicit index-being-built result), K6 (rename-scan timeout 2000 ms). See design D7.

Legend: L1 = vitest. Exemplar harness files (verified exist):
- `packages/kb/src/__tests__/kb.test.ts` (indexSource over tmp fixture trees)
- `packages/kb/src/__tests__/gitignore.test.ts` (loadGitignoreMatcher)
- `packages/kb/src/__tests__/verdict.test.ts` (enrichHits, injected `git` runner)
- `packages/kb/src/__tests__/index-atomicity.test.ts` (transaction rollback)
- `packages/kb-extension/src/__tests__/reindex.test.ts` (reindexNow / ensurePopulated / state.inflight)
- `packages/kb-extension/src/__tests__/kb-search-tool.test.ts` (tool execute → text/details)
- `packages/kb-extension/src/__tests__/git-scope-tool.test.ts` (scope:"git" execute paths)
- `packages/kb-extension/src/__tests__/guard.test.ts` (read-discipline chain)
- `scripts/__tests__/check-kb-dist-fresh.test.mjs` (dist/fingerprint freshness)

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | exemplar | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|----------|-------|---------|---------------------|
| E1 | auto-reindex: budget parse | EP (absent) | L1 | automated | reindex.test.ts | `KB_FRESHNESS_BUDGET_MS` unset | resolve budget | 1500 |
| E2 | budget parse | EP (empty / whitespace-only) | L1 | automated | reindex.test.ts | `""`, `"   "` | resolve | 1500 each |
| E3 | budget parse | BVA min | L1 | automated | reindex.test.ts | `"0"` | resolve | 0 (never wait) |
| E4 | budget parse | BVA min+1 | L1 | automated | reindex.test.ts | `"1"` | resolve | 1 |
| E5 | budget parse | EP trimmed nominal | L1 | automated | reindex.test.ts | `" 2000 "` | resolve | 2000 |
| E6 | budget parse | BVA max-1 / max / max+1 | L1 | automated | reindex.test.ts | `"59999"`,`"60000"`,`"60001"` | resolve | 59999 / 60000 / 60000 (clamp, not default) |
| E7 | budget parse | EP huge digits | L1 | automated | reindex.test.ts | `"99999999999999999999"` | resolve | 60000 (clamp; no NaN/Infinity) |
| E8 | budget parse | EP invalid classes | L1 | automated | reindex.test.ts | `"-1"`,`"1500.5"`,`"1e3"`,`"1500ms"`,`"abc"`,`"+5"`,`"0x10"` | resolve | 1500 each; `-1` ≠ never-wait |
| E9 | D2 outcome→status table | decision table | L1 | automated | kb-search-tool.test.ts | rows: done / done-no-wait / timeout+chunks0+!completed / timeout+chunks>0 / timeout+chunks0+completed / failed+chunks0 / failed+chunks>0 / aborted | kb_search condensed | none / none / being-built line / stale line+hits / stale line+normal empty / stale line+empty (never being-built) / stale line+hits / cancel line only |
| E10 | D2 table × tools | decision table | L1 | automated | kb-search-tool.test.ts | same 8 rows | kb_get, kb_neighbors | same status line selection; being-built replaces `(not found: …)` / empty node list |
| E11 | json rule | equivalence (byte-identity) | L1 | automated | kb-search-tool.test.ts | fixed hits H; outcome timeout chunks>0 vs done | kb_search format:"json" | output = `(index refresh still running — results may be stale)\n` + A; final line A byte-equal to done-run output; no wrapper object |
| E12 | json cold | decision table | L1 | automated | kb-search-tool.test.ts | chunks 0, !completed, timeout | kb_search json | exactly 2 lines: being-built line, `[]` |
| E13 | json cancel | decision table | L1 | automated | kb-search-tool.test.ts | aborted signal | kb_search json | exactly 2 lines: `(cancelled — no results retrieved)`, `[]` |
| E14 | cancel precedence over empty query | decision table | L1 | automated | kb-search-tool.test.ts | query `""` / `"  "`, aborted signal, condensed & json | execute | cancel result (not empty marker); no reindex started |
| E15 | empty query, live signal | regression | L1 | automated | kb-search-tool.test.ts | query `" "`, no signal | execute | existing empty marker; reindexNow spy 0 calls |
| E16 | completed-set: no-op not counted | state | L1 | automated | reindex.test.ts | removed cwd (dir deleted) | reindexNow | resolves; `state.completed.has(cwd)` false |
| E17 | completed-set: warm if-empty skip | state | L1 | automated | reindex.test.ts | warm index, nothing in flight, budget 0 | awaitFreshness if-empty | `"done"`; walk spy 0; completed unchanged |
| E18 | completed-set: rejected pass | state | L1 | automated | reindex.test.ts | indexSource throws | reindexNow | completed lacks cwd; outcome `"failed"` |
| E19 | completed-empty pass | EP | L1 | automated | reindex.test.ts + kb-search-tool.test.ts | source dir missing (`missing:true`) | first pass completes, then kb_get | normal `(not found: …)`, no being-built line |
| E20 | .worktrees excluded | EP | L1 | automated | kb.test.ts | fixture `docs/.worktrees/x/README.md`, no .gitignore | indexSource | file not selected; chunk count for path 0 |
| E21 | .worktrees no re-admit (include) | decision table | L1 | automated | kb.test.ts | include glob `**/.worktrees/**` | indexSource | still not selected |
| E22 | .worktrees no re-admit (negation) | decision table | L1 | automated | kb.test.ts + gitignore.test.ts | `.gitignore` `!.worktrees/` | indexSource | not selected; pre-scan does not descend (readdir spy never sees `.worktrees`) |
| E23 | .worktrees orphan removal | state | L1 | automated | kb.test.ts | file indexed under `.worktrees` by pre-change index | re-index | chunks for it removed |
| E24 | .worktrees name precision | EP negative | L1 | automated | kb.test.ts | dirs `worktrees/`, `.worktrees-notes/` | indexSource | their md files ARE selected |
| E25 | walk selection parity | equivalence | L1 | automated | kb.test.ts | fixture > 500 entries, nested dirs, mixed ext | async walk vs recorded sync list | identical array, identical order |
| E26 | gitignore loader parity | equivalence (4 fixtures) | L1 | automated | gitignore.test.ts | flat; nested+negation; ignored parent w/ own .gitignore; pruned dir | sync vs yielding loader | identical pattern lists, same order |
| E27 | yield threshold BVA | BVA | L1 | automated | kb.test.ts | trees with 499 / 500 / 501 / 1000 entries; spied `yieldToEventLoop` | walk | yields 0 / 1 / 1 / 2 (single `WALK_YIELD_EVERY` constant imported by test) |
| E28 | pre-scan yield BVA | BVA | L1 | automated | gitignore.test.ts | 499 / 500 / 501 dirs | yielding loader | yields 0 / 1 / 1 |
| E29 | rename runner compat | EP | L1 | automated | verdict.test.ts | sync `git` runner returning string; async runner returning Promise | enrichHits | identical verdicts (MOVED) |
| E30 | one scan per enrichment | invariant | L1 | automated | verdict.test.ts | 3 hits w/ absent subjects, counting runner | enrichHits | runner called exactly 1× (promise memoized) |
| E31 | completed forgotten on close | state | L1 | automated | reindex.test.ts | cwd completed; `closeKbForCwd(cwd)`; recreate empty; pass held pending past budget | kb_search | being-built line (not normal empty); same after `closeKb()` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | warm path unchanged (K2) | tail-latency (host measurement) | — | manual-only | this repo, warm index, 4 sources, same host as task 1.1 | median of 5 warm reindex runs ≤ task-1.1 baseline + 10 % [judgment: host-dependent wall clock, not CI-stable — recorded in design.md] | 5 runs |
| P2 | Goals: deep tree bounded (K1, K3) | threshold (scaled-down) | L1 | automated | synthetic tree ≈5k dirs, ≈1k gitignored, cold index, budget 1500 | kb_search wall time ≤ 1500 ms + 250 ms; max event-loop delay (`monitorEventLoopDelay`) ≤ 250 ms | one call |
| P3 | walk/pre-scan yield (K1) | timer-lag probe | L1 | automated | fixture ≥ 2×WALK_YIELD_EVERY entries | 10 ms interval timer fires ≥ 1× during pass; max event-loop delay ≤ 250 ms | pass duration |
| P4 | R10 wide dir residual (K1, K3) | threshold (scaled-down) | L1 | automated | one dir with ≈10k direct entries | pass completes; max event-loop delay ≤ 250 ms (full-scale ≥100k listing time recorded once in design.md by task 1.1) | one pass |
| P5 | rename scan cost (K1, K3, K6) | threshold (scaled-down) | L1 | automated | tmp git repo with ≈500 staged renames, default async runner | scan resolves < RENAME_SCAN_TIMEOUT_MS (2000); max event-loop delay during scan ≤ 250 ms; renames detected (MOVED) | one scan |
| P6 | budget bounds call | threshold (fake timers) | L1 | automated | indexSource stubbed never-resolving, budget 1500 | kb_search resolves after advancing 1500 ms, not after 1499 ms | fake clock |
| P7 | budget BVA on wait (K4) | BVA (fake timers) | L1 | automated | pass resolving at 1499 / 1501 ms, budget 1500 | 1499 → done (no line); 1501 → timeout (stale line); t == 1500 not asserted | fake clock |

### Frontend-quirk (async convergence — no rendered UI in scope)

| id | requirement | technique | level | disposition | exemplar | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|----------|-------|---------|---------------------------------|
| F1 | abandon wait, not work | convergence | L1 | automated | reindex.test.ts | deferred pass D, budget 10 | call #1 times out; call #2 before D resolves | indexSource spy called once; both calls joined D; call #2 stale-labelled |
| F2 | later call after completion | convergence | L1 | automated | reindex.test.ts | D resolves after #1 timed out | call #3 | no staleness line; `state.completed.has(cwd)` |
| F3 | mid-walk partial index joined | state-transition | L1 | automated | reindex.test.ts | chunks>0 (batch committed), inflight set | kb_get / kb_neighbors with budget 10 | joins inflight (no 2nd walk), stale line present |
| F4 | debounce + freshness coalesce | convergence | L1 | automated | reindex.test.ts | scheduleReindex fires during kb_search pass | both | single walk; same promise |
| F5 | budget 0, kb_search | state | L1 | automated | kb-search-tool.test.ts | budget 0, warm | kb_search | pass started in background (spy 1), stale line, hits returned |
| F6 | budget 0, kb_get warm idle | state | L1 | automated | reindex.test.ts | budget 0, warm, nothing inflight | kb_get | no walk, no line |
| F7 | budget 0 cold | state | L1 | automated | kb-search-tool.test.ts | budget 0, chunks 0, !completed | each of 3 tools | being-built line |
| F8 | fast path no timer leak | invariant | L1 | automated | reindex.test.ts | pass resolves in 1 ms, fake timers | awaitFreshness | `vi.getTimerCount()` == 0 after settle; timer is unref'd |
| F9 | cancel during wait | state-transition | L1 | automated | kb-search-tool.test.ts | deferred pass, controller.abort() mid-wait | each tool | resolves with cancel line before D settles; store.search / graph / chunk spies 0 calls |
| F10 | cancel leaves shared pass | invariant | L1 | automated | reindex.test.ts | caller A aborted, caller B waiting | abort A | D still resolves; B gets done; completed set |
| F11 | cancel before enrichment | state-transition | L1 | automated | kb-search-tool.test.ts | abort fired after search (hook on store.search) | kb_search | enrichHits spy 0; cancel result |
| F12 | cancel during rename scan | state-transition | L1 | automated | verdict.test.ts + kb-search-tool.test.ts | slow async git runner; abort mid-scan | kb_search | runner sees signal aborted; tool returns cancel line, no degraded GONE hits |
| F13 | already-aborted | state | L1 | automated | kb-search-tool.test.ts | `AbortSignal.abort()` | each tool | no reindex/search/enrich spies called; cancel line only; `details.aborted:true` |
| F14 | cancelled shape | invariant | L1 | automated | kb-search-tool.test.ts | any abort path | 3 tools | text === `(cancelled — no results retrieved)` exactly (condensed/get/neighbors); no throw |
| F15 | absent signal parity | regression | L1 | automated | kb-search-tool.test.ts | signal undefined vs unaborted controller | each tool | identical text output |
| F16 | git scope entry check | decision table | L1 | automated | git-scope-tool.test.ts | scope:"git", aborted signal | kb_search, kb_get | cancel result; forge fetch mock 0 calls |
| F17 | git scope live signal | regression | L1 | automated | git-scope-tool.test.ts | scope:"git", not aborted, abort later | kb_search | proceeds under forge budget; no docs reindex (spy 0) |
| F18 | Esc in live pi session | interactive | — | manual-only | — | pathological repo (≈50k dirs), pi TUI | press Esc during kb_search | [judgment: call ends promptly, session usable — live TUI interaction] |
| F19 | guard chain still reset | regression | L1 | automated | guard.test.ts | cancelled kb_search | tool_call | chain reset (unchanged behaviour) |

### Error-handling

| id | requirement | technique | level | disposition | exemplar | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|----------|-------|---------|---------------------|
| X1 | failure fallback | fault-injection (abort) | L1 | automated | kb-search-tool.test.ts | indexSource rejects within budget, chunks>0 | kb_search | warn logged; stale line + existing hits |
| X2 | failure on cold | fault-injection (abort) | L1 | automated | kb-search-tool.test.ts | reject, chunks 0 | kb_get/kb_neighbors | well-formed result, stale line, never being-built line |
| X3 | rejection after abandon | fault-injection (delay+abort) | L1 | automated | reindex.test.ts | pass rejects after all waiters timed out | process `unhandledRejection` listener | listener 0 calls; warn logged once |
| X4 | rejection, waiter still present | fault-injection | L1 | automated | reindex.test.ts | reject inside budget | awaitFreshness | `"failed"`; no unhandled |
| X5 | rename scan timeout (K6) | fault-injection (delay) | L1 | automated | verdict.test.ts | default runner w/ `git` stub on PATH sleeping > RENAME_SCAN_TIMEOUT_MS (2000) | enrichHits | absent subject → GONE; resolves within 2000 ms + 250 ms |
| X6 | rename scan BVA | BVA (fake/injected) | L1 | automated | verdict.test.ts | runner finishes at 1999 / 2001 ms | enrichHits | MOVED / GONE |
| X7 | rename scan spawn failure | fault-injection (abort) | L1 | automated | verdict.test.ts | non-git cwd | enrichHits | GONE (existing degrade) |
| X8 | rename scan aborted | fault-injection | L1 | automated | verdict.test.ts | signal aborted mid-scan | enrichHits | child killed (execFile signal); empty rename map |
| X9 | rollback unaffected | regression | L1 | automated | index-atomicity.test.ts | throw mid-batch after async walk | indexSource | txn rolled back; prior batches persist; rerun idempotent |
| X10 | slow fs during walk (K1) | fault-injection (delay) | L1 | automated | kb.test.ts | readdir stub adds ≈5 ms per dir over ≈200 dirs | kb_search with budget 50 | tool returns ≤ 50 ms + 250 ms with stale line; max event-loop delay ≤ 250 ms |
| X11 | cwd removed mid-pass | fault-injection | L1 | automated | reindex.test.ts | rm cwd during pass | pass + closeKbForCwd | pass settles (resolve or handled reject); completed lacks cwd |

### CI

| id | requirement | technique | level | disposition | exemplar | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|----------|-------|---------|---------------------|
| C-1 | build artifact fresh (task 5.2) | contract | ci | automated | scripts/__tests__/check-kb-dist-fresh.test.mjs | edited packages/kb/src + rebuilt fingerprint | `node scripts/check-kb-dist-fresh.mjs` | exit 0; stale fingerprint → exit≠0 |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | Open Q: 1500 ms on QA hosts | host measurement | — | manual-only | Docker image on spinning disk; Windows VM in `qa/` | warm + cold freshness pass | [judgment: pass time comfortably under 1500 ms, else raise default — hardware-dependent] |

---

## Coverage summary

- Requirements covered: 6/6 (auto-reindex budget/staleness/completion/join; pull-tool cancellation; markdown-kb cold being-built + json rule; indexing-pipeline exclusion; indexing-pipeline yielding + parity; verdict rename scan bound)
- Scenarios by class: edge 31 · perf 7 · frontend/async 19 · error 11 · ci 1 · manual 1
- Scenarios by level: L1 66 · L2 0 · L3 0 · ci 1 · — 3
- Scenarios by disposition: automated 67 · manual-only 3 (P1, F18, M1)

## New infra needed

- Event-loop-lag probe helper (`perf_hooks.monitorEventLoopDelay`) shared by P2/P3/P4/P5/X10 — small test helper under `packages/kb/src/__tests__/helpers/`.
- Synthetic deep/wide tree generator (scaled-down, ≈5k dirs / ≈10k entries) for P2/P4.
