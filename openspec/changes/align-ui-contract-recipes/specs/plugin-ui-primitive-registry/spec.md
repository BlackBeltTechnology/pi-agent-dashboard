## ADDED Requirements

### Requirement: Notice and inline action error primitive keys

`UI_PRIMITIVE_KEYS` SHALL include `"ui:notice"` (the shared notice: tone, title, optional explanation, remedy rows, actions and raw detail behind a disclosure) and `"ui:action-error"` (the shared inline action error: message, optional raw detail behind "Copy details"). Each key SHALL have a typed props entry in the primitive contract map, and the host SHALL register a component for each. Adding these keys SHALL NOT rename or remove any existing key.

#### Scenario: New keys resolve with literal types
- **WHEN** plugin code reads `UI_PRIMITIVE_KEYS.notice` and `UI_PRIMITIVE_KEYS.actionError`
- **THEN** TypeScript SHALL infer the literal types `"ui:notice"` and `"ui:action-error"`

#### Scenario: Host registers both primitives
- **WHEN** the dashboard client has started
- **THEN** `useUiPrimitive("ui:notice")` and `useUiPrimitive("ui:action-error")` SHALL each return a component

#### Scenario: Wrong props are a type error
- **WHEN** plugin code passes a `tone` outside success, info, warning, error or neutral to the notice primitive
- **THEN** TypeScript SHALL fail compilation
