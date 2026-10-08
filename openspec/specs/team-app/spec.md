# team-app Specification

## Purpose
TBD - created by archiving change add-team-plugin. Update Purpose after archive.

## Requirements

### Requirement: App delivery — same origin by default, standalone optional

The team app SHALL be a static single-page application built for the base path `/apps/team/`. By default the team plugin SHALL serve it from the dashboard at `/apps/team/`: existing files from the bundled build, `index.html` for any other path under the prefix, `/apps/team` redirected to `/apps/team/`, never a file outside the bundled build, and `503` when the build is missing. Served this way, the app SHALL talk to the same origin and SHALL sign in through the dashboard's login flow, returning to the requested `/apps/team/` path. The same build MAY instead be deployed on its own origin, where it SHALL read its dashboard endpoint from a runtime `config.json` and talk to the dashboard cross-origin through the app kit (bearer REST, ticketed WebSocket) with its own OIDC client. In either deployment, when the dashboard reports an active login provider, the app SHALL require sign-in before showing team data; when identity is inactive it SHALL run as the local operator without a sign-in step. When the login descriptor is unreachable it SHALL show a sign-in-unavailable state and no team data. When the host refuses a credential-less request it SHALL show a not-admitted state explaining that single-user mode needs network admission.

#### Scenario: Served by the dashboard
- **WHEN** a signed-out user opens `<dashboard>/apps/team/agent/shared:backend` against an identity-enforcing dashboard
- **THEN** the app page loads, sign-in starts through the dashboard's login, no `/api/plugins/team/*` request is made before it completes, and the user lands back on that agent

#### Scenario: Dashboard routes unaffected
- **WHEN** the team plugin is enabled and a user opens a dashboard deep link such as `/session/abc`
- **THEN** the dashboard's own page is served, not the team app

#### Scenario: Traversal refused
- **WHEN** a request asks for `/apps/team/../../package.json` or its percent-encoded form
- **THEN** no file outside the bundled build is returned

#### Scenario: Sign-in required
- **WHEN** a signed-out user opens the standalone app against an identity-enforcing dashboard
- **THEN** the app starts the OIDC sign-in and shows no personas before it completes

#### Scenario: Same build, other host
- **WHEN** `config.json` is changed to another `dashboardUrl` without rebuilding
- **THEN** the app talks to the new host

### Requirement: Two hosts — embedded and standalone

The team app SHALL run from one source in two hosts and SHALL reach its environment only through the app kit's `AppHost`. The app SHALL have a library entry that exports the app definition, renders no root, and adds no global CSS to `html`, `body` or `:root`. The team plugin SHALL embed it like the OpenSpec board through two content-area routes: a global one at `/team/` and a folder one at `/folder/<cwd>/team/` (see Folder entry). Embedded, the app SHALL render in the content area beside the visible sidebar, with the project selector in the embedded top bar between the breadcrumb and the actions, SHALL use the dashboard's identity, language and theme, and SHALL show no sign-in, user, language or theme controls of its own. Standalone, the app SHALL render the project selector, sign-in state, language and theme controls in the app kit's standalone bar. In both hosts, routes SHALL be relative to the host base path, data SHALL be requested only through the host's API, and the document title SHALL be set only through the host. When the dashboard offers a global sidebar entry slot, the plugin SHALL contribute a "Csapat" entry opening `/team/`. When the dashboard has no app host, the plugin SHALL register no embedded route and the app SHALL remain available standalone.

#### Scenario: Embedded deep link
- **WHEN** a signed-in dashboard user opens `/team/agent/shared:backend?project=billing`
- **THEN** the sidebar stays visible, the top bar shows the project selector set to `billing`, the agent view renders below it, and no sign-in or language control of the app is shown

#### Scenario: Standalone deep link
- **WHEN** the same user opens `/apps/team/agent/shared:backend?project=billing`
- **THEN** the standalone bar shows the project selector, sign-in state, language and theme controls, and the same agent view renders

#### Scenario: No app host
- **WHEN** the team plugin is enabled on a dashboard without the app host
- **THEN** the dashboard starts normally and the app is served standalone at `/apps/team/`

### Requirement: Project selector

The app header (the dashboard header when embedded, the standalone bar otherwise) SHALL offer a project selector listing the user's own workspace and every project allowed for the user, each with its name; projects reported unavailable SHALL be listed with their reason and SHALL NOT be selectable. The selected target SHALL scope the team grid and every conversation the user opens. The app SHALL remember the selection per browser and SHALL start with the last selected target, else the first available project, else the own workspace. When only the own workspace exists the selector SHALL be shown as a plain label.

#### Scenario: Switching target rescopes the grid
- **WHEN** alice switches from `billing` to her own workspace
- **THEN** the grid shows only the personas assigned to the own workspace, with statuses and conversation counts for that target

#### Scenario: Remembered selection
- **WHEN** alice selects `crm`, closes the app and opens it again
- **THEN** `crm` is selected

### Requirement: Folder entry

The team plugin SHALL show a "Csapat" row in the folder card of every dashboard folder that matches an allowed project (equal to it or inside it), with the agent count and active conversation count, and SHALL show no row for an unmatched folder. The folder actions menu SHALL offer "Csapat" for a matched folder; settings and disable items for a matched folder-enabled project to an admin (operator in single-user mode); and "enable team for this folder" for an unmatched folder only to a caller allowed to enable it. Opening the team from a folder SHALL render the app in the content area beside the sidebar, like the OpenSpec board, with the project selector locked to the folder's project and a link to the full team; Back SHALL return to where the user came from. Where the dashboard cannot host the app in the folder, the entry SHALL open the standalone app on that project. An empty project grid SHALL offer admins "add agents" to assign existing shared personas.

#### Scenario: Session folder leads to its team
- **WHEN** alice views a session whose cwd is inside project `billing` and opens "Csapat" from that folder
- **THEN** the team grid for `billing` renders beside the sidebar, the selector shows `billing` without a menu, and Back returns to the session

#### Scenario: Unmatched folder hidden
- **WHEN** a folder matches no allowed project and alice is not an admin
- **THEN** the folder card has no team row and the folder menu has no team item

#### Scenario: Admin enables from the folder menu
- **WHEN** an admin chooses "enable team for this folder", keeps the name, picks "everyone signed in" and confirms
- **THEN** the folder card shows the team row and the team opens for that project

### Requirement: Team grid

The app's home view SHALL show one card per persona listed for the selected target, each with avatar, name, description, role badge, model badge, scope (shared / own), aggregate status (`new`, `sleeping`, `running`, `busy`, `retired`, `unavailable`), the number of active conversations and the latest activity, plus an "unconfined" badge for `full` personas. Cards SHALL refresh while the view is visible. A card's primary action SHALL open the agent's most recent active conversation in the selected target, or start its first one; a second labelled action SHALL start a new conversation. Retired, unavailable and unassigned cards SHALL offer no new conversation; unassigned and retired cards SHALL still let the user reach their existing conversations to archive or delete them. A card flagged `personaStale` SHALL offer "Restart to apply" for its stale conversations. When no persona is assigned to the selected target, the grid SHALL say so and SHALL offer creating a private persona for it.

#### Scenario: Status reflects the session
- **WHEN** one of the agent's conversations starts streaming
- **THEN** the card shows `busy` within one refresh interval

#### Scenario: Admin sees template actions
- **WHEN** an admin opens the grid
- **THEN** shared cards offer edit and delete; a non-admin's shared cards offer only fork

#### Scenario: Empty target
- **WHEN** no persona is assigned to the selected project
- **THEN** the grid shows an empty state with an action to create a private persona assigned to that project

### Requirement: Agent conversation

The conversation view SHALL show the selected agent's conversations in the selected target (newest activity first, title, status, last activity; archived ones behind a separate filter), a "New conversation" action that is disabled with its reason at the conversation limit, and the opened conversation. Opening a conversation SHALL ensure its session, connect a ticketed socket for it, render the dashboard chat transcript with the prompt input, and reconnect after a dropped connection without duplicating transcript entries. Each conversation SHALL offer rename, archive or restore, delete (confirmed by a dialog stating the transcript file is kept but cannot be reopened in the app), and restart when stale. On narrow screens the list and the opened conversation SHALL be separate views. On wide screens (≥ 1024 px) the list and the opened conversation SHALL sit side by side and together fill the height available below the app header; the transcript SHALL take the remaining height and scroll on its own, and the prompt input SHALL stay at the bottom of the conversation pane. The prompt input's height cap SHALL be relative to the conversation pane, so the input, its send button and its toolbar are never clipped. Conversation list entries SHALL span the list width with left-aligned text.

#### Scenario: Conversation persists
- **WHEN** alice talks to an agent, closes the app, and opens the same conversation the next day
- **THEN** the earlier messages are shown and a new prompt continues the same session

#### Scenario: Two conversations stay separate
- **WHEN** alice switches between two conversations with the same agent
- **THEN** each shows only its own transcript, unchanged

#### Scenario: Limit shown
- **WHEN** alice has the maximum number of active conversations with an agent in a target
- **THEN** "New conversation" is disabled and says to archive one first

#### Scenario: Wide layout fills the viewport
- **WHEN** alice opens a conversation in a 1280 × 577 px standalone window with only a short transcript
- **THEN** the list and conversation panes reach the bottom of the window, and the prompt input sits at the bottom of the conversation pane

#### Scenario: Prompt input not clipped
- **WHEN** alice types a four-line prompt in an opened conversation
- **THEN** the input grows, and the send button and the input toolbar remain fully visible

#### Scenario: Reconnect without duplicates
- **WHEN** the socket drops and reconnects during a conversation
- **THEN** the transcript shows each message once

### Requirement: Persona editor

The app SHALL let a user create, edit and delete their own personas and fork any visible persona, and SHALL let an admin do the same for shared personas. The editor SHALL offer a project assignment list (own workspace plus the projects the author may assign, at least one required, the own workspace preselected for a new persona and the selected project added when the editor is opened from an empty project), SHALL show server validation errors next to the field, SHALL offer `full` tools only for shared personas, SHALL offer as skills only the catalog skills allowed for every selected target (and, on a private persona, for the user), removing a ticked skill that a target change makes ineligible and saying so, SHALL show admins a hint that links to the Skills panel when the catalog is empty, and SHALL confirm deletion with a dialog that states existing conversations are kept.

#### Scenario: Validation error shown
- **WHEN** the user saves a persona with a 61-character name
- **THEN** the name field shows the error and nothing is saved

#### Scenario: At least one target
- **WHEN** the user unticks every entry in the project list and saves
- **THEN** the field shows an error and nothing is saved

#### Scenario: Skills follow the targets
- **WHEN** the user ticks `review` (allowed in `billing` only) and then adds `crm` to the project list
- **THEN** `review` is unticked and disabled, and a note says it is not allowed in `crm`

#### Scenario: Empty catalog hint
- **WHEN** the catalog is empty and an admin opens the editor
- **THEN** the Skills field shows a hint with a link to the Skills panel, and a non-admin sees no Skills field

### Requirement: Language, theme and accessibility

Standalone, the app SHALL default to Hungarian with an English toggle (identical key sets); embedded, it SHALL follow the dashboard's language and theme. The app SHALL support light and dark themes using the dashboard theme tokens, SHALL be keyboard-operable with visible focus, and SHALL give every icon-only control an accessible name.

#### Scenario: Language switch
- **WHEN** the user switches to English
- **THEN** all app chrome strings render in English without reload

### Requirement: Admin Skills panel

The app SHALL show admins (the operator in single-user mode) a Skills panel. The panel lists every catalog entry with its name, source (`config` or `managed`), users and targets. It lets the admin add an entry by picking from the available skills or entering an absolute path, set its users (`everyone` or a list of principals, hidden in single-user mode) and targets (`all` or a list of projects and the own workspace), edit or remove managed entries, and see config entries read-only. Before a save that changes or removes an entry, the panel SHALL show the server's impact preview (sessions to end, personas that become blocked) and, when sessions would end, SHALL confirm before saving. Entries the server reports as invalid SHALL show the reason, including "name does not match the skill". Non-admins SHALL NOT see the panel.

#### Scenario: Admin grants a skill to one project
- **WHEN** an admin picks `review` from the available skills, sets targets to `billing` and users to everyone, and saves
- **THEN** the entry is listed as `managed`, and an editor of a persona assigned only to `billing` offers `review`

#### Scenario: Config entry read-only
- **WHEN** an admin opens an entry that comes from config
- **THEN** its fields are read-only and there is no remove action

#### Scenario: Removal confirms session end
- **WHEN** an admin removes `review` while two conversations using it are live
- **THEN** a dialog says 2 sessions will be ended, and confirming removes the entry

### Requirement: Skill availability feedback

The app SHALL make skill state visible before and during a conversation:
- An agent card SHALL show a chip with the number of `effectiveSkills`, naming them in its tooltip.
- A card with a `skillBlock` SHALL show a warning that is specific to the reason and SHALL NOT offer to start a conversation. Admins get a fix action: "Fix skill", which opens the skill's Skills-panel entry, for `invalid` and `missing`; "Fix persona", which opens the editor, for `targets` and `users`. Non-admins get "Ask your administrator".
- An open conversation that answers `409 skill_not_allowed` SHALL show the same reason-specific error above the transcript, keep the history readable and disable the composer.
- The conversation header SHALL list the effective skills.
- Before sending, the composer SHALL refuse input that the shared `parseSkillCommand` rule recognises as `/skill:<name>` when `<name>` is not an effective skill. It SHALL keep the text, mark the field invalid, and say which skills are available. The server-side guard stays the authority.

#### Scenario: Reason-specific card
- **WHEN** an admin views a card whose `skillBlock` is `{ skill: "legacy-lint", reason: "invalid" }`
- **THEN** the card says the skill's path is invalid, offers "Fix skill" leading to `legacy-lint` in the Skills panel, and has no chat button

#### Scenario: Composer refuses an unavailable skill
- **WHEN** alice types `/skill:memory-x summarise` to an agent whose effective skills are `review` and `openspec-propose` and presses Enter
- **THEN** nothing is sent, the text stays in the composer, the field is marked invalid, and the message lists `/skill:review, /skill:openspec-propose`
