## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Empty-state onboarding surface
The dashboard client SHALL render a `LandingPage` component in the main content pane whenever no session, terminal, editor, settings panel, or other primary view is selected. The `LandingPage` SHALL display its three onboarding steps as a single ordered list, in this order: connect a model provider, create your first project, start your first session.

Each step SHALL be in one of three states, derived from the current application state:
- **pending:** the first pending step in order is expanded and carries the step's call-to-action. Any later pending step renders as one line with no controls, naming the earlier step it waits on;
- **done:** the step collapses to one line with a check marker. Only Step ① may add the peer status, and only Step ② the "already existed" note, beneath that line;
- **locked:** the step collapses to one line with a lock marker and text naming the unmet prerequisite, and renders no controls.

Every state SHALL be conveyed by a marker and text, never by colour alone. Above the list, a progress line SHALL state how many of the three steps are done. At most one control SHALL use the primary-button treatment: the call-to-action of the first pending step, if any.

#### Scenario: First-run user sees all guidance
- **GIVEN** `useProvidersReady()` reports no credentials
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
Step ① SHALL navigate the user to the providers page of the settings panel (`/settings/providers`) when its CTA is activated. Step ① is **done** when `useProvidersReady()` reports credentials (an API key or an authenticated OAuth provider, per "Providers-ready detection").

#### Scenario: CTA routes to providers tab
- **GIVEN** Step ① is in the **pending** state
- **WHEN** the user clicks the Step ① CTA button
- **THEN** the client SHALL navigate to `/settings/providers`

#### Scenario: Done state reflects provider detection
- **GIVEN** `useProvidersReady()` reports credentials
- **WHEN** Step ① renders
- **THEN** it SHALL display a ✔ row with the label "Credentials configured"

### Requirement: Step ② Add folder
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
- **WHEN** Step ② renders
- **THEN** it SHALL render as one locked line with text indicating that credentials are required
- **AND** no field, Create project button or secondary action SHALL be rendered

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
