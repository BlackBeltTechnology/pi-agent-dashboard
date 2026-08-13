# session-card-status Specification

## Purpose
Defines the visual state machine of a session card's body decoration. The card answers, at a glance, three independent questions: *is the agent working right now?*, *is the agent waiting on the user for input?*, and *did the agent do something attention-worthy while the user was looking elsewhere?* Each question maps to a CSS class with explicit precedence rules so the three signals never visually fight each other.
## Requirements
### Requirement: Reduced-motion users get a static visual indicator

When the user's environment reports `prefers-reduced-motion: reduce`, the streaming/resuming card SHALL retain a clearly visible static amber-tinted background but SHALL NOT animate the sweep translation or any opacity pulsing.

#### Scenario: Reduced motion disables sweep but preserves the cue

- **GIVEN** the user has `prefers-reduced-motion: reduce` set
- **AND** a session card has the `card-working-pulse` class
- **THEN** no animations run on the element
- **AND** a static amber-tinted background still renders so the streaming state remains visually distinct from idle

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

### Requirement: Reduced-motion users get a static unread indicator

When the user's environment reports `prefers-reduced-motion: reduce`, the `card-unread-pulse` overlay SHALL retain a clearly visible static cyan-tinted background but SHALL NOT animate the sweep translation. This mirrors the rule for `card-working-pulse`.

#### Scenario: Reduced motion disables sweep but preserves the cue

- **GIVEN** the user has `prefers-reduced-motion: reduce` set
- **AND** a session card has the `card-unread-pulse` class
- **THEN** no animations SHALL run on the element
- **AND** a static cyan-tinted background SHALL still render

### Requirement: Session card left gutter SHALL render a status-tinted capsule rail with an icon chip

The session card's left gutter (a 20 px-wide column that hosts the source icon and doubles as the drag handle) SHALL render a **status-tinted vertical capsule rail** centered in the gutter, with the source icon presented in a **circular chip** sitting above the rail at its top.

The rail SHALL be 6 px wide (`w-1.5`), centred horizontally (`left-1/2 -translate-x-1/2`), inset bottom (`bottom-2`), and offset from the top (`top-7`) so it begins below the icon chip with a small visual gap. Both ends SHALL be `rounded-full` so the bar reads as a capsule. It SHALL use a single Tailwind alpha-modified background-color class and SHALL NOT animate, gradient, or use any mask/pattern. Its colour SHALL match the card's status, mirroring the precedence rules of `deriveDotColorWithFlags` (resuming > hasError > isRetrying > status) so the status dot, source icon tint, and rail always agree.

The gutter container SHALL keep its drag-handle wiring (`dragHandleProps` spread when provided by `SortableSessionCard`), `cursor-grab` / `active:cursor-grabbing` cursor classes, and the `data-testid="drag-handle-session"` attribute. The rail bar is rendered as an absolutely-positioned `<span aria-hidden="true">` so it does not interfere with hit-testing.

The source icon SHALL be wrapped in a **circular chip** (`w-4 h-4 rounded-full bg-[var(--bg-tertiary)] shadow-sm z-10`) layered above the rail bar so the icon stays clearly distinguishable from the colored rail behind it. The chip's colour SHALL stay constant; the icon glyph inside it SHALL still carry the status palette colour from `deriveIconStatusColor`.

Existing body-level animations (`card-working-pulse`, `card-unread-pulse`) are unaffected and continue to render on the card body, layered above the rail.

#### Scenario: Status → rail color mapping
- **WHEN** a session card renders
- **THEN** the gutter background-color class is derived from a `deriveRailBgColor(session, flags, isSelected)` helper exported from `packages/client/src/lib/session-status-visuals.ts`
- **AND** `streaming` and `resuming` status, and the chat-panel `isRetrying` flag, SHALL all map to amber
- **AND** the chat-panel `hasError` flag SHALL map to red and SHALL take precedence over the underlying status
- **AND** `active` and `idle` status SHALL map to green
- **AND** `ended` status SHALL map to a muted surface token (`bg-[var(--bg-surface)]`) regardless of `isSelected`
- **AND** the precedence order SHALL match `deriveDotColorWithFlags` (resuming > hasError > isRetrying > status)

#### Scenario: Rail bar is a centered capsule
- **WHEN** the rail renders for a non-`ended` session
- **THEN** the rail bar element SHALL apply a Tailwind alpha-modified utility class of the form `bg-<palette>-500/40` (unselected) or `bg-<palette>-400/65` (selected)
- **AND** the rail bar element SHALL be 6 px wide (`w-1.5`), centred (`absolute left-1/2 -translate-x-1/2`), offset from the top (`top-7`) and inset from the bottom (`bottom-2`) so it starts below the icon chip
- **AND** the rail bar element SHALL be `rounded-full` so both ends form a capsule
- **AND** the rail bar SHALL NOT apply any `mask-image`, `clip-path`, gradient, or repeating background pattern

#### Scenario: Selected session card uses a brighter, more opaque rail tint
- **WHEN** a session card is the currently selected session (`isSelected === true`) and its status is not `ended`
- **THEN** the rail SHALL render with the `-400/65` palette (e.g. `bg-green-400/65` instead of `bg-green-500/40`, `bg-amber-400/65` instead of `bg-amber-500/40`)
- **AND** the existing card-level selection treatment (blue border, blue ring, blue background tint) SHALL remain unchanged

#### Scenario: Drag handle behavior preserved
- **WHEN** the rail is rendered on a card hosted inside `SortableSessionCard`
- **THEN** the gutter element SHALL still receive `dragHandleProps` (attributes + listeners) from `SortableSessionCard`
- **AND** the `data-testid="drag-handle-session"` attribute SHALL still be present
- **AND** the cursor SHALL still switch to `grab` on hover and `grabbing` while dragging

#### Scenario: Source icon sits in a circular chip above the rail bar
- **WHEN** the rail bar renders
- **THEN** the source icon SHALL be wrapped in a circular chip (`w-4 h-4 rounded-full bg-[var(--bg-tertiary)] shadow-sm`) layered above the rail bar via `z-10`
- **AND** the chip SHALL sit at the top of the gutter (preceding the rail bar in the flex flow)
- **AND** the icon glyph inside the chip SHALL carry the status palette text colour from `deriveIconStatusColor`

### Requirement: ask_user state has dedicated rail and dot color

The session card SHALL render the chat-routed `ask_user` (blocked-on-you) state with a dedicated `--status-needs-you` color in its left-gutter rail (`deriveRailBgColor`) and status dot (`deriveDotColorWithFlags`), NOT the `active`/`idle` (green) color, when the prompt is NOT widget-bar-placed (per `useHasWidgetBarPrompt`). The source-icon tint (`deriveIconStatusColor`) SHALL mirror it so dot, rail, and
icon agree — restoring the documented "dot, source-icon tint, and rail always
agree" invariant.

Color precedence across dot, rail, and icon-tint SHALL be, highest to lowest:
`hasError` → `ask_user` (chat-routed) → `resuming`/`isRetrying` →
`streaming`/`currentTool` → `active`/`idle` → `ended`.

#### Scenario: Chat-routed ask_user rail and dot are needs-you, not green

- **WHEN** `session.currentTool === "ask_user"`
- **AND** the pending prompt is NOT widget-bar-placed
- **THEN** `deriveRailBgColor` SHALL return the `--status-needs-you` rail color
- **AND** `deriveDotColorWithFlags` SHALL return the `--status-needs-you` dot color
- **AND** neither SHALL return the `active`/`idle` green color

#### Scenario: Widget-bar ask_user keeps prior behavior

- **WHEN** `session.currentTool === "ask_user"`
- **AND** the pending prompt IS widget-bar-placed
- **THEN** rail and dot SHALL fall through to the `streaming`/`active` color (unchanged)

#### Scenario: Error outranks ask_user

- **WHEN** a session is both `ask_user` and `hasError`
- **THEN** rail and dot SHALL use the `--status-error` color

### Requirement: Status color is sourced from semantic tokens

The status helpers in `session-status-visuals.ts` SHALL source color from the
semantic tokens `--status-needs-you`, `--status-working`, `--status-idle`, and
`--status-error` rather than hardcoded palette literals (`purple-400`,
`green-500`, `amber-500`, `red-500`). Each token SHALL be defined for all themes
in `themes.ts` (base, dracula, nord, github, catppuccin, tokyo-night, rose-pine,
solarized, gruvbox), derived from that theme's existing accent tokens.

#### Scenario: No hardcoded status literals in helpers

- **WHEN** static analysis inspects `session-status-visuals.ts`
- **THEN** dot/rail/icon color derivation SHALL reference `--status-*` tokens
- **AND** SHALL NOT emit raw `purple-400`/`green-500`/`amber-500`/`red-500` for status state

#### Scenario: Tokens defined per theme

- **WHEN** any theme is active
- **THEN** all four `--status-*` tokens SHALL resolve to a defined value

### Requirement: Status dot encodes state by shape, not color alone

The session-card status dot SHALL differentiate state by **shape** in addition
to color: needs-you = filled, working = pulsing/half, idle = ring/outline,
error = cross. The shape distinction SHALL be present even when
`prefers-reduced-motion: reduce` is set.

#### Scenario: Shape differs per state under reduced motion

- **WHEN** `prefers-reduced-motion: reduce` is set
- **AND** two cards are in `ask_user` and `idle` states respectively
- **THEN** their dots SHALL be visually distinguishable by shape (filled vs ring)
- **AND** the distinction SHALL NOT depend on color alone

### Requirement: Streaming/resuming cards show a horizontal sweep gradient layered with a breathing tint

Session cards in `streaming` or `resuming` state (carrying the `card-working-pulse` state class, painted via the `card-stripes-running` overlay) SHALL display an animated **horizontal sweep gradient** instead of diagonal barber-pole stripes:

1. A **soft, double-wide color band** in low-alpha amber that glides **purely horizontally** (left→right) across the card, over a faint flat amber tint underlay.
2. The band SHALL read as a calm sweep (the same feel as the pending sent-prompt shimmer), NOT as hard high-contrast edges crossing the text.

The loop SHALL be **seamless and fluid**: the overlay carries a *repeating* horizontal gradient (one soft band per period `P`) and is translated by exactly one period via `transform: translateX(0 → P)` at constant (`linear`) velocity. Because the gradient is periodic, position `0` and position `P` are identical, so the loop has no visible exit/re-entry or velocity snap. The animation SHALL be compositor-only (`transform`, no `background-position` repaint).

The state class name SHALL remain `card-working-pulse` (applied on `status === "streaming"` or `resuming === true`) and the overlay class `card-stripes-running`, so existing component logic and tests continue to apply them unchanged.

**Precedence**: unchanged — `card-working-pulse` takes priority over `card-unread-pulse`.

#### Scenario: Streaming session card sweeps amber

- **WHEN** a `streaming` session card renders
- **THEN** the rendered card element has the `card-working-pulse` class
- **AND** the overlay computes a horizontal (90°) amber gradient band over a flat amber tint
- **AND** an animation translates the overlay along the X axis by exactly one gradient period at constant velocity (seamless loop)

#### Scenario: Resuming session card uses the same sweep

- **WHEN** a `resuming` session card renders
- **THEN** the card has the `card-working-pulse` class with the same horizontal sweep gradient

### Requirement: Unread sessions display the cyan sweep gradient

A session card whose backing `DashboardSession.unread === true` SHALL display the `card-unread-pulse` state class (overlay `card-stripes-unread`) **unless** a higher-priority class applies (`card-input-stripes` for `ask_user`, `card-working-pulse` for streaming/resuming).

`card-stripes-unread` SHALL render the **same horizontal sweep gradient geometry, period, and timing** as `card-stripes-running`, but with cool cyan colors:

- the swept band color SHALL be a low-alpha cyan (approximately `rgba(34, 211, 238, 0.20)`, Tailwind `cyan-400`)
- the flat tint underlay SHALL be a low-alpha cyan (approximately `rgba(34, 211, 238, 0.05)`)
- the same `translateX`-one-period seamless keyframe SHALL be reused.

Cyan keeps its distinct corner of the palette (distant from amber streaming, purple ask_user, green alive-dot, red error) and reads as "calm attention".

#### Scenario: Unread alive session sweeps cyan

- **GIVEN** a session with `status: "idle"`, `currentTool: undefined`, `unread: true`
- **WHEN** the card renders
- **THEN** the card element SHALL have the `card-unread-pulse` class
- **AND** SHALL NOT have `card-working-pulse` or `card-input-stripes`
- **AND** the overlay computes a horizontal cyan sweep gradient

#### Scenario: Streaming-and-unread session prefers amber over cyan

- **GIVEN** a session with `status: "streaming"`, `unread: true`
- **WHEN** the card renders
- **THEN** the card element SHALL have the `card-working-pulse` class
- **AND** SHALL NOT have the `card-unread-pulse` class

### Requirement: Session card surfaces the in-flight retry attempt

A session card SHALL display the current retry attempt number while a retry is
in flight for that session, so a retrying session is distinguishable from one
that errored and gave up.

The indicator SHALL be rendered as a branch of the card's existing activity
indicator — the same slot that otherwise prints the resuming, needs-you,
current-tool, thinking or idle label — and SHALL NOT introduce a separate
affordance competing with it on the same row.

Within that chain, the retry branch SHALL rank below the needs-you branch and
above the current-tool, streaming and idle branches. A session in a retry
backoff is not executing a tool, so the current-tool and thinking labels SHALL
NOT be shown in preference to it.

The retry set SHALL include a session whenever `retryState` is set, regardless
of whether `lastError` is also set. A provider retry normally carries both, so
gating on the absence of `lastError` would exclude the common case.

The attempt number SHALL be delivered to the card as a number, not inferred from
a boolean.

#### Scenario: Retrying with an error surfaced
- **GIVEN** a session whose state has both `retryState` (attempt 3) and `lastError` set
- **THEN** the session SHALL be a member of the retry set
- **AND** its card's activity indicator SHALL read `Retry 3`

#### Scenario: Retrying with no error surfaced
- **GIVEN** a session whose state has `retryState` (attempt 2) and no `lastError`
- **THEN** its card's activity indicator SHALL read `Retry 2`

#### Scenario: Retry outranks the streaming label
- **GIVEN** a session with `status: "streaming"` and `retryState` set at attempt 2
- **THEN** the activity indicator SHALL read `Retry 2`
- **AND** SHALL NOT read the thinking label

#### Scenario: Retry outranks the current-tool label
- **GIVEN** a session with a `currentTool` set and `retryState` set at attempt 2
- **THEN** the activity indicator SHALL read `Retry 2`
- **AND** SHALL NOT read the tool name

#### Scenario: Needs-you outranks retry
- **GIVEN** a session awaiting input via `ask_user` with no widget-bar prompt
- **AND** `retryState` set at attempt 2
- **THEN** the activity indicator SHALL read the needs-you label

#### Scenario: Errored, not retrying
- **GIVEN** a session with `lastError` set and `retryState` undefined
- **THEN** the activity indicator SHALL NOT show any retry label
- **AND** it SHALL fall through to its existing branch for that session state

#### Scenario: Ended sessions show no retry label
- **GIVEN** a session with `status: "ended"`
- **THEN** the activity indicator SHALL render nothing, as it does today

#### Scenario: Retry label is additive — existing status channels are unchanged
- **GIVEN** a session with both `retryState` and `lastError` set
- **THEN** the card's status dot SHALL use the error color
- **AND** the status shape marker SHALL be the error shape
- **AND** the mosaic rail SHALL use the error tint
- **AND** the folder status capsule SHALL bucket the session as `error`

#### Scenario: Retry label meets the contrast floor
- **WHEN** the retry label is rendered in any supported theme in either light or dark mode
- **THEN** its foreground against the card surface SHALL clear a 3:1 contrast ratio
- **AND** its color SHALL derive from `--severity-warning-fg` rather than a raw status or palette token

#### Scenario: Retry label survives reduced motion and greyscale
- **GIVEN** the user has `prefers-reduced-motion: reduce` set
- **THEN** the retry label and its attempt number SHALL remain legible
- **AND** no animation SHALL run on it
- **AND** the attempt number SHALL be conveyed by text, not by color alone

