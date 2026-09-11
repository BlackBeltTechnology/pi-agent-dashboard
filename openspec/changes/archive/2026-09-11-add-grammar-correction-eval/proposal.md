# Evaluate how good the `llm` grammar correction is

## Why

The `llm` grammar backend (`checkWithLlm`) now produces a `correctedText` + `suggestions[]`,
but we have **no measure of quality** — the existing tests only assert plumbing (JSON parses,
offsets re-locate), not whether corrections are actually right. Prompt tweaks, model swaps, or
the recent OAuth rewire could silently regress accuracy and we'd never know. This change adds
an **offline evaluation harness** that scores the `llm` backend against standard GEC benchmarks,
mirroring the existing `packages/kb/src/eval.ts` diagnostic pattern (pure scorer + golden data +
CLI, run manually — not a CI gate).

### Assumptions (please correct)

- **`llm` backend only.** LanguageTool is deterministic and third-party; scoring it is a
  separate concern. (Your choice.)
- **Datasets are NOT vendored.** JFLEG / BEA-2019 have their own licenses; the harness loads
  them from a user-supplied local path (`--dataset`), documents where to get each, and ships
  only tiny synthetic fixtures for the scorer's unit tests.
- **Diagnostic, not a gate.** Live-model runs are non-deterministic and cost tokens, so the
  eval is opt-in (`npm run grammar:eval`) and never blocks CI. Only the pure scorer is
  unit-tested in CI.
- **English first.** The loader has a seam for a Hungarian M2 set later; no hu benchmark now.

## What Changes

- **NEW** eval module `packages/server/src/grammar/eval/` (pure, deterministic, unit-tested):
  - `m2.ts` — parse M2-format gold edits (BEA-2019 dev / CoNLL-2014); derive *system* edits
    from `(original, correctedText)` via token-level Levenshtein alignment.
  - `score.ts` — the metrics: edit-level **Precision / Recall / F0.5** (simplified MaxMatch/M2,
    β=0.5), **suggestion-level P/R** (scores the backend's own `suggestions[]` spans vs gold),
    **edit-distance improvement** (Levenshtein(input,ref) − Levenshtein(output,ref), token +
    char), **over-correction rate** (fraction of no-edit sentences the system altered), and
    per-check **latency** (p50/p95).
  - `dataset.ts` — loaders for M2 (edit-level metrics) and JFLEG multi-reference (fluency /
    edit-distance), reading a local path; no network, no vendored corpus.
  - `judge.ts` — optional **LLM-as-judge**: a judge model scores `(input, output, gold)` on a
    fixed rubric (correctness 1–5, over-correction y/n). Opt-in, reported separately, never
    part of pass/fail.
- **NEW** CLI + script `npm run grammar:eval` — loads a dataset, runs `checkWithLlm` per item
  (bounded concurrency + `--limit`, reusing the server's OAuth-aware model runtime), scores,
  and prints a metrics table (+ optional `--judge`). `--dry-run` self-tests the scorer with no
  model calls.
- **NEW** unit tests for the scorer (M2 parse, alignment, P/R/F0.5 math, edit-distance,
  over-correction) against synthetic fixtures — these run in CI.
- **DOCUMENTATION** — `docs/architecture.md` gets a short "Grammar correction eval" note (how
  to obtain datasets, run the harness, read the metrics); directory `AGENTS.md` rows for the
  new files.

## Capabilities

### New Capabilities

- `grammar-correction-eval` — an offline, opt-in harness that scores the `llm` grammar backend
  against local GEC benchmarks: edit-level F0.5, suggestion P/R, edit-distance improvement,
  over-correction rate, latency, and an optional LLM-as-judge score. Pure scorer is
  deterministic + unit-tested; live runs never gate CI; datasets are loaded, not vendored.

### Modified Capabilities

- _None._ The `grammar-check-service` contract is unchanged; the harness is a read-only
  consumer of `checkWithLlm`.

## Out of Scope

- **LanguageTool evaluation** — deterministic third-party engine; a separate concern.
- **CI gating on live-model output** — non-deterministic + token cost; the harness is a
  manual diagnostic (only the pure scorer is CI-tested).
- **Vendoring JFLEG / BEA-2019 / CoNLL-2014 into the repo** — licensing; loaded from a local
  path instead.
- **ERRANT-grade error-type classification** — the scorer is span-level MaxMatch/M2, not a
  linguistic error-type tagger. (Noted as a divergence in `design.md`.)
- **Prompt / model auto-tuning loops** — the harness *informs* those; it doesn't run them.
- **A Hungarian benchmark** — English first; loader seam left for a hu M2 set later.

## Discipline Skills

doubt-driven-review (the F0.5 / MaxMatch scorer math is subtle and easy to get wrong — the
metric definitions must be stress-tested against a known reference before results are trusted);
performance-optimization (bounded concurrency, `--limit`, and a token/cost cap must keep a
live run cheap and fast; latency is itself a reported metric); security-hardening (the harness
sends benchmark text to a provider and resolves creds server-side via the fixed OAuth path —
must not log credentials and must cap spend; the judge model is the same).
