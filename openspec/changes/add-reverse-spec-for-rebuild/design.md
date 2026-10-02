## Context

See proposal.md (Why) and `docs/research/reverse-engineering-gap-analysis.md` (tranche 1; E9 quirk policy came from its open questions via user choice, D7; gaps
E3–E9, T1–T3, T5). The existing `reverse-spec-from-code` skill
(`packages/openspec-workflow/.pi/skills/reverse-spec-from-code/`) provides: a discovery prompt
(capability clustering via kb tree), a blind generator, a code-grounded auditor emitting strict
JSON, a step-6.5 `openspec validate` gate using throwaway ids, and a data-backed model routing
(`@fast` generator + `@research` auditor). It forbids implementation detail and line numbers by
design, because its output is indexed by kb. greenfield (MIT) supplies proven methodology for
provenance citations, confidence levels, state/edge/error templates and an entry-point
completeness check, but runs as a Claude Code plugin and never verifies rebuildability.

## Goals / Non-Goals

**Goals:**
- Rebuild package content complete enough that tranche 2 (characterize) and tranche 3
  (rebuild-check) can consume it without format changes.
- Reuse, not fork, the existing skill's discovery prompt and validate gate.
- Measurable quality: rule recall/precision and explicit/implicit classification accuracy on a
  seeded fixture.

**Non-Goals:**
- Executing the target, golden vectors, hidden duals, blind rebuild (tranches 2–3).
- Sanitization / contamination review for clean-room use (deferred optional mode).
- Multi-source evidence beyond code + the target's own tests: no git/docs/runtime mining for
  claim evidence or citations. Discovery may still consult the kb tree / `AGENTS.md` for
  capability boundary mapping only (reused `discovery.md` STEP 1).
- Language-agnostic tuning: v1 is tuned and evaluated on TypeScript; other languages are
  best-effort.

## Decisions

### D1. Sibling skill, prompts reused by reference
New `reverse-spec-for-rebuild/` with its own SKILL.md and prompts. Only the discovery prompt is
reused by reference (`../reverse-spec-from-code/prompts/discovery.md`); its JSON manifest output
is a recorded coupling (package `AGENTS.md` row + SKILL.md pitfall). The validate-gate loop is
re-implemented with a distinct throwaway prefix `_rsfr-val-` so concurrent runs of the two skills
never delete each other's dirs. The generator prompt restates STEP 1 and the FORMAT gate in full
rather than inheriting `generator.md`, whose "no line numbers" rule would forbid citations.
*Alternative:* `--mode rebuild` flag on the existing skill — rejected (user choice): two
divergent output contracts in one SKILL.md would bloat it and risk regressing the tuned kb flow.
*Alternative:* standalone package — rejected: loses co-location with the discovery/validate
assets and the tuning record.

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
```
Promotion moves the tree to a user-chosen path, refusing any path inside a kb-indexed root
(`openspec/`, `docs/`, `packages/`, `.pi/`) because kb would index provenance-heavy duplicates.
The check resolves the nearest existing ancestor's real path (the destination may not exist
yet), so relative, `..` and symlinked paths cannot bypass it. *Alternative:* spec.md into `openspec/specs` + sidecars —
rejected (user choice; kb pollution, and provenance comments conflict with the kb skill's
no-line-number policy).

### D3. Capability specs stay OpenSpec full-form
State machines, edge cases and errors are expressed as Requirements/Scenarios, not extra
`##` sections, so the existing `openspec validate` gate applies unchanged. Citations are
inline HTML comments (`<!-- cite: ref=path:L-L, confidence=confirmed -->`) adapted from
greenfield's format (dropped `agent`/`source` fields: single source type in v1). Task 1.1 spikes
that `openspec validate` tolerates these comments before the generator prompt depends on it.

### D4. Fragments + orchestrator merge for cross-cutting files
Generators run in parallel, one per capability, and each emits `_fragments/<cap>.json`
(candidate rules, entities, quirks, gaps, entry points). The orchestrating session merges them:
dedupe rules by meaning, assign stable `BR-/QUIRK-/GAP-` ids in first-seen capability order,
rewrite capability specs' local rule refs to global ids, then render the markdown files. A
revise pass regenerates a spec with local refs again, so every revision re-runs the merge
before the gates; the auditor checks every `BR-/QUIRK-/GAP-` ref resolves.
Id carry-over: when a previous package is supplied, the merge first matches new items to the
previous `rules.md`/`quirks.md`/`gaps.md` by meaning and reuses their ids; new items get ids above
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
`reverse-spec-for-rebuild/scripts/guard.mjs` (Node, no deps) owns the two filesystem guards so they
are testable instead of being agent prose: `guard.mjs check-dest <path>` exits non-zero when the
nearest existing ancestor's real path is inside `openspec/`, `docs/`, `packages/` or `.pi/` (exact
segment match, so `openspec-extra/` is allowed); `guard.mjs sweep` removes only
`openspec/specs/_rsfr-val-*` directories. SKILL.md calls the script at run start/end and before
promotion. L1 vitest tests live in `packages/openspec-workflow/src/__tests__/` (not published:
`files` ships only `.pi/skills/`, `NOTICE`, `README.md`), mirroring `packages/music-production`
(`vitest.config.ts`, `test` script, root `vitest.config.ts` project entry). The same suite checks
package wiring and the eval fixture's deterministic consistency (answer-key schema and locations).
LLM-quality targets stay agent-run (manual-only in `test-plan.md`). (User choice.)

## Risks / Trade-offs

- [`openspec validate` rejects HTML cite comments] → Task 1.1 spike first; fallback: keep
  citations in a parallel `capabilities/<cap>/citations.md` keyed by scenario name, and amend
  the spec delta's citation-placement wording (task 1.2) before prompts depend on it.
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
`.pi/skills/reverse-spec-for-rebuild/`, `NOTICE`, and the `pi.skills[]` entry.
