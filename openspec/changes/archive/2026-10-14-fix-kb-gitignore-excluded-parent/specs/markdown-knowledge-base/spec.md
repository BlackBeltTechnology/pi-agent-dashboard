## MODIFIED Requirements

### Requirement: The md walk SHALL honour gitignore
`kb dox lint` SHALL exclude files ignored by git, including files ignored by a nested `.gitignore`, because a row cannot be authored for a file absent from a fresh clone. A file whose ancestor directory is ignored SHALL be excluded even when a `.gitignore` inside that directory negates it, matching git's rule that a file cannot be re-included once a parent directory is excluded.

#### Scenario: Vendored ignored file is not reported missing
- **WHEN** a markdown file is matched by a `.gitignore` rule in its own directory or any ancestor
- **THEN** `kb dox lint` SHALL NOT emit a `missing` finding for it

#### Scenario: Tracked file is still reported
- **WHEN** a markdown file is not ignored by git and has no row in any ancestor `AGENTS.md`
- **THEN** `kb dox lint` SHALL emit a `missing` finding for it

#### Scenario: Negation inside an ignored directory does not re-include
- **GIVEN** the root `.gitignore` contains `vendored/`
- **AND** `vendored/.gitignore` contains `!keep.md`
- **WHEN** `kb dox lint` runs
- **THEN** it SHALL NOT emit a `missing` finding for `vendored/keep.md` or `vendored/other.md`
