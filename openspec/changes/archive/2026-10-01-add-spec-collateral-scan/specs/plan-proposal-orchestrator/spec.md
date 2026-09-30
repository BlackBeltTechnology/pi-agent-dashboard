## MODIFIED Requirements

### Requirement: Planning-phase orchestration on develop, main session only

The `plan-proposal` skill SHALL orchestrate the planning phase of an OpenSpec
change on the `develop` branch by composing existing skills, and SHALL run only
in the main interactive session. It MUST NOT be spawned as a subagent, because
it invokes `doubt-driven-review` (which spawns a fresh-context reviewer, and a second
cross-model reviewer — automatically when a `@propose-review-N` role resolves,
otherwise after an interactive offer) and `scenario-design` (whose
proposal/design-stage gate calls `ask_user`), both of which require a live main
session.

#### Scenario: Invoked in the main session
- **WHEN** a user invokes `plan-proposal` for a change in the main session on `develop`
- **THEN** it ensures the planning artifacts exist (via `openspec-new-change`/`-ff`/`-continue`), then runs doubt-review and scenario folding as ordered steps

#### Scenario: Refused inside a subagent
- **WHEN** `plan-proposal` detects it is running inside a subagent context where nested reviewer spawn is blocked
- **THEN** it SHALL stop and surface that planning must run in the main session, rather than degrade the doubt-review

### Requirement: Doubt-review trigger on proposal or design authoring

`plan-proposal` SHALL run `doubt-driven-review` on `proposal.md` and `design.md`
whenever either is drafted or modified during the planning phase, passing
ARTIFACT + CONTRACT only (never the CLAIM). Cross-model review SHALL run
automatically when a `@propose-review-N` reviewer role resolves; the interactive
cross-model offer SHALL be surfaced only when no reviewer role resolves.

Before each doubt-review cycle, `plan-proposal` SHALL run the spec-collateral
scan for the change and include its output in the CONTRACT as advisory
candidate conflicting requirements for the reviewer to check one by one. The
reviewer prompt SHALL instruct the reviewer to verify claims against the
repository, to write `unverified` for any claim it cannot check instead of
asserting it, and to report every listed candidate the artifact contradicts.
If the scan cannot run or exits non-zero, `plan-proposal` SHALL report the
failure and proceed with the doubt-review without candidates; the scan never
blocks planning. A candidate the reviewer shows to be contradicted SHALL be
resolved by a delta or an artifact correction; recording it as unaffected is
reserved for a verified false positive. After folding scenarios into `tasks.md`,
`plan-proposal` SHALL run the scan once more and report any candidate not seen
in the doubt-review cycles; a real conflict among them returns planning to the
doubt-review step.

When authoring `design.md`, `plan-proposal` SHALL instruct the author to cite the
path, and the line when the statement is line-specific, for every statement
about existing code behaviour.

#### Scenario: Proposal drafted or edited
- **WHEN** `proposal.md` or `design.md` is created or changed within `plan-proposal`
- **THEN** it invokes `doubt-driven-review` on the changed artifact and reconciles findings before proceeding to folding

#### Scenario: Review reveals an actionable finding
- **WHEN** the doubt-review classifies a finding as valid + actionable
- **THEN** `plan-proposal` pauses for the artifact to be corrected before committing planning artifacts

#### Scenario: Scan output reaches the contract every cycle
- **WHEN** a doubt-review cycle starts
- **THEN** the spec-collateral scan has been run on the current artifacts
- **AND** when that scan completed, its candidate lists appear in the CONTRACT labelled as advisory

#### Scenario: Candidates introduced by the fold are surfaced
- **WHEN** folding adds a task naming an identifier that brings a new capability into the scan's first list
- **THEN** `plan-proposal` reports that candidate before committing

#### Scenario: A failing scan does not block planning
- **WHEN** the spec-collateral scan exits non-zero before a doubt-review cycle
- **THEN** `plan-proposal` reports the scan failure
- **AND** the doubt-review cycle still runs, with no candidate list in the CONTRACT

#### Scenario: Unverifiable claims are labelled, not asserted
- **WHEN** the doubt-review reviewer prompt is composed
- **THEN** it instructs the reviewer to mark claims it cannot verify as `unverified`

#### Scenario: Cross-model runs without asking when a role resolves
- **WHEN** a `@propose-review-N` role probes clean
- **THEN** the cross-model review runs without an interactive offer
- **AND** the offer is surfaced only when no reviewer role resolves

#### Scenario: Code claims in design carry citations
- **WHEN** `plan-proposal` drives the authoring of `design.md`
- **THEN** its instructions require a path (and line when specific) for each statement about existing code behaviour
