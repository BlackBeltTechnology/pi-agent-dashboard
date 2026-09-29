## 1. Opt-in per-item records

- [ ] 1.1 Add failing tests in `packages/kb/src/__tests__/retrieval-quality.test.ts` (or sibling): `evaluate(..., { perItem: true })` returns `items` with ranks `[1,3,0,2,0]` + query text, omits unreachable items, aggregates equal the non-per-item run, and without the option the report has no `items` key; verify they fail
- [ ] 1.2 Implement the opt-in `items` field in `packages/kb/src/eval.ts`; verify new + existing `packages/kb` eval tests pass and `kb eval --golden packages/kb/eval/golden.doc-example.json` output keys are unchanged

## 2. Pure gate module

- [ ] 2.1 Write `packages/kb/src/__tests__/eval-gate.test.ts` covering every delta-spec scenario (split stability, duplicate drop, three signals, 40/30 gain, 1-of-100 noise, recall-loss regress, seed determinism, 3 acceptance scenarios, ledger record fields, dry run); verify it fails
- [ ] 2.2 Implement `packages/kb/eval/gate.ts` (no fs/store/git imports); verify `eval-gate.test.ts` passes

## 3. Wire into run-fixtures

- [ ] 3.1 Add `--gate`, `--hypothesis`, `--candidate`, `--baseline`, `--seed`, `--latency-ratio`, `--holdout` to `packages/kb/eval/run-fixtures.ts`; `--gate` implies `--fresh`; baseline/candidate built from `searchOptsFromConfig(DEFAULTS, …)` per design D6; verify `--gate` without `--hypothesis` prints a decision and writes no file
- [ ] 3.2 Interleaved latency pass + ledger file write (git sha, dirty diff hash, fixture hash, index counts) + exit codes 0/1/2; verify two runs with `--hypothesis` create two record files under `packages/kb/eval/ledger/`
- [ ] 3.3 Run `tsx packages/kb/eval/run-fixtures.ts --gate --baseline pre-change --hypothesis "seed: shipped default vs pre-change"` and commit the first record; note the decision in this task line

## 4. Docs + closeout

- [ ] 4.1 Update `packages/kb/AGENTS.md` rows for `src/eval.ts`, `eval/run-fixtures.ts`, new `eval/gate.ts`, `eval/ledger/` (See change: add-kb-eval-regularized-gate); verify `kb dox lint` reports nothing for them
- [ ] 4.2 Run `review-code` on the diff and `set -o pipefail; cd packages/kb && npm test 2>&1 | tee /tmp/kb-test.log`; verify zero failures
