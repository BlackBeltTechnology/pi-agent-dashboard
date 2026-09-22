## MODIFIED Requirements

### Requirement: The pane branches on the provider's flow type

After selection the dialog SHALL present the pane the provider's `flowType` requires:

- `auth_code` — a browser sign-in action. Once the flow reports a pending prompt, the pane SHALL additionally render that prompt (paste field, text field, or choice list) while keeping the sign-in link visible.
- `device_code` — the user code and verification URL, plus the explicit "Open Registration Page" action, and (for GitHub Copilot) the GitHub Enterprise domain prompt before the flow starts. The same pane serves every device-code provider. `flowType` is a hint for which pane opens first; the pane SHALL follow whatever step the started flow actually reports.
- `api_key` — a key field, plus the provider's `envVar` name as a hint when the status row carries one.
- custom endpoint — name, base URL, api type, and key fields, plus a **Test** action.

The dialog SHALL validate before writing: an empty key SHALL NOT be submitted, and a blank or whitespace-only custom-endpoint name SHALL be rejected at the dialog with a visible message rather than at save time.

#### Scenario: Auth-code selection opens the sign-in pane

- **WHEN** the operator selects a provider whose `flowType` is `auth_code`
- **THEN** the pane SHALL offer a browser sign-in action
- **AND** SHALL NOT present a key field

#### Scenario: Auth-code pane grows a paste field when the flow asks for one

- **WHEN** the started flow reports `pending.kind: "manual_code"`
- **THEN** the pane SHALL show a paste field beneath the still-visible sign-in link
- **AND** SHALL NOT replace or hide the link

#### Scenario: Auth-code pane offers a method choice when the flow asks for one

- **WHEN** the started flow reports `pending.kind: "select"`
- **THEN** the pane SHALL present one action per option and SHALL start no browser action until one is chosen

#### Scenario: Empty key cannot be submitted

- **WHEN** the operator submits an api-key pane with an empty key
- **THEN** the dialog SHALL NOT issue a write
- **AND** SHALL indicate that a key is required

#### Scenario: API-key pane shows the env-var hint

- **WHEN** the operator selects a provider whose status row carries `envVar: "MISTRAL_API_KEY"`
- **THEN** the pane SHALL name that environment variable as an alternative to storing a key

#### Scenario: Blank custom-endpoint name is refused in the dialog

- **WHEN** the operator submits a custom endpoint whose name is empty or whitespace-only
- **THEN** the dialog SHALL render a visible validation message
- **AND** SHALL NOT issue a write

#### Scenario: Device-code pane requires an explicit browser action

- **WHEN** a device-code flow starts from the dialog
- **THEN** the pane SHALL display the user code and verification URL with an explicit "Open Registration Page" action
- **AND** SHALL NOT open a browser tab automatically
