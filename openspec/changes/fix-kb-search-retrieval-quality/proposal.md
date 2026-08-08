## Why

`kb_search` loses to `grep`. Measured over 1929 session transcripts (310 real
`kb_search` calls, 154 sessions):

| outcome | share |
|---|---|
| agent opened a hit (`click`) | 21.9% |
| agent searched again (`refine`) | 36.5% |
| agent gave up and ran `rg`/`grep` (`fall-through`) | **41.3%** |

The 41.3% is an **upper bound** on kb failure, not a measure of it: in a warm
multi-turn session, grepping a path the agent already knows is often correct.
See `ab-context-calibration.md`. The index-side findings below do not depend on
it.

The AGENTS.md READ discipline mandates kb-before-grep and pi injects ~3,200
tokens of it every turn. Field data says the gate wins the *first* move
(36–45% of investigating sessions call `kb_search`) and loses everything after:
`kb_search` is only **3.4–4.7%** of all search calls. Two doctrine edits
(substitution table 2026-07-16, 58% root trim 2026-07-20) moved first-action
compliance by +5pp / −8pp — both null (p=0.40, p=0.27). **Instruction budget
cannot buy retention when the tool succeeds 22% of the time.**

The dominant defect is redundancy, not ranking. On **100% of 101 real queries**,
more than one result slot goes to the same file; **55.8% of every result page is
duplicate-file slots**. A rendered page for
`kb_search("collapsed messages chat view collapse expand")` returns *ten of ten*
hits from `specs/chat-view/spec.md` — one file's scenario list, for 723 tokens.
This is the literal meaning of the reported symptom ("returns similar but
irrelevant records"): the same file, repeated.

The existing dedup requirement (`kb-fts5-search-store` → *Exact-content dedup*)
collapses by **body hash**, so two different sections of one file never
collapse. Dedup is by content; the agent is choosing a **file**.

Measured effects, combined golden set (n=185, paired bootstrap 10k):

| change | R@10 | Δ | losses | evidence |
|---|---|---|---|---|
| baseline today | 0.286 | — | — | — |
| + dedup by source path | 0.416 | **+45%** | **0** | p < 1e-5, 24W/0L |
| + AGENTS `doc_type` lane quota | 0.512 | +79% | 0* | p < 1e-5, 34W/0L |
| + PRF & coverage rerank | 0.573 | +100% | 4 | p = 0.005 |

\* quota measured standalone on the source-target set.

Render repricing over 215 real queries: dedup-by-path + leaf heading +
`(+N more sections)` marker → **665 → 470 tokens (−29%)** while distinct files
per page rise **4.5 → 9.9**. Strictly cheaper and 3.1× more information-dense.

Two secondary defects surfaced by the same investigation:

- `kb dox lint` reports `missing` rows for `.md` files only — **0 of 47**
  findings are `.ts`/`.tsx`. Of 157 source files agents opened after a
  fall-through, **38% have no doc row at all**, structurally invisible to the
  lint that exists to catch it.
- `getChunk(root, path)` without a section does `ORDER BY rowid LIMIT 1`.
  **53 of 636** indexed AGENTS files have >1 chunk, so `kb_get(path)` silently
  returns one arbitrary slice with no indication that more exists.

**Refuted hypothesis, recorded so it is not re-proposed.** Mid-investigation we
proposed row-level chunking of directory `AGENTS.md` tables (707 dir-level
chunks → 2,647 row-level). A shadow-index simulation showed +7% R@10 *with* the
quota and −57% without it. The natural experiment then refuted it: the repo
already has 457 per-file `<File>.AGENTS.md` sidecars vs 179 directory blobs
(**72% of the "per-file record" is already per-file**), and targets backed by a
sidecar retrieve no better than targets backed by a directory row
(MRR 0.278 vs 0.261, n=29/74 — a wash). Row-level chunking would duplicate what
sidecars already do, amplify the `kb_get` truncation bug from 53 files to ~600,
and do nothing for the push budget the sidecar split actually exists to manage.
**Out of scope. Do not implement.**

## What Changes

- **Source-level dedup in `store.search()`** — collapse hits to one chunk per
  `(root, path)`, keeping the best-scoring representative and reporting the
  suppressed count. Complements (does not replace) the existing body-hash
  `akaPaths` collapse. Fetch depth grows (10 → ~60) so dedup does not starve the
  page; measured cost ~13ms → ~25ms.
- **AGENTS lane quota** — reserve a share of the result page for
  `doc_type='agents'` unconditionally. `doc_type=agents` raises hit@10 on the
  right source file from 11% → 51% (Δ +0.405, p < 1e-5, **34 wins / 0 losses**),
  but the flag is passed on only 13% of real queries and *dropped* to 5% on
  retry. An intent-detecting router was tested and **lost** to the
  unconditional quota (detector precision 45%, recall 30%) — the simpler design
  wins.
- **PRF query expansion + IDF-weighted coverage rerank** — finish the dead
  `expandQuery(mode:"prf")` stub, whose comment already says *"prf handled by
  callers via a second pass"* and whose caller was never written. Neither
  component is shippable alone: PRF expansion *without* coverage rerank drops
  P@5 (0.366 → 0.297); coverage rerank alone is underpowered (p = 0.11).
- **Condensed-render change** — show the **leaf** heading instead of the full
  breadcrumb (47% of the current page is breadcrumb text, 38% of it verbatim
  repetition within a file group) and surface `(+N more sections)` per file.
- **`kb dox lint` covers source files** — a `.ts`/`.tsx` file with no row in the
  nearest `AGENTS.md` and no sidecar SHALL be reported `missing`.
- **`kb_get` truncation is explicit** — a path-only fetch SHALL NOT silently
  return one of N chunks.
- **Eval fixtures + redundancy metric** — freeze both golden sets mined from
  session transcripts (101 markdown-target, 84 source-target query→click pairs)
  as `kb eval` fixtures, and add a **result-redundancy** metric (distinct
  sources per page). Precision/recall are blind to redundancy by construction:
  P@1 is 1.0 whether ranks 2–10 are nine other files or nine copies of rank 1.
  That blindness is why this defect survived ~20 ranking variants and four
  significance tests before being found by rendering one page.
- **BREAKING (tool semantics)**: `limit` changes meaning from "N chunks" to
  "N distinct sources". Condensed output line shape changes.

## Capabilities

### New Capabilities

*(none — every change modifies an existing capability)*

### Modified Capabilities

- `kb-fts5-search-store`: adds source-level dedup alongside exact-content
  dedup; adds an unconditional `doc_type` lane quota; makes PRF expansion +
  coverage rerank the default ranking path; makes path-only `getChunk`
  non-silent.
- `markdown-knowledge-base`: condensed `kb_search` output renders the leaf
  heading and a per-source suppressed-section count.
- `kb-retrieval-eval`: golden-set fixtures ship with the repo; adds a
  result-redundancy metric to the reported metric set.
- `kb-dox-tree`: drift lint's `missing` arm covers source files, not only
  markdown.

## Impact

- **Code**: `packages/kb/src/sqlite-store.ts` (search, dedup, getChunk),
  `packages/kb/src/render.ts` (condensed render), `packages/kb/src/eval.ts`
  (metrics + fixtures), `packages/kb/src/dox.ts` (lint missing arm),
  `packages/kb-extension/src/extension.ts` (tool description; `limit` semantics),
  `packages/kb/src/config.ts` (quota + rerank defaults).
- **Consumers**: `kb_search` / `kb_get` native tools, `kb search` / `kb get` CLI,
  `kb-plugin` surfaces. `store.search()` stays the structured interface.
- **Docs**: `docs/architecture.md` (retrieval pipeline), the READ-discipline
  substitution table if the tool description changes.
- **Latency**: search fetch depth 10 → ~60; measured ~13ms → ~25ms on a
  21,945-chunk index. Needs a stated budget.
- **Not in scope**: the code plane (`add-codegraph-code-plane`) — 74% of files
  opened after a fall-through are `.ts`/`.tsx`, which no markdown-side fix
  reaches. This change is the cheap complement, not a substitute.
- **Unmeasured, and not measurable with today's tooling**: whether the 41.3%
  fall-through rate actually drops. A 30-run calibration of `scripts/ab-context`
  (2026-08-06, $20.47 — see `ab-context-calibration.md`) **refuted** the
  hypothesis that its battery is cued: field-framed prompts score identically to
  archetype-framed ones (100% vs 100%, p=1.0). The real gap is environmental —
  `pi -p` runs a cold single-turn session where the agent has no prior context,
  so it scores 100% kb-first and **0%** grep fall-through against the field's
  41.3%. The harness cannot reproduce the condition under which the doctrine
  fails and therefore cannot gate this change.

## Discipline Skills

- `doubt-driven-review` — `limit` changes public tool semantics (chunks →
  sources) and the condensed output shape changes; both are consumer-visible and
  awkward to reverse.
- `performance-optimization` — fetch depth 10 → 60 is a measured latency
  regression traded for recall; needs a budget and a measurement, not a guess.
- `review-code` — multi-module change across store, render, eval, dox, and the
  extension.
