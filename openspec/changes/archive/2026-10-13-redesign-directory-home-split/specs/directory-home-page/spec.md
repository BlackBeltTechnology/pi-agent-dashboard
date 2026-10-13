## RENAMED Requirements

- FROM: `### Requirement: Centered prompt spawns a session`
- TO: `### Requirement: Docked prompt spawns a session`

## MODIFIED Requirements

### Requirement: Bare directory route

The client SHALL register a bare route `/folder/:encodedCwd` (both the desktop and
the mobile route chains) that renders the directory home page, including the folder
editor pane it hosts. The route MUST NOT match or shadow the deeper
`/folder/:encodedCwd/{terminals,editor,settings,openspec,pi-resources,view}`
routes.

#### Scenario: Bare folder URL renders the home page

- **WHEN** the user navigates to `/folder/<encodedCwd>` for a pinned directory
- **THEN** the directory home page SHALL render with its pre-session pane (not the folder settings surface, and not the root `LandingPage`)

#### Scenario: Deeper folder routes still resolve

- **GIVEN** the bare `/folder/:encodedCwd` route is registered
- **WHEN** the user navigates to `/folder/<encodedCwd>/terminals`
- **THEN** the terminals surface SHALL render and the bare home page SHALL NOT render

#### Scenario: Mobile back returns to the predecessor

- **GIVEN** a mobile viewport on `/folder/<encodedCwd>`
- **WHEN** the user triggers back
- **THEN** navigation SHALL pop to the surface the user came from (not treat the home page as depth-0)

### Requirement: Docked prompt spawns a session

The directory home page SHALL present a prompt docked at the bottom of its pre-session pane, with no active session. The prompt card SHALL render at its natural height: its text field, toolbar and send control SHALL be fully visible without an internal scrollbar while the draft fits. Its toolbar SHALL offer a model choice, a thinking-level choice, and — when the folder is a git repository — a run-location choice (`This folder` or `New worktree…`). On send it SHALL spawn a session in that directory carrying the typed text as initial prompt and the chosen model and thinking level. The send control SHALL be disabled while a spawn initiated from this page is in flight, and SHALL be re-enabled with the draft kept when that spawn fails.

#### Scenario: Send spawns with the typed text as initial prompt

- **GIVEN** the user typed a non-empty prompt on the directory home page for `<cwd>`
- **WHEN** the user sends
- **THEN** the client SHALL send `spawn_session` for `<cwd>` carrying `initialPrompt` equal to the typed text

#### Scenario: Send carries the chosen model and thinking level

- **GIVEN** the user picked model `anthropic/claude-sonnet-5` and thinking level `high` in the prompt toolbar
- **WHEN** the user sends
- **THEN** the `spawn_session` message SHALL carry `model: "anthropic/claude-sonnet-5"` and `thinkingLevel: "high"`

#### Scenario: Default model is pre-selected and tagged

- **GIVEN** Settings defines a default model
- **WHEN** the directory home page renders
- **THEN** the model chip SHALL show that model with a `default` tag
- **AND** sending without changing it SHALL carry that model in `spawn_session`

#### Scenario: Default model shown when the catalogue is unavailable

- **GIVEN** Settings defines default model `anthropic/claude-opus-5-5` and the model catalogue request fails
- **WHEN** the directory home page renders
- **THEN** the model chip SHALL show `anthropic/claude-opus-5-5` with a `default` tag

#### Scenario: Default thinking level is pre-selected and sent

- **GIVEN** Settings defines default model `anthropic/claude-opus-5-5` and default thinking level `medium`
- **WHEN** the user sends without changing either chip
- **THEN** the `spawn_session` message SHALL carry `model: "anthropic/claude-opus-5-5"` and `thinkingLevel: "medium"`

#### Scenario: No default model sends no model

- **GIVEN** Settings defines no default model and the user picks none
- **WHEN** the user sends
- **THEN** the model chip SHALL read `pi default`
- **AND** the `spawn_session` message SHALL NOT carry a `model` field

#### Scenario: Spawn watchdog failure re-enables send

- **GIVEN** the user sent a prompt and the spawn was accepted
- **WHEN** the spawned session fails to register and the register-timeout notice for that request arrives
- **THEN** the send control SHALL be enabled
- **AND** the draft SHALL still contain the typed text

#### Scenario: New worktree carries the prompt and choices

- **GIVEN** the folder is a git repository and the user typed a prompt and picked a model
- **WHEN** the user chooses `New worktree…` and completes the worktree dialog
- **THEN** exactly one `spawn_session` SHALL be sent, for the new worktree path, carrying the typed prompt as `initialPrompt` and the picked model

#### Scenario: Aborted worktree dialog re-enables send

- **GIVEN** the user chose `New worktree…` and the worktree creation fails
- **WHEN** the dialog reports the abort
- **THEN** the send control SHALL be enabled
- **AND** the draft SHALL still contain the typed text

#### Scenario: Run-location choice hidden outside git

- **GIVEN** the folder is not a git repository
- **WHEN** the directory home page renders
- **THEN** the run-location choice SHALL NOT be shown

#### Scenario: Prompt card renders at natural height

- **WHEN** the directory home page renders with an empty draft at a 900px-tall viewport
- **THEN** the prompt card's text field, toolbar and send control SHALL be fully visible
- **AND** the card SHALL NOT show an internal scrollbar

#### Scenario: Send is disabled while a spawn is in flight

- **GIVEN** the user has sent a prompt and the spawn has not yet correlated
- **WHEN** the user attempts to send again
- **THEN** the send control SHALL be disabled so a second concurrent spawn is not issued

#### Scenario: Failed spawn re-enables send

- **GIVEN** the user sent a prompt from the page
- **WHEN** a failed `spawn_result` for that request arrives
- **THEN** the send control SHALL be enabled again
- **AND** the draft SHALL still contain the typed text

#### Scenario: Empty prompt does not spawn

- **WHEN** the user activates send with an empty/whitespace-only prompt
- **THEN** no `spawn_session` SHALL be sent

## ADDED Requirements

### Requirement: Folder home content

The directory home page SHALL show a header with the folder name, its path, a layout switch (Chat / Split / Editor), and a folder-settings control. Its pre-session pane SHALL show skill/prompt starter cards and the docked prompt. It SHALL NOT list the folder's existing sessions (the sidebar owns that list) and SHALL NOT render separate Terminals / Editor / Settings quick-action buttons. The root `LandingPage` SHALL NOT render on this page.

#### Scenario: Populated folder does not repeat its sessions

- **GIVEN** the folder has one or more sessions
- **WHEN** the directory home page renders
- **THEN** no session list SHALL be rendered on the page

#### Scenario: Settings reachable from the header

- **WHEN** the user activates the header folder-settings control
- **THEN** the client SHALL navigate to the folder settings route for that cwd

#### Scenario: Landing page is not shown

- **WHEN** the directory home page renders for a folder with no sessions
- **THEN** the root `LandingPage` SHALL NOT be rendered

#### Scenario: Empty folder focuses the prompt

- **GIVEN** the folder has no sessions
- **WHEN** the directory home page renders
- **THEN** the docked prompt SHALL receive focus

### Requirement: Folder home hosts the editor split

The directory home page SHALL render its pre-session pane and the folder editor pane (files and terminal tabs for the cwd) in the same split workspace sessions use, with Chat, Split, and Editor modes, a resizable divider, and peek handles. Layout mode SHALL persist per folder; a folder with no stored layout SHALL open in Split mode.

#### Scenario: First visit opens in Split

- **GIVEN** no layout mode is stored for `/p`
- **WHEN** the directory home page for `/p` renders
- **THEN** it SHALL render in Split mode

#### Scenario: Split shows both panes

- **GIVEN** the folder's layout mode is Split
- **WHEN** the directory home page renders
- **THEN** the pre-session pane and the folder editor pane SHALL both be visible

#### Scenario: Editor mode fills the content area

- **WHEN** the user selects Editor in the header layout switch
- **THEN** the folder editor pane SHALL fill the content area
- **AND** a peek handle SHALL restore the pre-session pane

#### Scenario: Layout mode persists per folder

- **GIVEN** the user selected Editor mode on the home page of `/p`
- **WHEN** the user navigates away and back to `/folder/<encoded /p>`
- **THEN** the page SHALL render in Editor mode

#### Scenario: New terminal from the pane

- **WHEN** the user activates the editor pane's new-terminal affordance
- **THEN** a terminal tab for the folder cwd SHALL open in the pane

### Requirement: Skill starters insert into the prompt

The pre-session pane SHALL show up to six starter cards drawn from the folder's command list, ordered folder-scope skills, then prompt templates, then global skills. Activating a card SHALL put its slash invocation (`/skill:<name> ` or `/<prompt> `) at the start of the draft — replacing a leading slash token when the draft already starts with one — place the caret at the end of the draft, and focus the prompt. It SHALL NOT send.

#### Scenario: Card inserts without sending

- **GIVEN** an empty draft
- **WHEN** the user activates the `doc-summarizer` skill card
- **THEN** the draft SHALL read `/skill:doc-summarizer ` with the caret at its end
- **AND** no `spawn_session` SHALL be sent

#### Scenario: Card prepends to an existing draft

- **GIVEN** the draft reads `summarize 2025 receipts`
- **WHEN** the user activates the `doc-summarizer` skill card
- **THEN** the draft SHALL read `/skill:doc-summarizer summarize 2025 receipts`

#### Scenario: Card replaces an existing leading slash token

- **GIVEN** the draft reads `/skill:xlsx clean the sheet`
- **WHEN** the user activates the `doc-summarizer` skill card
- **THEN** the draft SHALL read `/skill:doc-summarizer clean the sheet`

#### Scenario: Folder-scope skills come first

- **GIVEN** the folder command list has global skill `xlsx` and folder-scope skill `document-organizer`
- **WHEN** the pre-session pane renders
- **THEN** the `document-organizer` card SHALL precede the `xlsx` card

#### Scenario: No skills shows no starter row

- **GIVEN** the folder command list contains no skills or prompts
- **WHEN** the pre-session pane renders
- **THEN** no starter cards SHALL be rendered

## REMOVED Requirements

### Requirement: Terminals and Editor quick actions have distinct targets

**Reason**: The quick-action buttons are removed; the folder editor pane is part of the page (see "Folder home hosts the editor split"), with terminals opened from its new-terminal affordance.

**Migration**: Terminals → Split/Editor mode + the pane's new-terminal tab; Editor → Editor mode; Settings → header gear. The `/folder/<cwd>/editor?focus=terminal` route stays valid for other entry points.

### Requirement: Directory home content

**Reason**: Replaced by "Folder home content" — the page no longer lists the folder's sessions or renders quick-action buttons.

**Migration**: Sessions → sidebar folder group; Terminals/Editor → layout switch + editor pane; Settings → header gear.
