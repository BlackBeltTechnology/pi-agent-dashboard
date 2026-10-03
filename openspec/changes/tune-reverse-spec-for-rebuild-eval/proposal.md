## Why

`add-reverse-spec-for-rebuild` shipped with an accepted eval shortfall (recorded in
`packages/eng-disciplines/.pi/skills/reverse-spec-for-rebuild/eval/score.md`, run 1,
2026-10-03): rule recall 88.2% against a 90% target, the config-dependent rule did not
name its config key, and capability/cross-cutting audits did not converge in two revise
rounds, so the package was not promotable. The re-run id carry-over check (M5) and the
real-target run (task 6.2) were deferred. This change closes those gaps.

## What Changes

- Catalog boundary: the merge dropped error-to-status mapping and the generic 500
  fallback as "interface plumbing". Define the boundary so error-handling decisions
  (which failures map to which outcome, what is hidden) stay in `rules.md`, and align
  the generator, merge step and auditor wording.
- Config-dependent rules: the generator and merge keep the literal configuration key
  name in the rule statement, not the in-code property.
- Audit convergence: measure whether the mechanical confidence rules added late in
  run 1 (multi-location or absence claims are at most `inferred`; merging never raises
  confidence) make audits converge; consider a deterministic `guard.mjs` lint for
  `confirmed` cites with more than one location.
- Run the deferred evals: fixture re-run with the first package supplied (M5 id
  carry-over) and one real `packages/server/src` area via the kb discovery path
  (task 6.2 of the parent change), appending results to `eval/score.md` and
  `docs/research/reverse-engineering-gap-analysis.md`.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `reverse-spec-for-rebuild`: clarified rule-catalog boundary and config-key naming
  (to be specified in this change's delta once the boundary is decided).

## Impact

- `packages/eng-disciplines/.pi/skills/reverse-spec-for-rebuild/` prompts, references,
  SKILL.md, possibly `scripts/guard.mjs` (+ L1 tests), `eval/score.md`.
- No runtime code. Rollback = revert the prompt/reference edits.

## Discipline Skills

- `scenario-design` — re-check that the fixture answer key's rule boundary matches the
  clarified catalog definition before re-running the eval.
- `review-code` — inline review of the prompt and guard changes before commit.
- No security, performance or observability triggers beyond those already covered by
  the parent change.
