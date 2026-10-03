## Context

See proposal.md (Why) and `docs/research/reverse-engineering-gap-analysis.md` (tranche 1; E9 quirk policy came from its open questions via user choice, D7; gaps
E3–E9, T1–T3, T5). The existing `reverse-spec-from-code` skill
(`packages/openspec-workflow/.pi/skills/reverse-spec-from-code/`) is the methodological ancestor
(this skill adapts its patterns but references none of its files). It provides: a discovery prompt
(capability clustering via kb tree), a blind generator, a code-grounded auditor emitting strict
JSON, a step-6.5 `openspec validate` gate using throwaway ids, and a data-backed model routing
(`@fast` generator + `@research` auditor). It forbids implementation detail and line numbers by
design, because its output is indexed by kb. greenfield (Apache-2.0) supplies proven methodology for
provenance citations, confidence levels, state/edge/error templates and an entry-point
completeness check, but runs as a Claude Code plugin and never verifies rebuildability.

## Goals / Non-Goals

**Goals:**
- Rebuild package content complete enough that tranche 2 (characterize) and tranche 3
  (rebuild-check) can consume it without format changes.
- Self-contained and portable: lives in `packages/eng-disciplines`, works in any git repo; kb and
  OpenSpec are optional accelerators, never prerequisites.
- Measurable quality: rule recall/precision and explicit/implicit classification accuracy on a
  seeded fixture.

**Non-Goals:**
- Executing the target, golden vectors, hidden duals, blind rebuild (tranches 2–3).
- Sanitization / contamination review for clean-room use (deferred optional mode).
- Multi-source evidence beyond code + the target's own tests: no git/docs/runtime mining for
  claim evidence or citations. Discovery may still consult a kb tree / `AGENTS.md` (when
  present) for capability boundary mapping only.
- Language-agnostic tuning: v1 is tuned and evaluated on TypeScript; other languages are
  best-effort.

## Decisions

### D1. Self-contained skill in eng-disciplines
New `packages/eng-disciplines/.pi/skills/reverse-spec-for-rebuild/` (user choice: rebuild-grade
characterization is a cross-cutting discipline, orthogonal to the OpenSpec lifecycle, and pairs
with `scenario-design` for tranche 2). It references no file outside its own directory, because
eng-disciplines installs independently of `openspec-workflow`. Patterns from
`reverse-spec-from-code` (cross-boundary STEP 1, FORMAT gate, strict-JSON auditor, `@fast`
generator + `@research` auditor) are restated in this skill's own prompts, not linked. Its own
`prompts/discovery.md` uses a kb tree (`kb agents`, `AGENTS.md`) when present and otherwise
clusters from manifests (`package.json`, `pyproject.toml`, `pom.xml`, `go.mod`, ...), entry points
and directory structure. The generator prompt drops the ancestor's "no line numbers" rule, which
would forbid citations.
*Alternative:* sibling skill in `openspec-workflow` reusing prompts by reference — rejected
(user choice): couples a portable discipline to the OpenSpec helper package, and its
cross-skill relative path breaks if the skills ever install separately.
*Alternative:* `--mode rebuild` on the existing skill — rejected: two divergent output
contracts in one SKILL.md. *Alternative:* methodology in eng-disciplines + thin OpenSpec
adapter in openspec-workflow — rejected: extra package boundary without a consumer.

### D2. Output = rebuild package, not `openspec/specs`
Layout:
```
.reverse-spec-scratch/<target-slug>/rebuild/
  README.md            index: capabilities, counts, gate verdicts
  model.md             entities / value types
  rules.md             BR-NNN (explicit|implicit)
  quirks.md            QUIRK-NNN
  gaps.md              GAP-NNN
  completeness.md      entry-point → spec|gap map + verdict
  capabilities/<cap>/spec.md
  _fragments/<cap>.json  per-generator rule/entity/quirk/gap fragments (merge input)
  _fragments/<cap>.spec.md  unmerged spec with local refs; every merge re-renders all capabilities/ specs from it
```
Promotion moves the tree to a user-chosen path, refusing any path inside a protected root —
default `openspec/`, `docs/`, `packages/`, `.pi/` (this repo's kb-indexed roots, where kb would
index provenance-heavy duplicates), overridable per run for other repos.
Scratch: `.reverse-spec-scratch/` at repo root; this repo already ignores it (`.gitignore:50`);
elsewhere the skill checks `git check-ignore` and, on consent, appends it to `.git/info/exclude`.
The check resolves the destination component by component in kernel order (symlinks, even
dangling ones, followed before a later `..`; the destination may not exist yet), so relative,
`..` and symlinked paths cannot bypass it. *Alternative:* spec.md into `openspec/specs` + sidecars —
rejected (user choice; kb pollution, and provenance comments conflict with the kb skill's
no-line-number policy).

### D3. Capability specs stay OpenSpec full-form; format gate is built-in first
State machines, edge cases and errors are expressed as Requirements/Scenarios, not extra
`##` sections. The format gate always runs `guard.mjs lint-spec <file>` (deterministic: title,
`## Purpose`, `## Requirements`, `### Requirement:` without numbering, `#### Scenario:` headings
not bold labels, each scenario has `- **WHEN**` and `- **THEN**`, no markdown tables). When the
OpenSpec CLI and an `openspec/` directory exist, it additionally runs `openspec validate` via a
transient `_rsfr-val-<cap>` id. Citations are inline HTML comments
(`<!-- cite: ref=path:L-L, confidence=confirmed -->`) adapted from greenfield's format (dropped
`agent`/`source` fields: single source type in v1). Task 1.1 spikes that `openspec validate`
tolerates these comments; `lint-spec` ignores them by construction.
- 2026-10-02 spike (task 1.1): VALID — `openspec validate _rsfr-val-spike --type spec` (and `--strict`) accepts cite comments after a SHALL line, between `#### Scenario` and `- **WHEN**`, and after THEN/AND bullets; task 1.2 not needed.

### D4. Fragments + orchestrator merge for cross-cutting files
Generators run in parallel, one per capability, and each emits `_fragments/<cap>.json`
(candidate rules, entities, quirks, gaps, entry points). The orchestrating session merges them:
dedupe rules by meaning, assign stable `BR-/QUIRK-/GAP-` ids in first-seen capability order,
rewrite capability specs' local rule refs to global ids, then render the markdown files. A
revise pass regenerates a spec with local refs again, so every revision re-runs the merge
before the gates; the auditor checks every `BR-/QUIRK-/GAP-` ref resolves.
Id carry-over: when a previous package is supplied, it is snapshotted read-only before generation
(before `PKG` is moved aside), and the merge first matches new items to the snapshot's `rules.md`/`quirks.md`/`gaps.md` by meaning and reuses their ids; new items get ids above
the previous maximum; retired ids are never reused (tranche 2 golden vectors key on `BR-NNN`).
*Alternative:* a dedicated consolidator subagent - deferred; start with the main session and
promote to a subagent only if merges exceed context. *Alternative:* one generator for everything
— rejected: context limits on real targets (tuning record shows coverage drops with size).

### D5. Completeness gate = deterministic inventory + LLM mapping
A `completeness.md` prompt instructs a subagent to enumerate entry points with grep patterns
(TS-first: `process.env.X`, route registrations, `pi.registerTool`/command registration, WS
message `type` literals, config key reads, thrown error codes/classes), then map each to a
capability spec or gap. Any unmapped entry point is FAIL; P0 (user-facing surface) / P1 / P2
only order remediation. A completeness-driven revision loops back through merge, audit and
validate before promotion. Adapted from greenfield `source-completeness` (tools, env vars, CLI flags,
subcommands, events, config keys, error categories) for TS/pi targets: subcommands → HTTP
routes; commands folded into tools/commands.

### D6. Auditor cloned and extended in a new prompt
New `prompts/auditor-rebuild.md` (existing `auditor.md` untouched) emits the existing JSON keys plus:
`bad_citations[]`, `misclassified_rules[]`, `confidence_errors[]`, `uncited_claims[]`,
`dangling_refs[]`. Model stays
`@research` (the hallucination safety net); generator defaults to `@fast` per the model-loss study.
A second pass of the same prompt audits the merged cross-cutting files (`model.md`, `rules.md`,
`quirks.md`, `gaps.md`) against their cited code, keyed by item id instead of capability; a failing
item is routed back to the capability whose fragment introduced it, then re-merged.

### D7. Quirk policy: annotated-faithful
Spec describes actual behavior; suspected defects go to `quirks.md` with suspected intent and
confidence. Rebuilder decides. (User choice.) Prevents both silent "fixes" and unflagged bugs.

### D8. Seeded eval fixture
`reverse-spec-for-rebuild/eval/fixture/` — a small TS module (~200–400 LoC) with an answer key
`eval/answer-key.json`: N explicit rules, ≥3 implicit rules (default value, exception handler,
cross-module ordering), one state machine, one planted quirk, one config-dependent unknown.
`eval/score.md` describes scoring (rule recall/precision, classification accuracy, quirk/gap
detected). Excluded from published files. Mirrors AgentModernize's explicit/implicit benchmark
design at toy scale.

### D9. Deterministic guards live in a helper script
`reverse-spec-for-rebuild/scripts/guard.mjs` (Node ≥20, no deps) owns the filesystem and format
guards so they are testable instead of agent prose:
- `check-dest <path> [--protect <dir>]...` exits non-zero when the path, resolved component by
  component in kernel order (symlinks — even dangling — followed before `..`), is inside a protected root (exact segment match, so `openspec-extra/` is allowed);
  defaults `openspec docs packages .pi`; `--protect` replaces the default list.
- `slug <target>` derives the scratch slug (canonical repo-relative path → kebab-case + hash; `root`; refuses targets outside the repo); `check-manifest` rejects unsafe or duplicate capability names before generators fan out.
- `check-cap <name>` / `check-run <id>` reject any capability name or run id that is not a single safe path component (capability names come from untrusted discovery output and become paths).
- `new-run` prints a collision-resistant run id (`<UTC ts>-<8 hex>`); validation ids are `_rsfr-val-<run>-<cap>` and carry an `.owner` pid while live.
- `seed-ids <ids.json> <dir>...` / `next-id <ids.json> <BR|QUIRK|GAP>` keep a persisted per-kind high-water mark (`_ids.json`, shipped with the package) so retired ids — across runs and across revisions within a run — are never reused.
- `sweep [--run <id>]` removes only this skill's `openspec/specs/_rsfr-val-*` directories: with `--run`, that run's `_rsfr-val-<id>-*`; without, only abandoned ones (`.owner` pid dead, or no owner and untouched 10 min) so a concurrent run's live dirs survive (no-op without `openspec/specs/`).
- `lint-spec <file>` is the built-in structural check (D3); exit 1 and `file:line: reason` per
  violation.
- Bad input → exit 2 + usage.
SKILL.md calls it at run start/end, in the format gate, and before promotion. L1 vitest tests live
in `packages/eng-disciplines/src/__tests__/` (unpublished: `files` ships only `.pi/skills/`,
`README.md`, `NOTICE`), mirroring `packages/music-production` (`vitest.config.ts`, `test` script,
root `vitest.config.ts` project entry); `knip.json` already declares the `packages/eng-disciplines`
workspace with `src/**` and `__tests__` entries. The same suite checks package wiring, skill
self-containment, and the eval fixture's deterministic consistency. LLM-quality targets stay
agent-run (manual-only in `test-plan.md`). (User choice.)

## Risks / Trade-offs

- [`openspec validate` rejects HTML cite comments] → Task 1.1 spike first; fallback: keep
  citations in a parallel `capabilities/<cap>/citations.md` keyed by scenario name, and amend
  the spec delta's citation-placement wording (task 1.2) before prompts depend on it.
- [Discovery without a kb tree clusters worse on large repos] → manifest/entry-point heuristics
  in the prompt; the completeness gate catches missed entry points; the real-target run (6.2)
  exercises the kb path, the fixture run exercises the plain path.
- [eng-disciplines gains its first test suite and executable script] → precedent:
  `node-inspect-debugger/scripts/`; suite pattern copied from `packages/music-production`.
- [Throwaway validation ids under `openspec/specs/` left behind by an interrupted run trip
  `check-conventions` / kb indexing] → delete in the same loop iteration (existing pattern);
  SKILL.md pitfall + start/end sweep of `openspec/specs/_rsfr-val-*` only (never `_rsfc-val-*`).
- [Merge step exceeds main-session context on large targets] → fragments are compact JSON;
  fall back to a consolidator subagent (D4 alternative).
- [Citation line numbers drift as target code changes] → package records the target commit SHA
  in README.md; re-run is the refresh path (incremental mode deferred).
- [Explicit/implicit boundary is subjective] → definitions in the prompt use concrete code
  patterns; fixture answer key calibrates; auditor checks classification.
- [Prompt injection from target code read by subagents] → read-only, no execution in this
  tranche; generator prompt states code comments are data, not instructions.
- [Toy fixture overstates real-world quality] → also run once on a real repo capability set and
  report auditor findings alongside fixture scores.

## Migration Plan

Additive. No data or runtime migration. Rollback: delete
`packages/eng-disciplines/.pi/skills/reverse-spec-for-rebuild/`, its `pi.skills[]` entry, the
greenfield paragraph in `NOTICE`, the vitest suite, and the root `vitest.config.ts` / `biome.json`
entries. The `scenario-design-discipline` delta only relaxes a stale count and needs no rollback.
