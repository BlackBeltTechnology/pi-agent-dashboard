# session-card-status Specification

## Purpose
Defines the visual state machine of a session card's body decoration. The card answers, at a glance, three independent questions: *is the agent working right now?*, *is the agent waiting on the user for input?*, and *did the agent do something attention-worthy while the user was looking elsewhere?* Each question maps to a CSS class with explicit precedence rules so the three signals never visually fight each other.

## Requirements

### Requirement: Streaming/resuming cards show horizontally drifting diagonal stripes layered with a breathing pulse

Session cards in `streaming` or `resuming` state (carrying the `card-working-pulse` CSS class) SHALL display two simultaneous, independent visual effects:

1. A **45° barber-pole stripe pattern** in low-alpha amber, drifting **purely horizontally** by translating `background-position` linearly along the X axis only. (Translation along the (1,1) diagonal is along the stripe direction itself — pattern-invariant — so it produces zero perceived motion. Horizontal scrolling cuts across the stripes for visible drift.)
2. A **breathing pulse** in which the overall element opacity oscillates smoothly, preserving the "alive" feel of the previous animation.

The stripe `background-size` SHALL be set to exactly one diagonal pattern period (`28.2843px × 28.2843px`, i.e. `20√2`) so tiles repeat seamlessly without visible seams. The animation SHALL translate by an integer number of full periods (e.g. `113.1371px = 4 × 20√2`) for a perfectly seamless loop. The two animations MAY run at the same period (3s/3s) or different periods; tuning is implementation-level.

The combined intensity SHALL remain ambient (low alpha, low contrast) so that streaming cards are clearly distinguishable from idle cards without being visually loud.

The CSS class name SHALL remain `card-working-pulse` so existing component logic and tests continue to apply it on `status === "streaming"` or `resuming === true`.

**Precedence**: `card-working-pulse` SHALL take priority over `card-unread-pulse`. A session that is both streaming AND has `unread: true` SHALL render only the yellow streaming pulse; the unread bit remains set in state but is not visualized while streaming, and re-emerges as cyan stripes when the session transitions back to a quiescent state if still unviewed.

**Idle interaction**: an idle session card SHALL have no pulse class **only when** `unread === false`. An idle session card with `unread === true` SHALL have the `card-unread-pulse` class per the Unread requirements below.

#### Scenario: Streaming session card has stripes and pulse
- **WHEN** a session enters `streaming` status
- **THEN** the rendered card element has the `card-working-pulse` class
- **AND** the computed background includes a repeating linear gradient at 45°
- **AND** an animation translates `background-position` along the X axis (horizontal drift only)
- **AND** an animation oscillates the element opacity

#### Scenario: Stripe tile size matches the diagonal pattern period
- **WHEN** the streaming card renders
- **THEN** `background-size` equals one full diagonal period (`20√2 px ≈ 28.2843px`) in both x and y
- **AND** the animation end position is an integer multiple of that period along the scroll axis (so the loop is seamless)

#### Scenario: Resuming session card uses the same animation
- **WHEN** a session is in `resuming` state
- **THEN** the card has the `card-working-pulse` class with the same combined stripe + pulse animation

#### Scenario: Streaming wins over unread
- **GIVEN** a session is `streaming` and was previously marked `unread: true`
- **WHEN** the card renders
- **THEN** the card element SHALL have the `card-working-pulse` class
- **AND** SHALL NOT have the `card-unread-pulse` class

#### Scenario: Streaming-then-idle with no view restores cyan stripes
- **GIVEN** a streaming-and-unread session
- **WHEN** the agent finishes its turn (status transitions to idle) while no browser is viewing it
- **THEN** the card SHALL have `card-unread-pulse`
- **AND** SHALL NOT have `card-working-pulse`

#### Scenario: Idle and read
- **WHEN** a session is `idle` with `unread: false` and no `currentTool` is set
- **THEN** the card SHALL have neither `card-working-pulse`, `card-input-pulse`, nor `card-unread-pulse`

#### Scenario: Idle and unread
- **WHEN** a session is `idle` with `unread: true` and no `currentTool` is set
- **THEN** the card SHALL have `card-unread-pulse`

### Requirement: Reduced-motion users get a static visual indicator
When the user's environment reports `prefers-reduced-motion: reduce`, the streaming/resuming card SHALL retain a clearly visible static striped + tinted background but SHALL NOT animate stripe drift or opacity pulsing.

#### Scenario: Reduced motion disables animations but preserves the state cue
- **WHEN** the user has `prefers-reduced-motion: reduce` set
- **AND** a session card has the `card-working-pulse` class
- **THEN** no animations run on the element
- **AND** the static repeating diagonal stripe background is still rendered so the streaming state remains visually distinct from idle

### Requirement: ask_user (input-pending) cards remain pulse-only
The existing `card-input-pulse` class used for sessions awaiting user input via `ask_user` SHALL continue to use only the breathing-pulse animation in purple, with NO diagonal stripes. This contrast SHALL be preserved so that "machine working" (stripes + pulse) is visually distinct from "machine waiting on you" (pulse only).

#### Scenario: ask_user card uses pulse only
- **WHEN** a session is awaiting user input via `ask_user`
- **THEN** the card has the `card-input-pulse` class
- **AND** the rendered background does NOT include a repeating linear gradient
- **AND** only an opacity / background-color pulse animation is applied

### Requirement: DashboardSession tracks per-session unread state

The `DashboardSession` type SHALL include an optional field `unread: boolean` representing whether the session has unviewed activity since it was last opened by a user. The field is server-managed; bridges SHALL NOT send it.

#### Scenario: New session has no unread state

- **WHEN** a new session is registered for the first time
- **THEN** `session.unread` SHALL be `false` or `undefined` (treated equivalently)

#### Scenario: Unread persists to per-session metadata

- **WHEN** the server writes a session's `.meta.json`
- **THEN** the file SHALL include the `unread` field if it is currently `true`
- **AND** the value SHALL be readable on subsequent server starts

### Requirement: Server marks a session unread on attention-worthy events when not viewed

The server SHALL set `session.unread = true` when ANY of the following triggers fire AND no connected browser is currently viewing the session AND the event is not part of a replay:

1. Session status transitions from `streaming` to `idle` or from `streaming` to `active` (turn finished).
2. Session's `currentTool` becomes `"ask_user"` (input requested).
3. An `agent_end` event is received with a payload indicating an error.

Any other event (assistant `message_end`, tool execution start/end, model select, git updates, process metrics, heartbeats) SHALL NOT set unread.

#### Scenario: Turn finishes while no browser views the session

- **GIVEN** session "abc" is streaming and no browser has it open
- **WHEN** the agent's turn ends and the session transitions to idle
- **THEN** `session.unread` SHALL be `true`
- **AND** a `session_updated` broadcast SHALL be sent including the new value

#### Scenario: Turn finishes while a browser views the session

- **GIVEN** session "abc" is streaming and at least one browser has sent `session_view` for it
- **WHEN** the agent's turn ends
- **THEN** `session.unread` SHALL remain `false`

#### Scenario: ask_user appears while unviewed

- **GIVEN** session "abc" is alive and no browser has it open
- **WHEN** an `ask_user` tool execution begins
- **THEN** `session.unread` SHALL be `true`

#### Scenario: Replay events do not trigger unread

- **GIVEN** the server is replaying historical events for session "abc" on cold start
- **WHEN** a streaming→idle transition appears in the replay stream
- **THEN** `session.unread` SHALL NOT be modified by that transition

#### Scenario: Non-trigger events leave unread untouched

- **WHEN** an assistant `message_end` event fires for an unviewed session
- **THEN** `session.unread` SHALL NOT change

### Requirement: Browser declares which session it is viewing

Browsers SHALL inform the server which session is currently displayed via two new WebSocket messages added to the `BrowserToServerMessage` union:

- `{ type: "session_view", sessionId: string }` — sent when a browser begins displaying a session's chat panel (typically when navigating to `/session/:id`).
- `{ type: "session_unview", sessionId: string }` — sent when the same browser stops displaying it (typically navigating away).

A browser SHALL re-send `session_view` for its currently-displayed session whenever its WebSocket connection is established or re-established, so server-side viewed-state remains coherent across reconnects.

#### Scenario: Browser opens a session

- **WHEN** a browser navigates to `/session/abc`
- **THEN** the browser SHALL send `{ type: "session_view", sessionId: "abc" }`

#### Scenario: Browser navigates between sessions

- **GIVEN** a browser is currently viewing session "abc"
- **WHEN** the user navigates to `/session/xyz`
- **THEN** the browser SHALL send `{ type: "session_unview", sessionId: "abc" }` followed by `{ type: "session_view", sessionId: "xyz" }`

#### Scenario: Browser reconnects

- **GIVEN** a browser is currently displaying session "abc" and its WebSocket has just been established or re-established
- **WHEN** subscription is complete
- **THEN** the browser SHALL send `{ type: "session_view", sessionId: "abc" }` so the server learns of the active view

### Requirement: Server tracks viewed sessions globally across browsers

The server SHALL maintain a viewed-session registry keyed by `sessionId`, where each entry records the set of WebSocket connections currently viewing that session. A session is considered "viewed" iff at least one connection's set membership is non-empty.

When a WebSocket connection closes for any reason, the server SHALL remove that connection from every entry in the registry.

#### Scenario: Two browsers view the same session

- **WHEN** two browsers both send `session_view` for "abc"
- **THEN** the server SHALL count "abc" as viewed
- **AND** the registry's set for "abc" SHALL contain both connections

#### Scenario: One viewing browser disconnects

- **GIVEN** two browsers are viewing "abc"
- **WHEN** one browser's WebSocket closes
- **THEN** the registry's set for "abc" SHALL still contain the remaining connection
- **AND** "abc" SHALL still count as viewed

#### Scenario: Last viewing browser disconnects

- **GIVEN** one browser is viewing "abc"
- **WHEN** that browser's WebSocket closes
- **THEN** the registry's set for "abc" SHALL be empty
- **AND** the next applicable trigger event for "abc" SHALL set `session.unread = true`

### Requirement: session_view clears unread

When the server receives `session_view` for a session whose current `unread` is `true`, the server SHALL set `session.unread = false` and broadcast `session_updated` to all subscribed browsers.

#### Scenario: Opening an unread session clears the indicator everywhere

- **GIVEN** session "abc" has `unread: true`
- **AND** browsers B1 and B2 are subscribed to session updates
- **WHEN** browser B2 sends `session_view` for "abc"
- **THEN** the server SHALL set `unread = false`
- **AND** both B1 and B2 SHALL receive a `session_updated` broadcast reflecting the cleared value

#### Scenario: Opening an already-read session is a no-op

- **GIVEN** session "abc" has `unread: false`
- **WHEN** a browser sends `session_view` for "abc"
- **THEN** the server SHALL NOT broadcast a redundant `session_updated`

### Requirement: Unread sessions display the cyan-stripes pulse

A session card whose backing `DashboardSession.unread === true` SHALL display the `card-unread-pulse` CSS class **unless** a higher-priority pulse class applies. Higher-priority classes are `card-input-pulse` (for `currentTool === "ask_user"`) and `card-working-pulse` (for `status === "streaming"` or `resuming === true`).

The `card-unread-pulse` class SHALL render the same diagonal scrolling stripes geometry and animation timing as `card-working-pulse`, but with cool cyan colors (instead of amber). Specifically:

- the `repeating-linear-gradient` stripe color SHALL be a low-alpha cyan (approximately `rgba(34, 211, 238, 0.18)`, Tailwind `cyan-400`)
- the flat tint underlay SHALL be a low-alpha cyan (approximately `rgba(34, 211, 238, 0.07)`)
- the keyframes (`card-working-stripes-scroll` for horizontal drift, `card-working-opacity-pulse` for breathing) SHALL be reused as-is.

Cyan was selected because it owns its own corner of the dashboard palette (distant from yellow streaming, purple ask_user, green alive-dot, and red error semantics) and reads as "calm attention" rather than "alarm".

#### Scenario: Unread alive session shows cyan stripes

- **GIVEN** a session with `status: "idle"`, `currentTool: undefined`, `unread: true`
- **WHEN** the card renders
- **THEN** the card element SHALL have the `card-unread-pulse` class
- **AND** SHALL NOT have `card-working-pulse` or `card-input-pulse`

#### Scenario: Streaming-and-unread session prefers yellow over cyan

- **GIVEN** a session with `status: "streaming"`, `unread: true`
- **WHEN** the card renders
- **THEN** the card element SHALL have the `card-working-pulse` class
- **AND** SHALL NOT have the `card-unread-pulse` class

#### Scenario: ask_user-and-unread session prefers purple over cyan

- **GIVEN** a session with `currentTool: "ask_user"`, `unread: true`
- **WHEN** the card renders
- **THEN** the card element SHALL have the `card-input-pulse` class
- **AND** SHALL NOT have the `card-unread-pulse` class

#### Scenario: Read alive session has no pulse class

- **GIVEN** a session with `status: "idle"`, `currentTool: undefined`, `unread: false`
- **WHEN** the card renders
- **THEN** the card element SHALL have neither `card-unread-pulse`, `card-working-pulse`, nor `card-input-pulse`

#### Scenario: Ended-and-unread session still shows cyan stripes

- **GIVEN** a session with `status: "ended"`, `unread: true` (e.g. agent finished while server was offline)
- **WHEN** the card renders
- **THEN** the card element SHALL have the `card-unread-pulse` class

### Requirement: Reduced-motion users get a static unread indicator

When the user's environment reports `prefers-reduced-motion: reduce`, the `card-unread-pulse` class SHALL retain a clearly visible static cyan-tinted striped background but SHALL NOT animate stripe drift or opacity pulsing. This mirrors the existing rule for `card-working-pulse`.

#### Scenario: Reduced motion disables animation but preserves the cue

- **GIVEN** the user has `prefers-reduced-motion: reduce` set
- **AND** a session card has the `card-unread-pulse` class
- **THEN** no animations SHALL run on the element
- **AND** the static repeating cyan diagonal stripe background SHALL still render
