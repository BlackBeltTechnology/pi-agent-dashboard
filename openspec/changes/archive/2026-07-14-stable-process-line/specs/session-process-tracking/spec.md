# session-process-tracking Specification (delta)

## MODIFIED Requirements

### Requirement: Client renders the PGID scan as a collapsible drawer
The client-side background-process list SHALL contribute its inventory to the PROCESS subcard's single collapsible summary line instead of rendering its own separate `⚠ N background processes` summary row. When collapsed, background processes SHALL be represented by a background-count segment in the unified line; their individual killable rows SHALL appear in the expanded body below the in-flight bash rows. The per-row `✕` PGID-kill verb and the overflow tail SHALL be unchanged.

#### Scenario: Collapsed line shows the background-count segment
- **GIVEN** one background process and no in-flight bash tools
- **WHEN** the summary line renders collapsed
- **THEN** it SHALL show a background indicator with count `⚠ 1`
- **AND** it SHALL NOT render a separate standalone drawer summary row

#### Scenario: Expanded body lists killable background rows
- **GIVEN** the collapsed summary line with background processes present
- **WHEN** the user expands the line
- **THEN** each background process SHALL render a row with its command and a `✕` control
- **AND** activating `✕` SHALL invoke `killProcess(pgid)` (unchanged)

#### Scenario: Bash and background counts coexist in one line
- **GIVEN** two in-flight bash tools and one background process
- **WHEN** the summary line renders collapsed
- **THEN** it SHALL show both a `2 running` segment and a `⚠ 1` segment in the single line
