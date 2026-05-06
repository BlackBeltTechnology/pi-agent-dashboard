## ADDED Requirements

### Requirement: Per-session push preferences data model

The server SHALL maintain per-session push preferences in memory via `Map<sessionId, PushPrefs>`.

```ts
interface PushPrefs {
  notifyCompletion: "off" | "on" | "auto";
}
```

Preferences SHALL be in-memory only (session lifetime). They SHALL NOT persist across server restarts. A new session starts with `notifyCompletion: "off"`.

#### Scenario: New session starts with defaults
- **WHEN** a new session is created
- **THEN** its PushPrefs SHALL be `{ notifyCompletion: "off" }`

#### Scenario: Server restart clears all prefs
- **WHEN** the server restarts
- **THEN** all PushPrefs SHALL be reset to defaults

### Requirement: Bell toggle component in StatusBar

The client SHALL render a bell toggle component in `StatusBar`, positioned between the left control group (ModelSelector + ThinkingLevelSelector) and the right status label. The toggle SHALL cycle through three states: Off → On → Auto → Off.

| State | Icon | Color |
|-------|------|-------|
| Off | `mdiBellOutline` | `text-secondary` (gray) |
| On | `mdiBell` | accent/blue |
| Auto | `mdiBellBadgeOutline` or `mdiBell` + dot indicator | accent/blue |

On click, the component SHALL emit a `set_push_prefs` WebSocket message and optimistically update UI.

#### Scenario: Bell cycles Off → On → Auto → Off
- **WHEN** user clicks the bell icon three times starting from Off
- **THEN** the state SHALL transition Off → On → Auto → Off

#### Scenario: Bell renders in StatusBar between controls and status
- **WHEN** StatusBar renders for a live session
- **THEN** a bell icon SHALL appear to the right of ThinkingLevelSelector and to the left of the status label

#### Scenario: Bell hidden for ended sessions
- **WHEN** session status is "ended"
- **THEN** the bell SHALL NOT render

#### Scenario: Bell hidden when push is disabled
- **WHEN** push is disabled or misconfigured (`push.enabled: false` or missing `contactEmail`)
- **THEN** the bell SHALL NOT render

### Requirement: Global push defaults in Settings

The `PushNotificationsSection` component SHALL expose a dropdown and two toggles:

- Notify on errors (checkbox, default: true)
- Notify when input needed (checkbox, default: true)
- Completion push (dropdown: off/on/auto, default: off)

These SHALL be stored in `config.json` under `push.defaults`:

```json
{
  "push": {
    "defaults": {
      "notifyErrors": true,
      "notifyAskUser": true,
      "notifyCompletion": "off"
    }
  }
}
```

#### Scenario: User changes completion default to on
- **WHEN** user selects "on" for completion push default in Settings
- **THEN** `config.json` SHALL be updated with `push.defaults.notifyCompletion: "on"`

#### Scenario: User toggles errors default off
- **WHEN** user disables "Notify on errors" in Settings
- **THEN** `config.json` SHALL be updated with `push.defaults.notifyErrors: false`

#### Scenario: Global defaults persist across restarts
- **WHEN** global defaults are set and server restarts
- **THEN** the defaults SHALL be preserved

### Requirement: New sessions inherit global completion default

When a session is registered (via `session_register` or equivalent server handler), its `PushPrefs` SHALL be initialized with the global `push.defaults.notifyCompletion` value. The per-session bell toggle can then override this.

#### Scenario: Global completion default is "on" — new session gets "on"
- **WHEN** global `notifyCompletion` is "on" AND a new session starts
- **THEN** the session's `pushPrefs.notifyCompletion` SHALL be "on"

#### Scenario: Global completion default is "off" — new session gets "off"
- **WHEN** global `notifyCompletion` is "off" AND a new session starts
- **THEN** the session's `pushPrefs.notifyCompletion` SHALL be "off"

#### Scenario: Bell overrides per-session independent of global
- **WHEN** global `notifyCompletion` is "off" AND user clicks bell to "on"
- **THEN** the session's `pushPrefs.notifyCompletion` SHALL be "on" for that session only

### Requirement: Browser-to-server set_push_prefs WebSocket message

A new `BrowserToServerMessage` type SHALL be added:

```ts
{ type: "set_push_prefs", sessionId: string, prefs: PushPrefs }
```

The server SHALL update the per-session prefs map and broadcast updated session state.

The server SHALL validate that `prefs.notifyCompletion` is one of `"off"`, `"on"`, `"auto"`. Unknown values SHALL be rejected (message silently dropped, no error broadcast). Extra fields SHALL be ignored.

#### Scenario: Browser sends set_push_prefs
- **WHEN** browser sends `{ type: "set_push_prefs", sessionId: "abc", prefs: { notifyCompletion: "on" } }`
- **THEN** server SHALL update session "abc" prefs AND broadcast updated state

#### Scenario: set_push_prefs for unknown session
- **WHEN** browser sends `set_push_prefs` for a non-existent sessionId
- **THEN** server SHALL ignore the message (no error)

#### Scenario: set_push_prefs with invalid value
- **WHEN** browser sends `prefs.notifyCompletion: "invalid"`
- **THEN** server SHALL drop the message silently

### Requirement: Push prefs included in session state broadcast

When the server broadcasts session state (on subscribe replay or update), it SHALL include `pushPrefs` in the session data.

#### Scenario: Subscribe replay includes pushPrefs
- **WHEN** a browser subscribes to a session
- **THEN** the replayed session state SHALL include `pushPrefs`
