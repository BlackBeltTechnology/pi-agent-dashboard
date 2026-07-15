# Chat display preferences

## Purpose

Global + per-session preferences gating which chat-view elements render
(token stats bar, context usage bar, reasoning blocks, tool calls, tool
result bodies, turn metadata, debug events). Replaces the legacy
`show-debug-tools` localStorage flag with a server-managed, multi-axis
opt-out so non-technical users can hide noise without learning what
"thinking" or "tool result" means first. `ask_user` is non-hidable.

See change: configurable-chat-display.
## Requirements
### Requirement: Global display preferences SHALL gate chat-view elements
The dashboard MUST persist a `DisplayPrefs` object in `preferences.json` controlling which chat-view elements render. The schema SHALL include boolean flags for `tokenStatsBar`, `contextUsageBar`, `reasoning`, `toolResults`, `turnMetadata`, `debugTools`, plus a `toolCalls` sub-object with booleans `read`, `bash`, `edit`, `agent`, `generic`. The schema SHALL also include a numeric `reasoningAutoCollapseMs` controlling how long a live-streamed reasoning block stays expanded after it completes before auto-collapsing.

`reasoningAutoCollapseMs` SHALL default to `30000` (30 seconds). A value of `0` SHALL mean "never auto-collapse" — a live-streamed reasoning block stays expanded until the user collapses it. The value SHALL only affect live-streamed reasoning blocks; replayed blocks are unaffected.

#### Scenario: Reasoning hidden when disabled
- **GIVEN** global `displayPrefs.reasoning = false`
- **WHEN** the chat view renders a turn containing reasoning content
- **THEN** no reasoning block SHALL render
- **AND** `reasoningAutoCollapseMs` SHALL have no effect

#### Scenario: Default auto-collapse delay
- **GIVEN** a `DisplayPrefs` object with no explicit `reasoningAutoCollapseMs`
- **WHEN** it is loaded or merged from a preset
- **THEN** the effective value SHALL be `30000`

#### Scenario: Legacy preferences file is backfilled
- **GIVEN** a persisted `preferences.json` whose `displayPrefs` predates the field and has no `reasoningAutoCollapseMs`
- **WHEN** the preferences store loads it
- **THEN** `reasoningAutoCollapseMs` SHALL be set to `30000` before it reaches any client
- **AND** the client SHALL never observe `reasoningAutoCollapseMs` as `undefined`

#### Scenario: Partial PATCH preserves the field
- **GIVEN** a stored `reasoningAutoCollapseMs` value
- **WHEN** a `PATCH /api/preferences/display` updates a different display field and omits `reasoningAutoCollapseMs`
- **THEN** the stored and broadcast `reasoningAutoCollapseMs` SHALL retain its prior value
- **AND** SHALL NOT be reset to `undefined`

### Requirement: Per-session overrides SHALL deep-merge over global prefs
Per-session `displayPrefsOverride` SHALL deep-merge over the global `DisplayPrefs` via `mergeDisplayPrefs`. Scalar and numeric fields present in the override SHALL win over the global value; absent fields SHALL fall through to global. `reasoningAutoCollapseMs` SHALL follow the same rule, and an override value of `0` SHALL be preserved (not coerced to the default).

#### Scenario: Boolean override wins
- **GIVEN** global `displayPrefs.reasoning = true`, `tokenStatsBar = true`
- **AND** session override `{ reasoning: false }`
- **WHEN** effective prefs are computed
- **THEN** the result has `reasoning: false` and `tokenStatsBar: true`

#### Scenario: Numeric override precedence
- **GIVEN** global `reasoningAutoCollapseMs = 30000`
- **AND** session override `{ reasoningAutoCollapseMs: 0 }`
- **WHEN** effective prefs are computed
- **THEN** the result has `reasoningAutoCollapseMs: 0`

### Requirement: Display prefs SHALL be controllable via REST and broadcast over WS

The server SHALL expose:

- `GET /api/preferences/display` returning the current `DisplayPrefs` or HTTP 200 with `displayPrefs: undefined` when never seeded.
- `PATCH /api/preferences/display` accepting `Partial<DisplayPrefs>` and deep-merging into the stored prefs (toolCalls merged field-by-field).

On any successful PATCH, the server MUST broadcast `display_prefs_updated { prefs: DisplayPrefs }` to every connected browser socket. Connected clients MUST update their local store on receipt without page reload.

The server MUST ALSO send a `display_prefs_updated { prefs }` snapshot to each browser socket on connect (within the `wss.on("connection")` handshake, alongside the `pinned_dirs_updated` / `favorite_models_updated` / `workspaces_updated` snapshots), **only when the stored prefs are defined**. This gives display-prefs the same reconnect self-healing as every sibling preference: a client that missed a live broadcast (socket not `OPEN` at broadcast time — the broadcast fan-out skips non-`OPEN` sockets and never replays) recovers the current prefs on its next connect without a full page reload. When prefs are undefined (seedless install), the server MUST NOT send the connect snapshot, so a genuine first launch still opens the first-launch modal exactly once.

A browser-to-server WS message `setSessionDisplayPrefs { sessionId, override }` SHALL update the per-session override. `override: null` clears it.

The server SHALL broadcast `session_updated` with `updates.displayPrefsOverride: null` (not `undefined`) so the field survives JSON serialization. The client's `getSessionOverride` SHALL normalize `null` to `undefined` before returning to consumers.

#### Scenario: PATCH broadcasts to other tabs
- **GIVEN** two browser tabs A and B connected to the same server
- **WHEN** tab A PATCHes `{ debugTools: true }`
- **THEN** tab B receives `display_prefs_updated` and its store reflects `debugTools: true` without reload

#### Scenario: Connect snapshot re-delivers seeded prefs on reconnect
- **GIVEN** stored prefs are defined AND a browser missed a `display_prefs_updated` broadcast because its socket was not `OPEN`
- **WHEN** the browser reconnects and completes the WS handshake
- **THEN** the server SHALL send `display_prefs_updated { prefs }` as part of the connect snapshot
- **AND** the client's local store SHALL reflect the current prefs without a page reload

#### Scenario: Seedless install sends no connect snapshot
- **GIVEN** the stored prefs are `undefined` (fresh install, never seeded)
- **WHEN** a browser connects and completes the WS handshake
- **THEN** the server SHALL NOT send a `display_prefs_updated` snapshot
- **AND** the client's mount `GET /api/preferences/display` SHALL return `undefined` and open the first-launch modal exactly once

#### Scenario: Clearing override broadcasts null, not empty
- **GIVEN** a session with an active override
- **WHEN** a browser sends `setSessionDisplayPrefs { sessionId, override: null }`
- **THEN** the broadcast `session_updated` carries `updates.displayPrefsOverride: null`
- **AND** `JSON.stringify` does not drop the field
- **AND** all connected browsers apply the clear

#### Scenario: PATCH deep-merges toolCalls
- **GIVEN** stored `toolCalls = { read:true, bash:true, edit:true, agent:true, generic:true }`
- **WHEN** a PATCH body of `{ toolCalls: { bash: false } }` is applied
- **THEN** stored `toolCalls.bash = false` and every other `toolCalls.*` field is unchanged

### Requirement: First-launch SHALL prompt the user to choose a preset

When the client receives a `GET /api/preferences/display` response that is **successful (HTTP 200) AND indicates prefs have never been seeded** (`displayPrefs === undefined`), it MUST display a one-shot modal offering three presets: `simple`, `standard`, `everything`. A failed or denied GET (non-2xx, e.g. HTTP 403 `network_not_allowed`, or a network error) MUST NOT open the first-launch modal — a transport/authorization failure SHALL NOT be treated as a fresh install.

On submit, the client SHALL PATCH the chosen preset. On dismiss (Esc or backdrop), the client SHALL PATCH the `standard` preset. Either action MUST close the modal **immediately and locally on every outcome path**, independent of any `display_prefs_updated` WS broadcast AND independent of whether the PATCH succeeds: the client SHALL set its local `displayPrefs` to the chosen preset (`DISPLAY_PRESETS[key]`), optionally refined by the PATCH response body `{ displayPrefs }` when it is readable, and SHALL run its close callback on success, on a non-2xx response, and on a thrown/rejected fetch alike. The modal's dismissal MUST NOT depend on a server-to-client round-trip completing, and a failed PATCH MUST NOT strand the modal open.

#### Scenario: Undefined prefs trigger modal only on a successful GET
- **GIVEN** a fresh install with no `displayPrefs` in `preferences.json`
- **WHEN** the client loads and `GET /api/preferences/display` returns HTTP 200 with `displayPrefs: undefined`
- **THEN** the first-launch modal mounts

#### Scenario: Failed GET does not open the modal
- **GIVEN** the mount `GET /api/preferences/display` returns a non-2xx response (e.g. 403) or fails at the transport layer
- **WHEN** the client finishes its load sequence
- **THEN** the first-launch modal SHALL NOT mount
- **AND** the client SHALL NOT treat the failure as a seedless first launch

#### Scenario: Continue closes the modal without any broadcast
- **GIVEN** the first-launch modal is open AND the browser WebSocket is not `OPEN` (mid-reconnect or suspended)
- **WHEN** the user selects a preset and clicks Continue and the PATCH returns HTTP 200
- **THEN** the client SHALL set local `displayPrefs` (to the preset, refined by the response body) and the modal SHALL close
- **AND** the close SHALL NOT wait for a `display_prefs_updated` broadcast

#### Scenario: Failed PATCH still closes the modal
- **GIVEN** the first-launch modal is open
- **WHEN** the user clicks Continue or Skip and the `PATCH /api/preferences/display` fails (non-2xx or network error)
- **THEN** the client SHALL still set local `displayPrefs` to the chosen preset and the modal SHALL close
- **AND** the modal SHALL NOT remain open waiting on a retry or a broadcast

#### Scenario: Dismiss defaults to standard and closes locally
- **GIVEN** the first-launch modal is open
- **WHEN** the user presses Esc
- **THEN** the client PATCHes `DISPLAY_PRESETS.standard`, sets local `displayPrefs` from the response (or the `standard` preset on fallback), and the modal closes permanently
- **AND** the close SHALL NOT depend on the WS broadcast

#### Scenario: Already-seeded prefs suppress modal
- **GIVEN** `preferences.json` already contains a `displayPrefs` object
- **WHEN** the client loads
- **THEN** the first-launch modal does NOT mount

#### Scenario: Modal renders on both mobile and desktop layouts
- **GIVEN** a genuinely seedless first launch (200 GET with `displayPrefs: undefined`)
- **WHEN** the client renders the desktop side-by-side layout OR the mobile layout
- **THEN** the first-launch modal SHALL mount in either layout
- **AND** the modal SHALL NOT be gated on viewport / `isMobile` — the seedless condition alone determines whether it opens

### Requirement: Legacy localStorage debug toggle SHALL migrate once

On first client hydration after upgrade, if `localStorage["show-debug-tools"]` exists, the client MUST PATCH `{ debugTools: <localStorage value as boolean> }` and remove the localStorage key. The migration MUST be idempotent — after the key is absent, no further action.

#### Scenario: Legacy true value migrates
- **GIVEN** `localStorage["show-debug-tools"] === "true"` and `displayPrefs.debugTools === false`
- **WHEN** the client hydrates
- **THEN** the client PATCHes `{ debugTools: true }`, removes the localStorage key, and subsequent loads do not re-PATCH

### Requirement: Display-preferences menu SHALL mount in the composer status bar

The per-session display-preferences popover (the "⚙ View" `ChatViewMenu`) SHALL render inside the composer `StatusBar` (the model-selector row, `data-testid="status-bar"`), positioned in the bar's `leading` cluster immediately after the refresh button and before the `ModelSelector`. It SHALL NOT render in a standalone full-width toolbar row inside `ChatView`.

The popover's behavior — editing the session's `displayPrefsOverride`, the "Use global settings" reset, and the "modified" indicator — SHALL be unchanged; only its mount location moves. The menu SHALL remain gated on an active selected session (it renders only when a session is selected).

#### Scenario: View menu renders in the status bar

- **GIVEN** a selected session
- **WHEN** the chat panel renders
- **THEN** the `⚙ View` `ChatViewMenu` SHALL appear within the `status-bar` element, after the refresh button and before the model selector
- **AND** no standalone display-prefs toolbar row SHALL render at the top of `ChatView`

#### Scenario: View menu absent when no session selected

- **GIVEN** no session is selected
- **WHEN** the shell renders the landing/content area
- **THEN** the `⚙ View` menu SHALL NOT render

#### Scenario: Toggling prefs from the status bar still works

- **GIVEN** the `⚙ View` menu mounted in the status bar for a session
- **WHEN** the user toggles a display-preference axis in the popover
- **THEN** the client SHALL send `setSessionDisplayPrefs { sessionId, override }` exactly as before the relocation
- **AND** the chat view SHALL reflect the changed preference

### Requirement: Per-session override popover SHALL auto-flip direction

The `⚙ View` popover (`ChatViewMenu`) SHALL stay fully within the viewport by
delegating its open-direction and height decision to the shared
`usePopoverFlip` hook (see capability `popover-viewport-positioning`).

The default direction SHALL be downward (below the button). The popover SHALL
render above the button when it would otherwise extend past the viewport bottom,
and SHALL clamp its height with internal scroll so every row — including the
trailing "Use global settings" action and the tool-call toggles — is reachable.

The direction SHALL be recomputed on each open and on viewport resize while open.

#### Scenario: Popover opens downward by default
- **GIVEN** the `⚙ View` button is in the upper half of the viewport
- **WHEN** the user clicks the button
- **THEN** the popover renders below the button

#### Scenario: Popover flips upward near viewport bottom
- **GIVEN** the `⚙ View` button is within 200px of the viewport bottom
- **WHEN** the user clicks the button
- **THEN** the popover renders above the button instead of below
- **AND** every row including "Use global settings" is on-screen and reachable

#### Scenario: Flip re-evaluates on viewport resize
- **GIVEN** the popover is open and positioned downward
- **WHEN** the viewport is resized so the popover would extend past the bottom
- **THEN** the popover re-positions itself upward within the same open session

### Requirement: Per-session View popover retains instant apply; Settings panel defers

The per-session display-preferences popover (the "⚙ View" `ChatViewMenu`) SHALL continue to apply changes instantly via `setSessionDisplayPrefs` on each toggle. The Settings-panel global display-preferences section SHALL NOT apply on each toggle; it SHALL buffer into the Settings draft and persist via the unified Save (see `settings-panel`). The `PATCH /api/preferences/display` endpoint and its `display_prefs_updated` WS broadcast SHALL remain unchanged; only the Settings-panel call timing moves from on-change to on-save.

#### Scenario: View popover still applies instantly
- **GIVEN** a selected session and the ⚙ View popover open
- **WHEN** the user toggles a display-preference axis in the popover
- **THEN** the client SHALL send `setSessionDisplayPrefs { sessionId, override }` immediately
- **AND** the chat view SHALL reflect the change without a separate save step

#### Scenario: Settings-panel display section does not autosave
- **WHEN** the user toggles a global display-preference axis in the Settings panel
- **THEN** no `PATCH /api/preferences/display` SHALL be sent until the user saves
- **AND** the global prefs SHALL persist via the unified Save fan-out

### Requirement: Reserve-process-line-at-idle display preference
`DisplayPrefs` SHALL include a boolean field `reserveProcessLineAtIdle` that controls whether a session card's PROCESS region keeps one line of reserved height while the session is idle. It SHALL be part of all three presets and of the sparse merge, exactly like other top-level `DisplayPrefs` booleans.

#### Scenario: Field present in every preset
- **GIVEN** the `DISPLAY_PRESETS` map
- **WHEN** any preset is read
- **THEN** it SHALL define `reserveProcessLineAtIdle` as a boolean
- **AND** `simple` and `standard` SHALL default it to `false`
- **AND** `everything` SHALL default it to `true`

#### Scenario: Per-session override wins over global
- **GIVEN** global prefs with `reserveProcessLineAtIdle: false`
- **AND** a per-session override with `reserveProcessLineAtIdle: true`
- **WHEN** `mergeDisplayPrefs(global, override)` is evaluated
- **THEN** the effective value SHALL be `true`

#### Scenario: Absent override falls back to global
- **GIVEN** global prefs with `reserveProcessLineAtIdle: true`
- **AND** a per-session override that omits `reserveProcessLineAtIdle`
- **WHEN** `mergeDisplayPrefs(global, override)` is evaluated
- **THEN** the effective value SHALL be `true`

#### Scenario: Configurable from the settings surfaces
- **GIVEN** the global Settings panel
- **WHEN** the user toggles "Reserve process line at idle"
- **THEN** the global `reserveProcessLineAtIdle` SHALL be patched
- **AND** the per-session chat-view menu SHALL expose the same control as an override, marked when it differs from global

