## ADDED Requirements

### Requirement: Standalone app on its own origin

The team app SHALL be a static single-page application that reads its dashboard endpoint from a runtime `config.json` and talks to the dashboard cross-origin through the app kit (bearer REST, ticketed WebSocket). When the dashboard reports an active login provider, the app SHALL require OIDC sign-in before showing team data; when identity is inactive it SHALL run as the local operator without a sign-in step. When the login descriptor is unreachable it SHALL show a sign-in-unavailable state and no team data. When the host refuses a credential-less request it SHALL show a not-admitted state explaining that single-user mode needs network admission.

#### Scenario: Sign-in required
- **WHEN** a signed-out user opens the app against an identity-enforcing dashboard
- **THEN** the app starts the OIDC sign-in and shows no personas before it completes

#### Scenario: Same build, other host
- **WHEN** `config.json` is changed to another `dashboardUrl` without rebuilding
- **THEN** the app talks to the new host

### Requirement: Team grid

The app's home view SHALL show one card per persona visible to the user, each with avatar, name, description, role badge, model badge, scope (shared / own) and status (`new`, `sleeping`, `running`, `busy`, `retired`, `unavailable`), plus an "unconfined" badge for `full` personas. Cards SHALL refresh while the view is visible. A card's primary action SHALL open the agent's conversation. Retired and unavailable cards SHALL offer no conversation action. A card flagged `personaStale` SHALL offer "Restart to apply".

#### Scenario: Status reflects the session
- **WHEN** the agent's session starts streaming
- **THEN** the card shows `busy` within one refresh interval

#### Scenario: Admin sees template actions
- **WHEN** an admin opens the grid
- **THEN** shared cards offer edit and delete; a non-admin's shared cards offer only fork

### Requirement: Agent conversation

Opening an agent SHALL ensure its session, connect a ticketed socket for that session, render the dashboard chat transcript with the prompt input, and reconnect after a dropped connection without duplicating transcript entries. Reopening later SHALL show the earlier conversation.

#### Scenario: Conversation persists
- **WHEN** alice talks to an agent, closes the app, and opens the agent the next day
- **THEN** the earlier messages are shown and a new prompt continues the same session

#### Scenario: Reconnect without duplicates
- **WHEN** the socket drops and reconnects during a conversation
- **THEN** the transcript shows each message once

### Requirement: Persona editor

The app SHALL let a user create, edit and delete their own personas and fork any visible persona, and SHALL let an admin do the same for shared personas. The editor SHALL show server validation errors next to the field, SHALL offer `full` tools only for shared personas, and SHALL confirm deletion with a dialog that states running conversations are kept.

#### Scenario: Validation error shown
- **WHEN** the user saves a persona with a 61-character name
- **THEN** the name field shows the error and nothing is saved

### Requirement: Language, theme and accessibility

The app SHALL default to Hungarian with an English toggle (identical key sets), SHALL support light and dark themes using the dashboard theme tokens, SHALL be keyboard-operable with visible focus, and SHALL give every icon-only control an accessible name.

#### Scenario: Language switch
- **WHEN** the user switches to English
- **THEN** all app chrome strings render in English without reload
