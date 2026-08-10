# local-review-gate Specification

## Purpose
TBD - created by archiving change wire-local-review-gate. Update Purpose after archive.
## Requirements
### Requirement: A semantic review runs before push, on the integrated green tree

`ship-it` SHALL invoke a semantic review checkpoint (step 4.5) after the docker
harness is green and after the deterministic enforcers (step 4.4) pass, and
strictly before `ship-change` is driven inline. The checkpoint SHALL run on every
`ship-it` invocation; there SHALL NOT be a triviality escape based on diff size,
changed-file count, or touched paths.

#### Scenario: Review runs after the harness and the enforcers

- **WHEN** the harness reports every automated scenario green and step 4.4 exits 0
- **THEN** the review checkpoint runs before any `ship-change` step executes
- **AND** it reads the tree that already includes the `origin/develop` merge from step 2.5

#### Scenario: A small diff is still reviewed

- **WHEN** the change's diff is a single line in a single file
- **THEN** the review checkpoint still runs
- **AND** no diff-size or path heuristic skips it

#### Scenario: Review never runs on a red tree

- **WHEN** the harness is red, or a step-4.4 enforcer exits non-zero
- **THEN** the review checkpoint does not run
- **AND** no model call is spent on a tree that already fails a mechanical gate

### Requirement: The reviewer is fed the diff and the change's intent

The checkpoint SHALL supply the reviewer with both the change diff and the
change's intent — `proposal.md` plus the task text — so findings can be judged
against what the change set out to do, not against the diff alone. The diff
SHALL be scoped to the change's own commits and working-tree edits, not to
everything the step-2.5 merge introduced from `develop`. The scoping SHALL use
the three-dot range `git diff origin/develop...HEAD` (merge-base), which yields
only commits authored on this branch, plus uncommitted working-tree edits.

#### Scenario: Intent accompanies the diff

- **WHEN** the review checkpoint invokes the reviewer
- **THEN** the reviewer input contains the change diff
- **AND** it contains the change's `proposal.md`
- **AND** it contains the text of the tasks being implemented

#### Scenario: Merged develop code is not attributed to the change

- **WHEN** step 2.5 has merged `origin/develop` into the worktree
- **THEN** the reviewed diff excludes changes originating from `develop`
- **AND** the reviewer is not asked to review code the change did not author

#### Scenario: Cross-file coupling is reviewable

- **WHEN** a diff edits a file whose behavior is documented as mirroring another package's rules by comment only
- **THEN** the reviewer receives enough context to raise the coupling as a finding
- **AND** the finding does not depend on any static-analysis rule existing for it

### Requirement: The reviewer is a REQUIRED role-aliased subagent

The checkpoint SHALL spawn an isolated subagent via the `Agent` tool with
`model: "@review"`, carrying `review-code`'s rubric as its prompt. It SHALL NOT
invoke the CodeRabbit CLI or any other metered PR-gate service, and SHALL NOT run
the review procedure inline in the orchestrator's own context.

`@review` SHALL be required: when the role is unconfigured or does not resolve,
the checkpoint SHALL fail with an actionable error naming the fix. It SHALL NOT
fall back to the session default model, because that model is the author model
and the result would be self-review.

#### Scenario: Role alias configured

- **WHEN** `@review` resolves to a model
- **THEN** the checkpoint spawns an isolated subagent on that model
- **AND** the reviewer runs in a context separate from the orchestrator's

#### Scenario: Role alias unconfigured

- **WHEN** `@review` is not configured or fails to resolve
- **THEN** the checkpoint fails with an error naming `@review` and how to set it
- **AND** the error suggests seeding it from an existing `@propose-review-N` role
- **AND** no review is performed against the session default model

#### Scenario: Review is never run inline by the orchestrator

- **WHEN** the checkpoint executes
- **THEN** the review is performed by a spawned subagent, not by the orchestrator itself

#### Scenario: PR-gate quota is not spent locally

- **WHEN** the checkpoint runs
- **THEN** no CodeRabbit CLI invocation occurs
- **AND** CodeRabbit remains the post-push PR gate, unchanged

### Requirement: Each reviewer invocation is deadline-bounded

The checkpoint SHALL apply a timeout to every reviewer invocation. A timeout
SHALL be treated as a checkpoint failure with a legible reason — never as a
blocking finding, and never as a silent pass.

#### Scenario: Reviewer stalls

- **WHEN** the reviewer invocation exceeds its deadline
- **THEN** the checkpoint terminates the invocation
- **AND** reports a timeout as the reason
- **AND** the headless run does not hang

#### Scenario: Timeout is not a silent pass

- **WHEN** a reviewer invocation times out
- **THEN** `ship-it` does not proceed to `ship-change` as though the review had passed

### Requirement: Severity routing under a hard cap of two review rounds

Findings of severity `issue(blocking)` SHALL re-enter `ship-it`'s step-4 fix
loop. Findings of every other severity SHALL be reported and SHALL NOT block.

The review SHALL be bounded by an explicit count of at most **two rounds**:
review, fix, re-review. If blocking findings remain after the second round, the
checkpoint SHALL stop and take the escape hatch. There SHALL NOT be a third
round, and the review SHALL NOT be bounded solely by step 4's no-progress rule,
which a non-deterministic reviewer can defeat by emitting a fresh finding each
cycle.

#### Scenario: Clean first round

- **WHEN** round 1 returns no `issue(blocking)` findings
- **THEN** `ship-it` proceeds to drive `ship-change`
- **AND** any non-blocking findings are reported

#### Scenario: Blocking finding fixed and cleared on re-review

- **WHEN** round 1 returns an `issue(blocking)` finding
- **THEN** it becomes a work item in the step-4 fix loop
- **AND** the harness is re-run after the fix
- **AND** exactly one re-review (round 2) runs on the updated diff
- **AND** a clean round 2 proceeds to `ship-change`

#### Scenario: Blocking findings survive the second round

- **WHEN** round 2 still returns `issue(blocking)` findings
- **THEN** `ship-it` stops and takes the escape hatch
- **AND** no third review round is performed

#### Scenario: A reviewer emitting fresh findings each round cannot loop forever

- **WHEN** the reviewer returns a different `issue(blocking)` finding on every round
- **THEN** the run still terminates after round 2
- **AND** termination does not depend on a cycle producing no worktree change

#### Scenario: A review fix may not weaken a test

- **WHEN** a fix for a review finding edits a test file in a way `assertNoWeakening` reports as `ok:false`
- **THEN** the change is rejected
- **AND** the finding is addressed in code instead

#### Scenario: An unsatisfiable finding is escalated, not looped

- **WHEN** a blocking finding can only be satisfied by weakening or deleting a test, and `assertNoWeakening` therefore rejects every candidate fix
- **THEN** the checkpoint stops and takes the escape hatch
- **AND** the report names both the finding and the guardrail blocking it
- **AND** the guardrail is not relaxed automatically

### Requirement: A review-driven halt is legible

When the checkpoint halts — blocking findings surviving round 2, an unsatisfiable
finding, an unconfigured `@review` role, or a reviewer timeout — `ship-it` SHALL
take the existing boundary-reverse escape hatch: leave the worktree intact, write
`openspec/changes/<change>/SHIP_IT_BLOCKED.md` naming the cause and what was
attempted, and exit non-zero. No new exit path or artifact SHALL be introduced.

#### Scenario: Unattended run halts on review

- **WHEN** a headless `ship-it` run has blocking findings after round 2
- **THEN** `SHIP_IT_BLOCKED.md` is written naming the blocking findings and the attempted fixes
- **AND** the worktree is left intact
- **AND** the process exits non-zero

#### Scenario: Configuration and timeout failures are equally legible

- **WHEN** the checkpoint fails because `@review` is unconfigured, or because the reviewer timed out
- **THEN** the same escape hatch records the cause
- **AND** a human can determine from the artifact why the run stopped

#### Scenario: No new escape machinery

- **WHEN** a review-driven halt occurs
- **THEN** it uses the same escape hatch as a red-test halt
- **AND** no additional blocked-state file or exit code is defined

