## MODIFIED Requirements

### Requirement: Display prefs SHALL be controllable via REST and broadcast over WS

The server SHALL expose:

- `GET /api/preferences/display` returning the current `DisplayPrefs` or HTTP 200 with `displayPrefs: undefined` when never seeded.
- `PATCH /api/preferences/display` accepting `Partial<DisplayPrefs>` and deep-merging into the stored prefs (toolCalls merged field-by-field).

On any successful PATCH, the server MUST broadcast `display_prefs_updated { prefs: DisplayPrefs }` to every connected browser socket. Connected clients MUST update their local store on receipt without page reload.

The server MUST ALSO send a `display_prefs_updated { prefs }` snapshot to each browser socket on connect (within the `wss.on("connection")` handshake, alongside the `pinned_dirs_updated` / `favorite_models_updated` / `workspaces_updated` snapshots), **only when the stored prefs are defined**. This gives display-prefs the same reconnect self-healing as every sibling preference: a client that missed a live broadcast (socket not `OPEN` at broadcast time — the broadcast fan-out skips non-`OPEN` sockets and never replays) recovers the current prefs on its next connect without a full page reload. When prefs are undefined (seedless install), the server MUST NOT send the connect snapshot, so a genuine first launch still opens the first-launch modal exactly once.

A browser-to-server WS message `setSessionDisplayPrefs { sessionId, override }` SHALL update the per-session override. `override: null` clears it.

The server SHALL broadcast `session_updated` with `updates.displayPrefsOverride: null` (not `undefined`) so the field survives JSON serialization. The client's `getSessionOverride` SHALL normalize `null` to `undefined` before returning to consumers, so a cleared session merges as pure global prefs and its "modified" indicator turns off without a page reload.

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

#### Scenario: Client normalizes cleared override to undefined
- **GIVEN** a session whose in-memory record carries `displayPrefsOverride: null` after applying a clearing `session_updated` broadcast
- **WHEN** a consumer reads the override via `getSessionOverride(sessionId)`
- **THEN** the returned value SHALL be `undefined`, not `null`
- **AND** `useDisplayPrefs` SHALL merge to pure global prefs (no override applied)
- **AND** the `ChatViewMenu` "modified" pill SHALL NOT render for that session

#### Scenario: PATCH deep-merges toolCalls
- **GIVEN** stored `toolCalls = { read:true, bash:true, edit:true, agent:true, generic:true }`
- **WHEN** a PATCH body of `{ toolCalls: { bash: false } }` is applied
- **THEN** stored `toolCalls.bash = false` and every other `toolCalls.*` field is unchanged
