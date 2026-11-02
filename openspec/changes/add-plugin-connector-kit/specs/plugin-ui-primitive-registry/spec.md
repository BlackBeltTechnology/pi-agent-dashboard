## ADDED Requirements

### Requirement: `ui:connector-settings` primitive key and contract

`UI_PRIMITIVE_KEYS` SHALL include `connectorSettings: "ui:connector-settings"`. `UiPrimitiveMap["ui:connector-settings"]` SHALL be `ComponentType<{ title: string; fields: ConnectorField[]; writesToggle?: boolean }>`, where `ConnectorField` is the shared connector contract type. The dashboard SHALL register a host implementation under this key at startup.

#### Scenario: Key is typed
- **WHEN** plugin code calls `useUiPrimitive(UI_PRIMITIVE_KEYS.connectorSettings)`
- **THEN** TypeScript SHALL type the result with the `{title, fields, writesToggle?}` props

### Requirement: Connector settings primitive is bound to its page

The `ui:connector-settings` implementation SHALL take the plugin id only from the enclosing plugin settings page, and SHALL ignore any id in its props. It SHALL load and save only through `/api/plugins/<pageId>/config`. Outside a plugin settings page it SHALL render nothing.

#### Scenario: Props cannot redirect the config route
- **WHEN** an intent rendered on `/settings/plugins/nav` carries `pluginId: "other"` in its props
- **THEN** the primitive SHALL load from and save to `/api/plugins/nav/config` only

### Requirement: Connector settings primitive renders fields with the settings kit

The primitive SHALL render each field with the shared settings kit and SHALL render labels and help as plain text. A secret field SHALL be a password input with `autoComplete="new-password"`, with a "saved — leave empty to keep" placeholder when a value is stored. It SHALL show configuration state as a worded pill, and a failure as one sentence with the code only in Copy details.

#### Scenario: Host renders a connector form
- **WHEN** plugin `nav` broadcasts a `settings-section` intent with primitive `ui:connector-settings` and fields `apiKey` (secret, required) and `region` (select)
- **THEN** `/settings/plugins/nav` SHALL render a password input for `apiKey` and a select for `region`, built from the shared settings components

### Requirement: Connector settings primitive drops invalid field entries individually

The primitive SHALL drop invalid field entries one by one, each with a console warning, using the `registerConnectorServer` limits: of a list longer than 32 it SHALL keep the first 32, of entries sharing a name it SHALL keep the first, and it SHALL drop an entry with an unknown `kind` or `required` on a `boolean`.

#### Scenario: Invalid entries are dropped individually
- **WHEN** an intent carries 33 valid fields, or a duplicate `apiKey`, or one field with `kind: "number"`, or a `boolean` field with `required: true`
- **THEN** the primitive SHALL keep the first 32 fields, the first `apiKey`, and every valid field, drop each invalid entry, and emit one `console.warn` per dropped entry

### Requirement: Connector settings primitive renders by field kind

The primitive SHALL render `text` as a text input, `secret` as a password input, `select` as a select over `options`, and `boolean` as a toggle. It SHALL pre-fill a field's `default` when no value is stored.

#### Scenario: Boolean field with a default
- **WHEN** a field `{name: "sandbox", kind: "boolean", default: true}` has no stored value
- **THEN** the primitive SHALL render a toggle that is on

### Requirement: Connector settings primitive saves through the host Save bar

The primitive SHALL register draft source `plugin:<pageId>` and SHALL send one PUT on the host Save bar commit. It SHALL NOT send a blank secret. When `writesToggle` is false it SHALL render no writes switch and its PUT body SHALL omit `writesEnabled`. It SHALL clear a typed secret after commit, on discard and on reset, and SHALL never put it in Copy details. "Remove credentials" SHALL be an immediate action behind a confirmation.

#### Scenario: Save goes through the host Save bar
- **WHEN** the user types a new API key
- **THEN** no request SHALL be sent until the host Save bar commits, and after commit the key field SHALL be empty with the saved placeholder shown

#### Scenario: No write tools means no writes switch
- **WHEN** the intent carries `writesToggle: false` and the user saves a changed `region`
- **THEN** no writes switch SHALL be shown and the PUT body SHALL have no `writesEnabled` key

#### Scenario: Discard drops a typed secret
- **WHEN** the user types a new API key and clicks Discard
- **THEN** the field SHALL be empty and no PUT SHALL be sent

#### Scenario: Secret never reaches Copy details
- **WHEN** a save that includes a typed secret fails
- **THEN** the copied details SHALL NOT contain the secret value
