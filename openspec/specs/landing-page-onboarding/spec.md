# landing-page-onboarding

## Purpose

First-run onboarding surface rendered in the dashboard's main content pane whenever nothing else is selected. Narrates the three steps needed to go from install → first running session (Setup credentials → Add folder → Start session) and collapses to a compact status strip once each step is satisfied, so returning users are not shown a wall of onboarding.

## Requirements

### Requirement: Empty-state onboarding surface
The dashboard client SHALL render a `LandingPage` component in the main content pane whenever no session, terminal, editor, settings panel, or other primary view is selected. The `LandingPage` SHALL display three onboarding steps — Setup credentials, Add folder, Start session — each rendered in one of three states: **pending**, **done**, or **locked**, derived from the current application state.

#### Scenario: First-run user sees all guidance
- **GIVEN** no LLM provider has a non-empty `apiKey` in `/api/providers`
- **AND** no pinned directories exist
- **AND** no active sessions exist
- **WHEN** the LandingPage renders
- **THEN** Step ① "Setup credentials" SHALL be **pending** with a CTA button
- **AND** Step ② "Add folder" SHALL be **locked** with a hint identifying credentials as the unmet prerequisite
- **AND** Step ③ "Start session" SHALL be **locked** with a hint identifying a pinned folder as the unmet prerequisite

#### Scenario: Fully configured user sees compact status
- **GIVEN** at least one provider has a non-empty `apiKey`
- **AND** at least one directory is pinned
- **AND** at least one session exists
- **WHEN** the LandingPage renders
- **THEN** all three steps SHALL render as single-line done rows with a ✔ indicator
- **AND** no CTA buttons SHALL be rendered

#### Scenario: Partially configured user progresses
- **GIVEN** at least one provider has a non-empty `apiKey`
- **AND** no pinned directories exist
- **WHEN** the LandingPage renders
- **THEN** Step ① SHALL render as **done**
- **AND** Step ② SHALL render as **pending** with a CTA button
- **AND** Step ③ SHALL render as **locked**

### Requirement: Step ① Setup credentials
Step ① SHALL navigate the user to the providers tab of the settings panel when its CTA is activated.

#### Scenario: CTA routes to providers tab
- **GIVEN** Step ① is in the **pending** state
- **WHEN** the user clicks the Step ① CTA button
- **THEN** the client SHALL navigate to `/settings?tab=providers`

#### Scenario: Done state reflects provider detection
- **GIVEN** `/api/providers` returns at least one entry with a non-empty `apiKey`
- **WHEN** Step ① renders
- **THEN** it SHALL display a ✔ row with the label "Credentials configured"

### Requirement: Step ② Add folder
Step ② SHALL open the `PinDirectoryDialog` when its CTA is activated. The CTA SHALL be disabled whenever Step ① is not in the **done** state.

#### Scenario: CTA opens pin dialog
- **GIVEN** Step ② is in the **pending** state
- **WHEN** the user clicks the Step ② CTA button
- **THEN** the client SHALL invoke the app-level `onOpenPinDialog` callback, which opens `PinDirectoryDialog`

#### Scenario: Locked when credentials missing
- **GIVEN** no provider has a non-empty `apiKey`
- **WHEN** Step ② renders
- **THEN** its CTA SHALL be disabled
- **AND** a hint SHALL indicate that credentials are required

#### Scenario: Sidebar "Add folder" still works independently
- **GIVEN** any combination of credential and folder state
- **WHEN** the user clicks the sidebar "Add folder" button
- **THEN** the `PinDirectoryDialog` SHALL open normally, regardless of Step ② lock state on the LandingPage

### Requirement: Step ③ Start session
Step ③ SHALL spawn a session in the first pinned directory when its CTA is activated. The CTA SHALL be disabled whenever no directories are pinned.

#### Scenario: CTA spawns in first pinned folder
- **GIVEN** Step ③ is in the **pending** state
- **AND** the pinned directory list has `firstPinnedCwd` as its first entry
- **WHEN** the user clicks the Step ③ CTA button
- **THEN** the client SHALL invoke `onSpawnSession(firstPinnedCwd)`

#### Scenario: Locked when no folders pinned
- **GIVEN** no directories are pinned
- **WHEN** Step ③ renders
- **THEN** its CTA SHALL be disabled
- **AND** a hint SHALL indicate that a pinned folder is required

#### Scenario: Done state reflects active sessions
- **GIVEN** at least one active session exists
- **WHEN** Step ③ renders
- **THEN** it SHALL display a ✔ row with the count of active sessions

### Requirement: Providers-ready detection
The client SHALL provide a `useProvidersReady()` hook that observes BOTH `/api/providers` (OpenAI-style baseUrl+apiKey config entries) AND `/api/provider-auth/status` (pi OAuth / API-key credentials stored in `~/.pi/agent/auth.json`) and returns `{ ready, count, loading }`. `ready` SHALL be `true` if either source has at least one authenticated/keyed entry; `count` SHALL be the sum across both sources. The hook SHALL refetch on initial mount, on window `focus`, and on `provider-auth-event` custom events. When one endpoint fails, the hook SHALL still derive readiness from the other.

The client SHALL dispatch a `provider-auth-event` on `window` after each credential write that succeeds, covering the API-key save, the API-key removal, the OAuth sign-in completion, the OAuth sign-out, the device-code completion, and the custom-LLM-provider save (which has replace semantics and therefore covers adding, editing, and deleting a custom provider). Writes that DECREASE the credential count SHALL dispatch on the same terms as writes that increase it.

The dispatch SHALL occur on the success branch by which each write path already determines success, and SHALL NOT introduce a new success gate. A write that the call site treats as failed SHALL NOT dispatch the event.

The event is a hint to re-derive readiness, not an assertion that the credential count changed. A dispatch that follows a successful write which turns out to have changed nothing SHALL be permitted; a successful write that changes the count and does NOT dispatch SHALL NOT be. Consumers SHALL therefore treat the event as idempotent.

The event SHALL carry no credential material.

The dispatch SHALL be attached to the credential-write path only, never to a status refresh that also runs on component mount.

This contract is bounded to writes performed by a mounted client surface in the current window. Credential writes that complete server-side after the initiating component unmounts, writes originating outside the client (CLI, direct API calls), and writes in another browser window are NOT covered; those surfaces continue to rely on the hook's `focus` and mount refetches.

#### Scenario: Ready is true when any `/api/providers` entry has an API key
- **GIVEN** `/api/providers` returns `{ providers: { openai: { apiKey: "sk-..." } } }`
- **AND** `/api/provider-auth/status` returns an empty array
- **WHEN** `useProvidersReady()` resolves
- **THEN** it SHALL return `ready=true`

#### Scenario: Ready is true when any OAuth provider is authenticated
- **GIVEN** `/api/providers` returns no entries with a non-empty apiKey
- **AND** `/api/provider-auth/status` returns `[{ authenticated: true }]`
- **WHEN** `useProvidersReady()` resolves
- **THEN** it SHALL return `ready=true`

#### Scenario: Ready is false when neither source has credentials
- **GIVEN** `/api/providers` returns no entries with a non-empty apiKey
- **AND** `/api/provider-auth/status` returns entries with `authenticated: false`
- **WHEN** `useProvidersReady()` resolves
- **THEN** it SHALL return `ready=false`

#### Scenario: One endpoint failure does not hide credentials from the other
- **GIVEN** `/api/providers` fails
- **AND** `/api/provider-auth/status` returns `[{ authenticated: true }]`
- **WHEN** `useProvidersReady()` resolves
- **THEN** it SHALL return `ready=true`

#### Scenario: Refetch on provider-auth-event
- **GIVEN** the hook is mounted
- **WHEN** a `provider-auth-event` is dispatched on `window`
- **THEN** the hook SHALL refetch both endpoints and update its state

#### Scenario: A successful API-key save dispatches the event
- **GIVEN** the provider auth settings section is mounted
- **AND** the API-key `PUT` is mocked to return a success response
- **WHEN** the user submits the save once
- **THEN** exactly one `provider-auth-event` SHALL be dispatched on `window`
- **NOTE** the count is scoped to a single submission; the component has no in-flight guard, so a double activation legitimately produces two writes and two dispatches

#### Scenario: A successful OAuth completion dispatches the event
- **GIVEN** the provider auth settings section is mounted
- **AND** an OAuth sign-in flow completes successfully
- **WHEN** the section observes the completion
- **THEN** a `provider-auth-event` SHALL be dispatched on `window`

#### Scenario: A successful device-code completion dispatches the event
- **GIVEN** the provider auth settings section is mounted
- **AND** a device-code flow completes successfully
- **WHEN** the section observes the completion
- **THEN** a `provider-auth-event` SHALL be dispatched on `window`

#### Scenario: A successful custom-LLM-provider save dispatches the event
- **GIVEN** the settings panel has a dirty custom-LLM-provider list
- **AND** the `/api/providers` `PUT` is mocked to return `success: true`
- **WHEN** the save is submitted
- **THEN** a `provider-auth-event` SHALL be dispatched on `window`

#### Scenario: Removing the last API key dispatches the event
- **GIVEN** the provider auth settings section is mounted with exactly one keyed provider
- **AND** no OAuth provider is authenticated and no `/api/providers` entry has a non-empty `apiKey`
- **AND** the key-removal request is mocked to succeed
- **WHEN** the user removes the key
- **THEN** a `provider-auth-event` SHALL be dispatched on `window`
- **AND** `useProvidersReady()` SHALL subsequently report `ready=false`

#### Scenario: A provider save that writes no credential still dispatches
- **GIVEN** an existing custom LLM provider whose API key is unchanged and round-trips as the redaction sentinel
- **AND** only its base URL or api type is edited
- **WHEN** the save succeeds
- **THEN** a `provider-auth-event` SHALL be dispatched
- **AND** the resulting readiness SHALL be unchanged

#### Scenario: OAuth sign-out dispatches the event
- **GIVEN** the provider auth settings section is mounted with one authenticated OAuth provider
- **AND** the sign-out request is mocked to succeed
- **WHEN** the user signs out
- **THEN** a `provider-auth-event` SHALL be dispatched on `window`

#### Scenario: Deleting a custom LLM provider dispatches the event
- **GIVEN** the settings panel has an existing custom LLM provider
- **AND** the `/api/providers` `PUT` that omits it is mocked to return `success: true`
- **WHEN** the save is submitted
- **THEN** a `provider-auth-event` SHALL be dispatched on `window`

#### Scenario: A transport-failed credential write dispatches nothing
- **GIVEN** the provider auth settings section is mounted
- **AND** the API-key `PUT` is mocked to return a non-2xx response
- **WHEN** the user saves the key
- **THEN** no `provider-auth-event` SHALL be dispatched

#### Scenario: A body-level failure dispatches nothing
- **GIVEN** a credential write whose endpoint reports failure in a success discriminator in its body
- **AND** the response is transport-successful
- **WHEN** the write completes
- **THEN** no `provider-auth-event` SHALL be dispatched

#### Scenario: Mounting the settings section dispatches nothing
- **GIVEN** the provider auth settings section is newly mounted
- **AND** the user has performed no action
- **WHEN** its initial status refresh completes
- **THEN** no `provider-auth-event` SHALL be dispatched

#### Scenario: Readiness updates without a window focus event
- **GIVEN** `useProvidersReady()` is mounted with both endpoints mocked as unconfigured
- **AND** the endpoints are then mocked to report one authenticated provider
- **WHEN** a credential-save path dispatches `provider-auth-event`
- **AND** no `focus` event is fired
- **THEN** the hook SHALL refetch both endpoints and report `ready=true`
