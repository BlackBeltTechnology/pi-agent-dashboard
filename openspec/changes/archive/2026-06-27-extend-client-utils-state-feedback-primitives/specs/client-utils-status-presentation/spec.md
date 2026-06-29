# client-utils-status-presentation — delta

## ADDED Requirements

### Requirement: Status presentation uses a non-hue channel

The shared status presentation primitive (`StatusPill` or a `statusPresentation` helper in `client-utils`) SHALL express each status via a semantic `--status-*` token AND a mandatory non-hue channel (icon, shape, or glyph), so status is never conveyed by color alone.

#### Scenario: Each status carries a non-color indicator

- **WHEN** the status primitive renders any state (done / current / todo / error)
- **THEN** the rendered output SHALL include an icon, shape, or glyph distinguishing that state
- **AND** the distinction SHALL NOT depend on color alone

#### Scenario: Done is distinguishable from todo without color

- **WHEN** a "done" and a "todo" item render in grayscale
- **THEN** they SHALL remain visually distinguishable (e.g. check glyph vs none)

### Requirement: Covered surfaces consume the shared status primitive

The composer `ArtifactChip` and the OpenSpec board state pill SHALL render via the shared status primitive rather than re-rolling their own color map, and icon-only status controls SHALL carry an `aria-label` naming the item and its state.

#### Scenario: Board uses the shared primitive

- **WHEN** the OpenSpec board renders a change's state
- **THEN** it SHALL use the shared status primitive
- **AND** SHALL NOT re-roll a local `STATE_COLORS` color-only map

#### Scenario: ArtifactChip announces name and state

- **WHEN** a screen reader focuses a P/D/S/T artifact chip
- **THEN** the chip SHALL expose an `aria-label` naming the artifact and its state (e.g. "Proposal, done")
- **AND** the done state SHALL render a non-color glyph (e.g. a check)
