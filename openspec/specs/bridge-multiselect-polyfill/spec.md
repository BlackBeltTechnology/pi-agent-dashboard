# bridge-multiselect-polyfill Specification

## Purpose

Provide a `ctx.ui.multiselect(title, options, opts?)` capability that pi-coding-agent's `ExtensionUIContext` does not expose natively. The polyfill lets the dashboard bridge's `ask_user` tool dispatch `method: "multiselect"` without crashing on `"ctx.ui.multiselect is not a function"`. It supplies a TUI list component for terminal rendering and a decode ladder that normalises PromptBus responses into a stable `string[] | undefined` result contract.

## Requirements

### Requirement: Multiselect dispatch resolution

The polyfill SHALL provide a multiselect capability that resolves through a bridge-patched primary path when available and a legacy TUI-overlay fallback otherwise, preserving a single result contract across both branches.

#### Scenario: Primary bridge-patched path

- **WHEN** `polyfillMultiselect` is called and `ctx.ui.multiselect` is a function
- **THEN** the call SHALL delegate to `ctx.ui.multiselect(title, options, opts)`
- **AND** the returned promise SHALL be resolved and passed through unchanged

#### Scenario: Legacy custom-overlay fallback

- **WHEN** `polyfillMultiselect` is called and `ctx.ui.multiselect` is not a function
- **THEN** the call SHALL fall back to `ctx.ui.custom`, constructing a `MultiSelectList` with the title, options, and optional message
- **AND** the list's `onConfirm` SHALL resolve the promise with the selected values
- **AND** the list's `onCancel` SHALL resolve the promise with `undefined`

#### Scenario: Result contract in both branches

- **WHEN** the user confirms a selection
- **THEN** the promise SHALL resolve to a `string[]`, possibly empty when nothing is checked
- **AND WHEN** the user cancels, the promise SHALL resolve to `undefined`

### Requirement: TUI list navigation and toggle

The `MultiSelectList` component SHALL support cursor navigation, per-item toggle, and bounded scrolling while preserving original option order.

#### Scenario: Cursor movement

- **WHEN** the user presses Arrow Up or `k`
- **THEN** the cursor SHALL move up by one, clamped at the first item
- **AND WHEN** the user presses Arrow Down or `j`, the cursor SHALL move down by one, clamped at the last item

#### Scenario: Toggle current item

- **WHEN** the user presses space
- **THEN** the checked state of the item under the cursor SHALL invert
- **AND** items initialise unchecked

#### Scenario: Selection preserves option order

- **WHEN** the selected values are computed
- **THEN** they SHALL contain the values of all checked items in original option order, not toggle order

#### Scenario: Unbound keys are inert

- **WHEN** the user presses any key other than the navigation, toggle, confirm, or cancel keys — including `a` or `A`
- **THEN** the input SHALL be a no-op with no "select all" behaviour

#### Scenario: Scroll window

- **WHEN** the number of options exceeds the visible window of 10
- **THEN** the render SHALL scroll to keep the cursor within the window
- **AND** a position indicator `(current/total)` SHALL be shown

### Requirement: TUI confirm and cancel

The `MultiSelectList` SHALL confirm on Enter and cancel on Escape via distinct callbacks.

#### Scenario: Confirm on Enter

- **WHEN** the user presses Enter (`\r` or `\n`)
- **THEN** `onConfirm` SHALL be invoked with the currently selected values

#### Scenario: Cancel on Escape

- **WHEN** the user presses Escape (`\u001b`)
- **THEN** `onCancel` SHALL be invoked

#### Scenario: Confirm with no selection

- **WHEN** the user presses Enter with no items checked
- **THEN** `onConfirm` SHALL be invoked with an empty array

### Requirement: PromptResponse decode ladder

`decodeMultiselectAnswer` SHALL convert a PromptBus response into `string[] | undefined`, treating cancellation and empty selection as distinct outcomes and never throwing on malformed input.

#### Scenario: Cancelled response

- **WHEN** the response has `cancelled: true`
- **THEN** the result SHALL be `undefined`

#### Scenario: Empty or missing answer

- **WHEN** the response is not cancelled and `answer` is `null`, `undefined`, or the empty string
- **THEN** the result SHALL be an empty array, representing a real empty selection distinct from cancellation

#### Scenario: JSON array answer

- **WHEN** the response is not cancelled and `answer` is a JSON array string such as `'["a","b"]'`
- **THEN** the result SHALL be the parsed array `["a","b"]`

#### Scenario: Non-array or unparseable answer

- **WHEN** the response is not cancelled and `answer` parses to a non-array value, or fails to parse as JSON
- **THEN** the result SHALL be an empty array, degrading gracefully without throwing
