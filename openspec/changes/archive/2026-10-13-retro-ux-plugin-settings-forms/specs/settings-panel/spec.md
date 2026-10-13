## MODIFIED Requirements

### Requirement: Shared settings field components carry an accessible name and description

The shared settings field components (`FieldShell`, `ToggleField`, `SelectField`, `NumberField`, `TextField`, and `TextAreaField`) SHALL live in `@blackbelt-technology/dashboard-plugin-runtime` and SHALL be exported from its root barrel. `SettingsPanel.tsx` SHALL import them from there and SHALL keep re-exporting `ToggleField`, `SelectField`, `NumberField` and `TextField` so existing imports keep working. Plugin-contributed settings sections SHALL use the same components; plugins SHALL import them directly, not through the UI primitive registry. Each component SHALL:

- associate its `<label>` with its control via `htmlFor`/`id` using generated ids, so the control has an accessible name;
- accept a **required** `hint` prop of type `React.ReactNode`, render it below the control row when non-null, and reference it from the control via `aria-describedby`;
- accept an optional `unit` string, rendered inside the `<label>` element as a 12 px chip so it forms part of the accessible name;
- accept optional `state` (`"default"` or `"changed"`, rendered as a pill in the label row) and `onReset` (rendered as a "Reset to default" control in the label row), so plugin forms keep their DEFAULT badge and per-field reset;
- accept an optional `error` string; when it is set, render it below the hint at 12 px in `--severity-error-fg` with an icon, add its element id to the control's `aria-describedby`, and set `aria-invalid="true"` on the control;
- accept an optional `testIds` object (`control`, `state`, `reset`, `error`) and render those `data-testid`s on the matching elements, so callers keep their existing test ids (`cms-input-*`, `cms-default-badge-*`, `cms-reset-*`, `cms-error-*`, `hermes-input-*`, …);
- render the error with `role="alert"`, and give every control the `focus-ring` utility so it shows the `--focus-ring` outline on keyboard focus;
- render the label at 12 px semibold in `--text-primary`, the hint at 12 px in `--text-secondary`, and contain no Tailwind palette class, hex or `rgba(` literal, and no font size other than 11, 12 or 14 px.

`FieldShell` SHALL accept a custom control through a render prop that receives the control id, the `aria-describedby` value and the invalid flag; the other components render their own control.

A `hint` of `null` SHALL be permitted and SHALL suppress both the hint element and the hint id in `aria-describedby`. `null` is reserved for controls whose label is a term of art from an external specification (for example OAuth `Client ID`, `Client Secret`, `Issuer URL`).

Because `hint` is required, a call site that omits it SHALL fail type-checking. No separate allowlist file or source-scanning test is used for this rule.

Bespoke controls rendered inline in `SettingsPanel.tsx` and field components belonging to sibling sections (`RetrySettingsSection`, `ModelProxySection`, `ToolsSection`, `DiagnosticsSection`) are OUT of scope.

#### Scenario: Control has an accessible name from its label
- **WHEN** a `NumberField` is rendered with label `Session register timeout`
- **THEN** the control's accessible name SHALL be `Session register timeout`

#### Scenario: Unit is part of the accessible name
- **WHEN** a `NumberField` is rendered with `unit="ms"`
- **THEN** the unit SHALL appear inside the label element and form part of the control's accessible name
- **AND** the label text SHALL NOT contain a parenthetical `(ms)`

#### Scenario: Hint becomes the accessible description
- **WHEN** a `ToggleField` is rendered with a non-null `hint`
- **THEN** the hint SHALL be visible below the control row
- **AND** the control's `aria-describedby` SHALL resolve to the element containing that hint

#### Scenario: Null hint suppresses the description
- **WHEN** a field is rendered with `hint={null}` and no `error`
- **THEN** no hint element SHALL render
- **AND** the control SHALL NOT carry an `aria-describedby` attribute

#### Scenario: Omitting the prop fails the build
- **WHEN** a call site of one of the components omits the `hint` prop
- **THEN** type-checking SHALL fail

#### Scenario: Null hint with an error links only the error
- **WHEN** a field is rendered with `hint={null}` and an `error`
- **THEN** no hint element SHALL render and the control's `aria-describedby` SHALL resolve to the error element only

#### Scenario: Error is linked and marks the control invalid
- **WHEN** a `NumberField` with a hint is rendered with `error="Enter a whole number."`
- **THEN** the control has `aria-invalid="true"` and its `aria-describedby` lists the hint id and then the error id

#### Scenario: Caller test ids are kept
- **WHEN** a `NumberField` is rendered with `testIds={{ control: "cms-input-search.windowMs", error: "cms-error-search.windowMs" }}` and an error
- **THEN** the input carries `data-testid="cms-input-search.windowMs"` and the error element carries `data-testid="cms-error-search.windowMs"` with `role="alert"`

#### Scenario: Plugin imports the shared fields from the runtime
- **WHEN** a plugin client module imports `NumberField` from `@blackbelt-technology/dashboard-plugin-runtime`
- **THEN** the import resolves without referencing `@blackbelt-technology/pi-dashboard-client-utils` or the UI primitive registry

## ADDED Requirements

### Requirement: Shared settings group and notice components
`@blackbelt-technology/dashboard-plugin-runtime` SHALL export `SettingsGroup` and `SettingsNotice`. `SettingsGroup` SHALL render a `<details>` whose summary is 14 px semibold in `--text-primary`, at least 44 px tall, with a visible `--focus-ring` outline on keyboard focus, and an optional meta text in `--text-secondary`. `SettingsNotice` SHALL render the `ui-contract.md` severity callout recipe for tones `info`, `warning`, `error` and `success`. Neither SHALL contain a Tailwind palette class, hex or `rgba(` literal.

#### Scenario: Notice tone maps to the severity family
- **WHEN** `SettingsNotice` is rendered with `tone="warning"`
- **THEN** its computed background, border and text colours equal the active theme's `--severity-warning-bg`, `--severity-warning-border` and `--severity-warning-fg`
