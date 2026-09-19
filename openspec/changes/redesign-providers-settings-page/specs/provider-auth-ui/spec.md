## ADDED Requirements

### Requirement: Catalogue-unavailable is distinguished from no-credentials

API-key rows exist only while a provider catalogue has been pushed by a connected pi session. When no catalogue is available the section SHALL NOT report that nothing is configured. It SHALL render a notice scoped to the api-key portion of the list, stating that the API-key provider list is unavailable and MAY be out of date, while continuing to render every row whose source does not depend on the catalogue.

The notice SHALL NOT replace the list, and the Add-provider control SHALL remain rendered beside it — it is the only path to adding a credential, and the unavailable state is precisely when an operator is likely to need it.

#### Scenario: No catalogue with stored keys
- **WHEN** the catalogue-availability signal reports not ready and `auth.json` holds API keys
- **THEN** the section SHALL NOT render the "nothing configured" empty state
- **AND** SHALL render the unavailable notice

#### Scenario: Add control remains available while the catalogue is unavailable
- **WHEN** the catalogue is unavailable
- **THEN** the Add-provider control SHALL still render
- **AND** the picker SHALL still offer the Custom endpoint entry

#### Scenario: No catalogue with an OAuth credential
- **WHEN** the catalogue is unavailable and an OAuth provider is connected
- **THEN** its Subscription row SHALL still render
- **AND** the notice SHALL be scoped beside the list, not substituted for it

### Requirement: Rows are identified by source, not by id alone

A provider id can be present both as an authentication row and as an entry in `providers.json`. The section SHALL identify rows by the pair (source, id) and SHALL render both, each labelled by its own kind, rather than collapsing or dropping one. The custom-endpoint row SHALL be labelled by its `providers.json` name.

#### Scenario: Same id from both sources
- **WHEN** `anthropic` holds an OAuth credential and `providers.json` also has an entry named `anthropic`
- **THEN** the section SHALL render a Subscription row and a Custom endpoint row
- **AND** neither SHALL replace the other

## MODIFIED Requirements

### Requirement: Provider authentication section in Settings
The Settings panel SHALL include a provider section that lists **only providers that hold a credential**, in one list. It SHALL NOT render the provider catalogue. Each row SHALL name the provider, carry a badge naming the credential's kind, show that kind's status, and offer that kind's actions:

| Badge | Row source | Status shown | Actions |
|---|---|---|---|
| Subscription | OAuth credential (`auth_code` / `device_code`) | relative expiry when known | Sign out |
| API key | stored api-key credential | masked key | Edit · Remove |
| Environment | `ambient`, or a credential whose source is the environment | the environment variable's name, or the ambient mechanism when no variable name is known | none (not removable from the dashboard) |
| Custom endpoint | a configured entry in `providers.json` | health pill | Test · Edit · Remove |

The kind SHALL be conveyed by the badge's text, not by colour alone.

A custom endpoint counts as configured when its stored key is non-empty AND is not an unresolved environment reference. An entry whose key is empty, or whose key is a `$NAME` reference to an environment variable that is not set, SHALL NOT be listed as configured; an entry whose `$NAME` reference resolves SHALL be listed, badged **Custom endpoint** (not Environment — the row is an endpoint the operator registered, and it keeps its Test / Edit / Remove actions).

When a provider has both a stored key and an ambient credential, the stored key takes precedence and the row renders as an API-key row.

A row SHALL be listed when its `configured` field is true. A client SHALL tolerate a server that does not send `configured` by falling back to `authenticated`, so an older server does not produce an empty list while credentials exist.

Only `ambient` or an environment-sourced credential SHALL earn the Environment badge. Other non-stored sources SHALL render as ordinary API-key rows, because they are neither environment variables nor necessarily un-removable.

When no provider holds a credential the section SHALL render an empty state offering the Add-provider control. An empty list SHALL NOT be rendered as an empty state when the api-key provider catalogue is unavailable — see "Catalogue-unavailable is distinguished from no-credentials".

#### Scenario: Render unauthenticated OAuth provider
- **WHEN** the Settings panel loads and `anthropic` reports `configured: false`
- **THEN** the section SHALL NOT render an Anthropic row
- **AND** Anthropic SHALL be offered in the Add-provider picker instead, unless the picker's cross-type suppression applies to it

#### Scenario: Configured providers only
- **WHEN** the status response holds 41 rows of which 6 report `configured: true`
- **THEN** the section SHALL render 6 rows
- **AND** SHALL NOT render a row, key input, or login button for the other 35

#### Scenario: Render authenticated OAuth provider
- **WHEN** `anthropic` is configured by an OAuth credential with an `expires` timestamp
- **THEN** its row SHALL carry a **Subscription** badge, the expiry as a relative time, and a Sign Out action

#### Scenario: Render API key provider with saved key
- **WHEN** `openrouter` is configured by a stored API key
- **THEN** its row SHALL carry an **API key** badge, a masked key, and Edit and Remove actions

#### Scenario: Render an Environment row
- **WHEN** `openai` is configured only by `OPENAI_API_KEY` in the environment
- **THEN** its row SHALL carry an **Environment** badge naming `OPENAI_API_KEY`
- **AND** SHALL NOT offer a Remove action

#### Scenario: Ambient credential without a known environment variable
- **WHEN** a provider is configured by an ambient credential chain and the status row carries no `envVar`
- **THEN** its row SHALL carry the **Environment** badge naming the ambient mechanism
- **AND** SHALL NOT render an empty variable name

#### Scenario: Stored key takes precedence over ambient
- **WHEN** a provider reports both a stored key and `ambient: true`
- **THEN** its row SHALL render as an API-key row showing the masked stored key

#### Scenario: Custom endpoint with an empty key is not listed
- **WHEN** `providers.json` holds an entry whose `apiKey` is empty
- **THEN** the section SHALL NOT list it as configured

#### Scenario: Custom endpoint with an unresolved environment reference is not listed
- **WHEN** an entry's key is `$SOME_VAR` and `SOME_VAR` is not set
- **THEN** the section SHALL NOT list it as configured

#### Scenario: Custom endpoint with a resolved environment reference is listed as a custom endpoint
- **WHEN** an entry's key is `$SOME_VAR` and `SOME_VAR` is set
- **THEN** the entry SHALL be listed with the **Custom endpoint** badge and its Test / Edit / Remove actions

#### Scenario: A non-environment, non-stored source is not badged Environment
- **WHEN** a provider's credential source is a runtime or models-json source
- **THEN** its row SHALL render as an API-key row, not as an Environment row

#### Scenario: Kind is readable without colour
- **WHEN** the rows render
- **THEN** each badge SHALL name its kind in text

#### Scenario: Old server without the configured field
- **WHEN** the status response rows carry `authenticated` but no `configured` field
- **THEN** the section SHALL list the rows reporting `authenticated: true`
- **AND** SHALL NOT render an empty list

#### Scenario: Empty state
- **WHEN** no provider holds a credential and the catalogue is available
- **THEN** the section SHALL render an empty state with the Add-provider control

### Requirement: OAuth popup login flow
When a user starts an auth-code sign-in from the Add-provider dialog, the UI SHALL call `POST /api/provider-auth/authorize`, open the returned `authUrl`, and observe the flow's completion. Upon completion it SHALL update the connected list. The completion mechanism is owned by the providers section, so dismissing the dialog does not end the flow.

*This requirement's relay-and-exchange mechanics (`postMessage` / `BroadcastChannel` / `localStorage`, and a `POST /api/provider-auth/exchange` route) do not describe what ships and are NOT reconciled by this change; only the trigger is corrected, so the requirement no longer names a control this change deletes.*

#### Scenario: Successful popup login
- **WHEN** the user starts an Anthropic sign-in from the Add-provider dialog and completes consent in the browser
- **THEN** the UI SHALL show a success indicator and list Anthropic as connected

#### Scenario: Popup blocked fallback
- **WHEN** the browser blocks the popup
- **THEN** the UI SHALL display the authorization URL as a copyable link and optionally a text input for the user to paste the callback URL manually

#### Scenario: Exchange error
- **WHEN** the token exchange returns an error
- **THEN** the UI SHALL display the error message and a "Try Again" button

### Requirement: API key entry
Key entry SHALL occur in exactly two places: the Add-provider dialog for a provider that holds no credential, and the Edit state of an existing API-key row. The section SHALL NOT render a persistent key input on a row. On confirm the UI SHALL call `PUT /api/provider-auth/api-key` with the provider name and key, and SHALL render the stored key masked thereafter. A refusal from the server SHALL be rendered inline with the server's message, and SHALL NOT be reported as a success.

#### Scenario: Save new API key
- **WHEN** the user enters "sk-..." for OpenAI in the Add-provider dialog and confirms
- **THEN** the UI SHALL call the API and the provider SHALL appear in the connected list with a masked key

#### Scenario: Edit an existing key from its row
- **WHEN** the user activates Edit on an API-key row and submits a new key
- **THEN** the UI SHALL call the API and re-render the row with the new key masked

#### Scenario: No key input on a row at rest
- **WHEN** the connected list renders
- **THEN** no row SHALL present a key text input until Edit is activated

#### Scenario: Remove API key
- **WHEN** the user clicks the remove button on an API-key row
- **THEN** the UI SHALL call `DELETE /api/provider-auth/openai` and remove the row from the list

#### Scenario: Refused key write is surfaced
- **WHEN** the server refuses the write because a credential of a different type is stored under the same key
- **THEN** the UI SHALL render the server's message inline
- **AND** SHALL NOT report the key as saved

### Requirement: Device code login flow
When a user starts a device-code sign-in from the Add-provider dialog, the UI SHALL call `POST /api/provider-auth/device-code`, display the verification URL and user code, and poll `GET /api/provider-auth/device-status/:flowId` until authorization completes or the code expires. The poll SHALL be owned by the providers section, so dismissing the dialog does not end the flow. The UI SHALL NOT automatically open the verification URL; the user must click an explicit "Open Registration Page" button (see "Device code flow requires explicit user action to open browser").

#### Scenario: Successful device code login
- **WHEN** the user enters the code on GitHub and authorizes
- **THEN** the polling SHALL detect success, close the dialog, and add the provider to the connected list

#### Scenario: Device code expires
- **WHEN** the device code expires without authorization
- **THEN** the pane SHALL show "Code expired" with a "Try Again" button

#### Scenario: GitHub Enterprise domain prompt
- **WHEN** the user selects GitHub Copilot in the Add-provider picker
- **THEN** the UI SHALL first prompt for a GitHub Enterprise domain (with a placeholder "blank for github.com") before starting the device code flow

### Requirement: Logout for OAuth providers
When the user activates "Sign Out" on a Subscription row, the UI SHALL call `DELETE /api/provider-auth/:provider` and remove the row from the connected list. The provider SHALL thereafter be offered again in the Add-provider picker.

#### Scenario: Sign out from Anthropic
- **WHEN** the user clicks "Sign Out" on the Anthropic row
- **THEN** the UI SHALL remove the credential via API
- **AND** the row SHALL leave the connected list
- **AND** Anthropic SHALL become selectable again in the Add-provider picker

### Requirement: Status refresh on load and after changes
The UI SHALL fetch provider status from `GET /api/provider-auth/status` when the Settings panel mounts and after any login, logout, API key change, or custom-endpoint write. The status SHALL reflect the current state of `auth.json`. Every such refresh SHALL pass through the section's single change-handling path, which SHALL dispatch the credential-change notification exactly once per successful write, whichever control initiated it.

#### Scenario: Custom-endpoint write refreshes the list
- **WHEN** a custom endpoint is added, edited, or removed
- **THEN** the section SHALL refresh and dispatch the credential-change notification once

#### Scenario: Status refresh after login
- **WHEN** the user completes an OAuth login
- **THEN** the UI SHALL re-fetch `/api/provider-auth/status` and update all provider statuses

### Requirement: Provider section degrades on a failed or malformed status response
The Settings provider section SHALL fail closed when `GET /api/provider-auth/status` does not deliver a JSON array. A non-`ok` HTTP response, a body that is not an array, or a network failure SHALL render an inline error inside the section — the section SHALL NOT throw, and SHALL NOT let an ErrorBoundary replace the surrounding Settings panel.

The section SHALL remain interactive in this state so the operator can still reach the controls that repair credentials.

The list merges two independent sources — the credential status and the custom-endpoint list. Each source SHALL render its own inline error, and a failure of one SHALL NOT hide the rows contributed by the other.

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

#### Scenario: A failed status fetch does not hide custom endpoints
- **WHEN** `GET /api/provider-auth/status` fails and `/api/providers` succeeds with one entry
- **THEN** the custom-endpoint row SHALL still render
- **AND** the credential-status error SHALL render inline beside it

#### Scenario: A failed providers fetch does not hide credential rows
- **WHEN** `/api/providers` fails and the credential status succeeds
- **THEN** the credential rows SHALL still render with their own actions

### Requirement: OAuth status poll tolerates transient failures
The auth-code login poll SHALL treat a malformed or non-`ok` status response as a *transient* failure and continue polling, ending the flow with an error message only after a bounded number of consecutive such failures. A single failed poll — a transient `5xx`, or a server restart mid-login — SHALL NOT abort an in-flight login, and a persistent failure SHALL NOT leave the UI reporting "waiting" until the 5-minute timeout.

The poll SHALL NOT invoke an array method on a body that is not an array.

Poll state SHALL live in the providers section and SHALL be keyed per provider, so concurrent flows do not share a timer or a failure counter and one flow's cleanup does not end another's. The poll SHALL read the unfiltered status response rather than the rendered (configured-only) list, or the transition it is waiting for is never observable.

The device-code poll retains its existing behaviour of retrying until expiry without a consecutive-failure bound; that asymmetry with the auth-code poll is preserved deliberately.

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

#### Scenario: One flow's failures do not abort another
- **GIVEN** two auth-code flows are polling concurrently
- **WHEN** one of them reaches its consecutive-failure bound and ends
- **THEN** the other SHALL continue polling

#### Scenario: The poll sees a provider become configured
- **GIVEN** the rendered list excludes unconfigured providers
- **WHEN** the provider being polled becomes configured
- **THEN** the poll SHALL observe the transition and complete the flow

## REMOVED Requirements

### Requirement: OAuth providers without server handler render disabled
**Reason**: The gating is inert. OAuth rows are built from the same handler registry that `GET /api/provider-auth/handlers` returns, so a catalogue OAuth row without a matching handler cannot arise from a real payload. Under the redesign the rows are also no longer login surfaces — logins start from the Add-provider dialog — so a disabled login button has nothing to disable.
**Migration**: The client stops fetching `/api/provider-auth/handlers` and drops its `supported` gating; the endpoint itself is retained for other consumers. No operator-visible behaviour is lost, because every OAuth row the section can render is handler-backed by construction.
