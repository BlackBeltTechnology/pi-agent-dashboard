## ADDED Requirements

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
already-checked task, because apply does not revisit checked tasks. The loop
SHALL be bounded by progress-making cycles — a cycle that produces no change
SHALL immediately escalate rather than count against the bound. `ship-it` MUST
NOT reach green by weakening a test.

#### Scenario: Red test, fix makes progress
- **WHEN** a harness run is red and `ship-it` makes a code/test change
- **THEN** it re-runs the harness and continues, counting the cycle toward the bound

#### Scenario: No-progress cycle
- **WHEN** a fix cycle produces no change to the worktree
- **THEN** `ship-it` stops the loop immediately and surfaces the blocker (per the escape hatch), rather than spinning

#### Scenario: Weakening a test is rejected
- **WHEN** a cycle's diff of the test file would add `.only`, `skip`, delete the test, or weaken an assertion
- **THEN** `ship-it` rejects that change and does not use it to reach green

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
