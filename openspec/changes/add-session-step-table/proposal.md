# Extract a labeled step table from the pi session corpus

## Why

Every proposal in the "learn from sessions" family — a doctrine bandit, a wasted-step
gate, `add-lora-dataset-export-skill` — needs the same thing first: the 1.28 GB of
session JSONL turned into **rows with features and outcome labels**. None of them can be
evaluated without it, and today each would re-derive its own ad-hoc extraction.

The corpus is large enough that this is worth doing properly, and a throwaway scan
already overturned two planning assumptions (below). The distiller
(`packages/session-distiller`) already owns parsing, tool-call pairing, and episode
segmentation; what is missing is a **feature/label emitter** on top of it.

This change produces a dataset and a report. It trains nothing and changes no agent
behaviour.

## Baseline — derive it, do not trust it

The numbers below come from an exploratory scan (regex heuristics over raw JSONL, not
the distiller's typed layer). They exist to size the work and to give task 7 a
falsification target. **The extractor's own output is the authority; a task explicitly
re-derives each row through `buildTrajectory` and reconciles the delta.**

**Every figure below is from an ad-hoc probe, not shipped code.** Successive probe
versions disagree slightly (629 vs 640 test invocations; 25/275 vs 25/278 log-reread
yield) because the detector changed between runs. Treat them as ± a few percent and
directionally load-bearing only; task 7 re-derives them all through the real extractor.
The `≥250 KB` size filter used throughout is likewise a probe proxy that the design
deliberately replaces with a tool-call threshold.

This section has already been rewritten once. The first pass shipped three wrong numbers
because its test-invocation detector matched the **serialized arguments JSON** rather than
the executed command — so every `Write` whose file content mentioned "test", and every
analysis script containing the string "vitest", counted as a test run. That inflated test
invocations 5.2× and poisoned every label derived from them. The corrected detector
matches only shell tools, only `arguments.command`, and only at a command position. The
correction is preserved here because it is the single most likely way this change fails
in implementation.

Corpus as of 2026-08-06, `~/.pi/agent/sessions/**/*.jsonl`:

| | Sessions | Bytes |
|---|---:|---:|
| all | 3,165 | 1,284 MB |
| <50 KB | 1,049 | 23 MB |
| 50–250 KB | 1,221 | 114 MB |
| 250 KB–1 MB | 555 | 298 MB |
| 1–5 MB | 318 | 542 MB |
| >5 MB | 22 | 308 MB |

The corpus is **bimodal**: 895 sessions ≥250 KB carry 89% of all bytes. Deep scan of 300
of them (419 MB):

| Measure | Value |
|---|---|
| tool calls | 34,747 (median 98/session, max 465) |
| thinking blocks | 21,632 (median 61/session) |
| user turns | 1,434 |
| tool results with `isError === true` | 1,222 = **3.5% of calls** (typed field, authoritative) |
| sessions reading one file ≥3× | 117 (39.0%) |
| grep-before-`kb_*` sessions | 206 vs 94 kb-first |

Test-derived measures, before and after the detector fix (same 300 sessions):

| Measure | Contaminated | **Corrected** |
|---|---:|---:|
| test invocations | 3,293 | **629** |
| sessions invoking tests | 86.3% | **53.0%** |
| red→green | 66.3% | **9.7%** (18.2% of test-bearing) |
| red-only | 7.7% | **23.7%** |
| green-only | — | 8.3% |
| no test signal | — | 58.3% |
| positive : negative class balance | 54 : 2 | **54 : 71 ≈ 1:1** |

Two findings changed the plan:

1. **User corrections are not a usable label.** 12 correction-flavoured user turns in
   1,434 (0.8%). The distiller's `user_correction` signal is fine for rare high-value
   artifacts; it cannot supervise anything. Any design that leans on it is wrong.
2. **69% of substantial sessions violate the repo's own top-of-`AGENTS.md` rule**
   ("Docs-First Gate — kb before grep"), a rule injected into every turn of every
   session. This is the first quantified evidence that injected prose does not reliably
   change behaviour at the decision point — and it makes `doctrine_order` a first-class
   column, not an afterthought.
3. **The repo's testing doctrine destroys the outcome label.** `AGENTS.md` → "Running
   Tests" instructs `npm test 2>&1 | tee /tmp/pi-test.log`, then grep. Measured
   consequence over 629 real test invocations:

   | | Count | Effect |
   |---|---:|---|
   | piped through `tee`/`grep`/`tail`/`head` | 626 / 629 (99.5%) | — |
   | with `set -o pipefail` | **0** | exit status becomes the *pipe tail's*, so `isError` is `false` on every failing test run |
   | verdict unrecoverable from output text | 267 / 626 (42.7%) | `tail`/`grep` discards the vitest summary line |
   | empty grep output usable as an implicit "green" | 6 / 185 (3.2%) | not a viable fallback |

   Both channels — exit status and summary text — are severed by the same one-line
   habit. **The context-saving doctrine and the supervision signal are in direct
   conflict**, and today the doctrine wins silently. This is upstream of everything
   else in this change: no feature engineering recovers a label that was never written
   down.

Time span: 2026-03 → 2026-08, with 2,192 of 3,165 sessions in 2026-07 alone. 1,923 are
`pi-agent-dashboard`.

**Harness contamination — the planning heuristic was backwards.** An earlier draft assumed
the 608 `--private-tmp--` sessions were `scripts/ab-context` runs. Verified against
`scripts/ab-context/arms.json`, they are not: those sessions have `cwd: /private/tmp` and
assorted models — ordinary scratch work. The real arms are `A = <repo root>` and
`B = <repo root>/.worktrees/ab-trimmed`, and the 26 arm-B sessions (run with doctrine
deliberately removed) would have been tagged `project = pi-agent-dashboard` and **included**
in the default report. The heuristic would have excluded the innocent population and kept
the contaminating one. `harnessArm` is therefore derived from `arms.json` by `cwd` match;
no arm marker exists in any session JSONL (grep-verified).

## What Changes

- **Scoped to this repository's sessions** (cwd under the repo or its `.worktrees/*`) —
  **2,264 in scope, 908 out, 0 with a missing `cwd`** (measured by reading each session
  header, not by directory name). `doctrineEra`, `harnessArm`, and `kbBeforeGrep` are all defined by
  *this* repo's `AGENTS.md` and `scripts/ab-context/arms.json`; applying them across the
  ~348 session directories of unrelated projects would be meaningless. Every statistic
  therefore describes one developer on one repository, stated as a precondition rather
  than buried as a caveat.
- **One shared-type change outside the new module**:
  `packages/session-distiller/src/types.ts` declares `ToolResult.isError` as **required**
  `boolean`, so `trajectory.ts` coerces a missing field to `false` — a silent green in the
  primary step-level error label. It becomes `isError?: boolean` with consumers updated.
  Deliberately beyond the original single-module scope, because absence is destroyed at
  the type level and no care inside the new module can recover it.
- **New module `packages/session-distiller/src/steptable.ts`** (+ CLI entry) that emits
  two JSONL tables and a stats report. No new JSONL parser: it drives the existing
  `readSession` → `buildTrajectory` (which pairs tool calls internally) → `segment` path.
- **`steps.jsonl`** — one row per tool call, carrying only **derived features and labels**,
  never transcript text. Schema pinned in the delta spec.
- **`episodes.jsonl`** — one row per segmented episode, carrying the terminal outcome
  label and episode-level aggregates.
- **`report.md`** — counts, label densities, class balance, per-month and per-model
  breakdown, and the univariate correlation of each doctrine feature against the episode
  outcome label. This report is the deliverable a human reads; the tables are what a
  later model consumes.
- **Text-free by construction.** Because rows hold numbers, enums, tool names, and
  hashed path identifiers — not prompts, diffs, or file contents — this change does
  **not** depend on `scrub.ts` / `add-automatic-session-kb-index`. Free-text emission is
  out of scope and a test enforces it.
- **Incremental**: reuses `watermark.ts` so a re-run processes only newer sessions.
- **Provenance columns** (`model`, `startedAt`, `project`, `harnessArm`) so downstream
  work can weight by recency, stratify by model, and exclude ablation runs. Recency
  decay and weighting are downstream decisions, not baked in here.
- **`verdictObservable` is a first-class column, and the unobservable rate is a headline
  report metric.** An episode whose test verdict was destroyed by piping is labelled
  `unobservable`, never silently folded into `no-signal` or `green`.

## Non-goals

Explicitly out of scope, to keep this landable and to keep the dataset honest:

- No model, no training, no gate, no bandit.
- No runtime behaviour change **except** the `ToolResult.isError` optionality fix, which
  genuinely changes distiller fault/episode classification for results lacking the field.
  That is a bug fix, not a neutral refactor, and is called out rather than hidden under a
  blanket non-goal.
- No natural-language output, no LLM in the pipeline — the extractor is deterministic.
- No claim about *which* doctrine helps. The report shows correlations; correlations from
  observational session data are confounded, and the spec says so in the report header.
  Causal claims remain the job of `scripts/ab-context`.

## Capabilities

### Added Capabilities

- `session-step-table` — deterministic, incremental extraction of a feature/label table
  from pi session JSONL, with a stats + correlation report.

## Discipline Skills

- `security-hardening` — the input corpus contains secrets, tokens, and PII; the
  text-free invariant is the control and needs adversarial review.
- `performance-optimization` — a full cold pass reads ~1.2 GB; needs a stated budget and
  a streaming (not read-whole-file) implementation.
- `doubt-driven-review` — the feature schema is the interface every downstream consumer
  binds to; getting it wrong is expensive to undo.
- `review-code` — non-trivial new module before commit.

## Impact

- **Scope**: one new module + CLI flag in `packages/session-distiller` (~350–450 LOC +
  tests), plus a one-field optionality change to that package's shared `ToolResult` type
  and its consumers. No server, no client, no extension changes. Nothing is injected into
  any session.
- **Invocation**: manual CLI (`--step-table`). Not wired to any lifecycle trigger.
- **Output location**: `~/.pi/agent/distill-session-knowledge/<cwd-hash>/steptable/`,
  alongside the existing watermark state.
- **Risk**: low — read-only over session logs, writes only to its own state directory.
  The real risk is schema regret, addressed by `featureSchemaVersion` + the review gate.
- **Sequencing**: no dependency on `add-automatic-session-kb-index` (deliberately, via
  the text-free invariant). `add-lora-dataset-export-skill` stays independent — it needs
  text and masking, this needs features and labels; they share only the distiller's
  trajectory layer.
- **Recommended companion change (not owned here)**: make test invocations
  verdict-preserving — add `set -o pipefail` (or an explicit `echo "EXIT=${PIPESTATUS[0]}"`)
  to the `AGENTS.md` "Running Tests" recipe. One line, zero added context cost, and it
  restores the exit-status channel for all *future* sessions. This change deliberately
  does not depend on it: the extractor must work on the corpus as it exists, and must
  report how much of it is unobservable.
