## Why

Mining 157 September sessions (63 ship-it worktree runs) shows the step-4.5
local review gate does not converge, and the cause is upstream of the reviewer:

- **Round-2 blocking findings are mostly fix-induced.** The agent's own words
  after round 2: "two are flaws in my own round-1 fixes", "a blocking escape my
  round-1 fix introduced", "F3/F4 only partially resolved". Across 29 round-1 →
  round-2 transitions the fix step wrote a failing test first **once** and swept
  for sibling instances **5 times**; the one run that swept "the same flake
  class" passed round 2 clean.
- **The reviewer prompt is hand-written every run.** 75 code-review prompts, no
  template: ~half never point at `specs/`, and ~1 in 7 anchor the reviewer with
  the author's conclusion ("all were fixed", "a third round is not permitted, so
  be precise") — the bias `doubt-driven-review` forbids ("never pass the CLAIM").
- **The two-round cap is a keep-going prompt, not a hand-back.** All 6
  `SHIP_IT_BLOCKED.md` files were written for the review cap (never a design
  issue); every one was answered "go on" / "fix", after which the agent
  **self-reset** a "FRESH two-round review budget" (one session: 14 review calls).
- **The "isolated" reviewer is not isolated.** The subagent runtime inherits a
  compressed copy of the parent conversation unless the agent definition
  disables it; 62 of 69 `@review` spawns used ad-hoc `subagent_type` labels
  with no definition, so the reviewer saw the author's reasoning.
- **Blocking findings cluster in nameable defect classes** the generic rubric
  never asks the reviewer to sweep: spec/task conformance, canonicalize-before-
  check, degenerate inputs, stale state, error-path cleanup, shared-helper blast
  radius, interleavings, test-vs-production fidelity.

## What Changes

- **Isolated reviewer agent.** A `CodeReviewer` agent definition (`@review`,
  no context inheritance, read-only tools) becomes the only step-4.5 spawn
  target.
- **Generated reviewer prompt.** A `buildReviewPrompt()` helper plus thin CLI in
  `.pi/skills/ship-it/scripts/` emits the step-4.5 prompt; ship-it passes its
  stdout verbatim. It references the diff range, `proposal.md`, `design.md`,
  every delta spec, `tasks.md` and `test-plan.md`, inlines the `review-code`
  rubric, and has **no free-text author field**: generator-authored text never
  asserts anything about the fixes, and author-supplied ledger fields appear only
  in a delimited unverified-records block.
- **Fix protocol with a validated ledger.** Every `issue(blocking)` is fixed by:
  failing test first (or a stated reason it is untestable) → smallest fix →
  sibling sweep of the same pattern across the change → re-read of the fix hunk
  against the finding's defect class. A ledger entry records each step;
  `validateFixLedger()` blocks round 2 until every blocking finding has one.
- **Round 2 is a verification round.** The reviewed tree is committed before each
  round; round 2 receives the reviewer's own round-1 blocking findings plus the
  ledger as unverified records, and reviews the fix delta since that commit —
  not a fresh full review. Harness and step-4.4 enforcers re-run after every
  review fix.
- **Defect-class sweep in `review-code`.** The rubric gains the eight classes
  above and the fix protocol; the reviewer reports, per class, what it checked.
- **Human continuation instead of self-reset.** At the cap, an interactive run
  (one with `ask_user` available) asks: one more verification round, or hand
  back to planning (`SHIP_IT_BLOCKED.md`). Each approval adds exactly one round;
  the agent SHALL NOT restart a review budget on its own; round and approval
  counts are derived from the run's recorded files. Headless behaviour is
  unchanged.
- **A hand-back gates the next invocation.** A `SHIP_IT_BLOCKED.md` present at
  `ship-it` entry stops a headless run and makes an interactive run ask before
  resuming, so re-invoking cannot silently farm fresh review budgets.
- **Replies are parsed, not trusted.** An empty or self-contradictory reply
  (e.g. lists `B1`, ends `BLOCKING_COUNT: 0`) is malformed: one retry, then halt.

## Non-goals

- Parallel per-lens reviewers (≈6× calls) — measure the checklist first.
- Collateral-spec scan and planning-side claim checks — separate change
  (`add-spec-collateral-scan`).
- The narrow proof-of-effect rule for visual/config "done" claims (3 of 128
  claims corrected) — a direct `implement`-skill edit, not a spec change.
- CodeRabbit (the PR gate) and step 4.4 enforcers — unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `local-review-gate`: reviewer input comes from the generated prompt and
  includes design + delta specs + test-plan; round 2 is a verification round fed
  by a validated fix ledger; the cap halts into a human continuation choice
  (interactive) and forbids self-reset; the rubric sweeps named defect classes.
- `ship-it-orchestrator`: idempotent entry stops (headless) or asks (interactive)
  when `SHIP_IT_BLOCKED.md` exists; the red-test fix-loop requirement's review bound
  becomes "two, plus one per recorded human approval" and review fixes re-run
  the step-4.4 enforcers; the skill-composition requirement pins the generator,
  the ledger check and the new Guardrails wording.

## Impact

- `.pi/skills/ship-it/scripts/review-gate.ts` (`reviewRoundDecision` gains the
  continuation outcome), new `scripts/review-prompt.ts` (builder + CLI) and
  `scripts/fix-ledger.ts`, their `__tests__`, `skill-contract.test.ts`.
- `.pi/skills/ship-it/SKILL.md` step 4.5 and Guardrails.
- `packages/eng-disciplines/.pi/skills/review-code/SKILL.md` (published
  package): defect-class sweep + fix protocol. Additive guidance; no API.
- No runtime, server, client or protocol change. Rollback = revert the skill
  text and scripts; no persisted state is introduced.

## Discipline Skills

- `doubt-driven-review` — the cap/continuation semantics change a safety bound
  of an unattended gate; stress-test before it stands.
- `review-code` — both the subject of the change and the inner-loop check on it.
