## Purpose

Let dashboard plugins run OAuth sign-in flows on the host's existing flow machinery (status / paste-input / cancel routes, flow UI), with the same start robustness as provider sign-in and a reusable loopback redirect listener.

## ADDED Requirements

### Requirement: Plugin-started OAuth flows
The host SHALL let a server plugin start a sign-in flow by supplying a login flow and a persist callback. The host SHALL return a flow id once the flow's first user-facing step is available, and SHALL reject with a typed error if the login fails before that step or no step appears within the start timeout. A new flow for the same plugin and key SHALL supersede a pending one. The flow SHALL be served by the existing flow status, input and cancel routes. On successful login the host SHALL call the plugin's persist callback with the credential and SHALL NOT write the credential to `auth.json`.

#### Scenario: Flow served by existing routes
- **WHEN** a plugin starts a flow and the client polls the flow status route with the returned id
- **THEN** the status carries the auth URL and any pending prompt, in the same shape as provider flows

#### Scenario: Credential goes to the plugin, not auth.json
- **WHEN** the plugin's flow completes successfully
- **THEN** the plugin's persist callback receives the credential and `auth.json` is unchanged

#### Scenario: Extra credential fields preserved
- **WHEN** the plugin's login resolves with a credential carrying extra fields such as `sub` and `email`
- **THEN** the persist callback receives those fields unchanged

#### Scenario: Plugin flows independent of the provider registry
- **WHEN** the LLM provider registry failed to build, and a plugin flow is started and polled
- **THEN** the flow status, input and cancel routes serve the plugin flow normally

#### Scenario: Early failure rejects instead of hanging
- **WHEN** the plugin's login flow throws before emitting any user-facing step
- **THEN** starting the flow rejects with a login-failed error and no flow record remains

#### Scenario: Start timeout
- **WHEN** the login flow emits no user-facing step within the start timeout
- **THEN** starting the flow rejects with an error whose code is `start_timeout`

#### Scenario: Plugin client drives the flow without hard-coded paths
- **WHEN** a plugin client uses the runtime flow client to poll, submit input and cancel
- **THEN** the calls reach the existing flow routes and behave as for provider flows

#### Scenario: Pasted redirect completes a remote sign-in
- **WHEN** the flow is pending a manual-code prompt and the user submits the pasted redirect URL through the input route
- **THEN** the flow's login receives that input and can complete

#### Scenario: Cancel releases the flow
- **WHEN** the user cancels via the cancel route
- **THEN** the flow ends with a cancelled status and any loopback listener it opened is closed

### Requirement: Provider sign-in behaviour preserved
Sharing the flow-start logic with plugins SHALL NOT change provider sign-in behaviour.

#### Scenario: Existing provider-auth route tests pass unchanged
- **WHEN** the provider-auth route and adapter test suites run
- **THEN** every test passes without modification

### Requirement: Flow input is never logged
Values submitted through the flow input route for plugin flows SHALL NOT be written to server logs.

#### Scenario: Auth code absent from logs
- **WHEN** a user submits a redirect URL containing `code=` for a plugin flow
- **THEN** the server log contains neither the code nor the URL

### Requirement: Public login-flow types
The plugin runtime SHALL export structural types for the login flow, the interaction, prompts, events and credentials. Plugins SHALL be able to implement a login flow without importing server packages.

#### Scenario: Types stay compatible with the host
- **WHEN** the type-check runs
- **THEN** the host's login-flow types and the runtime's exported types are mutually assignable

### Requirement: Loopback callback helper
The runtime SHALL provide a loopback callback helper with these properties:
- It listens on `127.0.0.1` on an ephemeral port.
- It generates the `state` value itself and exposes it together with the redirect URI.
- It resolves with the authorization code only for a request on its callback path that carries the matching `state`.
- It keeps waiting after requests to other paths or with a missing or mismatched `state`.
- It fails on an `error` parameter only when the request also carries the matching `state`, and on timeout (default 5 minutes) and abort.
- It closes on completion, failure or an explicit close. Close SHALL be idempotent.

#### Scenario: Matching state yields the code
- **WHEN** the browser hits the redirect URI with the helper's `state` and a `code`
- **THEN** the helper resolves with the code, answers the browser with a completion page, and stops listening

#### Scenario: Stray and mismatched requests do not end the wait
- **WHEN** a request arrives for `/favicon.ico`, and another arrives on the callback path with a wrong or shorter `state`
- **THEN** neither yields a code, the helper keeps listening, and a later matching callback still succeeds

#### Scenario: Forged error without state ignored
- **WHEN** a local request hits the callback path with `error=access_denied` and no or a wrong `state`
- **THEN** the helper keeps waiting and a later matching callback still succeeds

#### Scenario: Timeout closes the listener
- **WHEN** no matching callback arrives before the timeout
- **THEN** the helper fails with a timeout and stops listening

#### Scenario: Bound to loopback only
- **WHEN** the helper is listening
- **THEN** it is not reachable on any non-loopback interface

### Requirement: Shared OAuth flow view primitive
The client SHALL register a generic OAuth flow view as the UI primitive `ui:oauth-flow`. The view SHALL render the auth link, device code, paste field, select and text prompts, status and cancel control of a flow. The provider add dialog SHALL render the same view with no visible change.

#### Scenario: Plugin renders the flow view
- **WHEN** a plugin settings section looks up `ui:oauth-flow` and passes it a flow status
- **THEN** the auth link, paste field and cancel control render as in the provider dialog
