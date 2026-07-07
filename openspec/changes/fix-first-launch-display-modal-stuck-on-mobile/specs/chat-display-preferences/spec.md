## MODIFIED Requirements

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

#### Scenario: PATCH deep-merges toolCalls
- **GIVEN** stored `toolCalls = { read:true, bash:true, edit:true, agent:true, generic:true }`
- **WHEN** a PATCH body of `{ toolCalls: { bash: false } }` is applied
- **THEN** stored `toolCalls.bash = false` and every other `toolCalls.*` field is unchanged
