## MODIFIED Requirements

### Requirement: Confirm intent drives action button style

The `Confirm` SHALL accept `intent="primary" | "danger" | "neutral"`
(default `primary`) and apply it to the action button via
`Dialog.Action`'s `intent` prop. The cancel button's appearance is
intent-independent.

#### Scenario: Primary intent

- **WHEN** a `Confirm` is rendered with `intent="primary"` (or omitted)
- **THEN** the action button SHALL render with the `--accent-solid`
  background (the `Dialog.Action` primary fill)

#### Scenario: Danger intent

- **WHEN** a `Confirm` is rendered with `intent="danger"`
- **THEN** the action button SHALL render with a red background
  (`bg-red-600`)

#### Scenario: Cancel button is unaffected by intent

- **WHEN** a `Confirm` is rendered with any intent
- **THEN** the cancel button SHALL render with the neutral
  bordered-transparent style
