## MODIFIED Requirements

### Requirement: The convention is advisory, not gating

The `## Discipline Skills` convention SHALL be gating for proposals a change
touches, and advisory for proposals it does not. A missing line in a
`proposal.md` that the current change adds or content-modifies SHALL fail
`ship-it` step 4.4. A missing line in a `proposal.md` the current change does not
touch SHALL NOT fail any build, gate, or commit, so the pre-existing backlog does
not block unrelated work. Archiving a legacy proposal — a pure rename — SHALL NOT
count as touching it.

The posture change is deliberate: 34 of 74 active proposals omit the line, a 46%
violation rate that is evidence the advisory posture did not produce compliance.
Scoping the gate to touched files makes the rule enforceable without a backfill.

#### Scenario: Absence in a touched proposal fails the gate

- **WHEN** a change adds or content-modifies a `proposal.md` that omits the `## Discipline Skills` line
- **THEN** `scripts/check-conventions.mjs` reports the file
- **AND** `ship-it` step 4.4 exits non-zero

#### Scenario: Absence in an untouched proposal does not fail a gate

- **WHEN** an existing `proposal.md` omits the line and the current change does not touch it
- **THEN** no lint, CI job, or commit gate fails on that basis

#### Scenario: A relocated proposal is not treated as authored

- **WHEN** a change moves a legacy `proposal.md` to a new path without changing its content
- **THEN** the gate does not fail on that file

#### Scenario: Backfill is not required

- **WHEN** the gating check is wired
- **THEN** the 34 existing proposals missing the line are not modified
- **AND** the gate is nonetheless green on the change's own tree

### Requirement: Proposals declare their applicable discipline skills

AGENTS.md SHALL define a proposal-authoring convention that carries
discipline-skill hints into the openspec implement loop via the proposal
artifact, without modifying any openspec skill. Because the convention is now
gating for touched proposals, a touched proposal SHALL always carry the
`## Discipline Skills` heading; when no discipline applies, it SHALL say so
explicitly under that heading rather than omitting it.

#### Scenario: Convention is documented under OpenSpec Conventions

- **WHEN** the `## OpenSpec Conventions` section of AGENTS.md is read
- **THEN** it instructs authors to add a `## Discipline Skills` line to `proposal.md` naming applicable `eng-disciplines` skills
- **AND** it maps skill selection to the checkpoint table
- **AND** it states that the heading is required on any proposal a change touches

#### Scenario: No applicable discipline is stated, not omitted

- **WHEN** a touched proposal has no applicable discipline skill
- **THEN** it carries the `## Discipline Skills` heading recording that none apply
- **AND** the gate passes

#### Scenario: No openspec skill is modified

- **WHEN** the change's diff is inspected
- **THEN** no file under `.pi/skills/openspec-*` or `.pi/skills/implement` is modified
- **AND** the convention itself is still carried by `AGENTS.md`, not by an openspec skill
- **AND** enforcement lives in `scripts/check-conventions.mjs`, invoked by `ship-it`, rather than in any openspec skill
