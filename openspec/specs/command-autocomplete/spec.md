## ADDED Requirements

### Requirement: Commands state in App
The App component SHALL store per-session commands in a `Map<string, CommandInfo[]>` keyed by session ID. When a `commands_list` message is received from the server, the commands for that session SHALL be updated. The active session's commands SHALL be passed to the `CommandInput` component.

#### Scenario: Commands received for session
- **WHEN** the server sends a `commands_list` message for session "abc-123"
- **THEN** the App SHALL store the commands and pass them to `CommandInput` when session "abc-123" is selected

#### Scenario: Switch sessions
- **WHEN** the user switches from session A to session B
- **THEN** the `CommandInput` SHALL receive session B's commands for autocomplete

#### Scenario: No commands received yet
- **WHEN** a session is selected but no `commands_list` has been received
- **THEN** the `CommandInput` SHALL receive an empty commands array

### Requirement: Request commands on subscribe
When the browser subscribes to a session, it SHALL also send a `request_commands` message to fetch the current command list.

#### Scenario: Subscribe to session
- **WHEN** the browser subscribes to a new session
- **THEN** it SHALL send both `subscribe` and `request_commands` messages

### Requirement: CommandInput replaces MessageInput
The App component SHALL use `CommandInput` instead of `MessageInput` for the chat input. `MessageInput` SHALL be removed from the codebase.

#### Scenario: Input renders with multiline and autocomplete
- **WHEN** the chat view is displayed
- **THEN** the input SHALL be a multiline textarea with `/` command autocomplete support

### Requirement: Selection callbacks invoke the current onDraftChange prop
The `CommandInput` component SHALL invoke the latest `onDraftChange` prop
reference when the user selects an autocomplete suggestion, regardless of how
many prop updates have occurred since the component mounted. This requirement
applies to all three selection entry points: **Tab key**, **Enter key** (when
the dropdown is open and non-empty), and **mouse click** on a dropdown item.
It applies to both the `/` command dropdown and the `@` file dropdown.

#### Scenario: Tab selects command after onDraftChange reference changes
- **WHEN** `CommandInput` is rendered with `draft=""` and `onDraftChange=v1`,
  then re-rendered with a different `onDraftChange=v2` (simulating a session
  switch in the parent), then the user types `/dep` and presses **Tab**
- **THEN** the component SHALL call `v2("/deploy ")` — NOT `v1` — and the
  dropdown SHALL close

#### Scenario: Enter selects command after onDraftChange reference changes
- **WHEN** `CommandInput` is rendered with `draft=""` and `onDraftChange=v1`,
  then re-rendered with `onDraftChange=v2`, then the user types `/dep` and
  presses **Enter**
- **THEN** the component SHALL call `v2("/deploy ")` — NOT `v1` — and the
  dropdown SHALL close

#### Scenario: Mouse click selects command after onDraftChange reference changes
- **WHEN** `CommandInput` is rendered with `draft=""` and `onDraftChange=v1`,
  then re-rendered with `onDraftChange=v2`, then the user types `/dep` and
  clicks the `/deploy` dropdown row
- **THEN** the component SHALL call `v2("/deploy ")` — NOT `v1`

#### Scenario: Tab selects file after onDraftChange reference changes
- **WHEN** `CommandInput` is rendered with `draft=""` and `onDraftChange=v1`,
  then re-rendered with `onDraftChange=v2`, then the user types `@` (and
  `fileResults` is populated), then presses **Tab**
- **THEN** the component SHALL call `v2` with a draft string that contains
  the selected file path — NOT `v1`
