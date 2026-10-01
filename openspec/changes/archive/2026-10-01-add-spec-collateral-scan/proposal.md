## Why

The dominant planning defect in the September session logs is a change whose
delta leaves a *different* main-spec requirement contradicting it after archive
("post-archive contradiction"). Doubt-review catches these — ~430 "contradicts"
findings across 211 review results — but late, one cycle at a time, and not
reliably: on `update-pi-core-0-99` the reviewer's conflict table named 8
capabilities while ~17 main specs pinned the removed package; on this repo's own
`harden-review-and-fix-loop`, a manual grep for "two review rounds" missed the
`ship-it-orchestrator` requirement phrased "at most two". The corpus has 657
capability specs, so neither author nor reviewer can read the candidates by hand.

A read-only spike (identifier overlap between a change's artifacts and the main
specs, replayed on pre-review states recovered from the logs) found:
- identifier-pinned conflicts (package, function, event names): precision 4/5 in
  the top 5, recall 7/11 in the top 20, plus 2 real conflicts the reviewer missed;
- an ADDED-where-MODIFIED gap: the exact requirement ranked #1 by a 5.7× margin;
- prose-only UI restructures ("replaces the action row"): weak (#29) — that class
  stays with the reviewer.

Separately, the genuine noise in doubt-review (<10% of findings) comes from
reviewers asserting facts they could not check (e.g. "model X doesn't exist"
without network access).

## What Changes

- **`scripts/spec-collateral.mjs`** — advisory scan for a change: lists main-spec
  requirements outside the delta that mention identifiers the change touches
  (top N, ranked), and unmodified requirements inside delta capabilities that do
  (ADDED-where-MODIFIED). Markdown or `--json`; always exits 0 on a completed
  scan. Tuning from the spike: code-shaped identifiers only, ×3 weight for
  identifiers in sentences that remove/replace/rename, per-requirement scoring,
  document-frequency cap.
- **`plan-proposal` step 2 feeds the scan into the doubt-review CONTRACT** as
  "candidate conflicting requirements — check each", so the reviewer sweeps a
  bounded list instead of discovering conflicts one cycle at a time.
- **Doubt-review prompt hygiene** — the adversarial template asks the reviewer to
  verify claims against the repository and to mark what it cannot verify as
  `unverified` instead of asserting it, and to check every listed candidate.
- **Cited code claims** — `plan-proposal` asks the author to cite the path (and
  line when specific) for each statement about existing code behaviour in
  `design.md`, so wrong-file / "does not exist" claims surface before review.

## Non-goals

- Gating: the scan never fails a check — its precision on prose-described UI
  changes is too low (spike: 1/10 in the top 10 on one case).
- A ship-time scan of the code diff inside `ship-it` — depends on
  `harden-review-and-fix-loop`'s prompt generator landing first; follow-up.
- Semantic (embedding) matching — revisit only if the identifier scan's misses
  dominate the next log analysis.

## Capabilities

### New Capabilities

- `spec-collateral-scan`: the advisory scan's inputs, ranking, output shape and
  exit behaviour.

### Modified Capabilities

- `plan-proposal-orchestrator`: the doubt-review trigger requirement gains the
  scan input to the CONTRACT (failure → proceed without it), the
  verify-or-say-unverified reviewer instruction, and the cited-code-claims
  authoring rule; both it and the main-session requirement align the
  cross-model wording with the current skill (automatic when a reviewer role
  resolves, offered otherwise).

## Impact

- New `scripts/spec-collateral.mjs` + `scripts/__tests__/spec-collateral.test.mjs`
  (synthetic fixture corpora), row in `scripts/AGENTS.md`.
- `.pi/skills/plan-proposal/SKILL.md` step 2 (+ its step 1 authoring note).
- `packages/eng-disciplines/.pi/skills/doubt-driven-review/SKILL.md` (+ its
  `SKILL.agent.md`) adversarial template — published package, additive wording.
- No runtime, server, client or protocol change; no dependency added. Rollback:
  revert — nothing persists.

## Discipline Skills

- `performance-optimization` — the scan reads all 657 main specs on every
  planning run; measure before assuming it is cheap (single-pass read pinned in
  the spec; timed check in the test plan).
- `review-code` — inner-loop review of the script before commit.
