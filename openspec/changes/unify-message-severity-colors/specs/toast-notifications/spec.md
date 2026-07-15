## MODIFIED Requirements

### Requirement: useToast hook
The `useToast` hook SHALL provide `showToast(text, variant?, opts?)` to add a message and `dismissToast(id)` to manually remove one. `variant` SHALL be one of `error | warning | success | info | neutral` and SHALL default to **`neutral`** when omitted, so an unmarked toast is styleless and never reads as an error. Each toast SHALL have a unique auto-incrementing ID.

#### Scenario: Show toast programmatically
- **WHEN** `showToast("Session spawned")` is called with no variant
- **THEN** a new toast message SHALL appear with the given text using the **neutral** style (not red)

#### Scenario: Success is not red
- **WHEN** a spawn succeeds or a commit completes and a toast is shown
- **THEN** the call site SHALL pass variant `"success"` and the toast SHALL render green, not red

#### Scenario: Warning tier available
- **WHEN** `showToast(text, "warning")` is called
- **THEN** the toast SHALL render in the orange (`--severity-warning`) style, distinct from working-yellow

#### Scenario: Info is blue
- **WHEN** `showToast(text, "info")` is called
- **THEN** the toast SHALL render using `--severity-info` (blue), matching the `--status-notice` color used by status surfaces

## ADDED Requirements

### Requirement: Toast variant vocabulary matches the severity scale
`ToastVariant` SHALL enumerate exactly `error | warning | success | info | neutral`, and `VARIANT_CLASSES` SHALL provide a style entry for each, sourced from `--severity-*` tokens.

#### Scenario: Every severity has a style
- **WHEN** a toast is rendered with any of the five variants
- **THEN** `VARIANT_CLASSES` SHALL resolve a box + close-button style for that variant
