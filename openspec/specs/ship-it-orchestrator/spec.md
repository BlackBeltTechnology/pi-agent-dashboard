# ship-it-orchestrator Specification

## Purpose
Worktree-side implementation orchestrator for an OpenSpec change. Idempotent entry gated on filesystem reality (an automated scenario is done only when its test file exists and passes the docker harness, never the checkbox alone); owns the red-test fix loop with a no-weakening guardrail; delegates the harness lifecycle with strict teardown ordering; drives `ship-change` inline with a manifest-aware defer; and provides a boundary-reverse escape hatch (`SHIP_IT_BLOCKED.md`) back to planning.
## Requirements
### Requirement: Idempotent entry gated on filesystem reality

The `ship-it` skill SHALL run inside a git worktree and be idempotent: its first
act is `openspec status` for orientation, but it SHALL treat an `automated`
manifest scenario as satisfied only when its test file exists AND passes in the
docker harness — never on the `tasks.md` checkbox alone. A hand-checked or
prior-partial `- [x]` MUST NOT be trusted as proof an automated test is done.

#### Scenario: Checkbox says done but test file missing
- **WHEN** an `automated` scenario's task is `- [x]` but its test file is absent
- **THEN** `ship-it` treats the scenario as NOT done, authors the test, and runs it before continuing

#### Scenario: Re-invocation after a partial run
- **WHEN** `ship-it` is invoked again on a partially-implemented worktree
- **THEN** it re-verifies each automated scenario against harness results and does only the remaining work to reach all-green, reaching the same end state as a fresh run

### Requirement: ship-it owns the red-test fix loop

When an authored test runs red, `ship-it` SHALL drive the fix itself (edit code
or test, re-run the harness); it MUST NOT re-invoke `openspec-apply` on an
already-checked task, because apply does not revisit checked tasks. The same loop
SHALL also carry the fixes for `issue(blocking)` findings raised by the step-4.5
review checkpoint.

The loop SHALL be bounded by progress-making cycles for **red tests** — a cycle
that produces no change SHALL immediately escalate rather than count against the
bound. That progress rule SHALL NOT be the bound for **review findings**: a
non-deterministic reviewer can emit a fresh finding every round, so every cycle
would register as progress and the bound would never fire. Review rounds SHALL
instead be bounded by an explicit count of at most two (see the
`local-review-gate` capability). Both bounds escalate to the same escape hatch,
whichever trips first.

`ship-it` MUST NOT reach green by weakening a test, including when the fix
answers a review finding.

#### Scenario: Red test, fix makes progress
- **WHEN** a harness run is red and `ship-it` makes a code/test change
- **THEN** it re-runs the harness and continues, counting the cycle toward the bound

#### Scenario: Blocking review finding, fix makes progress
- **WHEN** the step-4.5 checkpoint returns an `issue(blocking)` finding and `ship-it` makes a code/test change
- **THEN** it re-runs the harness and performs exactly one re-review
- **AND** the review is bounded by the two-round cap, not by the no-progress rule

#### Scenario: No-progress cycle
- **WHEN** a fix cycle produces no change to the worktree
- **THEN** `ship-it` stops the loop immediately and surfaces the blocker (per the escape hatch), rather than spinning

#### Scenario: A reviewer that keeps finding new issues still terminates
- **WHEN** the reviewer returns a different `issue(blocking)` finding on each round, so every cycle changes the worktree
- **THEN** `ship-it` still terminates after the second review round
- **AND** it takes the escape hatch rather than looping

#### Scenario: Weakening a test is rejected
- **WHEN** a cycle's diff of the test file would add `.only`, `skip`, delete the test, or weaken an assertion
- **THEN** `ship-it` rejects that change and does not use it to reach green
- **AND** this holds whether the cycle answers a red test or a review finding

### Requirement: Manifest-aware defer via ship-change, run inline

`ship-it` SHALL execute `ship-change`'s procedure inline (not as a black-box
subagent) so it retains step-level control. The defer rule SHALL read the
manifest: when `test-plan.md` exists, a leftover `- [ ]` task is deferrable only
if it maps to a `manual-only` manifest row; any other leftover is real work and
SHALL stop the ship. When `test-plan.md` is absent (legacy change), the existing
keyword-based defer SHALL apply unchanged.

#### Scenario: Only manual-only tasks remain
- **WHEN** every leftover task maps to a `manual-only` manifest row
- **THEN** `ship-it` marks them deferred-to-post-merge and proceeds to archive, PR, CI, and merge

#### Scenario: A non-manual leftover remains
- **WHEN** a leftover `- [ ]` task does not map to a `manual-only` manifest row
- **THEN** `ship-it` stops and reports real work remaining, without shipping

#### Scenario: Legacy change without a manifest
- **WHEN** the change has no `test-plan.md`
- **THEN** `ship-it` applies `ship-change`'s current keyword defer behavior unchanged

### Requirement: Harness lifecycle delegated with strict teardown ordering

`ship-it` SHALL obtain the harness and its port by calling `docker/test-up.sh`
from inside the worktree (which allocates on first run and reuses on re-up) and
reading the derived port from `.pi-test-harness.json`; it SHALL NOT hardcode a
port. It SHALL wrap the harness in a trap/finally so `docker/test-down.sh` runs
on red test, abort, or partial start, and SHALL tear the harness down BEFORE
`ship-change` attempts worktree removal.

#### Scenario: Port read from state file
- **WHEN** `ship-it` starts the harness
- **THEN** it runs the suite against the port recorded in `.pi-test-harness.json`, not a fixed `:18000`

#### Scenario: Teardown precedes worktree removal
- **WHEN** the ship reaches worktree removal
- **THEN** `test-down.sh` has already run so no leaked container makes the worktree busy

#### Scenario: Abort mid-run
- **WHEN** `ship-it` aborts or a test-up start is partial
- **THEN** the trap runs `test-down.sh`, leaving no orphaned compose project for that worktree

### Requirement: Boundary-reverse escape hatch

`ship-it` SHALL provide a reverse path across the worktree boundary. When
`openspec-apply` reveals a design issue, or the fix-loop bound is exhausted,
`ship-it` MUST NOT headlessly rewrite planning artifacts. It SHALL leave the
worktree intact, write a `SHIP_IT_BLOCKED.md` report in the change directory
naming the failing scenario or design gap, exit non-zero, and surface via the
dashboard so a human re-enters `plan-proposal`/`doubt-driven-review` on
`develop`.

#### Scenario: Apply surfaces a design issue
- **WHEN** apply reports that implementation reveals a design issue
- **THEN** `ship-it` writes `SHIP_IT_BLOCKED.md`, exits non-zero, leaves the worktree unmodified beyond the report, and does not edit `proposal.md`/`design.md`

#### Scenario: Fix bound exhausted
- **WHEN** the red-test fix loop exhausts its progress-making bound
- **THEN** `ship-it` writes `SHIP_IT_BLOCKED.md` naming the failing scenario and stops for human handoff

### Requirement: Steps 4.4 and 4.5 sit between the harness gate and the inline ship-change drive

`ship-it`'s procedure SHALL contain a deterministic enforcer step 4.4 and a
semantic review step 4.5, in that order, executed only after every automated
scenario is harness-green and strictly before any `ship-change` step runs. Step
4.4 SHALL run `check-conventions.mjs --base origin/develop`, the `kb dox lint`
byte-arm gate, `i18n:lint --strict`, and `i18n:parity`. The skill's
composed-skills list SHALL name `review-code`.

#### Scenario: Ordering is enforced

- **WHEN** `ship-it` runs to completion
- **THEN** step 4.4 executes after the harness gate
- **AND** step 4.5 executes after step 4.4
- **AND** both execute before the first `ship-change` step

#### Scenario: Cheap deterministic failure precedes the model call

- **WHEN** a step-4.4 enforcer exits non-zero
- **THEN** step 4.5 does not run
- **AND** no reviewer model call is spent

#### Scenario: Skill documents the composition

- **WHEN** `.pi/skills/ship-it/SKILL.md` is read
- **THEN** it describes steps 4.4 and 4.5
- **AND** its Composed skills section names `review-code`
- **AND** its Guardrails state that review rounds are capped at two and escalate via the step-5 escape hatch

