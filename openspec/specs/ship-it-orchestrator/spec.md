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

A `SHIP_IT_BLOCKED.md` already present in the change directory at entry means a
previous invocation handed the change to a human. An interactive run SHALL show
its cause and ask via `ask_user` whether to resume; on resume it SHALL copy the
file's content into the new invocation's run directory (outside version
control, beside that invocation's review records) and remove the file, and on refusal it SHALL stop without changes. A headless run SHALL exit
non-zero naming the file and SHALL NOT start any fix loop or review round.
Removing the file, or answering resume, is the human decision that lets a new
invocation start a new review budget.

#### Scenario: Checkbox says done but test file missing
- **WHEN** an `automated` scenario's task is `- [x]` but its test file is absent
- **THEN** `ship-it` treats the scenario as NOT done, authors the test, and runs it before continuing

#### Scenario: Re-invocation after a partial run
- **WHEN** `ship-it` is invoked again on a partially-implemented worktree
- **THEN** it re-verifies each automated scenario against harness results and does only the remaining work to reach all-green, reaching the same end state as a fresh run

#### Scenario: Headless re-invocation after a hand-back is refused
- **WHEN** a headless `ship-it` starts while `SHIP_IT_BLOCKED.md` exists in the change directory
- **THEN** it exits non-zero naming `SHIP_IT_BLOCKED.md`
- **AND** no review round and no fix cycle runs

#### Scenario: Interactive resume is an explicit decision
- **WHEN** an interactive `ship-it` starts while `SHIP_IT_BLOCKED.md` exists
- **THEN** `ask_user` shows the recorded cause and asks whether to resume
- **AND** on resume the previous cause is copied into the new invocation's run directory and the file is removed
- **AND** on refusal nothing is changed

### Requirement: ship-it owns the red-test fix loop

When an authored test runs red, `ship-it` SHALL drive the fix itself (edit code
or test, re-run the harness); it MUST NOT re-invoke `openspec-apply` on an
already-checked task, because apply does not revisit checked tasks. The same loop
SHALL also carry the fixes for `issue(blocking)` findings raised by the step-4.5
review checkpoint; after each such fix it SHALL re-run the harness and the
step-4.4 enforcers before another review round is requested.

The loop SHALL be bounded by progress-making cycles for **red tests** — a cycle
that produces no change SHALL immediately escalate rather than count against the
bound. That progress rule SHALL NOT be the bound for **review findings**: a
non-deterministic reviewer can emit a fresh finding every round, so every cycle
would register as progress and the bound would never fire. Review rounds SHALL
instead be bounded by an explicit count of at most two, raised by exactly one
round per human approval given at the cap in an interactive run (see the
`local-review-gate` capability). Both bounds escalate to the same
boundary-reverse (step-5) escape hatch, whichever trips first; at the review cap
an interactive run first asks the human whether to add one round.

`ship-it` MUST NOT reach green by weakening a test, including when the fix
answers a review finding.

#### Scenario: Red test, fix makes progress
- **WHEN** a harness run is red and `ship-it` makes a code/test change
- **THEN** it re-runs the harness and continues, counting the cycle toward the bound

#### Scenario: Blocking review finding, fix makes progress
- **WHEN** the step-4.5 checkpoint returns an `issue(blocking)` finding and `ship-it` makes a code/test change
- **THEN** it re-runs the harness and the step-4.4 enforcers and performs exactly one verification round
- **AND** the review is bounded by the round cap, not by the no-progress rule

#### Scenario: No-progress cycle
- **WHEN** a fix cycle produces no change to the worktree
- **THEN** `ship-it` stops the loop immediately and surfaces the blocker (per the escape hatch), rather than spinning

#### Scenario: A reviewer that keeps finding new issues still terminates
- **WHEN** the reviewer returns a different `issue(blocking)` finding on each round, so every cycle changes the worktree
- **THEN** a headless `ship-it` still terminates after the second review round and takes the escape hatch rather than looping
- **AND** an interactive `ship-it` runs no round beyond the second without a human approval recorded for that round

#### Scenario: Weakening a test is rejected
- **WHEN** a cycle's diff of the test file would add `.only`, `skip`, delete the test, or weaken an assertion
- **THEN** `ship-it` rejects that change and does not use it to reach green
- **AND** this holds whether the cycle answers a red test or a review finding

#### Scenario: A review fix that breaks an enforcer is caught before re-review
- **WHEN** a fix for a blocking finding makes a step-4.4 enforcer exit non-zero
- **THEN** no verification round is requested
- **AND** the enforcer failure re-enters the fix loop first

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
composed-skills list SHALL name `review-code`. Step 4.5 SHALL obtain the
reviewer prompt from the skill's prompt generator and pass it verbatim, and
SHALL validate the fix ledger before requesting any verification round.

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
- **AND** step 4.5 instructs running the prompt generator and passing its output verbatim
- **AND** step 4.5 instructs validating the fix ledger before any verification round
- **AND** its Guardrails state that review rounds are capped at two, that only a human approval at the cap adds a round (one per approval), that the orchestrator never renews its own budget, and that headless runs and hand-backs escalate via the boundary-reverse (step-5) escape hatch
