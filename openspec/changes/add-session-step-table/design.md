## Context

`~/.pi/agent/sessions/**/*.jsonl` holds 3,165 sessions / 1,284 MB spanning 2026-03 →
2026-08. 895 of those sessions (≥250 KB) carry 89% of the bytes and ~104k tool-call steps.
Every downstream "learn from sessions" idea — a doctrine bandit, a wasted-step gate,
`add-lora-dataset-export-skill` — needs the same feature/label table, and today each would
re-derive its own extraction.

`packages/session-distiller` already owns the hard parts: `readSession` (JSONL),
`buildTrajectory` + `pairToolCalls` (call↔result pairing via `toolCallId`), `segment`
(episode boundaries), and `watermark.ts` (incremental state). What is missing is a
feature/label emitter.

The planning exploration produced three constraints that shape this design more than any
requirement in the proposal:

1. **Three successive measurement errors** came from over-permissive matching — matching a
   test-runner pattern against the serialized arguments object (5.2× inflation), borrowing
   a neighbouring run's verdict and calling it recovery (71% → 9%), and treating a
   structurally unavailable feature as a zero-valued observation (green bias). All three
   produced plausible numbers. None announced itself.
2. **The corpus is not a clean sample.** It is single-subject, 61% one project, 68% one
   month, spans a mid-corpus doctrine change, and contains ablation runs from
   `scripts/ab-context` in which doctrine was deliberately removed.
3. **The dominant label is partly missing by construction.** The pre-fix `AGENTS.md` test
   recipe piped through `tee`/`tail`/`grep` without `pipefail`, severing exit status in
   100% of runs and the summary text in 42.7%.

## Scope: this repo's sessions only

The extractor processes **only sessions whose recorded `cwd` is under this repository**
(including its `.worktrees/*`). Measured by reading each session header: **2,264 in scope,
908 out of scope, 0 with a missing `cwd`**. (Directory-name counting suggested ~1,923 —
another reminder that the path string is not the header.)

*Rationale:* the corpus spans ~348 session directories across unrelated projects
(`judo-ng`, `invoicebot`, `Documents`, …). `doctrineEra` is defined by *this* repo's
`AGENTS.md`, `harnessArm` by *this* repo's `scripts/ab-context/arms.json`, and
`kbBeforeGrep` by *this* repo's doctrine. Applying any of them corpus-wide would be
meaningless for the majority of sessions. Narrowing also makes the single-subject skew an
explicit precondition rather than a caveat buried in the risks section.

*Consequence:* every statistic this change produces describes one developer working on one
repository. It is not a model of agent behaviour in general and must never be presented as
one.

## Goals / Non-Goals

**Goals:**

- One deterministic, incremental extractor producing `steps.jsonl`, `episodes.jsonl`, and
  a `report.md`, reusing the distiller's trajectory layer.
- Labels whose provenance and confidence are explicit, so a consumer can choose its own
  trust threshold without re-extracting.
- A dataset that is cheap and safe to throw away and regenerate.
- A report a human reads to decide what to test next with `scripts/ab-context`.

**Non-Goals:**

- No model, training, gate, bandit, or runtime behaviour change.
- No LLM anywhere in the pipeline. The extractor is deterministic; an LLM-judged label
  would be unreproducible and unauditable.
- No causal claims. Correlations from observational session data are confounded.
- No natural-language content in the output at all (see Decision 2).
- No repair of historical sessions. The corpus is evidence and stays immutable.
- No sessions from other projects. Cross-project generalisation is explicitly not attempted.

## Decisions

> **Provenance of every number in this document.** All measurements come from **ad-hoc
> exploratory probes** run during planning — throwaway scripts over the session corpus, not
> shipped code. Successive probe versions disagree slightly (629 vs 640 test invocations;
> 25/275 vs 25/278 log-reread yield) because the detector changed between runs. Treat every
> figure as ± a few percent and directionally load-bearing only. Task 7 re-derives all of
> them through the real extractor and publishes the delta. The `≥250 KB` figure used in
> Context is likewise the probe's file-size proxy, which D7 deliberately replaces.

### 1. Emitter on the distiller's trajectory layer, not a new pipeline

Reuse the existing chain: `readSession` → `buildTrajectory` (which calls `pairToolCalls`
internally) → `segment`. A spec requirement forbids a second JSONL parser or a local
call/result pairing.

*Known gaps in the reused layer that this change must handle rather than inherit:*

- `trajectory.ts` sets `isError: m.isError === true`, so a paired result **missing** the
  field coerces to `false` — a silent green. See Decision 9.
- `pairToolCalls` keys a `Map` by `toolCallId`; duplicate ids mean last-write-wins, so a
  call can pair to an unrelated result and still look confidently labelled.
- `watermark.ts` advances a single max timestamp with a **strict** `tsMs > sinceMs`, and
  prefers the filename timestamp over mtime. That comparison — not the choice of anchor
  directory — is what permanently skips a resumed or copied session whose name-timestamp
  predates the watermark. The extractor needs per-file identity (path + size + mtime), not
  a single high-water mark. In-scope sessions span this repo plus its `.worktrees/*`, so
  several directories are still involved even after narrowing.

*Alternative considered:* a standalone extractor reading JSONL directly. Rejected — the
pairing and segmentation logic is subtle (`toolCallId` matching, name-change and time-gap
boundaries), already tested, and duplicating it guarantees drift between this table and
the LoRA export that shares the same upstream.

### 2. Rows carry features, never text

Numbers, enums, ids, and a hashed `pathKey` only. No prompt, output, diff, command
string, or absolute path.

*Rationale:* three benefits from one constraint. Privacy-by-construction over a corpus
known to contain tokens and PII; independence from `scrub.ts` (so no sequencing
dependency on `add-automatic-session-kb-index`); and a hard ceiling on output size.

*Alternative considered:* keep short text excerpts for debuggability. Rejected — an
excerpt is exactly where a secret leaks, and the raw JSONL is retained anyway, so any row
can be traced back via `sessionId` + `stepIndex` when a human needs the text.

*Trade-off:* this table can never feed a LoRA export. That is deliberate;
`add-lora-dataset-export-skill` needs text and loss masking and stays a separate consumer
of the same trajectory layer.

### 3. The table is a derived view, never a repaired artifact

Output is a pure function of (immutable JSONL × `extractorVersion`). Rows are never
hand-edited or back-filled; mixed versions refuse to append and force a full re-extract.

*Rationale:* this is the direct answer to "can we retroactively fix wrongly flagged
entries". Because the source is immutable and retained, every labelling bug — including
the three found during planning — is corrected by fixing the extractor and re-running.
There is no dataset-repair procedure to design, test, or get wrong.

*Alternative considered:* an append-only table with correction records. Rejected — it
makes every consumer implement correction-replay, and the full re-extract is cheap enough
(single-digit minutes over 1.2 GB) that incrementality is a convenience, not a necessity.

### 4. Label provenance is a column, and channels are ranked

`labelSource ∈ {direct, log-reread, behavioural, none}`, never merged into one "verdict"
field. Ranked by trust:

| Channel | Yield (planning measurement) | Policy |
|---|---|---|
| `direct` — verdict in the invocation's own result | 362 / 640 invocations | authoritative |
| `log-reread` — same log artifact re-read later, parsed | 25 / 278 destroyed (9.1%) | trusted |
| `behavioural` — inferred from subsequent actions | ~35 / 278 at 94.6% precision | red-only, abstaining |
| model's prose claim ("all tests pass") | agreement 2/5 with recovered truth | **rejected** |
| a neighbouring test run's verdict | — | **rejected** |

The last two are named explicitly because both are tempting and both were tried during
planning. Borrowing a neighbour's verdict is what turned a real 9.1% recovery rate into a
fictitious 71.1%.

### 5. Behavioural inference is one-directional: it may add failures, never successes

Measured feature lifts, P(f|red) ÷ P(f|green), over 362 directly-labelled invocations:

| feature | P(f\|red) | P(f\|green) | lift |
|---|---:|---:|---:|
| `readLog` | 57.3% | 3.4% | **16.9** |
| `grepFail` | 64.3% | 24.3% | 2.65 |
| `rerun` | 29.7% | 29.9% | 0.99 |
| `editTest` | 12.4% | 13.6% | 0.92 |
| `editSrc` | 10.8% | 14.1% | 0.77 |

Session-level 5-fold CV: accuracy 76.5% (majority baseline 51.1%), AUC 0.749, **precision
94.6%**, recall 57.3%. The signal is almost entirely `readLog` — *the model goes back and
re-reads the output*. The intuition that a failure provokes a code edit is refuted:
`editSrc`/`editTest`/`rerun` all sit at lift ≈ 1.0.

The inference may assign `red` and may never assign `green`.

*Rationale:* the failure mode being defended against is a false green, which is precisely
the bug that motivated the companion `pipefail` fix. A one-directional rule cannot
manufacture one. It also matches the classifier's shape — high precision, moderate recall —
so the abstain path is the common path by design, not by accident.

### 9. `isError` is tri-state; absent is not false

`ToolResult.isError` has three states that matter: `true`, `false`, and **absent**. The
reused `trajectory.ts` collapses absent to `false`. This change must distinguish them:
absent → `is_error = null` with a `errorFieldPresent = false` marker, counted in neither
class.

*Rationale:* this is the same bug as the `pipefail` finding, one layer down. "No evidence
of failure" silently became "evidence of no failure" — and if field presence correlates
with session age or tool, the resulting green bias is systematic rather than random. The
report must publish the field-presence rate per tool and per `doctrineEra`.

*Resolution (decided, not left open):* `packages/session-distiller/src/types.ts` declares
`isError: boolean` as **required**, so presence is already destroyed at the type level —
no amount of care in the new module can recover it. The two alternatives both failed:
re-reading the raw event is literally a second parse, which this change's own spec forbids
with a `SHALL NOT`; and leaving the collapse in place preserves a silent-green bias in
the error label, which is the precise bug class this change exists to expose.

So the shared type changes: `isError?: boolean`, with `trajectory.ts` preserving absence
and every existing distiller consumer updated. This deliberately widens the change beyond
its original single-module scope — accepted, because the alternative is a dataset whose
primary step-level label is quietly wrong.

### 6. Features are stratified by availability; "unavailable" ≠ 0

| population | writes a log | no log written |
|---|---:|---:|
| directly labelled (n=362) | 230 (63.5%) | 132 (36.5%) |
| verdict destroyed (n=278) | 80 (28.8%) | **198 (71.2%)** |

`readLog` cannot fire without a log artifact. Encoding its structural absence as `0`
makes the classifier predict green on 71.2% of the target population — 12.6% predicted
red against a 51.1% base rate. That is the original false-green bug rebuilt in statistics:
exit 0 and "did not inspect" both silently mean *pass*.

Fitting within the no-log stratum also recovers signal that pooling destroyed: base rate
there is 20.5% red (not 51.1%), and `rerun` carries lift 1.59 (not 0.99).

*Alternative considered:* impute the missing feature. Rejected — the missingness is
deterministic and correlated with the outcome, so imputation encodes the bias rather than
removing it.

### 7. Inclusion threshold is tool-call count, not file size

Default ≥20 tool calls, flag-overridable, reported.

*Rationale:* the ≥250 KB figure used throughout planning is a proxy that happens to work
on this corpus and would silently drift as transcripts change shape. Call count measures
the thing actually wanted — an episode with enough steps to carry signal.

### 8. Provenance columns instead of baked-in corrections

`model`, `startedAt`, `project`, `harnessArm`, `doctrineEra`, `extractorVersion`,
`featureSchemaVersion`. Recency decay, model stratification, and arm exclusion are
downstream decisions.

`doctrineEra` is load-bearing: sessions before and after the `AGENTS.md` `pipefail` fix
have genuinely different label-generating processes, and pooling them would train a model
across a discontinuity.

`harnessArm` is a safety column, and the planning heuristic for it was **exactly
backwards**. `scripts/ab-context/arms.json` is the source of truth:

```json
{ "A": "<repo root>", "B": "<repo root>/.worktrees/ab-trimmed" }
```

Verified against the corpus: the 608 `--private-tmp--` sessions have `cwd: /private/tmp`
and assorted models — ordinary scratch work, **not** harness runs. The genuine
doctrine-removed arm-B sessions live under
`--Users-robson-Project-pi-agent-dashboard-.worktrees-ab-trimmed--` (26 sessions) and
would have been tagged `project = pi-agent-dashboard` and **included** in the default
report. The heuristic excluded the innocent population and kept the contaminating one.

Corrected: `harnessArm` is derived by matching the session's `cwd` against the values in
`arms.json`, not by guessing from the directory name. No arm marker exists anywhere in the
session JSONL (grep-verified), so cwd matching is the only available signal, and the
extractor must fail loudly if `arms.json` is absent rather than silently tagging nothing.

**Matching is exact, longest-arm-first.** Arm B's path is a *subpath* of arm A's
(`<repo>/.worktrees/ab-trimmed` ⊂ `<repo>`), so a naive `startsWith` mis-tags every arm-B
session as arm A — silently restoring the exact contamination this column exists to
prevent. Sessions matching neither arm get `harnessArm = null` and are **included**;
only explicitly-tagged arms are excluded by default. `arms.json` holds machine-specific
absolute paths, so they are resolved relative to the repo root before comparison, keeping
the output independent of where the checkout lives.

Since the extractor is scoped to this repo, `doctrineEra` is now well-defined for every
row it emits, and is pinned to the commit that lands the `pipefail` fix.

## Risks / Trade-offs

- **Schema regret** — every downstream consumer binds to the field set. → `doubt-driven-review`
  gate at task 1.3, before the emitter exists; `featureSchemaVersion` forces a clean
  re-extract on any change.
- **A plausible-but-wrong extractor** — the failure mode that hit three times in planning,
  and it produces credible numbers rather than errors. → Task 7 reconciles against the
  recorded planning baseline, and task 7.4 requires reproducing the *broken* detector's
  5.2× gap as evidence the correct one is actually different.
- **Observational correlations read as causal** — the report will be read by humans who
  want a doctrine answer. → A spec requirement forces the confounding disclaimer into the
  same document and names `scripts/ab-context` as the causal instrument.
- **Behavioural labels drift** — the classifier is calibrated on this corpus, this user,
  these models. → Per-stratum precision published on every run; labels filterable by
  `labelSource`; consumers can discard them entirely with no re-extraction.
- **`readLog` is recipe-confounded** — the pre-fix `AGENTS.md` recipe *instructs* the agent
  to `tee` a log and then grep it, so "went back and re-read the log" is partly doctrine
  compliance, not spontaneous failure investigation. The 16.9 lift may therefore be
  measuring "followed the recipe" as much as "the suite failed", and the confound is
  strongest in exactly the era the feature is used on. → Report the lift separately per
  `doctrineEra`; if it collapses post-fix, the feature was compliance, not distress.
- **Calibration on the evaluation folds, and too few positives for the ceremony** — the
  ≥90% threshold and the reported precision would come from the same CV, which is
  threshold-on-test optimism. Nesting fixes the methodology but not the sample: with a few
  dozen positives split across folds, per-cell counts reach single digits and the interval
  spans most of [0,1]. → Nested split *plus* a stated minimum per-cell positive count below
  which the behavioural channel is **suppressed entirely** rather than reported with a
  meaningless interval. Correct-but-useless statistics are their own failure mode.
- **Cold-pass cost, and "streaming" overstated** — `readSession` is `readFileSync` of a
  whole session file, so reuse (Decision 1) means the pipeline streams *across* sessions
  but not *within* one. Peak RSS is bounded by the largest single in-scope session, and
  the bound is **not** that file's size: a whole-file Buffer, plus the parsed event graph
  (several× for text-heavy NDJSON), plus the retained `Trajectory` are live
  simultaneously. → Measure the real peak on the largest in-scope session and set the
  stated bound from that measurement. Do not derive it from file size, and do not claim a
  streaming guarantee the reused reader cannot provide.
- **Determinism is not free** — byte-identical output requires pinned JSON key order,
  pinned number formatting, and a **total** row order (`startedAt` alone ties at
  same-second granularity; `sessionId` + `stepIndex` are needed as tiebreakers). Any
  derived ratio invites float drift across platforms. → Emit integers and enums only where
  possible; pin serialization explicitly. The fixture-hash test runs against a **frozen
  fixture corpus committed to the repo**, never against the live sessions directory, which
  grows daily and cannot produce a stable hash.
- **`pathKey` is not anonymisation and must not be described as such** — the hash is
  brute-forceable against a repo file listing, and `project` / `startedAt` / `model` ship
  unhashed beside it, so the rows are trivially re-identifiable. The hash exists to keep
  path *strings* out of the output (bounding size and avoiding incidental secrets in
  paths), not to protect identity. → Accepted, and stated plainly so no downstream consumer
  infers an unlinkability guarantee that does not exist.
- **Single-subject corpus** — 61% one project, 68% one month. Anything fitted here models
  *this repo in July*. → Provenance columns make the skew measurable; the report breaks
  every statistic down by month and model. Not solvable, only surfaced.

## Migration Plan

New module and new output directory; nothing existing changes shape.

- Output under `~/.pi/agent/distill-session-knowledge/<cwd-hash>/steptable/`, beside the
  existing watermark state.
- No server, client, or extension change; nothing to rebuild or restart.
- Rollback = delete the output directory. There is no persistent state to unwind and no
  consumer in this change.
- Forward migration on any schema or extractor change = full re-extract, triggered
  automatically by a version mismatch.

## Open Questions

- **Which test runners count?** Narrowing to this repo makes the runner set tractable
  (`npm test`, `npm run test:*`, `vitest`, `playwright test`, via `npx`/`pnpm`), but the
  list must still be explicit in source and printed in the report so an unlisted runner is
  visibly under-counted rather than silently `no-signal`. Note that `node` and `pnpm dlx`
  are **not** test wrappers — `node scripts/*.mjs` is ubiquitous non-test usage in this
  repo and would generate systematic false positives. The detector's own precision/recall
  on a hand-labelled sample is required: every episode outcome depends on this one
  function, and it is the component that already failed 5.2× during planning.
- **How do `featureSchemaVersion` and `extractorVersion` relate?** One governs the field
  set, the other the derivation logic; either changing invalidates existing rows. Simplest
  resolution is a single monotonic version covering both, but the two-field split is
  currently unspecified in the contract.

- **Is `red-green` the right episode outcome at all?** Corrected measurement puts it at
  9.7% of sessions (18.2% of test-bearing), with 58.3% of sessions invoking no test.
  Class balance for a binary success model is ≈1:1, which is good — but the label only
  covers the minority of sessions that run tests. A complementary outcome signal for
  non-test sessions is unresolved and deliberately out of scope here.
- **External recovery channels.** Git SHA → CI run would give an independent verdict for
  pushed commits, the only channel that could dent the 198 no-log invocations. Coarse
  (per-commit, not per-invocation) and unmeasured. Recorded as future work in task 11.3.
- **Re-execution recovery** is blocked on `make-test-suite-deterministic`; a
  nondeterministic suite cannot reproduce a historical verdict, and a wrong recovered
  label is worse than a missing one.
- **Does `readLog` generalise beyond tests?** "The agent went back to re-read output" may
  be a domain-general distress signal for any tool, and a better wasted-step feature than
  anything currently in the step schema. Not investigated.
