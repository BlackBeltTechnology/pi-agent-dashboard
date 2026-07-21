# reverse-spec-from-code — Method Playbook

Companion doc. This one holds METHOD. Metrics/data live in [`docs/research/reverse-spec-from-code.md`](reverse-spec-from-code.md). Shipped skill: [`packages/openspec-workflow/.pi/skills/reverse-spec-from-code/`](../../packages/openspec-workflow/.pi/skills/reverse-spec-from-code/).

How-we-did-it record. One pi session produced the `reverse-spec-from-code` skill plus a 102-spec backfill across ~16 packages. Below: the method, the decisions and their rationale, the levers, the failure-mode catalog, the takeaways.

## Goal

User ask: build a skill that reverse-generates OpenSpec specs from existing code via parallel subagents. Test subagent prompts against real specs. Iterate the prompt until generated content near-matches ground truth. Purpose = enrich the `kb_search` corpus with capability specs for code that lacks them.

## Method (phased)

### Phase 0 — Investigate first

Read real spec format before writing code. Two forms exist:
- Delta: `## ADDED Requirements` inside `openspec/changes/`.
- Canonical: `# <cap> Specification` / `## Purpose` / `## Requirements` / `### Requirement:` / `#### Scenario:` inside `openspec/specs/`.

~399 existing specs = ready-made ground truth.

### Phase 1 — Build the fitness function

Pick 6 diverse ground-truth specs whose source is locatable: `server-cors`, `server-restart`, `token-stats-bar`, `jiti-loader`, `ws-ping-pong`, `force-kill-handler`.

- BLIND generator subagents (opus `@research`) read ONLY code, write `gen-vN.md`.
- JUDGE subagents (`@research`) score gen-vs-real semantically → strict JSON: `requirement_coverage`, `scenario_coverage`, `hallucinated_requirements`, `format_compliance`.

Judge JSON = the fitness metric. Loopable, measurable.

### Phase 2 — Iterate prompt v1→v2

| Version | Input | Avg req coverage |
|---|---|---|
| v1 | single-file | 66.8% |
| v2 | + cross-boundary + grouping + header | 97.2% |

Levers applied:
- (a) Cross-boundary exploration — follow every emitted message / registry-write / spawn / config-read into the OTHER file and spec it. Dominant lever. `server-restart` 40→95.
- (b) Group into 3–8 requirements. Stop over-splitting.
- (c) Add title header.
- (d) "Describe CURRENT code, do not soften to older assumptions."

### Phase 3 — Build the skill

`packages/openspec-workflow/.pi/skills/reverse-spec-from-code/` = `SKILL.md` + `prompts/{discovery,generator,auditor}.md`.

Pipeline: discover capabilities → generate blind (parallel) → audit vs code (parallel) → revise → `openspec validate` gate → promote on user confirm.

Scratch-first. Writes land in gitignored `.reverse-spec-scratch/`, NOT under `openspec/`.

### Phase 4 — Live validation

Ran full pipeline end-to-end on `packages/bus-client`. Discovery over-clustered — 5 capabilities sharing one file. Added anti-fragmentation rule to the discovery prompt.

### Phase 5 — Bulk build

102 specs across ~16 packages in waves. Conservative discovery gate skipped already-covered packages — `document-converter`, `video-transcription`, `session-distiller`, `flows-plugin` returned fully-covered. ~23 of 102 needed a revise pass. Auditor caught all. 0 fabrications and 0 unaudited specs promoted.

### Phase 6 — Defect fix (kb pollution)

Scratch first lived UNDER `openspec/`, which kb indexes → polluted `kb_search` with duplicate spec chunks. Relocated scratch to gitignored repo-root `.reverse-spec-scratch/`. Promotion = MOVE not copy, so no duplicate stays under an indexed root.

### Phase 7 — Model-loss test

Swapped generator model. Held judge CONSTANT at `@research` so swaps stay clean.

| Generator | Req coverage | Validate |
|---|---|---|
| opus `@research` | 97.2 | 6/6 |
| deepseek-flash `@fast` | 95.8 | 6/6 (with format directive) |
| haiku `@compact` | 88.0 | 3/6 (format collapse) |

Full tables: [`docs/research/reverse-spec-from-code.md`](reverse-spec-from-code.md).

### Phase 8 — Hardening

- FORMAT hard-gate directive in `generator.md`: exact `### Requirement:` / `#### Scenario:` headings. No tables, no bold-Scenario, no numbered reqs.
- `openspec validate` gate in `SKILL.md` step 6.5: validates each scratch spec via a throwaway id, then deletes it. Invalid never promoted.

### Phase 9 — Land + document

Committed skill + 102 specs (`e9c582433`). Moved results into `docs/research/` (`b999373c7`). Both local on develop.

## Key decisions (rationale)

| Decision | Rationale |
|---|---|
| Ask clarifying questions UPFRONT via one `ask_user` batch | Settle ground-truth selection, skill input contract, generator model, scratch location, explore step-out BEFORE spending opus tokens. |
| Judge = SEPARATE subagent, not generator self-eval | Self-eval biases. Independent instrument measures honestly. |
| Hold judge model CONSTANT across every comparison | Model swaps on the generator stay clean; delta traces to the generator, not the judge. |
| Code is the ORACLE, not the existing spec | Real specs drift stale. `ws-ping-pong` proved it — generator more correct than the spec. Auditor checks code. |
| Scratch-first + promote-on-confirm | Never write `openspec/specs/` without user pick AND audit-pass AND validate-pass. |
| Conservative discovery gate | Skip already-specced capabilities. Avoid kb duplication (the pi-image-fit / document-converter lesson). |
| Parallel fan-out | One subagent per capability, all in a SINGLE message. Generators, then auditors. |
| Keep MAIN-agent context clean | Subagents read code + judge. Orchestrator never reads source itself. |
| Deterministic gate over model judgment for structure | `openspec validate` cheap + reliable. Beats trusting a model to self-format. |

## Levers / keypoints

- Cross-boundary exploration = #1 coverage lever. A capability's contract spans files.
- Grouping 3–8 requirements beats over-splitting.
- Format = the fragile part for cheap models. One-line directive + validate gate recovers it (3/6 → 6/6).
- "fast" != "weak". deepseek-flash ~= opus on coverage. haiku = the capability floor.
- Loss concentrates on the HARDEST cross-file capabilities, not single-file ones.
- Auditor = the hallucination safety net regardless of generator model.

## Failure-mode catalog

Caught by the auditor / revise loop across 102 specs:

- Under-scoped orchestrator — missed the primary entry function in another file.
- Dropped same-file domain — spec'd half a module.
- Hallucination from CODE COMMENTS — spec'd aspirational comments as behavior.
- Security spec UNDERSTATING its admission surface — claimed narrower than code.
- Importing ANOTHER package's internals — env vars that live in a peer package.
- Reaching into cross-file CALLER behavior not in the given source file.
- Cheap-model FORMAT breaks — tables / bold-Scenario / numbered reqs → fail validate.

## Takeaways (reusable)

- Build the fitness function first. Makes prompt iteration measurable and loopable.
- Reuse in-repo ground truth to calibrate a generator.
- Separate the measurement instrument (judge) from the thing measured (generator). Hold it constant across comparisons.
- Prefer deterministic gates (validators) over model judgment for structural correctness.
- Conservative discovery + scratch-first + confirm-to-promote = safe autonomy at scale.
- Delegate reads to subagents. Keeps the orchestrator context clean, parallelizes the work.
- Cost play: cheap generator + prompt directives + deterministic gate + strong auditor ~= expensive-model quality.

## Reproduce faster (next run)

- Point the skill at a package. Runs discover → generate → audit → validate → promote.
- Use `@fast` generator + `@research` auditor. Format directive + validate gate already baked in.
- Conservative discovery skips covered capabilities automatically.

## Artifacts

- Skill: [`packages/openspec-workflow/.pi/skills/reverse-spec-from-code/`](../../packages/openspec-workflow/.pi/skills/reverse-spec-from-code/) — `SKILL.md` + `prompts/{discovery,generator,auditor}.md`.
- Commit `e9c582433` — skill + 102 specs.
- Commit `b999373c7` — results moved into `docs/research/`.
- Metrics doc: [`docs/research/reverse-spec-from-code.md`](reverse-spec-from-code.md).
