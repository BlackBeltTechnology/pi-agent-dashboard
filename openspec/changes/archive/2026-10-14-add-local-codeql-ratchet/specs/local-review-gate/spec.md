## MODIFIED Requirements

### Requirement: A semantic review runs before push, on the integrated green tree

`ship-it` SHALL invoke a semantic review checkpoint (step 4.5) after the docker
harness is green and after the deterministic enforcers (step 4.4) pass, and
strictly before `ship-change` is driven inline. The checkpoint SHALL run on every
`ship-it` invocation that proceeds toward `ship-change`; there SHALL NOT be a
triviality escape based on diff size, changed-file count, or touched paths. An
invocation stopped before step 4.5 — by the entry gate on an existing
`SHIP_IT_BLOCKED.md`, a red harness, or a failing enforcer — neither reviews nor
reaches `ship-change`. The checkpoint SHALL additionally run only after the local CodeQL
ratchet (step 4.4b) passes or reports that CodeQL is unavailable; an invocation
stopped by new CodeQL alerts not yet fixed or accepted in step 4.4b neither
reviews nor reaches `ship-change`.

#### Scenario: Review runs after the harness and the enforcers

- **WHEN** the harness reports every automated scenario green and step 4.4 exits 0
- **AND** step 4.4b passes or reports that CodeQL is unavailable
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

#### Scenario: An invocation stopped at the entry gate neither reviews nor ships

- **WHEN** `ship-it` stops at entry because `SHIP_IT_BLOCKED.md` exists
- **THEN** the review checkpoint does not run
- **AND** no `ship-change` step runs

#### Scenario: Unresolved CodeQL alert prevents the review

- **WHEN** step 4.4b reports a new CodeQL alert that is neither fixed nor accepted
- **THEN** the review checkpoint does not run
- **AND** no reviewer model call is spent
