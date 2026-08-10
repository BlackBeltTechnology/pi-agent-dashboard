# kb_search Retrieval Quality — Investigation Dossier

> Status: **research / investigation complete**. Feeds openspec change `fix-kb-search-retrieval-quality`.
> Goal: diagnose why `kb_search` returns "sometimes similar, but unrelevant records"; measure candidate fixes before the change lands.
> Scope: kb extension retrieval + presentation only. No implementation here. Rounds 1–6 + doctrine/push budget + ab-context calibration (2026-08-06).
> Date: 2026-08-06.

---

## 1. Question

User report: `kb_search` returns "sometimes similar, but unrelevant records".
Asked: could the tool return refinement hints, so the LLM reruns a better query?

Investigation reframed: measure WHY retrieval misses before answering the hint question.
Refinement hints = treating symptoms. Root cause first.

---

## 2. Verdict

- Ranking ≈ 1/5 of the effect. Presentation (dedup) = largest cheap win.
- 55.8% of result slots are duplicate-file slots; 100% of queries over-consume one file.
- `doc_type` lane quota: +0.405 MRR on source set, 34W/0L, zero losses.
- PRF + coverage rerank: jointly positive, alone regressions. Ship together or not at all.
- Tool description "Prefer 2–5 keyword terms" wrong on this corpus. Term pruning loses.
- 41.3% fall-through = UPPER BOUND on kb failure, not a measure. Warm-session grep of known path often correct.
- 9 decisions carried into `fix-kb-search-retrieval-quality` (section 5).

```mermaid
flowchart LR
  A["today · combined R@10 0.286"] --> B["+ dedup by path · 0.416"]
  B --> C["+ doc_type quota · 0.512"]
  C --> D["+ PRF & coverage · 0.573"]
```

---

## 3. Method

### Corpus

- 1929 session JSONL transcripts: `~/.pi/agent/sessions/--Users-robson-Project-pi-agent-dashboard--`
- 312 `kb_search` calls, 154 sessions. Avg 6.89 terms/query, max 13.
- Index 21,945 chunks: `doc` 21,149 (96.4%) · `agents` 707 (3.2%) · `source-md` 89 (0.4%)
- Avg chunk len: `agents` 1167 chars · `doc` 414 chars
- 636 distinct `agents` files = 457 per-file `<File>.AGENTS.md` sidecars + 179 directory blobs (72% already per-file)
- 53/636 `agents` files have >1 chunk

### Golden sets — implicit relevance feedback (click-through)

- Golden set 1 "markdown-intent" = 101 pairs: query → clicked `.md`.
- Click = `kb_get` / `read` / `edit` within 12 tool calls before next search.
- Golden set 2 "source-intent" = 84 pairs, mined from fall-throughs.
- Target = source file opened after `grep`, matched via its AGENTS row.

### Scoring

- Every variant scored against a copy of the real live index (`/tmp/kb-ab.db`). Never a toy fixture.
- Paired bootstrap, 10,000 resamples.
- Label matcher changed at round 4. Rounds 1–3: hit credited on `path` match only. Round 4+: `headingPath` match also credited.
- Rule: compare within a round, never across rounds. Absolute numbers not comparable across rounds.

---

## 4. Measurements

### Outcome distribution (n=310 real calls)

| Outcome | n | % |
|---|---|---|
| click (opened a result) | 68 | 21.9% |
| refine (reran kb, new terms) | 113 | 36.5% |
| fall-through to `rg`/`grep` | 128 | 41.3% |
| other | 1 | — |

### Round 1 — OR-dilution hypothesis

`toMatch()` in `packages/kb/src/sqlite-store.ts` ORs all tokens.
BM25 rewards single-term density, not query coverage.

Baseline top-1 term-coverage histogram: 100% of terms only 20% of the time; ≤50% coverage in 22%.

Variants, markdown set n=101 (P@1 / P@5 / R@10 / MRR):

| Variant | P@1 | P@5 | R@10 | MRR |
|---|---|---|---|---|
| A baseline | .178 | .366 | .436 | .257 |
| B idf_top4 | .149 | .267 | .376 | .211 |
| C drop_common (df>2%) | .109 | .257 | .347 | .174 |
| D AND_2_rarest | .129 | .307 | .337 | .199 |
| E coverage_rerank | .208 | .416 | .525 | .298 |
| G cov K150 | .188 | .455 | .535 | .292 |
| H cov+path_boost | .188 | .376 | .446 | .271 |
| J RRF | .208 | .406 | .455 | .283 |

KEY: every term-PRUNING variant (B, C, D) LOST to baseline.
Tool description "Prefer 2–5 keyword terms" wrong on this corpus.

E vs A (MRR): Δ+0.042, CI [−0.023, +0.106], p=0.107 → NOT significant.

Corpus-noise terms by df: `not` 6966 · `session` 5480 (23 queries) · `pi` 5356 · `server` 4523 · `user` 4400 · `dashboard` 4352 (13 queries)

### Round 2 — reformulation autopsy + PRF

- 113 refine pairs → 64 true reformulations (Jaccard ≥0.10); 49 discarded as topic drift.

q1(failed) → q2(retry) deltas:

| Metric | q1 | q2 |
|---|---|---|
| term count | 6.67 | 6.98 |
| avg IDF | 3.35 | 3.45 |
| max IDF | 5.10 | 5.18 |
| zero-df terms | 0.05 | 0.03 |
| noise terms (df>15%) | 0.83 | 0.88 |
| has code identifier | 28% | 34% |
| used `doc_type` | 13% | 5% |

- Edit type: pure-ADD 1 · pure-REMOVE 0 · SWAP 63
- `session` simultaneously #1 most-ADDED and #1 most-DROPPED term on retry.
- VERDICT: agent reformulates by near-random synonym churn. Cannot refine a lexical query. Lacks index vocabulary, not motivation.

EXP1 — PRF vs agent's own retry vocabulary: 28/64 = 44% of retries had ≥1 added term already suggestible by PRF; mean 15% of added terms recovered.

EXP2, n=101 (P@1 / P@5 / R@10 / MRR):

| Variant | P@1 | P@5 | R@10 | MRR |
|---|---|---|---|---|
| A baseline | .178 | .366 | .436 | .257 |
| E coverage | .208 | .416 | .525 | .298 |
| P prf_alone | .208 | .297 | .426 | .256 |
| Q prf+coverage | .228 | .475 | .515 | .330 |

Q vs A: MRR Δ+0.073, CI [+0.017, +0.131], p=0.0046, W/L/T 25/14/62. P@5 Δ+0.109, CI [+0.020, +0.198], p=0.0082, W/L/T 16/5/80.

INTERACTION: PRF expansion alone degrades precision (adds terms to an OR query). Only safe after coverage rerank.

### Round 3 — corpus gap + doc_type lane

Files opened after a fall-through (n=305):

| Ext | n | % |
|---|---|---|
| `.tsx` | 119 | 39.0% |
| `.ts` | 97 | 31.8% |
| `.md` | 79 | 25.9% |
| `.css` | 4 | — |
| `.html` | 4 | — |
| `.mjs` | 2 | — |

Markdown 25.9%, source 74.1%.

Grep patterns are exact code identifiers: `CODE_TTL_MS` · `role:resolve-model` · `set_session_tags|setSessionTags` · `CollapsedToolGroup|collapseToolBursts` · `piCompatibility` · `unsplit|onSplit|isSplit`.

Compound identifiers agents grepped (n=80): present in markdown KB 51 (64%), ABSENT 29 (36%).
Absent: `DirectoryCard` · `onSplit` · `collapseToolBursts` · `setSessionTags` · `newWorkspace` · `maxSteps`.

AGENTS coverage of 157 distinct source files opened: own sidecar 21 (13%) · directory row 76 (48%) · NO row 60 (38%).

`doc_type=agents` lever (n=84): no filter 9 (11%) → with filter 43 (51%). Δ+0.405, CI [+0.298, +0.512], p<0.00001, W/L/T 34/0/50 — ZERO losses.

Cause of burial: `agents` = 3.2% of index AND 2.8× longer than `doc`. Rarer plus BM25 length-normalisation penalty → buried ~30:1.

Two populations want opposite treatments. EASY set = markdown n=101 (P@5 / R@10 / MRR):

| Variant | P@5 | R@10 | MRR |
|---|---|---|---|
| A | .366 | .436 | .257 |
| Q | .475 | .515 | .330 |
| R quota | .366 | .485 | .193 |
| T quota+Q | .455 | .554 | .247 |

HARD set = source n=84:

| Variant | P@5 | R@10 | MRR |
|---|---|---|---|
| A | .060 | .107 | .044 |
| Q | .238 | .310 | .131 |
| R quota | .393 | .452 | .282 |
| T | .369 | .476 | .277 |

Intent ROUTER tested and LOST: combined P@5 / R@10 / MRR U_router .384/.454/.273 vs T unconditional .416/.519/.263. Detector fires on 30% of queries, precision 45%, recall 30%.

T vs A combined n=185 R@10: 0.286 → 0.519. Δ+0.232, CI [+0.157, +0.303], p<0.00001, W/L/T 50/7/128.

### Round 4 — chunker hypothesis, RETRACTED

Simulated row-level chunking of directory AGENTS tables: 707 → 2,647 chunks (3.7×), avg len 1167 → 357 chars.

HARD set (P@5 / R@10 / MRR):

| Variant | dir-blob | row-level |
|---|---|---|
| A | .131 / .190 / .079 | .036 / .071 / .034 |
| Q | .226 / .286 / .110 | .167 / .262 / .112 |
| T | .369 / .512 / .293 | .476 / .548 / .355 |

Row-level A = 2.3× WORSE than dir-blob A.

Full stack vs today (combined n=185, this round's run): R@10 0.351 → 0.530. Δ+0.178 (+51%), p<0.00001, W/L/T 44/11/130.

Label-matcher note: round 4 changed the label matcher. Rounds 1–3 credited a hit only when result `path` matched the golden target. Round 4 additionally credited a `headingPath` match. Cause: row-level chunking simulation put the full file path into `heading_path`; a path-only matcher would have scored it unfairly. Looser matcher → every variant scores higher, baseline included. All variants scored identically within a round → within-round comparisons and ablation ladder valid. Across-round absolute numbers NOT comparable.

Ablation, HARD R@10:

| Stack | R@10 |
|---|---|
| today | 0.190 |
| +PRF/coverage | 0.286 |
| +quota | 0.512 |
| +row-level | 0.548 |

NATURAL EXPERIMENT killed it. Repo already has 457 sidecars (= per-file chunks).
Targets WITH a sidecar (n=29) vs only a directory row (n=74), `doc_type=agents`: MRR 0.278 vs 0.261, R@10 0.448 vs 0.419 → a WASH.

Row-level chunking would duplicate what sidecars already do, amplify the `kb_get` truncation bug from 53 files to ~600, and do nothing for the push budget the sidecar split exists to manage. RETRACTED, out of scope.

Architectural insight found here: `AGENTS_BYTE_CAP` = 30000 governs PUSH cost (pi auto-injects directory AGENTS.md every turn), NOT retrieval. Sidecars move detail push→pull. Per-file retrieval granularity is a SIDE EFFECT.

### Round 5 — duplicate sources, largest cheap win

- Loss characterisation of the stack: 8 losses / 53 wins. ALL 8 in the markdown set, ZERO in the source set.
- 7 of 8 = FLOODING (multiple chunks of one file eating slots, e.g. 4/10 slots to `packages/goal-plugin/src/client/AGENTS.md`).
- 1 of 8 = alias artifact of the harness (`markdown-knowledge-base/spec.md` exists at 3 paths; shadow index dropped the real store's `akaPaths` collapse).
- 1-chunk-per-path cap: losses 8→4, wins 53→57, R@10 0.530 → 0.573.

PRODUCTION CHECK — 101 real queries against the real index: 101/101 = **100%** of queries put >1 slot on the same file. 564/1010 slots = **55.8% of every result page is duplicate-file slots.**

ISOLATED dedup-by-path (n=185, no quota, no PRF, no rerank): P@5 .227→.314, R@10 .286→.416, MRR .160→.196. R@10 Δ+0.130, CI [+0.081, +0.178], p<0.00001, W/L/T **24/0/161** — zero losses. ~4 LOC.

ROOT CAUSE: existing dedup groups by `bodyHash`. Two different sections of one file have different bodies → never collapse. Dedup is by CONTENT; the agent is choosing a FILE.

### Round 6 — presentation

Rendered page for `kb_search("collapsed messages chat view collapse expand")`: 10 of 10 hits from `specs/chat-view/spec.md`, 723 tokens. Second sampled query: 8 of 10 from `specs/sidebar-drag-reorder/spec.md`.

Page anatomy over 215 real queries:

| Metric | Value |
|---|---|
| distinct files per 10-hit page | 4.5 |
| largest single-file share | 5.3/10 slots |
| pages that are 100% one file | 7% |
| page size | 665 tokens |
| breadcrumb text | 47% |
| snippets | 34% |
| paths | 14% |
| within-file breadcrumb duplication | 376 chars/page = 38% of all breadcrumb text |

Snippet is `snippet(chunks,9,'[',']',' … ',12)` = 12 tokens mid-sentence; for openspec Gherkin bodies it fragments badly.

Presentation-failure test: 32 (33%) of fall-throughs had an eventually-opened file already in top-10 (some at rank 1); 65 (67%) genuinely absent. UPPER BOUND, not proof — "eventually opened" includes files read after grepping for something else.

Proposed render (dedup by path + leaf heading + `(+N more sections)`): 665 → 470 tokens (−29%), distinct files/page 4.5 → 9.9, density 0.68 → 2.10 files per 100 tokens (3.1× denser).

`(+N more sections)` is a free relevance signal — per-source match count. `specs/chat-view/spec.md` had 44 matching sections.

### Doctrine / push budget

- Root `AGENTS.md` 12,847 bytes ≈ 3,200 tokens injected EVERY turn.
- 196 directory AGENTS.md, 635 KB total. Heaviest 28.1 / 26.4 / 26.0 / 24.3 KB against a 30 KB cap.
- 457 sidecars = 295 KB pull-only, zero per-turn cost.

| Window | sessions | investigating | adoption | first-action-kb | kb share of searches |
|---|---|---|---|---|---|
| tool only 2026-06-24→07-15 | 382 | 230 | 41% | 26% (n=230) | 4.1% (175 kb vs 4102 grep) |
| + substitution table 07-16→07-19 | 60 | 51 | 45% | 31% (n=51) | 4.7% (65 vs 1305) |
| + 58% root trim 07-20→08-31 | 955 | 104 | 36% | 23% (n=104) | 3.4% (74 vs 2106) |

- Substitution table effect z=0.84, p=0.403 (null). 58% trim effect z=−1.11, p=0.267 (null).
- Push cost: 25,078 assistant turns → ~80M–193M tokens injected → 314 `kb_search` calls → ~256,000–615,000 tokens per induced call.
- `kb dox lint` today: 53 stale · 47 missing · 19 missing-companion · 3 over-threshold · 2 broken-ref · 1 orphan = 125 findings.
- ALL 47 `missing` are `.md`. ZERO `.ts`/`.tsx` ever flagged missing.

### ab-context calibration run, 2026-08-06

Follow-up to `docs/research/context-injection-ab-test.md` (July, commit fa2558186).

Hypothesis under test: the `scripts/ab-context` battery is CUED, scoring 80–100% kb-first where the field scores 23–31%.

Design: single arm (main repo cwd), 5 subjects × 2 framings = 10 tasks. Identical checks `first_search_is_kb` + `tool_called: kb_search`. `arch-*` = harness archetype template. `field-*` = verbatim mined user message, typos preserved. N=3, pi default model, 30 runs, ~3.5 h, 20.3M tokens, $20.47.

Artifacts: `scripts/ab-context/tasks.calibration.jsonl`, `arms.calibration.json`, `paired.mjs`, `runs-calibration/` (gitignored).

RESULT 1 — hypothesis REFUTED. `kb_first`: archetype 100% (n=14) vs field 100% (n=15), Δ 0pp, **p=1.0000**. `used_kb` 93% vs 100%, Δ+7pp, p=0.31 (noise). Task framing is NOT the validity gap.

RESULT 2 — larger gap confirmed from raw transcripts:

| Behavior | harness | field |
|---|---|---|
| kb-first | 100% | 23–31% |
| ran `rg`/`grep` after `kb_search` | 0% (0/29) | 41.3% |
| iterated on kb again | 83% (24/29) | 36.5% |

Cause is ENVIRONMENTAL: `pi -p` starts a cold single-turn session — no history, no files in context, tools the only route. Real sessions are warm and multi-turn; agent often already knows the path and greps it.

RESULT 3 — field prompts needed 14.5 mean tool calls after the first `kb_search` vs 7.4 for archetype (≈2×), with ZERO movement in either adherence check.

CONSEQUENCE: the 41.3% fall-through is an UPPER BOUND on kb failure, not a measure of it — warm-session grep of a known path is often correct. `scripts/ab-context` cannot gate the retrieval change. Fixing `tasks.jsonl` does not help; it would need multi-turn warm-context fixtures.

---

## 5. Decisions — carried into `fix-kb-search-retrieval-quality`

| # | Decision |
|---|---|
| D1 | dedup by `(root, path)` not `bodyHash` |
| D2 | fetch depth `limit × 6` (~13ms→~25ms measured) |
| D3 | unconditional `doc_type` lane quota, not an intent router |
| D4 | PRF + coverage rerank ship together or not at all |
| D5 | render leaf heading + `(+N more sections)` |
| D6 | `limit` means sources (BREAKING) |
| D7 | `kb_get` path-only fetch stops silently truncating (53 files) |
| D8 | redundancy = first-class eval metric + freeze both golden sets as fixtures |
| D9 | `dox lint` missing arm covers source files |

Ranked fix table (effect on combined R@10 / losses / cost):

| Fix | R@10 | Losses | Cost |
|---|---|---|---|
| dedup-by-path | 0.286 → 0.416 | 0 | ~4 LOC |
| + quota | → 0.512 | 0 | ~20 LOC |
| + PRF & coverage | → 0.573 | 4 | ~30 LOC |
| lint arm | — | — | ~10 LOC |
| code plane (74% of fall-throughs) | — | — | large, owned by `add-codegraph-code-plane` |

---

## 6. Good instincts

- Mining implicit relevance feedback (click-through) from transcripts. Produced a real golden set at zero labelling cost, from data already on disk.
- Scoring every variant against a COPY OF THE REAL INDEX, never a toy fixture.
- Paired bootstrap significance instead of eyeballing deltas. Caught that round 1's winner was p=0.107, i.e. nothing.
- Doubting the tool's own description ("prefer 2–5 terms") and testing it. It was wrong.
- Checking prior art before designing: Elasticsearch term/phrase suggesters (`suggest_mode: missing|popular`), Azure AI Search generative query rewriting, LlamaIndex query transformations (HyDE, multi-step decomposition), RAG-Fusion/RRF, RM3 PRF, Anthropic Contextual Retrieval.
- Running a NATURAL EXPERIMENT (sidecar-backed vs directory-row-backed targets) that used data the investigator could not influence — and letting it kill the investigator's own hypothesis.
- Characterising the losses instead of accepting the aggregate. That is what exposed flooding.
- Eventually rendering a result page and reading it.

## 7. Bad instincts

- Assumed the problem was RANKING and spent two rounds there. Ranking was ~1/5 of the effect.
- Trusted a SIMULATION the investigator built. Pattern: every simulated change looked good; the one real-data natural experiment disagreed. Row-level chunking was proposed on simulation and retracted on evidence.
- Did not look at the actual tool output until round 6. The single largest finding (55.8% duplicate slots, 100% of queries) was visible on the first query of round 1.
- Built and trusted metrics blind to the defect BY CONSTRUCTION. P@1 = 1.0 whether ranks 2–10 are nine other files or nine copies of rank 1.
- Derived the per-path cap by inspecting the losses = fitting to the test set. Flagged, needs a held-out slice. (The isolated dedup result 24W/0L was measured independently and does not share the flaw.)
- Analysis bug: `rows.jsonl` serialises `toolSeq` as bare names, so `t.cmd` is always empty. Produced a false "0% fall-through" that had to be re-derived from raw transcripts.
- Claimed the ab-context battery was "cued" without testing it. Refuted at p=1.0000 for $20.47.
- Overwrote the harness's canonical `tasks.jsonl`, `arms.json`, and `finish.sh` mid-run; restored from git afterwards.
- Own `finish.sh` bug: `pgrep -f "ab-context/run.sh"` does not match `./run.sh`, so the finisher fired immediately and wrote an empty report.
- Reported 41.3% fall-through as "kb losing to grep". The calibration showed it is an upper bound.
- Changed the label matcher mid-investigation (round 4) without re-running earlier rounds. Left an unexplained moving baseline — baseline R@10 0.286 (round 3) vs 0.351 (round 4). Fix: re-score all rounds with the final matcher. Not done.

## 8. Meta-lessons

- Three separate instruments in this investigation are blind to the same thing — what happens AFTER the first success. P@1/Recall blind to redundancy. `first_search_is_kb` blind to the 41% fall-through. The doctrine itself wins the first move and loses the rest.
- Every layer (dedup, quota, PRF, coverage, row-level) is a no-op or a REGRESSION when tested alone; only jointly positive. A disciplined one-change-at-a-time A/B — exactly what `packages/kb/src/eval.ts` is built to gate — would have rejected all four.
- RULE: render one page and read it before optimising a retrieval metric.
- Instinct-quality asymmetry: hypotheses tested against data the investigator generated survived; hypotheses tested against data the investigator could not influence died. Prefer natural experiments.

---

## 9. Sources / Cross-references

- `openspec/changes/fix-kb-search-retrieval-quality/{proposal,design,tasks,ab-context-calibration}.md`
- `packages/kb/src/sqlite-store.ts` · `packages/kb/src/eval.ts` · `packages/kb/src/render.ts` · `packages/kb/src/dox.ts`
- `packages/kb-extension/src/extension.ts`
- `scripts/ab-context/` (run.sh, extract.mjs, analyze.mjs, paired.mjs, tasks.jsonl, tasks.calibration.jsonl, arms.calibration.json)
- `docs/research/context-injection-ab-test.md` (July, commit fa2558186)
- `openspec/changes/add-codegraph-code-plane/` (code plane — 74% of fall-throughs)
