# agent-card Specification

## Purpose

Provides a reusable agent card shell that frames agent-like UI with a status-derived border, an icon-and-name header, and optional stats and content slots. Supplies shared helpers that map an agent status to its icon and that format token counts and elapsed durations compactly.

## Requirements

### Requirement: Card shell layout and slots

The card shell SHALL render a bordered container with an icon-and-name header and optional slots for right-aligned header content, a stats line, and tool-specific children.

#### Scenario: Rendering the header

- **WHEN** the shell is rendered with a name and status
- **THEN** the header shows the status icon followed by the agent name
- **AND** the name truncates when it exceeds available width

#### Scenario: Optional right-aligned header content

- **WHEN** header-right content is provided
- **THEN** it appears at the end of the header row alongside the icon and name

#### Scenario: Optional stats line

- **WHEN** stats content is provided
- **THEN** a stats line renders below the header
- **AND** when no stats content is provided the stats line is omitted

#### Scenario: Tool-specific content

- **WHEN** children are provided
- **THEN** they render in a content area below the header and stats line

### Requirement: Status-derived and selection-derived border

The card shell SHALL derive its border accent from the agent status and selection state.

#### Scenario: Running status accent

- **WHEN** the status is `running`
- **THEN** the card shows a yellow border accent

#### Scenario: Error status accent

- **WHEN** the status is `error`
- **THEN** the card shows a red border accent

#### Scenario: Selected card

- **WHEN** the card is selected
- **THEN** it shows a blue border accent and a surface background

#### Scenario: Clickable card

- **WHEN** a click handler is provided
- **THEN** the card is interactive and indicates it is clickable on hover
- **AND** when no click handler is provided the card is not interactive

### Requirement: Status icon lookup

The status icon helper SHALL map each known agent status to a distinct icon and color, and SHALL fall back to the pending definition for any unknown status.

#### Scenario: Known statuses

- **WHEN** the status is one of `pending`, `running`, `complete`, `error`, `blocked`, `stopped`, or `background`
- **THEN** the helper returns that status's dedicated icon and color
- **AND** the `running` icon animates while the others are static

#### Scenario: Unknown status fallback

- **WHEN** the status is not a recognized value
- **THEN** the helper returns the `pending` icon and color

### Requirement: Token count formatting

The token formatter SHALL render counts below one thousand verbatim and counts of one thousand or more in compact thousands notation.

#### Scenario: Small count

- **WHEN** the count is less than 1000
- **THEN** the formatter returns the exact number as text (for example `500` → `500`)

#### Scenario: Large count

- **WHEN** the count is 1000 or more
- **THEN** the formatter returns the count rounded to the nearest thousand with a `k` suffix (for example `12000` → `12k`)

### Requirement: Duration formatting

The duration formatter SHALL convert milliseconds to a human-readable string, switching from seconds to a minutes-and-seconds form at one minute.

#### Scenario: Under one minute

- **WHEN** the elapsed time is less than 60 seconds
- **THEN** the formatter returns seconds with one decimal and an `s` suffix (for example `5300` ms → `5.3s`)

#### Scenario: One minute or more

- **WHEN** the elapsed time is 60 seconds or more
- **THEN** the formatter returns whole minutes with an `m` suffix followed by whole remaining seconds with an `s` suffix (for example `95000` ms → `1m 35s`)
