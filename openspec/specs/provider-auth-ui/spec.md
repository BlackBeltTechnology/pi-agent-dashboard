## Purpose

Provider Authentication settings UI: OAuth login rows, API-key rows, device-code flow, and detection of catalogue OAuth providers that lack a dashboard handler.
## Requirements
### Requirement: Provider authentication section in Settings
The Settings panel SHALL include a "Provider Authentication" section displaying all OAuth providers and a separate area for API key providers. Each OAuth provider SHALL show its name, authentication status, and a login or logout button. Each API key provider SHALL show its name and a text input for the key.

#### Scenario: Render unauthenticated OAuth provider
- **WHEN** the Settings panel loads and `anthropic` has `authenticated: false` in the status response
- **THEN** the UI SHALL show "Anthropic (Claude Pro/Max)" with a "Sign In" button

#### Scenario: Render authenticated OAuth provider
- **WHEN** `anthropic` has `authenticated: true` with an `expires` timestamp
- **THEN** the UI SHALL show "Anthropic (Claude Pro/Max)" with a green status indicator, the expiry as a relative time (e.g., "expires in 6 days"), and a "Sign Out" button

#### Scenario: Render API key provider with saved key
- **WHEN** `openai` has `authenticated: true` in the status response
- **THEN** the UI SHALL show "OpenAI" with a masked key display (e.g., "sk-...xxxx") and a remove button

### Requirement: OAuth popup login flow
When a user clicks "Sign In" for an auth-code provider, the UI SHALL call `POST /api/provider-auth/authorize`, open the returned `authUrl` in a popup window, and listen for the authorization code via `postMessage`, `BroadcastChannel`, and `localStorage` events. Upon receiving the code, it SHALL call `POST /api/provider-auth/exchange` and update the status display on success.

#### Scenario: Successful popup login
- **WHEN** the user clicks "Sign In" for Anthropic, completes consent in the popup, and the code is relayed back
- **THEN** the UI SHALL exchange the code, show a success indicator, and update the provider status to authenticated

#### Scenario: Popup blocked fallback
- **WHEN** the browser blocks the popup
- **THEN** the UI SHALL display the authorization URL as a copyable link and optionally a text input for the user to paste the callback URL manually

#### Scenario: Exchange error
- **WHEN** the token exchange returns an error
- **THEN** the UI SHALL display the error message and a "Try Again" button

### Requirement: Device code login flow
When a user clicks "Sign In" for GitHub Copilot, the UI SHALL call `POST /api/provider-auth/device-code`, display the verification URL and user code in a modal, and poll `GET /api/provider-auth/device-status/:flowId` until authorization completes or the code expires. The UI SHALL NOT automatically open the verification URL; the user must click an explicit "Open Registration Page" button (see "Device code flow requires explicit user action to open browser").

#### Scenario: Successful device code login
- **WHEN** the user enters the code on GitHub and authorizes
- **THEN** the polling SHALL detect success, close the modal, and update the provider status to authenticated

#### Scenario: Device code expires
- **WHEN** the device code expires without authorization
- **THEN** the modal SHALL show "Code expired" with a "Try Again" button

#### Scenario: GitHub Enterprise domain prompt
- **WHEN** the user clicks "Sign In" for GitHub Copilot
- **THEN** the UI SHALL first prompt for a GitHub Enterprise domain (with a placeholder "blank for github.com") before starting the device code flow

### Requirement: API key entry
The UI SHALL provide text inputs for API key providers. When the user enters a key and confirms, the UI SHALL call `PUT /api/provider-auth/api-key` with the provider name and key. The input SHALL mask the key value after saving.

#### Scenario: Save new API key
- **WHEN** the user enters "sk-..." for OpenAI and clicks save
- **THEN** the UI SHALL call the API, show a success indicator, and mask the key display

#### Scenario: Remove API key
- **WHEN** the user clicks the remove button for an authenticated API key provider
- **THEN** the UI SHALL call `DELETE /api/provider-auth/openai` and update the status to unauthenticated

### Requirement: Logout for OAuth providers
When the user clicks "Sign Out" for an authenticated OAuth provider, the UI SHALL call `DELETE /api/provider-auth/:provider` and update the display to unauthenticated.

#### Scenario: Sign out from Anthropic
- **WHEN** the user clicks "Sign Out" for Anthropic
- **THEN** the UI SHALL remove the credential via API and show the "Sign In" button again

### Requirement: Status refresh on load and after changes
The UI SHALL fetch provider status from `GET /api/provider-auth/status` when the Settings panel mounts and after any login, logout, or API key change. The status SHALL reflect the current state of `auth.json`.

#### Scenario: Status refresh after login
- **WHEN** the user completes an OAuth login
- **THEN** the UI SHALL re-fetch `/api/provider-auth/status` and update all provider statuses

### Requirement: Device code flow requires explicit user action to open browser
When the device code flow is initiated, the system SHALL NOT automatically open the verification URL in a new browser tab. Instead, the system SHALL display the verification URL as a clickable link and a dedicated "Open Registration Page" button. The user MUST manually click the button to open the URL.

#### Scenario: Device code flow shows button instead of auto-opening
- **WHEN** the user initiates a device code login (e.g., GitHub Copilot)
- **THEN** the device code modal displays the user code and verification URL
- **AND** a "Open Registration Page" button is shown
- **AND** no browser tab is opened automatically

#### Scenario: User clicks button to open registration
- **WHEN** the user clicks the "Open Registration Page" button in the device code modal
- **THEN** the verification URL opens in a new browser tab

### Requirement: OAuth providers without server handler render disabled

The Provider Authentication section SHALL fetch `GET /api/provider-auth/handlers` once on mount and cache the returned `ids` as a Set. For each row in the catalogue whose `flowType !== "api_key"` (i.e. OAuth flow), if its `id` is NOT present in the handler-id set, the UI SHALL render its login button with `disabled` and a `title` tooltip in the form `"OAuth flow not yet supported in dashboard for <displayName>"`. Click handlers SHALL be suppressed for those rows. All other rendering (display name, expiry indicator, sign-out for stored credentials) SHALL be unchanged.

#### Scenario: Extension-registered OAuth provider has no handler
- **WHEN** the catalogue contains `{ id: "custom-llm", displayName: "Custom LLM", hasOAuth: true }` and `GET /api/provider-auth/handlers` returns `["anthropic", "openai-codex", "github-copilot"]`
- **THEN** the row for Custom LLM SHALL render the login button with the `disabled` attribute and a tooltip "OAuth flow not yet supported in dashboard for Custom LLM"

#### Scenario: Built-in provider with handler unaffected
- **WHEN** the catalogue contains `{ id: "anthropic", hasOAuth: true }` and the handler-id set contains `"anthropic"`
- **THEN** the Anthropic row SHALL render the login button enabled, click-handler attached, exactly as before

#### Scenario: Already-authenticated provider with no handler keeps "Sign Out"
- **WHEN** the catalogue contains an OAuth row with no matching handler but `auth.json` has stored credentials for it
- **THEN** the Sign Out button SHALL remain enabled (revoking is a `DELETE /api/provider-auth/credential` call, not a handler-driven flow), and the disabled state applies only to a new login click

### Requirement: Provider section degrades on a failed or malformed status response
The Settings provider section SHALL fail closed when `GET /api/provider-auth/status` does not deliver a JSON array. A non-`ok` HTTP response, a body that is not an array, or a network failure SHALL render an inline error inside the section — the section SHALL NOT throw, and SHALL NOT let an ErrorBoundary replace the surrounding Settings panel.

The section SHALL remain interactive in this state so the operator can still reach the controls that repair credentials.

#### Scenario: 500 response renders an inline error, not a white screen
- **WHEN** `GET /api/provider-auth/status` responds `500` with `{"statusCode":500,"error":"Internal Server Error","message":"..."}`
- **THEN** the section SHALL render an inline error message
- **AND** the Settings panel SHALL remain mounted
- **AND** no error SHALL propagate to the ErrorBoundary

#### Scenario: Non-array body does not crash the render
- **WHEN** the status endpoint responds `200` with a JSON object instead of an array
- **THEN** the section SHALL render an inline error and SHALL NOT invoke an array method on the body

#### Scenario: Network failure renders an inline error
- **WHEN** the status fetch rejects
- **THEN** the section SHALL render an inline error and SHALL leave the Settings panel mounted

### Requirement: OAuth status poll tolerates transient failures
The auth-code login poll SHALL treat a malformed or non-`ok` status response as a *transient* failure and continue polling, ending the flow with an error message only after a bounded number of consecutive such failures. A single failed poll — a transient `5xx`, or a server restart mid-login — SHALL NOT abort an in-flight login, and a persistent failure SHALL NOT leave the UI reporting "waiting" until the 5-minute timeout.

The poll SHALL NOT invoke an array method on a body that is not an array.

#### Scenario: One transient failure does not abort the login
- **GIVEN** an auth-code login is polling for completion
- **WHEN** a single poll returns `500`
- **AND** the next poll returns a normal status array showing the provider authenticated
- **THEN** the flow SHALL complete successfully

#### Scenario: Persistent failure ends the flow with a message
- **WHEN** consecutive polls keep returning a non-`ok` or non-array response up to the bound
- **THEN** the flow SHALL stop and SHALL display an error message
- **AND** it SHALL NOT keep reporting "waiting" until the 5-minute timeout

#### Scenario: Poll never calls an array method on a non-array
- **WHEN** a poll response body is a JSON object
- **THEN** the poll SHALL NOT throw a TypeError

