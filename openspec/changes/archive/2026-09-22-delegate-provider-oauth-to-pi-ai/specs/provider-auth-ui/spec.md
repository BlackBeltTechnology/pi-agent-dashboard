## MODIFIED Requirements

### Requirement: OAuth popup login flow

When a user starts an OAuth sign-in from the Add-provider dialog, the UI SHALL call `POST /api/provider-auth/start`, render the step the response carries (an authorization link, a device code, or a prompt — see "Prompt-driven sign-in steps"), open `authUrl` when one is present, and poll `GET /api/provider-auth/flow/:flowId` until the flow completes, fails, expires, or is cancelled. The authorization link SHALL stay visible alongside any later prompt. Upon completion the UI SHALL update the connected list. The poll is owned by the providers section, so dismissing the dialog does not end the flow.

#### Scenario: Successful popup login
- **WHEN** the user starts an Anthropic sign-in from the Add-provider dialog and completes consent in the browser on the same machine as the server
- **THEN** the flow poll SHALL observe `status: "complete"`, and the UI SHALL show a success indicator and list Anthropic as connected

#### Scenario: Remote browser completes via paste
- **WHEN** the user's browser cannot reach the server's localhost callback and lands on an unreachable `localhost` redirect
- **THEN** the pane SHALL already be showing a paste field (`pending.kind: "manual_code"`), and submitting the copied redirect URL SHALL complete the sign-in and list the provider as connected

#### Scenario: Popup blocked fallback
- **WHEN** the browser blocks the popup
- **THEN** the UI SHALL display the authorization URL as a copyable link, with the paste field still available

#### Scenario: Exchange error
- **WHEN** the flow poll observes `status: "error"` (the flow's code-for-token exchange or any other step failed)
- **THEN** the UI SHALL display the flow's `error` message and a "Try Again" button

### Requirement: Device code login flow

When the flow reports `pending.kind: "device_code"`, the UI SHALL display the verification URL and user code and keep polling `GET /api/provider-auth/flow/:flowId` until authorization completes or the code expires. The poll SHALL be owned by the providers section, so dismissing the dialog does not end the flow. The UI SHALL NOT automatically open the verification URL; the user must click an explicit "Open Registration Page" button (see "Device code flow requires explicit user action to open browser"). The same pane SHALL serve every provider that reports a device code; no provider-specific pane exists.

#### Scenario: Successful device code login
- **WHEN** the user enters the code with the provider and authorizes
- **THEN** the polling SHALL detect `status: "complete"`, close the dialog, and add the provider to the connected list

#### Scenario: Newly supported provider uses the same pane
- **WHEN** the user selects `xai`, `kimi-coding`, or `meta` in the Add-provider picker
- **THEN** the UI SHALL show the same device-code pane (user code, verification URL, "Open Registration Page") it shows for GitHub Copilot

#### Scenario: Device code expires
- **WHEN** the flow poll observes `status: "expired"`
- **THEN** the pane SHALL show "Code expired" with a "Try Again" button

#### Scenario: GitHub Enterprise domain prompt
- **WHEN** the user selects GitHub Copilot in the Add-provider picker
- **THEN** the UI SHALL first prompt for a GitHub Enterprise domain (with a placeholder "blank for github.com") and send it as `enterpriseDomain` on `POST /api/provider-auth/start`, so the flow's own domain question is never shown a second time

## ADDED Requirements

### Requirement: Prompt-driven sign-in steps

The sign-in pane SHALL render whatever step the flow status reports, in addition to any authorization link already shown:

- `manual_code` and `text` — a single text field labelled with the prompt's `message`, using its `placeholder`, and a Submit action that posts the value to `POST /api/provider-auth/flow/:flowId/input`. The field SHALL be cleared after submit and SHALL NOT be re-populated from any later status read.
- `select` — the prompt's `message` and one action per option (label, optional description); choosing one posts the option `id` to the input endpoint.
- `device_code` — the device-code pane (see "Device code login flow").

A pane SHALL also offer a Cancel action that calls `DELETE /api/provider-auth/flow/:flowId`, stops polling, and returns the dialog to the picker.

#### Scenario: Codex login-method choice
- **WHEN** an OpenAI Codex flow reports `pending: { kind: "select", options: [browser, device-code] }`
- **THEN** the pane SHALL show both options; choosing device-code SHALL subsequently render the device-code pane for the same flow

#### Scenario: Paste field submit
- **WHEN** the user pastes a redirect URL into the `manual_code` field and submits
- **THEN** the UI SHALL post it once, clear the field, and continue polling the same `flowId`

#### Scenario: Cancel mid-flow
- **WHEN** the user cancels a pending auth-code sign-in
- **THEN** the UI SHALL call the flow's cancel endpoint, stop polling, and return to the picker without listing the provider as connected

#### Scenario: Start failure is shown in the pane
- **WHEN** `POST /api/provider-auth/start` returns HTTP 500 or 504
- **THEN** the pane SHALL display the response's `error` and a "Try Again" button without starting a poll

### Requirement: Permanent-key OAuth credentials show no expiry

When a connected OAuth row carries `expires: null`, the UI SHALL NOT render an expiry countdown or "expired" state for that row; it SHALL present the row as connected with no expiry information.

#### Scenario: OpenRouter connected row
- **WHEN** the status response lists `openrouter` with `authenticated: true` and `expires: null`
- **THEN** the row SHALL show as connected and SHALL NOT display an expiry or "expired" label
