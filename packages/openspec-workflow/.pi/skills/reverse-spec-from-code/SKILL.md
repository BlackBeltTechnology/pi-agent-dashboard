---
name: reverse-spec-from-code
description: Reverse-generate OpenSpec capability specs (openspec/specs/<cap>/spec.md) from existing code that lacks them, using parallel subagents, to enrich the kb_search corpus. Discovers capability boundaries in a target directory/package, fans out one blind generator per capability that follows the behavioral contract ACROSS file boundaries, audits each generated spec against the actual code for hallucinations, writes to a scratch dir, and promotes to openspec/specs/ only on user confirm. Use on "reverse-engineer specs from this package", "generate specs from code", "backfill openspec specs", "spec this code for the KB", "document <package> as openspec specs".
---

# reverse-spec-from-code

Turn spec-less code into OpenSpec capability specs so `kb_search` has high-signal,
consistently-formatted behavioral documents to index. Tuned via a blind
generate→judge loop against 6 real specs: requirement coverage 97%, scenario
coverage 91% (see `docs/research/reverse-spec-from-code.md` for the tuning record
+ a model-loss test across opus / deepseek-flash / haiku).

> Scratch MUST live OUTSIDE `openspec/` (kb indexes `openspec/`). Use the
> gitignored repo-root dir `.reverse-spec-scratch/` — otherwise every draft
> pollutes `kb_search` with duplicate spec chunks. Promotion MOVES the file
> into `openspec/specs/` (the only kb-indexed copy).

## When to use

- A package/directory under `packages/` has behavior but no `openspec/specs/<cap>/spec.md`.
- You want to enrich `kb_search` (it indexes `openspec/` markdown) with behavioral specs.
- An existing spec is stale and you want a code-current reconciliation (`--refresh`).

Skip for a single trivial file, or when the capability already has an accurate spec.

## Core principle (the lever that matters)

**A capability's contract is not confined to one file.** The single biggest
quality driver is making each generator FOLLOW the behavioral contract across
file boundaries: every emitted message/event, registry write, spawned/killed
process, config read, or DOM attribute is a contract with another component and
must be spec'd too. In tuning this moved requirement coverage from 40% to 95% on
the cross-cutting capability. The generator prompt (`prompts/generator.md`)
enforces this in STEP 1 — do not weaken it.

## Fitness, honestly

"Match an existing spec" is a PROXY, not the goal. Real specs drift from code.
The goal is a spec that accurately describes **current** code and is searchable.
Target: high requirement coverage + **zero code-ungrounded hallucination**.
Code-current divergence from a stale spec is a win, not a miss.

## Procedure

1. **Resolve target + scope.** User names a directory/package (e.g. `packages/server`)
   and optionally a single capability. Confirm the target path exists.

2. **Discover capability boundaries.** Spawn ONE discovery subagent
   (`prompts/discovery.md`, model `@compact` is fine) that clusters the target's
   files into capabilities using the directory `AGENTS.md` tree (`kb agents <dir>`,
   `kb_search --doc-type agents`) + grep. It returns a manifest:
   `[{ capability, purpose_hint, files[] }]`. For a single-capability target you
   may skip this and build the manifest by hand.

3. **Skip already-specced capabilities.** For each manifest entry, if
   `openspec/specs/<capability>/spec.md` exists and `--refresh` was NOT requested,
   drop it (report as skipped). With `--refresh`, keep it and reconcile.

4. **Generate in parallel (blind).** Fan out ONE generator subagent per remaining
   capability IN A SINGLE MESSAGE (`prompts/generator.md`). Each reads code only
   — never an existing spec — and writes `.reverse-spec-scratch/<capability>/spec.md`.
   Pass capability, purpose_hint, start files, and the output path. Model: a
   fast/cheap model (`@fast`/`@compact`) is viable AS LONG AS the format gate
   (step 6.5) and the `@research` auditor run — see "Model choice" below.

5. **Audit in parallel (code-grounding).** Fan out ONE auditor subagent per
   generated spec IN A SINGLE MESSAGE (`prompts/auditor.md`, model `@research`).
   Each verifies the generated spec against the ACTUAL code and returns strict
   JSON: `hallucinated_requirements[]` (in spec, not in code),
   `missing_behaviors[]` (in code, not in spec), `format_ok`, `verdict`
   (pass|revise). No real spec is needed — the code is the oracle.

6. **Revise if needed.** For any spec with `verdict: revise`, re-spawn its
   generator with the auditor's findings appended (remove the listed
   hallucinations, add the listed missing behaviors). One revise pass is usually
   enough; re-audit only if the first audit was severe.

6.5. **Format gate (`openspec validate`) — HARD, deterministic.** `openspec
   validate` only reads specs under `openspec/specs/`, so validate each scratch
   spec via a throwaway id, then delete it:
   ```bash
   for c in <cap1> <cap2> ...; do
     d="openspec/specs/_rsfc-val-$c"; mkdir -p "$d"
     cp ".reverse-spec-scratch/$c/spec.md" "$d/spec.md"
     openspec validate "_rsfc-val-$c" --type spec 2>&1 | grep -qi "is valid" \
       && echo "$c: VALID" || echo "$c: INVALID"
     rm -rf "$d"
   done
   ```
   Any spec that is INVALID is treated exactly like `verdict: revise` with reason
   "format: openspec validate failed" — re-spawn its generator emphasizing the
   FORMAT rule (no tables, no bold `**Scenario:**`, no numbered requirements),
   then re-run this gate. A spec that fails validate is NEVER promoted. Cheap
   generator models fail here most often — this gate is what makes them safe.

7. **Present + promote on confirm.** Show the user: per-capability spec path,
   requirement count, and audit + validate summary (skipped / passed / revised /
   valid). Only specs that BOTH audit-pass AND validate-pass are promotable. Use
   `ask_user` (confirm or multiselect) to choose which to promote. On confirm,
   MOVE `.reverse-spec-scratch/<cap>/spec.md` → `openspec/specs/<cap>/spec.md`
   (create the dir; move, don't copy, so no duplicate stays under an indexed
   root). NEVER write `openspec/specs/` without explicit confirm.

8. **Verify KB indexing.** After promotion, run `kb_search "<a phrase from a new
   spec>"` to confirm the spec is discoverable. Report the result.

## Subagent routing

| Role       | Prompt                | Model            | Access      | Parallel |
|------------|-----------------------|------------------|-------------|----------|
| discovery  | prompts/discovery.md  | `@compact`       | read-only   | 1 pass   |
| generator  | prompts/generator.md  | `@research` (max quality) or `@fast`/`@compact` (cheap; needs gate) | read+write (scratch) | N in one message |
| auditor    | prompts/auditor.md    | `@research` (keep strong — the safety net) | read-only   | N in one message |

Fan out generators (then auditors) as multiple `Agent` calls in a SINGLE message
so they run concurrently. One capability per subagent — isolated context.

### Model choice (from the model-loss test in docs/research/reverse-spec-from-code.md)

Judge/generator swap on the 6 ground-truth specs (judge held `@research`):

| generator | req cov | scen cov | `openspec validate` |
|---|---|---|---|
| opus (`@research`) | 97% | 91% | 6/6 |
| deepseek-flash (`@fast`) + format directive | 96% | 90% | 6/6 |
| haiku (`@compact`), no directive | 88% | 81% | 3/6 |

- "fast" ≠ "weak": `@fast` (deepseek-flash) nearly matched opus on coverage.
- Cheap models lose most on FORMAT and on the HARDEST cross-file capabilities —
  the format gate (6.5) fixes the former; extra revise cycles fix the latter.
- Recommended cost config: `@fast` generator + format gate + `@research` auditor
  + revise loop ≈ opus quality at a fraction of the cost. Keep the auditor strong;
  it is the hallucination safety net regardless of generator model.

## Output format (what generators produce)

Full-form OpenSpec spec (post-archive shape, NOT the `## ADDED Requirements` delta):

```
# <capability> Specification

## Purpose
<1-3 sentences>

## Requirements
### Requirement: <short imperative name>
The <subject> SHALL <behavioral obligation>.

#### Scenario: <name>
- **WHEN** <trigger>
- **THEN** <observable outcome>
- **AND** <optional>
```

## Pitfalls

- **Under-scoped input** — feeding one file to a cross-cutting capability caps
  coverage low no matter how good the prompt. Discovery must gather ALL files;
  the generator must follow references. This is the #1 failure mode.
- **Over-splitting** — without a grouping rule the generator emits many tiny
  requirements. Prompt targets 3-8 grouped requirements with rich scenarios.
- **Visual/detail invention** — UI capabilities tempt the model to describe
  pixels/colors it did not confirm. The prompt forbids unconfirmed detail; the
  auditor catches the rest.
- **Clobbering real specs / kb pollution** — scratch-first in the gitignored
  repo-root `.reverse-spec-scratch/` (NEVER under `openspec/`, which kb indexes),
  promote (move) only on confirm.
- **Chasing 100% match to an existing spec** — the spec may be stale. The code
  is the oracle; the auditor checks the code, not the old spec.
- **Cheap-model format breaks** — smaller/faster generators (`@fast`/`@compact`)
  tend to emit markdown tables, bold `**Scenario:**`, or numbered requirements
  that FAIL `openspec validate`. The format directive in `prompts/generator.md`
  plus the step-6.5 validate gate catch this; never promote a cheap-model spec
  without running the gate.

## Verification

- Format gate (step 6.5) returned VALID for every promoted spec
  (`openspec validate <capability> --type spec` → "is valid"). This is a HARD
  gate, not an advisory check — an invalid spec is never promoted.
- Auditor returned `verdict: pass` (or `revise` was resolved) for every promoted spec.
- `kb_search "<phrase from a new spec>"` returns the new spec.
- No file under `openspec/specs/` was written without user confirm.
