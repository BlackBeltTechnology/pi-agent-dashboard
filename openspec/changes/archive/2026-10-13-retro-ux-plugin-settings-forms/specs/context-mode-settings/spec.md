## ADDED Requirements

### Requirement: Context-mode settings use the shared settings components and severity tokens
The context-mode settings form SHALL render every field through the shared settings field components (`settings-panel`), every group through `SettingsGroup`, and its notices (new sessions only, environment precedence, storage scope) through `SettingsNotice` with tone `info`. Its status line SHALL read "No changes" in `--text-secondary` or show a severity-warning pill "N unsaved changes" with `role="status"`. The DEFAULT badge and per-field reset required by "Settings form" SHALL be rendered through the shared field components' `state` and `onReset`. It SHALL NOT paint any text with an `--accent-*` token (today: load error, status line, per-field reset, field error). It SHALL pass the contrast, size and focus probes in `{base,dark}`, `{base,light}` and `{nord,dark}` at 375, 768 and 1440 px in these states: loading, load error, populated, file not yet created, and invalid field with unsaved changes. Every existing `cms-*` test id SHALL still render in its state, and saving SHALL still go through the host Save bar.

#### Scenario: Invalid field is announced
- **WHEN** the user enters `-2` in `search.maxResultsAfter`
- **THEN** the input has `aria-invalid="true"`, the error text is linked by `aria-describedby`, the status shows an unsaved-changes pill, and `cms-error-search.maxResultsAfter` renders

#### Scenario: Probes pass in every state
- **WHEN** the capture spec probes each listed state in every listed theme and width
- **THEN** every contrast, size and focus failure list is empty
