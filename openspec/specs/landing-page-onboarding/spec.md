# landing-page-onboarding

## Purpose

First-run onboarding surface rendered in the dashboard's main content pane whenever nothing else is selected. Narrates the three steps needed to go from install → first running session (Setup credentials → Add folder → Start session) and collapses to a compact status strip once each step is satisfied, so returning users are not shown a wall of onboarding.

## Requirements

### Requirement: Empty-state onboarding surface
The dashboard client SHALL render a `LandingPage` component in the main content pane whenever no session, terminal, editor, settings panel, or other primary view is selected. The `LandingPage` SHALL display its three onboarding steps as a single ordered list, in this order: connect a model provider, create your first project, start your first session.

Each step SHALL be in one of three states, derived from the current application state. Step ① has a fourth state, **skipped** (see "Step ① can be skipped"):
- **pending:** the first pending step in order is expanded and carries the step's call-to-action. Any later pending step renders as one line with no controls, naming the earlier step it waits on;
- **done:** the step collapses to one line with a check marker. Only Step ① may add the peer status, and only Step ② the "already existed" note, beneath that line;
- **locked:** the step collapses to one line with a lock marker and text naming the unmet prerequisite, and renders no controls;
- **skipped** (Step ① only): the step collapses to one line with a skip marker, text stating that provider setup was skipped, and one secondary control that resumes setup. A skipped step is not pending: it is never the expanded first pending step, and no later step waits on it. It is not done either, and SHALL NOT count toward the progress line.

Every state SHALL be conveyed by a marker and text, never by colour alone. Above the list, a progress line SHALL state how many of the three steps are done. At most one control SHALL use the primary-button treatment: the call-to-action of the first pending step, if any.

#### Scenario: First-run user sees all guidance
- **GIVEN** `useProvidersReady()` reports no credentials
- **AND** Step ① has not been skipped
- **AND** no pinned directories exist
- **AND** no active sessions exist
- **WHEN** the LandingPage renders
- **THEN** Step ① SHALL be **pending** with a CTA button
- **AND** Step ② SHALL be **locked**, rendering no controls, with text identifying credentials as the unmet prerequisite
- **AND** Step ③ SHALL be **locked**, rendering no controls, with text identifying a project folder as the unmet prerequisite
- **AND** the progress line SHALL report 0 of 3 steps done

#### Scenario: Fully configured user sees compact status
- **GIVEN** `useProvidersReady()` reports credentials
- **AND** at least one directory is pinned
- **AND** at least one session exists
- **WHEN** the LandingPage renders
- **THEN** all three steps SHALL render as done rows with a ✔ indicator
- **AND** no step CTA buttons SHALL be rendered (a peer **Install** or **Retry install** action beneath Step ① is not a step CTA)

#### Scenario: Folder pinned before credentials
- **GIVEN** `useProvidersReady()` reports no credentials
- **AND** Step ① has not been skipped
- **AND** a directory was pinned from the sidebar
- **AND** no sessions exist
- **WHEN** the LandingPage renders
- **THEN** only Step ① SHALL be expanded with a primary CTA
- **AND** Step ③ SHALL render as one line with no controls, naming Step ① as the step it waits on

#### Scenario: Partially configured user progresses
- **GIVEN** `useProvidersReady()` reports credentials
- **AND** no pinned directories exist
- **WHEN** the LandingPage renders
- **THEN** Step ① SHALL render as **done**
- **AND** Step ② SHALL render as **pending** with its inline project-name field and Create project button
- **AND** Step ③ SHALL render as **locked**
- **AND** the progress line SHALL report 1 of 3 steps done

### Requirement: Step ① Setup credentials
Step ① SHALL navigate the user to the providers page of the settings panel (`/settings/providers`) when its CTA is activated. Step ① is **done** when `useProvidersReady()` reports credentials (an API key or an authenticated OAuth provider, per "Providers-ready detection"). Done takes precedence over skipped.

#### Scenario: CTA routes to providers tab
- **GIVEN** Step ① is in the **pending** state
- **WHEN** the user clicks the Step ① CTA button
- **THEN** the client SHALL navigate to `/settings/providers`

#### Scenario: Done state reflects provider detection
- **GIVEN** `useProvidersReady()` reports credentials
- **WHEN** Step ① renders
- **THEN** it SHALL display a ✔ row with the label "Credentials configured"

#### Scenario: Done wins over a previous skip
- **GIVEN** Step ① was skipped earlier in this browser
- **WHEN** `useProvidersReady()` reports credentials
- **THEN** Step ① SHALL render as **done**, not skipped

### Requirement: Step ② Add folder
Step ② is **locked** while Step ① is neither **done** nor **skipped**.

In its **pending** state, Step ② SHALL present an inline "Create your first project" form:
- a labelled project-name text field prefilled with `my-first-project`;
- a primary **Create project** button carrying `data-testid="onboarding-step-2-create"`;
- a secondary **Use an existing folder…** action carrying the existing `data-testid="onboarding-step-2-cta"`, which keeps its meaning: it opens the folder browser.

**Create project** SHALL request the directory from `POST /api/browse/create-project` and, on success, pin the returned path through the same pin path the folder browser uses. **Use an existing folder…** SHALL open `AddFoldersDialog` through the app-level `onOpenPinDialog` callback.

Name validation SHALL be performed by the server only. The client SHALL map the server's error reason to localized guidance, and SHALL show a generic localized message for an unknown reason or a non-standard error body. The error SHALL render between the field label and the field, SHALL mark the field invalid for assistive technology, and SHALL preserve the user's input.

The done row reports the pinned-folder count.

#### Scenario: Create a new project
- **GIVEN** Step ② is in the **pending** state
- **WHEN** the user keeps the default name and activates Create project
- **THEN** the client SHALL post `{ name: "my-first-project" }` to `/api/browse/create-project`
- **AND** on success SHALL pin the returned absolute path
- **AND** Step ② SHALL render as **done** and Step ③ SHALL become **pending**

#### Scenario: Name already taken by a directory
- **WHEN** the endpoint responds successfully with `existed: true`
- **THEN** the client SHALL pin the returned path
- **AND** the Step ② done row SHALL add a line stating that the folder already existed and was pinned as-is
- **AND** that line SHALL disappear once the LandingPage unmounts (for example the user opens a session) and SHALL NOT reappear when it mounts again

#### Scenario: Create fails
- **WHEN** the endpoint responds with `success: false`, the request fails, or the response is not a standard API envelope (for example an older server's 404)
- **THEN** localized guidance for the reason (or a generic message) SHALL render between the field label and the field, with the field marked invalid
- **AND** the field SHALL keep the text the user entered
- **AND** nothing SHALL be pinned
- **AND** the form and the secondary action SHALL remain usable

#### Scenario: Submit in flight
- **WHEN** a Create project request is outstanding
- **THEN** the field, the Create project button and the secondary action SHALL be disabled, and the button marked busy, so a second request cannot be issued

#### Scenario: CTA opens pin dialog
- **GIVEN** Step ② is in the **pending** state
- **WHEN** the user activates **Use an existing folder…**
- **THEN** the client SHALL invoke the app-level `onOpenPinDialog` callback, which opens `AddFoldersDialog`

#### Scenario: Locked when credentials missing
- **GIVEN** `useProvidersReady()` reports no credentials
- **AND** Step ① has not been skipped
- **WHEN** Step ② renders
- **THEN** it SHALL render as one locked line with text indicating that credentials are required
- **AND** no field, Create project button or secondary action SHALL be rendered

#### Scenario: Pending after Step ① is skipped
- **GIVEN** `useProvidersReady()` reports no credentials
- **AND** Step ① has been skipped
- **AND** no pinned directories exist
- **WHEN** Step ② renders
- **THEN** it SHALL be the expanded first pending step with its inline form and the primary Create project button

#### Scenario: Sidebar "Add folder" still works independently
- **GIVEN** any combination of credential and folder state
- **WHEN** the user clicks the sidebar "Add folder" button
- **THEN** `AddFoldersDialog` SHALL open normally, regardless of Step ② lock state on the LandingPage

### Requirement: Step ③ Start session
Step ③ SHALL spawn a session in the first pinned directory when its CTA is activated. The CTA SHALL be rendered only while Step ③ is **pending**. While no directories are pinned, Step ③ is **locked** and renders no CTA.

#### Scenario: CTA spawns in first pinned folder
- **GIVEN** Step ③ is in the **pending** state
- **AND** the pinned directory list has `firstPinnedCwd` as its first entry
- **WHEN** the user clicks the Step ③ CTA button
- **THEN** the client SHALL invoke `onSpawnSession(firstPinnedCwd)`

#### Scenario: Locked when no folders pinned
- **GIVEN** no directories are pinned
- **WHEN** Step ③ renders
- **THEN** it SHALL render as one locked line with text indicating that a project folder is required
- **AND** no Step ③ CTA SHALL be rendered

#### Scenario: Done state reflects active sessions
- **GIVEN** at least one active session exists
- **WHEN** Step ③ renders
- **THEN** it SHALL display a ✔ row with the count of active sessions

### Requirement: Providers-ready detection
The client SHALL provide a `useProvidersReady()` hook that observes BOTH `/api/providers` (OpenAI-style baseUrl+apiKey config entries) AND `/api/provider-auth/status` (pi OAuth / API-key credentials stored in `~/.pi/agent/auth.json`) and returns `{ ready, count, loading }`. `ready` SHALL be `true` if either source has at least one authenticated/keyed entry; `count` SHALL be the sum across both sources. The hook SHALL refetch on initial mount, on window `focus`, and on `provider-auth-event` custom events. When one endpoint fails, the hook SHALL still derive readiness from the other.

The client SHALL dispatch a `provider-auth-event` on `window` after each credential write that succeeds, covering the API-key save, the API-key removal, the OAuth sign-in completion, the OAuth sign-out, the device-code completion, and each custom-provider write (the single-provider create, update, and delete, and the retained whole-map write). Writes that DECREASE the credential count SHALL dispatch on the same terms as writes that increase it.

The readiness hook continues to derive readiness from `authenticated`. It SHALL NOT be rewired onto the credential-status `configured` field by this contract; its under-count of environment-credentialed providers is pre-existing and is changed, if at all, by its own change.

The dispatch SHALL occur on the success branch by which each write path already determines success, and SHALL NOT introduce a new success gate. A write that the call site treats as failed SHALL NOT dispatch the event.

The event is a hint to re-derive readiness, not an assertion that the credential count changed. A dispatch that follows a successful write which turns out to have changed nothing SHALL be permitted; a successful write that changes the count and does NOT dispatch SHALL NOT be. Consumers SHALL therefore treat the event as idempotent.

The event SHALL carry no credential material.

The dispatch SHALL be attached to the credential-write path only, never to a status refresh that also runs on component mount.

This contract is bounded to writes performed by a mounted client surface in the current window. Writes originating outside the client (CLI, direct API calls) and writes in another browser window are NOT covered; those surfaces continue to rely on the hook's `focus` and mount refetches.

An authentication flow started from the Add-provider dialog is **in** scope even when it completes after the dialog closed, because the flow is owned by the providers section rather than by the dialog. The exclusion for a write completing after the *initiating component* unmounts therefore applies to the unmount of the owning section, not to the dismissal of the dialog that started the flow.

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
- **GIVEN** the operator submits a custom endpoint from the Add-provider dialog
- **AND** the single-provider write is mocked to succeed
- **WHEN** the write completes
- **THEN** a `provider-auth-event` SHALL be dispatched on `window`

#### Scenario: A flow completing after the dialog closed still dispatches
- **GIVEN** an OAuth flow started from the Add-provider dialog and the dialog has since been dismissed
- **AND** the providers section is still mounted
- **WHEN** the flow completes successfully
- **THEN** a `provider-auth-event` SHALL be dispatched on `window`
- **AND** the list SHALL refresh

#### Scenario: Removing the last API key dispatches the event
- **GIVEN** the provider auth settings section is mounted with exactly one keyed provider
- **AND** no OAuth provider is authenticated and no `/api/providers` entry has a non-empty `apiKey`
- **AND** the key-removal request is mocked to succeed
- **WHEN** the user removes the key
- **THEN** a `provider-auth-event` SHALL be dispatched on `window`
- **AND** `useProvidersReady()` SHALL subsequently report `ready=false`

#### Scenario: A provider save that writes no credential still dispatches
- **GIVEN** an existing custom provider whose API key is unchanged and round-trips as the redaction sentinel
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
- **GIVEN** an existing custom provider row
- **AND** the single-provider delete is mocked to succeed
- **WHEN** the operator removes it
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

### Requirement: Step ① done row reports the Claude peer state
While Step ① is **done**, a peer status MAY appear beneath its one-line label. Exactly one of the following applies, first match wins:
1. the bridge probe, when known, reports the peer as found but failing to import → a warning that the package failed to load, pointing to Settings › Providers, with no install action;
2. the bridge probe reports the peer resolving → no peer status;
3. an automatic install (see `anthropic-peer-hint`) is deciding, queued or running → an in-progress status;
4. an automatic install failed → the same plain-language warning as the Anthropic row, with a **Retry install** action, and the raw installer output only inside a collapsed log block;
5. an automatic install succeeded → no peer status;
6. the `anthropic` subscription is authenticated and the server's recommended-extension state reports the peer not active in pi → a warning that Claude tool calls need `pi-anthropic-messages`, with an **Install** action;
7. otherwise → no peer status.

Requirements on these actions and on the status:
- **Install** and **Retry install** SHALL go through the same decision and the same single global install as the automatic path, including its vetoes and its "already pending" rule.
- Both SHALL use the secondary-button treatment, never the primary one.
- The recommended-extension state and the bridge probe SHALL be requested by Landing only while Step ① is done and `anthropic` is authenticated.
- The status SHALL be announced politely to assistive technology and SHALL NOT block Steps ② and ③.

#### Scenario: Install in progress after returning from settings
- **GIVEN** the operator completed the Anthropic sign-in and the automatic install is running
- **WHEN** the LandingPage renders
- **THEN** the Step ① done row shows an in-progress status naming `pi-anthropic-messages`
- **AND** Step ② remains usable

#### Scenario: Install succeeded
- **WHEN** the automatic install completes successfully
- **THEN** the Step ① done row shows no peer status, even if the recommended-extension state has not yet refreshed

#### Scenario: Install failed
- **WHEN** the automatic install reports an error
- **THEN** the Step ① done row shows the plain-language warning
- **AND** the raw installer output is not visible until the operator expands the log block
- **AND** activating **Retry install** enqueues the same global install again

#### Scenario: Sign-in finished without an automatic decision
- **GIVEN** the `anthropic` subscription is authenticated
- **AND** no automatic-install state exists (for example the sign-in completed after settings was closed)
- **AND** the recommended-extension state reports the peer not active in pi
- **WHEN** Step ① renders as **done**
- **THEN** its done row shows the manual-install warning with an **Install** action
- **AND** activating **Install** runs the shared decision and, when it enqueues, the row switches to the in-progress status

#### Scenario: Peer resolves outside pi settings
- **GIVEN** the `anthropic` subscription is authenticated
- **AND** the recommended-extension state reports the peer not active in pi
- **AND** the bridge probe reports the peer resolving (for example from a workspace `node_modules`)
- **WHEN** Step ① renders as **done**
- **THEN** its done row shows no peer status

#### Scenario: Broken package is not reinstalled from Landing
- **GIVEN** the manual-install warning is shown
- **WHEN** the operator activates **Install** and a fresh probe reports the peer as failing to import
- **THEN** no install is enqueued and the row shows the failed-to-load warning

#### Scenario: No Claude subscription
- **GIVEN** `anthropic` is not authenticated
- **WHEN** Step ① renders as **done** because another provider is configured
- **THEN** its done row shows no peer status and no recommended-extension request is made

### Requirement: Step ① can be skipped
While Step ① is **pending**, it SHALL render a secondary **Skip for now** control next to its call-to-action. The control SHALL NOT use the primary-button treatment. It SHALL carry `data-testid="onboarding-step-1-skip"`.

Activating **Skip for now** SHALL put Step ① into the **skipped** state and SHALL remember the skip in the current browser, so it survives reloads and remounts of the LandingPage. When that browser storage is unavailable, the skip SHALL still apply for as long as the LandingPage stays mounted. The skip SHALL be scoped to onboarding only. It SHALL NOT change `useProvidersReady()`, the settings panel, or any server state.

While Step ① is **skipped**:
- its one-line row SHALL state that provider setup was skipped and that sessions need a model provider to run prompts. It SHALL also note that starting a session lists every provider the session knows, including providers added by extensions;
- its row SHALL offer one secondary **Set up now** control, carrying `data-testid="onboarding-step-1-resume"`, which navigates to `/settings/providers`;
- Step ② and Step ③ SHALL derive their states as if Step ① were satisfied.

#### Scenario: Skipping unlocks the next step
- **GIVEN** `useProvidersReady()` reports no credentials and no pinned directories exist
- **WHEN** the user activates **Skip for now**
- **THEN** Step ① SHALL render as **skipped** with the **Set up now** control
- **AND** Step ② SHALL become the expanded first pending step
- **AND** the progress line SHALL still report 0 of 3 steps done

#### Scenario: Skipped step lets a session be started
- **GIVEN** Step ① is skipped and one directory is pinned
- **AND** no sessions exist
- **WHEN** the LandingPage renders
- **THEN** Step ③ SHALL be the expanded first pending step with its CTA
- **AND** activating it SHALL invoke `onSpawnSession(firstPinnedCwd)`

#### Scenario: Skip survives a reload
- **GIVEN** the user skipped Step ① and then reloaded the page
- **WHEN** the LandingPage renders with no credentials
- **THEN** Step ① SHALL render as **skipped**

#### Scenario: Resume setup from the skipped row
- **GIVEN** Step ① is skipped
- **WHEN** the user activates **Set up now**
- **THEN** the client SHALL navigate to `/settings/providers`

#### Scenario: Skip control is absent once done
- **GIVEN** `useProvidersReady()` reports credentials
- **WHEN** Step ① renders
- **THEN** no **Skip for now** or **Set up now** control SHALL be rendered
