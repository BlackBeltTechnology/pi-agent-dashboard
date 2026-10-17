# sleek-card-design Specification

## Purpose

Visual contract for the session card: an action row separated by a divider, an accent for the selected card, a source badge in the action row, and a full-card background pulse while the session is working.

## Requirements

### Requirement: Selected card accent
The currently selected session card SHALL display a subtle left border accent (`border-l-2 border-blue-500/40`) in addition to the existing background highlight. All session cards SHALL have an explicit `bg-[var(--bg-tertiary)]` background to create visual layering within the folder container.

#### Scenario: Card selected
- **WHEN** a session card is the currently selected session
- **THEN** the card SHALL have `bg-[var(--bg-tertiary)]` background AND a `border-l-2 border-blue-500/40` left accent

#### Scenario: Card not selected
- **WHEN** a session card is not selected
- **THEN** the card SHALL have `bg-[var(--bg-tertiary)]` background with no left accent border

#### Scenario: Card layering within folder
- **WHEN** a session card is rendered inside a folder group container
- **THEN** the card background (`--bg-tertiary`) SHALL be visually distinct from the folder container background (`--bg-secondary`)

### Requirement: Full-card background pulse for working sessions
Session cards SHALL display a slow pulsing background tint animation when the session is in `streaming` status or has `resuming` set to true. The animation SHALL cycle the card's background color between transparent and a faint amber tint (`rgba(234, 179, 8, 0.06)`) over a 3-second ease-in-out infinite loop using a `card-working-pulse` CSS keyframe defined in `index.css`.

#### Scenario: Streaming session card pulses
- **WHEN** a session card is rendered with `session.status === "streaming"`
- **THEN** the card `<li>` element SHALL have the `card-working-pulse` animation applied

#### Scenario: Resuming session card pulses
- **WHEN** a session card is rendered with `session.resuming === true`
- **THEN** the card `<li>` element SHALL have the `card-working-pulse` animation applied

#### Scenario: Idle session card does not pulse
- **WHEN** a session card is rendered with `session.status === "idle"` and `session.resuming` is falsy
- **THEN** the card `<li>` element SHALL NOT have the `card-working-pulse` animation

#### Scenario: Ended session card does not pulse
- **WHEN** a session card is rendered with `session.status === "ended"`
- **THEN** the card `<li>` element SHALL NOT have the `card-working-pulse` animation
