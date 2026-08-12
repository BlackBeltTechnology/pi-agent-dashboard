# openspec-spec-integrity — delta

## ADDED Requirements

### Requirement: Main spec structural contract

Every file at `openspec/specs/<capability>/spec.md` SHALL contain an h2 section
titled exactly `Purpose` and an h2 section titled exactly `Requirements`, and
SHALL NOT contain any delta header (`## ADDED Requirements`,
`## MODIFIED Requirements`, `## REMOVED Requirements`, `## RENAMED Requirements`,
or any h2 beginning with those words).

Delta headers are valid **only** inside
`openspec/changes/<name>/specs/<capability>/spec.md`. The parser resolves the
requirements section by exact case-insensitive title match, so `## ADDED
Requirements` is an unrelated section and every `### Requirement:` beneath it is
invisible to `validate`, `list`, `show`, and `archive`.

#### Scenario: Conforming spec parses fully

- **WHEN** a main spec has `## Purpose` and `## Requirements` and no delta header
- **THEN** `openspec validate <capability>` SHALL report the spec valid
- **AND** the requirement count from `openspec show <capability> --json` SHALL
  equal the count of `### Requirement:` headers in the file

#### Scenario: Delta header in a main spec is rejected

- **WHEN** a main spec contains `## ADDED Requirements`
- **THEN** `openspec validate <capability>` SHALL report an error
- **AND** the spec SHALL NOT be considered conforming

#### Scenario: Missing Purpose aborts the parse before other checks

- **WHEN** a main spec has no `## Purpose` section
- **THEN** `openspec validate <capability>` SHALL report `Spec must have a
  Purpose section`
- **AND** any delta-header defect in the same file SHALL remain unreported until
  the Purpose defect is repaired

### Requirement: Repair tool promotes the first delta header and deletes the rest

`scripts/repair-main-specs.mjs` SHALL rewrite a non-conforming main spec by
renaming the **first** delta header to `## Requirements` and **deleting** every
subsequent delta header line, so that all requirements become children of the
single surviving `## Requirements` section.

Renaming subsequent headers is forbidden: the parser's section lookup returns the
**first** match, so a second `## Requirements` section would be ignored and its
requirements would stay invisible — a repair that reports success while changing
nothing observable.

#### Scenario: Single delta header is promoted

- **WHEN** the tool repairs a spec whose only delta header is `## ADDED Requirements`
- **THEN** that line SHALL become `## Requirements`
- **AND** every `### Requirement:` in the file SHALL be visible to `openspec show`

#### Scenario: Second delta header is deleted, not renamed

- **WHEN** the tool repairs a spec carrying two delta headers (e.g.
  `app-decomposition`, `browser-gateway-decomposition`, `command-executor`,
  `auto-shutdown`)
- **THEN** the first SHALL become `## Requirements` and the second SHALL be
  removed entirely
- **AND** the repaired file SHALL contain exactly one `## Requirements` section
- **AND** the requirement count from `openspec show` SHALL equal the file's
  `### Requirement:` count, including those that followed the deleted header

#### Scenario: Suffixed delta header is handled

- **WHEN** a delta header carries trailing text (e.g.
  `## ADDED Requirements — Tool Modules`)
- **THEN** the tool SHALL treat it as a delta header
- **AND** SHALL NOT leave the suffixed heading in the repaired file

### Requirement: Repair tool refuses REMOVED requirement blocks

The repair tool SHALL NOT promote a `## REMOVED Requirements` section to
`## Requirements`. On encountering one it SHALL leave the file unmodified, name
the spec on stderr, and exit non-zero.

Requirements under `## REMOVED Requirements` were deliberately retired by a
change and carry `**Reason**` / `**Migration**` annotations. Promoting them would
restore retired behaviour as current specification — a silent, semantically
destructive corruption that no structural check would catch.

#### Scenario: REMOVED block halts the repair

- **WHEN** the tool encounters a spec containing `## REMOVED Requirements`
- **THEN** it SHALL exit non-zero naming that spec
- **AND** SHALL leave the file byte-identical

#### Scenario: Refusal does not block conforming repairs

- **WHEN** the tool runs across the full spec tree and one spec has a REMOVED block
- **THEN** the refusal SHALL be reported as requiring manual handling
- **AND** SHALL identify the spec by path so a human can decide between deletion,
  restoration, and tombstoning

### Requirement: Repair tool is idempotent

Running `scripts/repair-main-specs.mjs` on an already-conforming spec tree SHALL
produce no file modifications and exit zero.

The tool is retained in `scripts/` for future drift, so a second run must be
safe — in particular it SHALL NOT insert a duplicate `## Purpose`, duplicate an
h1, or alter a spec it previously repaired.

#### Scenario: Second run is a no-op

- **WHEN** the tool is run twice in succession
- **THEN** the second run SHALL modify zero files
- **AND** `git diff` after the second run SHALL be empty

#### Scenario: Conforming specs are never touched

- **WHEN** the tool runs over the 446 already-valid specs
- **THEN** none of them SHALL be modified

### Requirement: Repair tool re-validates after writing

After writing repairs the tool SHALL re-run validation on each modified spec and
report any errors that surface only after the write.

Because `Spec must have a Purpose section` aborts parsing before the
delta-header check executes, a spec can report exactly one error before repair
and a different error after it. A tool that validates only once would report
success on a spec that is still broken.

#### Scenario: Second-phase error is surfaced in the same run

- **WHEN** a spec's missing-Purpose defect is repaired and a delta-header defect
  is thereby revealed
- **THEN** the tool SHALL report the revealed error in the same run
- **AND** SHALL NOT report the spec as fully repaired

#### Scenario: Exit code reflects final validation state

- **WHEN** any modified spec still fails validation after the write
- **THEN** the tool SHALL exit non-zero

### Requirement: Main specs carry an authored Purpose, not a repair placeholder

Any `## Purpose` the repair tool inserts SHALL be marked with a `TODO(repair):`
token, and no such token SHALL remain in `openspec/specs/**` when the change is
complete. Each repaired spec SHALL carry a Purpose describing that capability,
derived from its own requirement text.

The inserted placeholder is scaffolding that makes the structural repair
scriptable; it is not the deliverable. This requirement deliberately does not
govern the 111 pre-existing specs carrying the archive's own `TBD - created by
archiving change` placeholder, which parse and validate.

#### Scenario: No repair placeholder survives

- **WHEN** the change is complete
- **THEN** `grep -r 'TODO(repair):' openspec/specs/` SHALL return no matches

#### Scenario: Inserted Purpose is marked

- **WHEN** the tool inserts a `## Purpose` section
- **THEN** the inserted body SHALL contain `TODO(repair):`
- **AND** the spec SHALL parse successfully so later phases can proceed

### Requirement: Retired capabilities are deleted rather than repaired

A main spec whose every requirement is retired — carrying zero current
requirements — SHALL be deleted rather than structurally repaired, provided each
retired requirement's successor capability exists as a live spec.

Repairing such a file would publish a capability the project no longer has.

#### Scenario: Fully retired capability is removed

- **WHEN** a spec's `### Requirement:` count equals its `**Reason**:` count and
  every named successor exists under `openspec/specs/`
- **THEN** the spec directory SHALL be deleted
- **AND** `openspec validate --specs` SHALL NOT report it

#### Scenario: Successor verification precedes deletion

- **WHEN** a retired spec names a successor capability
- **THEN** that successor SHALL be confirmed to exist and carry the behaviour
  before the retired spec is deleted

### Requirement: Whole spec tree validates

`openspec validate --specs --no-interactive` SHALL exit zero across
`openspec/specs/**`.

#### Scenario: Full tree is clean after repair

- **WHEN** `openspec validate --specs --no-interactive` runs after the change
- **THEN** it SHALL exit zero
- **AND** report zero specs with errors

#### Scenario: Recovered requirements become visible

- **WHEN** the repaired tree is queried via `openspec show`
- **THEN** the 413 previously hidden requirement blocks SHALL be reported
- **AND** `interactive-renderers` SHALL report 5 requirements rather than 3
