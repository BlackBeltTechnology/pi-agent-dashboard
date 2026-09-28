# provider-add-flow Specification

## Purpose
Defines the single "Add provider" entry point in Settings → Providers: a dialog that lets the operator pick an unconfigured provider (or a custom OpenAI-compatible endpoint) and complete the credential flow its type requires, without the page listing every provider it could theoretically hold.

## Requirements

### Requirement: Single Add-provider entry point

Settings → Providers SHALL offer exactly one affordance for adding a credential: an **Add provider** control rendered with the connected list. The control SHALL name the number of providers the picker would offer as **selectable**, so the operator learns the catalogue exists without the page rendering it, and the count does not promise entries the picker suppresses. Activating the control SHALL open a dialog. The page SHALL NOT render a per-provider row, key input, or login button for any provider that holds no credential.

#### Scenario: Add control names the selectable count

- **WHEN** the status response holds 41 providers, 6 are configured, and 1 further entry is suppressed by the cross-type rule below
- **THEN** the page SHALL render one Add-provider control naming 34 available providers
- **AND** SHALL NOT render a row for any unconfigured provider

#### Scenario: Add control is present in the empty state

- **WHEN** no provider holds a credential
- **THEN** the empty state SHALL still render the Add-provider control

### Requirement: Picker lists only providers that can be added

The dialog SHALL open on a searchable picker listing every provider that is NOT already configured, plus a pinned **Custom endpoint** entry. A configured provider SHALL NOT appear in the picker; it is managed from its row in the list. Search SHALL match on the provider's display name and id. The picker SHALL be operable by keyboard alone (type to filter, arrow keys to move, Enter to select, Esc to dismiss).

#### Scenario: Configured provider absent from the picker

- **WHEN** `openrouter` is configured and the operator opens the dialog
- **THEN** `openrouter` SHALL NOT be offered in the picker

#### Scenario: Custom endpoint is always offered

- **WHEN** the picker renders, with or without a catalogue
- **THEN** a **Custom endpoint** entry SHALL be present regardless of the search term's match against known provider names

#### Scenario: Keyboard-only selection

- **WHEN** the operator types a filter, moves with arrow keys, and presses Enter
- **THEN** the highlighted provider SHALL be selected and its pane SHALL open

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

### Requirement: The picker suppresses the cross-type credential conflict

Two rows can resolve to the same stored credential: an OAuth provider and its `<id>-api` API-key twin. The picker SHALL suppress the entry whose selection would overwrite a credential of a different type under the same key — the twin while the OAuth sibling holds a credential, and the OAuth entry while the twin holds a stored key. The suppressed entry SHALL remain visible as a non-selectable entry naming the conflicting credential and the remove-first path, so the conflict is explained rather than hidden.

This suppression is a usability layer over the server's write-path refusal, NOT the enforcement of it.

#### Scenario: Twin suppressed while the OAuth sibling is connected

- **WHEN** `anthropic` holds a stored OAuth credential
- **THEN** the picker SHALL NOT allow selecting "Anthropic (API Key)"
- **AND** SHALL state that the Anthropic subscription credential must be removed first

#### Scenario: OAuth entry suppressed while the twin holds a key

- **WHEN** the `anthropic` auth entry holds an API-key credential
- **THEN** the picker SHALL NOT allow starting an Anthropic OAuth sign-in
- **AND** SHALL state that the stored key must be removed first

#### Scenario: Suppression is not the only guard

- **WHEN** a client bypasses the UI and writes an api-key credential for `anthropic-api` while an OAuth credential is stored
- **THEN** the write SHALL still be refused by the server

### Requirement: The flow outlives the dialog

An in-flight OAuth or device-code flow SHALL be owned by the providers section, not by the dialog. Closing the dialog SHALL NOT cancel an in-flight flow, and a flow that completes after the dialog closed SHALL still refresh the list through the section's single change-handling path. The flow SHALL NOT write a credential without the operator having initiated it, and SHALL NOT render a credential-entry surface after the dialog closed.

Poll state SHALL be keyed per provider so two concurrent flows do not share timers or failure counters. The poll SHALL observe the unfiltered status response, not the rendered (configured-only) list, or a provider becoming configured is never observed and the flow never completes. Section unmount (leaving the page) still ends the flow; the guarantee is scoped to dialog dismissal.

#### Scenario: Dialog closed mid-flow still completes

- **WHEN** the operator starts an auth-code sign-in and closes the dialog before completing it in the browser
- **THEN** the flow SHALL continue polling
- **AND** on completion the list SHALL refresh and show the provider as connected

#### Scenario: A flow refused after the dialog closed is reported on the section

- **WHEN** a flow started from the dialog completes after the dialog closed and the credential write is refused
- **THEN** the providers section SHALL render the refusal inline with its actionable message
- **AND** the list SHALL NOT show the provider as connected

#### Scenario: Two concurrent flows do not interfere

- **WHEN** two provider flows are in flight at once
- **THEN** each SHALL keep its own timer and failure count
- **AND** ending one SHALL NOT cancel the other

#### Scenario: Poll observes the unfiltered status

- **WHEN** a provider that is not yet configured completes its login
- **THEN** the poll SHALL observe the transition from the raw status response
- **AND** the flow SHALL complete rather than time out

### Requirement: A completed add commits immediately and refreshes the list

A successful write from the dialog SHALL persist on its own action — there SHALL be no page-level Save step between the dialog's submit and the credential being stored. On success the dialog SHALL close, the list SHALL refresh, and the client SHALL dispatch its credential-change notification exactly once through the section's single change-handling path. A failed write SHALL keep the dialog open, render the server's message inline, and SHALL NOT dispatch a credential-change notification.

#### Scenario: Successful add is persisted without a Save step

- **WHEN** the operator submits a key in the dialog and the write succeeds
- **THEN** the credential SHALL be stored
- **AND** the list SHALL show the provider as connected without any further action

#### Scenario: Refused write keeps the dialog open

- **WHEN** the write is refused by the server
- **THEN** the dialog SHALL remain open with the server's message rendered inline
- **AND** no credential-change notification SHALL be dispatched
