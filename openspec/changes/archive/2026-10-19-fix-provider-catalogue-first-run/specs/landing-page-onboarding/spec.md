## MODIFIED Requirements

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

## ADDED Requirements

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
