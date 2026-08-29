# Make kb retrieval measurable — unstale the CLI build and stop dropping ranking config

> Blocks `fix-kb-search-lane-composition`. Any retrieval claim measured today is
> invalid; this change fixes the instrument before anyone tunes the engine.

## Why

Two independent defects make every `kb` retrieval measurement wrong, and both were
hit while investigating real `kb_search` quality.

**1. The CLI runs a different engine than the agent.**
`packages/kb/dist/` is dated 2026-08-05; `packages/kb/src/sqlite-store.ts` is
2026-08-13 (the `fix-kb-search-retrieval-quality` ship). The built artifact contains
no `laneQuota`, no `suppressedSections` anywhere in the artifact (`render.js` does
exist — an earlier "no render.js" claim here was wrong; the stale-engine diagnosis
stands on the missing ranking features).

- the extension resolves to `packages/kb/src/index.ts` (fresh engine)
- the `kb` bin resolves to `packages/kb/dist/cli.js` (pre-fix engine)

So `npx kb search` / `npx kb eval` measure code that shipped a week before the
retrieval fix. Measured cost of the confusion: source-intent Recall@10 reads
**0.144** on `dist` versus **0.495** on `src` — a 3.4x understatement. `laneQuota`
also appears to be a dead parameter (identical output at 0 and at 1) purely because
it does not exist in `dist`.

**2. `kb eval` structurally cannot measure the shipped ranking.**
`packages/kb/src/cli.ts:294` calls `evaluate(store, golden, { k, docType })`. It drops
every ranking option that `packages/kb-extension/src/extension.ts` passes to
`store.search`: `fieldWeights`, `proximityBoost`, `diversity`, `sourceDedup`,
`laneQuota`, `coverageRerank`, `queryExpansion`, `prf`, `expandParent`, `rootPriority`.
The eval therefore scores a bare BM25 path no agent ever exercises.

**3. The bundled golden sets cannot be run by the documented command.**
`kb eval --golden packages/kb/eval/golden.source-intent.json` fails with
`golden is not iterable` — the fixtures are objects (`$provenance`/`intent`/`minedAt`/`n`/`items`)
while the CLI expects a bare array. Worse, once unwrapped they still score 0 on every
query: `eval.ts:38` matches `r.path.includes(g.expect)`, but `expect` is repo-relative
(`packages/foo/...`) while the index stores paths relative to each configured root.
A silent all-zero result reads as "retrieval is broken" rather than "fixture is
mis-shaped". 7 of 104 source-intent and 48 of 108 markdown-intent targets additionally
point at `tests/`, `qa/`, `scripts/` and `docker/`, which are not configured roots and
are unreachable by construction.

## What Changes

- **Rebuild `packages/kb/dist` and gate it.** Add a CI check (or a `prepare` script)
  that fails when `dist` is older than `src`, so the bin and the extension can never
  diverge again.
- **Thread ranking config through `kb eval` and `kb search`.** `cli.ts` builds the
  same option object `extension.ts` does — extracted into one shared
  `searchOptsFromConfig(cfg, overrides)` helper in `packages/kb` so the tool and the
  CLI cannot drift apart a third time.
- **Accept both fixture shapes** in `--golden`: a bare array, or an object with an
  `items` array. Emit a clear error naming the expected shape instead of
  `golden is not iterable`.
- **Normalize golden `expect` paths against configured roots** when scoring, and
  **report unreachable items separately** (`expect` outside every configured root)
  rather than silently counting them as misses.
- **Fail loudly on a vacuous eval**: when Recall@K is 0 across the whole set, exit
  non-zero with a diagnostic — an all-zero score is a harness fault far more often
  than a retrieval fault.

## Capabilities

### Modified Capabilities

- `markdown-knowledge-base` — the eval surface gains a defined fixture contract,
  root-relative path normalization, and parity with the tool's search options.

## Impact

- No change to indexing, ranking behaviour, or the tool's output shape. This change
  only makes existing behaviour observable.
- Expect published eval numbers to move sharply on rebuild; that is the defect being
  corrected, not a regression. Record fresh baselines after landing.
- `packages/kb/eval/run-fixtures.ts` builds its own index and is unaffected, but should
  be pointed at the shared helper for consistency.

## Discipline Skills

- `doubt-driven-review` — this change exists because a measurement was trusted without
  verifying the instrument; the fix itself must not repeat that. Verify the rebuilt
  `dist` actually contains `laneQuota` before claiming parity.
- `systematic-debugging` — the src/dist divergence was found only by probing a feature
  token rather than reading mtimes. Root-cause each remaining eval discrepancy the same
  way instead of patching symptoms.
- `review-code` — `searchOptsFromConfig` becomes a shared contract between the CLI and
  the extension; review the extraction for behavioural equivalence at both call sites.
