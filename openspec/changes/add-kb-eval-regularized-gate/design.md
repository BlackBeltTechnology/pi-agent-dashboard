## Context

- `packages/kb/src/eval.ts` `evaluate()` computes aggregates only; per-item rank + page dup share are loop-locals. Reachability (`isUnreachable`) is private and filesystem-dependent.
- `packages/kb/src/cli.ts` `kb eval` prints `JSON.stringify(evaluate(...))` — any new `EvalMetrics` field changes CLI output.
- `packages/kb/eval/run-fixtures.ts` indexes the repo on import (not unit-testable), caches the index in `$TMPDIR/kb-eval-fixture-index` unless `--fresh`, and scores hand-pinned `VARIANTS` against a frozen pre-change `BASELINE`. Pure logic lives beside it in `eval/sweep-rows.ts` (tested in `src/__tests__/sweep-rows.test.ts`).
- Existing spec scenario "Fixtures gate ranking changes": Recall@K drop or dup-share rise = regression. The gate must honour it.
- kb search is deterministic; the noise that matters is **item sampling** (~100 mined queries per fixture), not run-to-run variance.
- `golden.doc-example.paraphrase.json` targets a different corpus → unusable as repo held-out.
- `golden.markdown-intent.json` has 1 exact-duplicate query.

## Goals / Non-Goals

**Goals:** pure, seeded, unit-tested gate; single `--gate` entry point in `run-fixtures.ts`; conflict-free ledger.

**Non-Goals:** automated candidate proposal, config leakage critic, `kb eval` CLI changes, fixture re-mining, CI wiring, hermes-memory pruning, doctrine evolution.

## Decisions

**D1 — Noise floor = paired bootstrap over items.** Seeded mulberry32 (default seed 1, recorded), B=2000, resample record indices, mean Δ per signal.
- Alt: re-run baseline N times (RRSI literal) → zero variance for deterministic search. Rejected.
- Alt: fixed Δ threshold → ignores n/spread. Rejected.
- Alt: Wilcoxon → no interval to log, more code. Rejected.

**D2 — Three signals, asymmetric thresholds.** Reciprocal rank (headline), hit (= Recall@K per item), −dupShare (existing regression criteria). `gain` needs the 95% lower bound > 0; `regress` fires when the 80% upper bound < 0. Vetoing at 80% makes the gate conservative: a small held-out (~30 items) can still veto a moderate regression that a 95% interval would call `noise`. Cost: more false rejections — acceptable, rejecting a real gain is cheap (re-test later), shipping a regression is not.
- Alt: formal non-inferiority margin δ → with n≈30 the 95% interval width (~±0.1 MRR) rejects almost every candidate. Rejected.

**D3 — Pooled evolve gain (multiplicity control).** Gain is tested once over pooled evolve records of both fixtures, not "either lane", so a pure-noise candidate has one ~2.5% shot, not two. Per-lane/per-split checks only veto.

**D4 — Split by SHA-1 of normalized query**, big-endian uint32 / 2^32 < 0.3. Depends only on `q`; fixture files untouched; re-mines keep existing items in place. Duplicate queries dropped (first wins) before split + stats.
- Alt: `split` field in fixtures / seeded shuffle → drift on re-mine. Rejected.
- Held-out is clean only prospectively: past sessions saw all items. Documented, accepted.

**D5 — Opt-in per-item output.** `evaluate(store, golden, { …, perItem: true })` adds `items: Array<{ q, expect, rank, dupShare }>`; absent otherwise → `kb eval` output byte-identical. Records carry `q`, so `eval/gate.ts` splits and aligns by query text with no fs access and no knowledge of reachability. Baseline and candidate are aligned by `q`; a mismatch in record sets throws (harness error).

**D6 — Baseline = current shipped config.** Default baseline/candidate options come from `searchOptsFromConfig(DEFAULTS, { sources, overrides: { expandGraph: false, rerank: false } })` — the exact `kb eval` path — with `--candidate '<json overrides>'` layered on for the candidate. `--baseline pre-change` selects the existing frozen `BASELINE` (used once to seed the ledger). This stops candidates being judged against an ancient config.

**D7 — Fresh index under `--gate`.** `--gate` implies `--fresh` (minutes of wall time, accepted) so the ledger's git state describes the corpus actually searched; index file/chunk counts are recorded.

**D8 — Cost rule.** Latency is measured interleaved (baseline query i, candidate query i) to cancel warm-up drift; median per-query ms compared; rule fires only when ratio > 1.25 AND absolute delta ≥ 0.5 ms. This is the one non-deterministic input; it is recorded, and the margin keeps flip-flopping to near-threshold cases. Interleaving needs one extra timing pass in `run-fixtures.ts` via `store.search` (not `evaluate`).

**D9 — Ledger = one JSON file per record** at `packages/kb/eval/ledger/<ISO-timestamp>-<slug>.json`. Worktrees never conflict (no shared appended file). Record fields per spec; `gitSha`, `gitDirty`, `diffHash` (sha256 of `git diff HEAD`), `fixtureHash` (sha256 of both fixture files), `index: {files, chunks}`, `seed`. `--hypothesis` absent → dry run, nothing written. Exit code: 0 accept, 1 reject, 2 harness error.

**D10 — Module layout.** `src/eval.ts` (opt-in `items`), `eval/gate.ts` (pure: `dedupe`, `splitRecords`, `pairedBootstrap`, `verdicts`, `decide`, `ledgerRecord`), `eval/run-fixtures.ts` (flags, fresh index, interleaved latency, fs/git I/O).

## Risks / Trade-offs

- [80% veto rejects some real gains] → by design (D2); re-test with more data after a re-mine.
- [Repeated gating on the same evolve split still overfits] → ledger count of attempts is visible; rotating the split salt is a follow-up.
- [Shipped default may fail vs pre-change baseline] → that is a finding to record in the first ledger entry, not a blocker.
- [Fresh index slows each gate run] → correctness over speed; gate is a pre-default-change step, not an inner loop.
- [Citation arXiv 2609.24972 taken from the project page BibTeX] → only motivates "Why"; the method is adapted, not reproduced.
