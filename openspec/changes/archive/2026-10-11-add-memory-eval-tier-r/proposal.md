# add-memory-eval-tier-r

> Umbrella `openspec/changes/unify-context-manager`, task 2.1 (Tier R half).
> Evidence: `docs/research/unified-context-manager-exploration.md` §19
> ("Tier R v0 — current-stack baseline").

## Why

Every remaining phase of the context manager claims to improve cross-session
recall: the session index (phase 2), cues (phase 3), and the injection tiers
the umbrella gates on A/B tests (task 2.2). None of those claims can be tested
today.

- The Tier R v0 harness that produced the baseline (hermes `session_search`
  34% helpful, any shipped retriever 54%, no abstention on 30 negatives) ran
  from `/tmp` and was deleted. Its numbers survive in the research doc, and
  fragments of its scripts survive in a session log. Neither is a committed,
  re-runnable reference.
- A re-run today would build a different case set with different ad-hoc
  scripts, so no later number is comparable with the baseline.
- Phase 2's acceptance criterion ("the `sessions` scope beats the old stack
  and stays silent on negatives") cannot be written as a test without a
  harness.

## What Changes

- **New private package `packages/memory-eval`** with a `memory-eval` CLI.
  It is independent of the context manager; later phases plug in a retriever
  adapter.
- **Case builder:** a TypeScript port of the v0 case builder. It mines four
  case types from a project's pi session logs:
  - recurring faults: an error an earlier session already fixed;
  - user-flagged recurrences: "stuck again", "megint";
  - explicit cross-session references;
  - negatives: first-ever failures.

  Each case carries its decision time, and retrieval is evaluated strictly
  *as of* that time; the harness drops and counts any later hit. The builder
  uses a seeded sample and stable case ids, and the baseline case set is
  frozen so later phases are measured on the same cases.
- **Retriever adapters** behind one interface: faithful replicas of the old
  stack: hermes `session_search` in both newest-first and BM25 order, and
  hermes `memory_search`. `kb_search` over docs is reported separately as a
  non-as-of reference, because kb chunks carry no timestamps. blackhole
  `recall` is documented as zero by construction, and phase 2 adds a
  context-manager adapter.
- **LLM judge:**
  - the model comes from a role (default `@review`) and runs through headless
    `pi` with every tool, extension, skill and context file off;
  - secrets are scrubbed from case and retrieved text before it is sent;
  - the prompt is versioned in the repo;
  - it judges case validity once per case, and helpfulness per (case,
    retriever output) pair;
  - verdicts are cached by content hash, so a re-run judges only new outputs;
  - a failed or malformed call yields `unjudged`, never "not helpful".
- **Report:** helpful@5 on valid positives with confidence intervals, union
  across retrievers, false injection and abstention on negatives, injected
  size, and deterministic gold-session hit@k. A comparison mode runs a paired
  test between two runs on the same cases.
- **Local-only data:** mined cases, retrieved text and verdicts stay under
  `~/.pi/dashboard/memory-eval/<project>/` and are never committed. The repo
  holds the code, the judge prompt, a synthetic fixture, and aggregate reports
  that contain no case text.
- **Baseline:** this change re-measures the old stack for this repo with the
  committed harness, judged by `@propose-review-1` (the `@review` provider had
  no credits at planning time). The result replaces the v0 figures as the
  reference that phase 2 must beat on the same frozen case set.

## Capabilities

### New Capabilities
- `memory-eval`: the case building, retriever adapter contract, judging,
  caching, reporting and data locality of the Tier R retrieval evaluation.

### Modified Capabilities
None.

## Impact

- **New:** `packages/memory-eval/` (private workspace package; no runtime
  dependency beyond `node:sqlite`, `tsx`, `packages/kb`, `packages/shared`).
- **Reads, never writes:** pi session JSONL under `~/.pi/agent/sessions/`;
  hermes `sessions.db` and the kb index, each file-copied with its WAL
  sidecars once per run (never opened in place), vacuumed into a snapshot
  and queried only as that snapshot.
- **Writes:** `~/.pi/dashboard/memory-eval/<project>/` only, plus the
  aggregate report the operator chooses to commit.
- **External calls:** the judge sends case and retrieved text to the model
  provider behind the judge role. The CLI names the provider and asks for
  confirmation before the first remote call. Without a TTY and without
  `--yes`, it refuses.
- **Umbrella:** task 2.1 splits: Tier R here, Tier O (outcome replay) later.
- **No user-facing behaviour changes;** nothing ships in the dashboard or in
  pi sessions.

## Discipline Skills

- `security-hardening`: mined session text (prompts, commands, paths, possible
  secrets) must stay local; the judge discloses case text to a model provider;
  retrieved text is untrusted input to the judge.
- `doubt-driven-review`: the case definitions and metrics become the yardstick
  for every later phase, so a flaw here propagates.
- `review-code`: before commit.
- `performance-optimization`: the BM25 adapter has a 500 ms budget over a
  45k-row table (the v0 query-plan lesson).
- `observability-instrumentation`: the judge is a new external call; each
  call is logged to `judge-calls.jsonl` and summarised by `status`.
