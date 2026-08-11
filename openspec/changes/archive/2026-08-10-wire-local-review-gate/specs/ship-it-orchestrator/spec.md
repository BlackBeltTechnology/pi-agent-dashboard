## MODIFIED Requirements

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

## ADDED Requirements

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
