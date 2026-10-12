## ADDED Requirements

### Requirement: Hermes settings fields are labelled, described and announce errors
Every hermes-memory settings field SHALL render through the shared settings field components (`settings-panel`), so each control has an associated `<label>` and its help text is linked by `aria-describedby`; the Model override field uses `FieldShell` with the model selector as its custom control, still looked up with the strict `useUiPrimitive("ui:model-selector")` (a shell-bound wrapper, not a transient picker). A field validation error SHALL set `aria-invalid="true"` on the control and SHALL be linked by `aria-describedby`; validation messages from `settings-model.ts` SHALL be translated through `t()` with `en`, `hu` and `zh-CN` entries. Boolean fields SHALL use `ToggleField` (`role="switch"`). The section SHALL NOT paint any text with an `--accent-*` token (today: load error, file path, status line, save error, reset and inherit links, field error).

#### Scenario: Every control has an accessible name
- **WHEN** an accessibility snapshot of the populated section is taken
- **THEN** every input, select, textarea and switch has a non-empty accessible name equal to its field label

#### Scenario: Invalid number is announced
- **WHEN** the user types `abc` into `memoryCharLimit`
- **THEN** the input has `aria-invalid="true"` and its `aria-describedby` includes the error text element

### Requirement: Hermes raw-JSON view and missing models follow the contract
The raw-JSON view SHALL be a dialog with `role="dialog"`, `aria-modal="true"`, a labelled title, a focus trap, Escape-to-close that returns focus to the "View raw JSON" control, and an `--bg-overlay` scrim, with no `bg-black/*` or other palette class. When the model list is empty, the Model override field SHALL show an info notice with an action that opens the Providers settings. The DEFAULT badge, per-field reset, "inherit session model" action and unknown-model preservation required by the existing hermes requirements SHALL be kept, rendered through `FieldShell`'s `state` and `onReset` and the field's own controls. The section SHALL pass the contrast, size and focus probes in every listed theme and width in these states: loading, load error, populated, invalid with unsaved changes, models unavailable, and raw-JSON dialog open. Every existing `hermes-*` test id SHALL still render in its state.

#### Scenario: Dialog traps focus and closes on Escape
- **WHEN** the raw-JSON dialog is open and the user presses Tab repeatedly, then Escape
- **THEN** focus stays inside the dialog while open, and after Escape the dialog is closed and "View raw JSON" has focus

#### Scenario: No models offers a way forward
- **WHEN** `GET /api/models` returns an empty list
- **THEN** the Model override field shows a notice with an "Open Providers" action

#### Scenario: Probes pass in every state
- **WHEN** the capture spec probes each listed state in every listed theme and width
- **THEN** every contrast, size and focus failure list is empty
