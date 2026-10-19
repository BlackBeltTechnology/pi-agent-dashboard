## MODIFIED Requirements

### Requirement: Status presentation uses a non-hue channel

The shared status presentation primitive (`StatusPill` or a `statusPresentation` helper in `client-utils`) SHALL express each status via a semantic token AND a mandatory non-hue channel (icon, shape, or glyph), so status is never conveyed by color alone. The status pill SHALL use the `--severity-*` triples. The `statusPresentation` helper SHALL keep its `--status-*` tokens for workflow progress (done / current / todo / error).

#### Scenario: Each status carries a non-color indicator

- **WHEN** the status primitive renders any state (done / current / todo / error)
- **THEN** the rendered output SHALL include an icon, shape, or glyph distinguishing that state
- **AND** the distinction SHALL NOT depend on color alone

#### Scenario: Done is distinguishable from todo without color

- **WHEN** a "done" and a "todo" item render in grayscale
- **THEN** they SHALL remain visually distinguishable (e.g. check glyph vs none)

#### Scenario: Pill and helper token families

- **WHEN** the status pill renders the `warn` state and the `statusPresentation` helper renders `current`
- **THEN** the pill SHALL use `--severity-warning-*` tokens
- **AND** the helper SHALL use `--status-working`

### Requirement: Covered surfaces consume the shared status primitive

The following surfaces SHALL render state through the shared status primitive and SHALL NOT re-roll their own colour map:

- the composer `ArtifactChip`;
- the OpenSpec board state pill;
- the Services page state pill;
- the vault status, grant-status and binding-state pills;
- the provider health pill;
- the plugin list status pill.

Icon-only status controls SHALL carry an `aria-label` naming the item and its state. The status pill SHALL take its colours from the severity tokens of the active theme palette, not from fixed colour values chosen by a dark/light switch.

#### Scenario: Board uses the shared primitive

- **WHEN** the OpenSpec board renders a change's state
- **THEN** it SHALL use the shared status primitive
- **AND** SHALL NOT re-roll a local `STATE_COLORS` color-only map

#### Scenario: ArtifactChip announces name and state

- **WHEN** a screen reader focuses a P/D/S/T artifact chip
- **THEN** the chip SHALL expose an `aria-label` naming the artifact and its state (e.g. "Proposal, done")
- **AND** the done state SHALL render a non-color glyph (e.g. a check)

#### Scenario: Settings surfaces use the shared primitive

- **WHEN** the Services page, the vault page, the provider list or the plugin list renders a state pill
- **THEN** each pill SHALL be rendered by the shared status primitive
- **AND** its existing test id and state attribute SHALL be unchanged

#### Scenario: Primitive follows the active palette

- **WHEN** the active palette is a non-base palette such as nord dark
- **THEN** the status pill's colours SHALL be that palette's severity token values
