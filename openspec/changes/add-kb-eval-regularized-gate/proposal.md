## Why

kb ranking changes are judged by eyeballing `run-fixtures.ts` tables over the same two mined golden sets they are tuned on. Nothing separates a real gain from sampling noise (n≈104/108 items), nothing holds items back to detect overfitting the fixtures, and nothing records what was tried — so failed ideas get re-tested and small fixture-fitted wins ship as defaults. RRSI (Xia et al., arXiv 2609.24972) shows the fix is to regularize the *selection* of changes, not the ranker: a noise-adjusted floor, a held-out split, a cost rule, and a ledger.

## What Changes

- `evaluate` gains **opt-in** per-item records (query, expected path, rank, page dup share); default output — and so `kb eval` — unchanged.
- Golden items split deterministically into **evolve** and **held-out** by SHA-1 of the normalized query — no fixture edits, stable across re-mines; duplicate queries counted once.
- New **gate**: seeded paired bootstrap over items on three signals (reciprocal rank, hit, dup share) → `gain` / `noise` / `regress` per fixture × split. Regressions veto at an 80% interval, gains need 95% — conservative by design.
- **Acceptance rule**: pooled-evolve reciprocal-rank `gain` AND no signal `regress` anywhere. Makes the existing "Fixtures gate ranking changes" regression criterion measurable.
- **Cost rule**: a candidate >1.25× and ≥0.5 ms slower (median, interleaved timing) also needs a pooled held-out `gain`.
- **Baseline = current shipped config** (same options path as `kb eval`), not the frozen pre-change reconstruction; `--baseline pre-change` kept for the seed entry.
- **Ledger**: `run-fixtures.ts --gate --hypothesis "<text>"` writes one JSON record file per run under `packages/kb/eval/ledger/` (conflict-free across worktrees) with seed, intervals, verdicts, decision, git sha + dirty diff hash, fixture hash, index counts. No hypothesis → dry run, nothing written.
- `--gate` forces a fresh index; exit 0 accept / 1 reject / 2 harness error.

Out of scope (follow-ups): automatic proposal loop, hermes-memory usage-based pruning, doctrine/AGENTS.md evolution via `scripts/ab-context`.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `kb-retrieval-eval`: adds per-item rank output, deterministic evolve/held-out split, paired-bootstrap significance verdicts, cost rule, candidate acceptance rule, and an append-only experiment ledger.

## Impact

- `packages/kb/src/eval.ts` — opt-in `perItem` option → `items` field.
- `packages/kb/eval/` — new pure `gate.ts` (unit-testable like `sweep-rows.ts`), `run-fixtures.ts` `--gate`/`--hypothesis`/`--candidate`/`--baseline`/`--seed` flags, new `ledger/` directory.
- `packages/kb/src/__tests__/` — new gate tests.
- `packages/kb/AGENTS.md` — rows for new/changed files.
- No runtime search behaviour change; no CLI `kb eval` change; no new dependencies.

## Discipline Skills

- `doubt-driven-review` — the acceptance rule becomes the standard for every future kb ranking default; stress-test thresholds before they stand.
- `review-code` — before commit.
- No security / performance / observability triggers: offline eval tooling, no untrusted input, no runtime path.
