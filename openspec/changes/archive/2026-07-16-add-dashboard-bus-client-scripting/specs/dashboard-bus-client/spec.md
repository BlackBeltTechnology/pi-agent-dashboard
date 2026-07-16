# dashboard-bus-client — delta

## ADDED Requirements

### Requirement: Typed WebSocket bus client

The system SHALL provide a `@pi-dashboard/bus-client` package: a headless,
ticket-authenticated WebSocket client that imports the `packages/shared` protocol
types and exposes `send`, `request`, `until`, `await`, `read`, and `plugin`
primitives over a single connection.

#### Scenario: Connect obtains a ticket and subscribes

- **GIVEN** a running dashboard server on the configured port
- **WHEN** a caller invokes `connect()`
- **THEN** the client SHALL discover the port, obtain a WebSocket ticket, open the
  WS, and subscribe such that it receives the session snapshot plus live deltas

#### Scenario: Typed command send is compile-checked

- **WHEN** a caller invokes `send(msg)` where `msg` is typed as
  `BrowserToServerMessage`
- **THEN** a malformed verb or payload SHALL be a TypeScript compile error, and a
  well-formed message SHALL be transmitted verbatim over the WS

#### Scenario: Verb helpers are generated from the protocol union

- **WHEN** the package builds
- **THEN** a helper signature SHALL exist for every member of
  `BrowserToServerMessage`, generated from the union, and a completeness test
  SHALL fail if any member lacks a generated helper

### Requirement: Correlated awaits over the bus

The client SHALL let callers block on a completion event over the same connection,
using an exact correlation id when one exists and a structural session-keyed match
otherwise.

#### Scenario: Spawn awaits its correlated registration

- **GIVEN** a connected client
- **WHEN** `spawn({cwd})` is called
- **THEN** the client SHALL mint a `spawnRequestId`, send `spawn_session`, await the
  `session_added` event whose `spawnRequestId` matches, and resolve with that
  session id

#### Scenario: Turn completion awaited by session status

- **GIVEN** a session with a prompt in flight (`send_prompt` carries no correlation id)
- **WHEN** `until(sessionId, "idle")` is called
- **THEN** the client SHALL resolve **structurally** when the subscription stream
  reports that session transitioning to `idle`, keyed by session id so concurrent
  sessions do not cross

#### Scenario: Uncorrelated request verbs are not exact-awaited

- **GIVEN** `request_models` / `request_providers` / `request_roles` carry no
  `requestId` and broadcast their `*_list` reply to all subscribers
- **WHEN** a caller needs those results
- **THEN** the client SHALL NOT claim an exact `requestId` round-trip for them; it
  SHALL read the broadcast by structural match or defer to the REST twin

#### Scenario: Await honours a timeout

- **WHEN** an `await`/`until` is given a timeout and the matching event does not
  arrive within it
- **THEN** the client SHALL reject with a timeout error identifying the awaited
  pattern

### Requirement: Plugin-action passthrough (goal-plugin today)

The client SHALL expose a `plugin(pluginId, action, payload)` primitive that emits
a `plugin_action` message. As-built only `goal-plugin` registers a working
`plugin_action` handler; the client SHALL support it and SHALL surface a clear
error for pluginIds with no server-side handler until the follow-up change
(`fix-plugin-action-fanout-and-handlers`) universalizes the seam.

#### Scenario: Plugin action reaches the working goal handler

- **WHEN** `plugin("goal", "set-subgoal", { text })` is called
- **THEN** the client SHALL send `{type:"plugin_action", pluginId:"goal",
  action:"set-subgoal", payload:{ text }}` and the server-side goal plugin handler
  SHALL receive it

#### Scenario: Unhandled plugin id errors clearly

- **GIVEN** `flows`/`kb`/`automation` have no working `plugin_action` handler yet
- **WHEN** `plugin("flows", …)` is called
- **THEN** the client SHALL surface an explicit "no handler for pluginId" error
  rather than silently dropping the message

### Requirement: Reads are bus-consistent

Session/state reads SHALL be served from the subscription snapshot and deltas —
the same stream the awaits watch — so a script never races a stale REST read.

#### Scenario: Session list reflects live state

- **GIVEN** a connected, subscribed client
- **WHEN** `read.sessions()` is called after a session transitions state
- **THEN** the returned list SHALL reflect the transition already observed on the
  subscription stream, with no separate REST fetch required

#### Scenario: Reads are metadata-only

- **GIVEN** the `sessions_snapshot` carries registry metadata + status, not chat
  history or the agent's last response
- **WHEN** a caller uses `read.session(id)`
- **THEN** the client SHALL return session metadata + status only, and SHALL NOT
  claim to return chat/last-response (that requires the `event` stream, a follow-up)
