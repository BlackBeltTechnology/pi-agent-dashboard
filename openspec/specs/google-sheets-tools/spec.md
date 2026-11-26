# google-sheets-tools Specification

## Purpose
Agent tools that read and write Google Sheets ranges of a connected account through Google Connect leases, with confirmed writes and formula evaluation only when explicitly requested.

## Requirements

### Requirement: Sheets read tools
The plugin SHALL provide `gsheets_get` (title, tabs, grid sizes) and `gsheets_read` (values of an A1 range). A read SHALL return at most 10 000 cells and report truncation with the next range to read.

#### Scenario: Large range truncated
- **WHEN** the agent reads `A:Z` of a 50 000-row tab
- **THEN** at most 10 000 cells are returned with the next range to continue

### Requirement: Sheets write tools
The plugin SHALL provide `gsheets_create`, `gsheets_write` (overwrite an A1 range) and `gsheets_append` (append rows). Each SHALL require Sheets at level write and ask the user to confirm, showing account, spreadsheet, tab, range, cell count and the first rows. No interactive UI, denial, dismissal or timeout SHALL leave the spreadsheet unchanged.

#### Scenario: Denied write
- **WHEN** the user denies `gsheets_write`
- **THEN** no cell changes

### Requirement: Values are written literally by default
Written values SHALL be stored as literal values unless the call asks for formula evaluation; then the confirmation SHALL state that formulas will be evaluated and list the cells containing formulas.

#### Scenario: Formula text stays text
- **WHEN** a confirmed `gsheets_write` without formula evaluation writes `=IMPORTXML("https://x","//a")`
- **THEN** the cell contains that text, not a formula
