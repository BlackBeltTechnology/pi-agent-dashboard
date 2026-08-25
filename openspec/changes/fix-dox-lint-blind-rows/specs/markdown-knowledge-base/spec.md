# markdown-knowledge-base — delta

## ADDED Requirements

### Requirement: DOX row recognition SHALL depend on the table, not on heading state
`kb dox lint` SHALL recognize a file row by the header of the table containing it, and SHALL NOT make recognition conditional on the document's heading structure, because a heading-state gate silently skips rows and reports the containing file as clean.

#### Scenario: Row under a subheading is scanned
- **WHEN** an `AGENTS.md` opens with a `# DOX` heading and its file table sits under a later `## Files` subheading
- **THEN** every row of that table SHALL be recognized as a file row

#### Scenario: File without a DOX heading is scanned
- **WHEN** an `AGENTS.md` contains a `| File | Purpose |` table but no `# DOX` heading
- **THEN** every row of that table SHALL be recognized as a file row

#### Scenario: Prose table is not scanned
- **WHEN** a table's header is not a file-row header and its cells contain backticked text
- **THEN** no row of that table SHALL be recognized as a file row
- **AND** no `orphan` finding SHALL be produced for those cells

#### Scenario: Every lint arm sees the same rows
- **WHEN** a row becomes recognizable under this requirement
- **THEN** the `stale`, `orphan`, `broken-ref` and `missing` arms SHALL all evaluate it

### Requirement: The md walk SHALL honour gitignore
`kb dox lint` SHALL exclude files ignored by git, including files ignored by a nested `.gitignore`, because a row cannot be authored for a file absent from a fresh clone.

#### Scenario: Vendored ignored file is not reported missing
- **WHEN** a markdown file is matched by a `.gitignore` rule in its own directory or any ancestor
- **THEN** `kb dox lint` SHALL NOT emit a `missing` finding for it

#### Scenario: Tracked file is still reported
- **WHEN** a markdown file is not ignored by git and has no row in any ancestor `AGENTS.md`
- **THEN** `kb dox lint` SHALL emit a `missing` finding for it

### Requirement: Lint SHALL report its own scan coverage
`kb dox lint` SHALL report how many files and rows it scanned, so an empty finding list can be distinguished from an unread file.

#### Scenario: Coverage accompanies the findings
- **WHEN** `kb dox lint` completes
- **THEN** it SHALL report the number of `AGENTS.md` files scanned and the number of rows recognized

#### Scenario: A file-row table yielding no rows is a finding
- **WHEN** an `AGENTS.md` contains a file-row table from which zero rows are recognized
- **THEN** `kb dox lint` SHALL emit a finding naming that file
