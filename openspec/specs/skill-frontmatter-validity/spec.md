# skill-frontmatter-validity Specification

## Purpose
TBD - created by archiving change fix-skill-frontmatter-yaml. Update Purpose after archive.
## Requirements
### Requirement: Skill frontmatter parses as valid YAML

Every `SKILL.md` in the repo SHALL have a leading `---`-fenced frontmatter block that parses as valid YAML (excluding `node_modules`, build output, and worktree checkouts).

#### Scenario: All skill manifests parse

- **WHEN** the guard globs every `**/SKILL.md` under the repo (excluding `node_modules`, `dist`, and worktrees)
- **THEN** each file's `---`-fenced frontmatter SHALL parse without a YAML error.

#### Scenario: Description-with-colon values are quoted

- **WHEN** a skill `description` value contains a `colon-space` sequence (e.g. `Triggers: "…"`)
- **THEN** the value SHALL be a quoted or block scalar so the parser does not read it as a nested mapping.

### Requirement: Skill frontmatter declares a non-empty description

Every `SKILL.md` frontmatter SHALL contain a `description` key whose value is a non-empty string after trimming. This mirrors pi's hard-drop behaviour: a skill without a non-empty `description` is not loaded at all.

The guard collects only files named `SKILL.md`, so documentation-tree files such as `AGENTS.md` and `*.AGENTS.md` are outside its scope by construction and need no exemption. Discovery likewise excludes them by applying pi's own load gate, not by name.

#### Scenario: Missing or empty description fails the guard

- **WHEN** a `SKILL.md` frontmatter omits `description` or sets it to an empty/whitespace string
- **THEN** the guard SHALL fail and name the offending file.

#### Scenario: Documentation-tree files are never collected

- **GIVEN** `.pi/skills/AGENTS.md` with no frontmatter
- **WHEN** the guard runs
- **THEN** it SHALL NOT be collected as a skill candidate

### Requirement: The three previously-broken skills load

The skills `ship-change`, `frontend-mockup-loop`, and `anti-slop-frontend` SHALL have frontmatter that parses as valid YAML with their original description wording preserved (only quoting/escaping added).

#### Scenario: Formerly-failing skills now parse

- **WHEN** the guard parses `.pi/skills/ship-change/SKILL.md`, `packages/mockup-loop/.pi/skills/frontend-mockup-loop/SKILL.md`, and `packages/anti-slop/.pi/skills/anti-slop-frontend/SKILL.md`
- **THEN** each SHALL parse successfully with a non-empty `description`
- **AND** the human-readable wording of each description SHALL be unchanged from before the fix.

### Requirement: The guard SHALL match pi's severity for each condition

The guard SHALL fail only on conditions pi treats as fatal, and SHALL warn on conditions pi warns about. Each reported item SHALL identify whether it derives from a pi constraint or a repository policy.

| Severity | Condition | Source |
|---|---|---|
| error | `description` missing or empty after trimming | pi drops the skill |
| warning | `description` exceeds 1024 characters | pi's `MAX_DESCRIPTION_LENGTH` |
| warning | `name` exceeds 64 characters | pi's `MAX_NAME_LENGTH` |
| warning | `name` does not match `^[a-z0-9-]+$` | pi's `validateName` |
| warning | `name` has leading, trailing, or consecutive hyphens | pi's `validateName` |

#### Scenario: Missing description fails

- **GIVEN** a `SKILL.md` whose frontmatter omits `description` or sets it to whitespace
- **WHEN** the guard runs
- **THEN** it SHALL fail and name the file

#### Scenario: Over-length description warns without failing

- **GIVEN** a `SKILL.md` whose `description` exceeds 1024 characters
- **WHEN** the guard runs
- **THEN** it SHALL warn and name the file
- **AND** it SHALL NOT fail the build

#### Scenario: Malformed name warns without failing

- **GIVEN** a `SKILL.md` whose `name` contains uppercase characters or consecutive hyphens
- **WHEN** the guard runs
- **THEN** it SHALL warn and name the file
- **AND** it SHALL NOT fail the build

#### Scenario: Each finding names its source

- **WHEN** the guard reports a finding derived from a pi constraint and one derived from a repository policy
- **THEN** each SHALL state which of the two it comes from

### Requirement: The guard SHALL be a script that reports severities

The guard is presently a vitest test that can only pass or fail. It SHALL be converted into a script emitting structured findings with a severity and a source label, invoked by its own CI job, so that warnings can be reported without failing the build.

#### Scenario: Structured output

- **WHEN** the guard runs
- **THEN** each finding SHALL carry a severity and a source label

#### Scenario: Warnings do not fail the run

- **GIVEN** a repository whose skills produce warnings but no errors
- **WHEN** the guard runs
- **THEN** it SHALL report the warnings
- **AND** it SHALL exit successfully

### Requirement: The guard SHALL warn on the repository description budget

The guard SHALL warn when a `description` exceeds 400 characters. This is a repository context-cost policy, distinct from pi's 1024-character limit, and SHALL never be an error.

The skills named by the existing requirement "The three previously-broken skills load" SHALL be exempt from this budget, because that requirement mandates their description wording remain unchanged.

#### Scenario: Over-budget description warns

- **GIVEN** a `SKILL.md` whose `description` is between 401 and 1024 characters
- **WHEN** the guard runs
- **THEN** it SHALL warn, naming the file and the length
- **AND** it SHALL NOT fail the build

#### Scenario: The two thresholds are reported distinctly

- **GIVEN** one skill over 400 characters and one over 1024 characters
- **WHEN** the guard runs
- **THEN** the first SHALL be reported as a repository budget finding
- **AND** the second SHALL be reported as a pi limit finding

#### Scenario: Wording-locked skills are exempt

- **GIVEN** `ship-change`, `frontend-mockup-loop`, and `anti-slop-frontend`, whose descriptions exceed 400 characters
- **WHEN** the guard runs
- **THEN** no budget warning SHALL be raised for them
- **AND** their description wording SHALL remain unchanged

### Requirement: Description trimming SHALL preserve trigger phrasing

A skill's `description` is what causes it to auto-load. Any trim performed to satisfy the repository budget SHALL retain the phrases that trigger the skill, relocating only rationale and elaboration into the skill body.

#### Scenario: Trigger phrases survive a trim

- **GIVEN** a skill whose `description` is trimmed to satisfy the budget
- **WHEN** the trimmed description is compared with the original
- **THEN** the trigger phrases SHALL still be present

### Requirement: The guard SHALL run in CI

The skill guard SHALL execute in the repository's CI workflow so that an error blocks the pull request and a warning does not.

#### Scenario: Error blocks CI

- **GIVEN** a pull request introducing a `SKILL.md` with no `description`
- **WHEN** CI runs
- **THEN** the skill guard job SHALL fail

#### Scenario: Warnings do not block CI

- **GIVEN** a pull request introducing a `SKILL.md` with a 500-character `description`
- **WHEN** CI runs
- **THEN** the guard SHALL report the warning and SHALL NOT fail

