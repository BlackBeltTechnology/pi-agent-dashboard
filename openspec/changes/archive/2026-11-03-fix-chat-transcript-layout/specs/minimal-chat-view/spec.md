## MODIFIED Requirements

### Requirement: Layout modes

The view SHALL support inline, popout, and row layout modes, defaulting to inline, and SHALL render only a single-line summary in row mode. Inline mode SHALL size to its content up to a viewport-relative cap and scroll its body beyond the cap; it SHALL NOT reserve blank space below short or streaming content.

#### Scenario: Default mode
- **WHEN** no mode is supplied
- **THEN** the view renders in inline mode

#### Scenario: Row mode
- **WHEN** mode is `row`
- **THEN** only a single line is rendered containing the status icon and the title
- **AND** no header chrome, body, or footer is rendered

#### Scenario: Inline and popout modes
- **WHEN** mode is `inline` or `popout`
- **THEN** a header and a scrollable body are rendered
- **AND** popout fills its parent height while inline sizes to its content up to a cap of 60% of the viewport height

#### Scenario: Short inline content leaves no blank area
- **GIVEN** inline mode with a single short entry, or only a live in-progress entry
- **WHEN** the view renders
- **THEN** its height SHALL be the header plus the content height, with no empty area below the last entry

#### Scenario: Long inline content scrolls at the cap
- **GIVEN** inline mode with content taller than 60% of the viewport height
- **WHEN** the view renders
- **THEN** its height SHALL equal the cap and the body SHALL scroll
