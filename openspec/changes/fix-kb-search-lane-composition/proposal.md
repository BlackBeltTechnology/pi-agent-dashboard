# Surface the per-file record — make `doc_type` discoverable and fix rank-1 lane composition

> Depends on `fix-kb-eval-measurement-integrity`. Do not tune ranking until the
> instrument is fixed; the numbers below were taken with a hand-built harness that
> imports `packages/kb/src` and passes the tool's real search options.

## Why

The repo's whole retrieval doctrine rests on the per-file `AGENTS.md` record. Measured
against 97 real file-lookup queries mined from session transcripts
(`packages/kb/eval/golden.source-intent.json`, whose `expect` is always an `agents`
record), the KB puts that record at rank 1 **4% of the time**:

| source-intent (n=97) | P@1 | P@5 | Recall@10 | MRR |
|---|---|---|---|---|
| unfiltered | **0.041** | 0.402 | 0.495 | 0.198 |
| `doc_type:"agents"` | **0.227** | 0.485 | 0.567 | 0.345 |

Two facts follow.

**The right record is usually on the page but almost never at the top.** Recall@10 is
0.495 while P@1 is 0.041. Rank-1 composition explains it: for those 97 queries rank 1 is
`openspec` **77%** of the time and docType `doc` **86%** of the time, versus `agents`
**14%** — verbose requirement prose outranks the terse one-line file record in the KB's
own index. `laneQuota: 0.5` already reserves page share for the agents lane and demonstrably
works on recall (0.144 -> 0.495), but it does not contest **slot 1**.

**The escape hatch exists and nobody uses it.** `doc_type:"agents"` yields 5.5x P@1 and
1.7x MRR, yet across 563 real `kb_search` calls in `~/.pi/agent/sessions/` `doc_type`
was passed only **12%** of the time. The reason is visible in
`packages/kb-extension/src/extension.ts`: the `doc_type` parameter is declared as a bare
`Type.Optional(Type.Union([...]))` with **no `description`**, and neither `promptGuidelines`
entry mentions it. The model is never told the parameter exists or when it helps.

Critically the filter is **conditional, not a global win** — on conceptual/markdown queries
it hurts badly (P@1 0.150 -> 0.067), so it must be described as a lane choice rather than
recommended by default.

Two hypotheses were tested and rejected, and are recorded so they are not retried:

- **Corpus freshness is not the bottleneck.** All 183 stale DOX rows in indexed roots were
  triaged against their git diffs; only 11 (6%) made a false claim. Correcting them moved
  every metric by exactly zero, confirmed by stash-and-remeasure.
- **Query formulation is not the bottleneck.** FTS terms are OR'd, the zero-hit rate across
  563 real calls is 0.5%, and median query length is already 5 terms.

## What Changes

- **Describe `doc_type` in the tool schema.** Give the parameter a `description` naming the
  lane trade-off, and add a `promptGuidelines` entry: file/symbol lookup -> `"agents"`;
  conceptual/how-does-X -> leave unset.
- **Contest rank 1 for the agents lane.** Extend the `interleaveLanes` contract so the
  reserved lane can take slot 1 when its top candidate is competitive, rather than only
  earning share further down the page. Gate behind config; default chosen by measurement.
- **Report the lane in output** so a wrong-lane result is legible to the agent (and so the
  fallback to `doc_type` is self-suggesting) without materially growing the page.
- **Re-baseline both golden sets** after the change and record the numbers, guarding the
  markdown lane against regression — the two lanes trade off against each other.

Explicitly **not** in scope: enabling `doxEnforcement`, any freshness gate, and the
`SNIPPET_MAX` budget (a separate, second-order concern).

## Capabilities

### Modified Capabilities

- `markdown-knowledge-base` — `kb_search` gains a documented `doc_type` contract and a
  lane-aware rank-1 policy.

## Impact

- `packages/kb-extension/src/extension.ts` (tool schema + guidelines),
  `packages/kb/src/sqlite-store.ts` (`interleaveLanes`), `packages/kb/src/config.ts` (gate).
- Root `AGENTS.md` already carries the measured `doc_type` rule and the retired
  `kb_neighbors` claim (commit `48d6b35a1`); revisit that wording if the default changes.
- Risk: promoting the agents lane at rank 1 can regress markdown-intent. Both fixtures must
  be reported together on every candidate setting.

## Discipline Skills

- `performance-optimization` — measure-before-optimize is the whole point here; every
  candidate lane policy must be justified against both golden sets, never one.
- `doubt-driven-review` — the freshness hypothesis survived three rounds of plausible
  reasoning before measurement killed it. Stress-test the lane-composition hypothesis the
  same way before shipping a ranking default.
- `review-code` — `interleaveLanes` is shared ranking code; a rank-1 change affects every
  consumer and needs a careful diff review plus fixture evidence.
