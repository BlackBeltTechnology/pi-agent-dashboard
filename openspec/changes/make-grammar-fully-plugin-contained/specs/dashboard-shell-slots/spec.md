# dashboard-shell-slots Specification

## ADDED Requirements

### Requirement: `composer-panel` slot renders adjacent to the chat composer input

The chat composer (`CommandInput`) SHALL expose a `composer-panel` slot rendered directly below
the input field. Slot components SHALL receive a **read-only** composer context
`{ draft: string, language?: string }` (the current input draft) via the standard slot-props
mechanism, and MAY dispatch actions through the existing plugin action-dispatch (e.g. an
apply-text action). The slot SHALL NOT grant a mutable draft setter. Core SHALL render whatever
claims the slot and SHALL contain no feature-specific (e.g. grammar) logic. With no claim, nothing
extra renders and the composer behaves exactly as before.

#### Scenario: A plugin claim renders below the composer and receives the draft

- **WHEN** a plugin claims `{ slot: "composer-panel", component: "X" }` AND the user has typed a
  draft
- **THEN** component `X` SHALL render below the composer input
- **AND** it SHALL receive `{ draft, language? }` reflecting the current input value

#### Scenario: No claim → composer unchanged

- **WHEN** no plugin claims `composer-panel`
- **THEN** the composer SHALL render no extra panel and its typing/send behaviour SHALL be
  unchanged from before the slot existed

#### Scenario: Slot component owns its own debounce

- **WHEN** the draft changes on every keystroke
- **THEN** core SHALL pass the updated draft to the slot component without itself debouncing
- **AND** any throttling/side-effect (e.g. a network check) SHALL be the slot component's
  responsibility (no added keystroke-path latency in core)
