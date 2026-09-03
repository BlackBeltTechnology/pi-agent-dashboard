# Tasks

> Scenario-design was not run for this scaffold; the test tasks below are hand-noted TDD steps.
> The pure scorer is CI-tested; live-model runs are a manual diagnostic (never a CI gate).

## 1. Preconditions (read before writing)

- [ ] 1.1 Read `packages/kb/src/eval.ts` + `packages/kb/src/cli.ts` (`eval` command) — the
  golden-set + pure-`evaluate()` + CLI pattern this harness mirrors.
- [ ] 1.2 Read `packages/server/src/grammar/backends/llm.ts` (`checkWithLlm`, `LlmModelRegistry`,
  `LlmStreamFn`) and the `server.ts` `getModelRegistry` / `streamSimple` wiring — the seam the
  live run reuses.
- [ ] 1.3 Read `packages/shared/src/grammar-types.ts` (`GrammarCheckResult`, `GrammarSuggestion`)
  — the result shape the scorer consumes.
- [ ] 1.4 Confirm the M2 and JFLEG on-disk formats (spec sources) and pick the scoring split
  (BEA-2019 **dev** — test has no public gold).
- [ ] 1.5 Run `npm test 2>&1 | tee /tmp/grammar-eval-baseline.log` — green baseline.

## 2. Pure scorer (TDD — CI-tested)

- [ ] 2.1 Create synthetic fixtures `packages/server/src/grammar/eval/__fixtures__/` — ~10
  hand-authored M2 lines (incl. no-edit sentences), labelled as test fixtures, not a benchmark.
- [ ] 2.2 (TDD) `m2.test.ts` first: parse gold edits from M2; derive system edits from
  `(input, correctedText)` via token-level Levenshtein alignment. Verify red → green.
- [ ] 2.3 Create `eval/m2.ts` — M2 parser + system-edit extraction.
- [ ] 2.4 (TDD) `score.test.ts` first: edit-level P/R/**F0.5** (β=0.5) — perfect=1.0; spurious
  edit hits precision harder than recall; suggestion-level P/R from `suggestions[]`;
  edit-distance improvement (token+char, best-of multi-ref); over-correction rate incl. the
  no-clean-items not-applicable case. Verify red first.
- [ ] 2.5 Create `eval/score.ts` — implement the metrics to pass 2.4.
- [ ] 2.6 (doubt-driven-review) Validate P/R/F0.5 against the hand-checked fixture values;
  document the MaxMatch-approximation divergence from the official M2 scorer in the module
  header.

## 3. Dataset loaders

- [ ] 3.1 Create `eval/dataset.ts` — load from a local `--dataset` path; support `format`
  `m2` and `jfleg` (`.src` + N `.ref`); flag no-edit items; no network, no vendored corpus.
- [ ] 3.2 (TDD) `dataset.test.ts`: M2 + JFLEG parse over fixtures; missing/unreadable path
  → clean non-zero error pointing to the acquisition docs (no model calls).

## 4. Live-run CLI + script

- [ ] 4.1 Create `eval/run.ts` (CLI): flags `--dataset --format --limit --concurrency
  --provider --model --judge --dry-run`; default provider/model from `config.grammar.llm`.
- [ ] 4.2 Bootstrap the model runtime via the server seam (`getModelRegistry` + `streamSimple`);
  call `checkWithLlm` per item with bounded concurrency; (performance-optimization) honour
  `--limit` + concurrency; measure per-check latency.
- [ ] 4.3 (security-hardening) Ensure no credentials/headers/raw provider bodies are ever
  logged; cap spend via `--limit`.
- [ ] 4.4 `--dry-run` runs loader + scorer with **no** model calls (self-test); exits zero when
  they agree.
- [ ] 4.5 Add `"grammar:eval"` script to `packages/server/package.json`.

## 5. LLM-as-judge (optional, non-authoritative)

- [ ] 5.1 Create `eval/judge.ts` — `--judge <provider/model>` scores `(input, output, gold)` on
  a fixed rubric (correctness 1–5, over-correction y/n) at temperature 0; off by default.
- [ ] 5.2 Reporting keeps judge scores in a separate section; they never affect pass/fail.

## 6. Reporting

- [ ] 6.1 Print a metrics table: headline (correctedText) P/R/F0.5, suggestion P/R,
  edit-distance improvement, over-correction rate, latency p50/p95, n; optional judge block.

## 7. Tests

- [ ] 7.1 Run `npm test` — scorer/loader unit tests green.
- [ ] 7.2 `--dry-run` smoke over the fixtures passes with no model calls.
- [ ] 7.3 Run `npm run quality:changed` and clear new findings.

## 8. Docs

- [ ] 8.1 (DocScribe, caveman style) `docs/architecture.md` — "Grammar correction eval" note:
  where to obtain JFLEG/BEA-2019, how to run `grammar:eval`, how to read the metrics,
  diagnostic-not-a-gate + datasets-not-vendored.
- [ ] 8.2 Directory `AGENTS.md` rows for the new `eval/` files.

## 9. Verify + land

- [ ] 9.1 `openspec validate add-grammar-correction-eval --strict` passes.
- [ ] 9.2 (review-code) inline review before commit.
- [ ] 9.3 Manual: run `grammar:eval` against a downloaded BEA-2019 dev / JFLEG set with a
  configured `llm` provider; sanity-check the metrics.

## Open questions

- [ ] O.1 One extra metric ("Other") was requested but left undescribed — fold it in once
  specified (add a scorer test first).
