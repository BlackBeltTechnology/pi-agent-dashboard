## ADDED Requirements

### Requirement: STATUS subcard hides when no badge claim would render

The STATUS subcard (slot `session-card-badge`) SHALL render its panel and `STATUS` title only
when at least one registry claim on that slot passes its `predicate` / `shouldRender` for the
session and the host per-plugin visibility filter. Every registry claim on `session-card-badge`
SHALL declare a `predicate` or `shouldRender` whose condition matches the claim component's own
render/skip condition. Intent-store contributions are not counted by this gate; a badge
contributed only via the intent store MAY be hidden.

The browser plugin's `BrowserRelayBadge` claim SHALL declare a `shouldRender` that returns
`true` **iff** the latest relay status snapshot reports at least one tab on any instance, which is
the same condition under which the component renders. The relay status subscription SHALL NOT
depend on the badge or any session card being mounted. When the relay snapshot changes between
"no tabs" and "at least one tab", the STATUS gate SHALL re-evaluate without requiring a session
broadcast. The relay snapshot SHALL be refreshed when the shell connection becomes connected,
so a snapshot from before a disconnect does not persist; if the refresh fails, the snapshot
SHALL be cleared. The composer's STATUS group, which uses the same slot, SHALL follow the same
gate.

#### Scenario: STATUS subcard hidden when the browser plugin is enabled with no relay tabs

- **WHEN** a desktop session card is rendered with the browser plugin enabled
- **AND** the latest relay status reports zero tabs across all instances
- **AND** the session has no goal and is not an automation run
- **THEN** no element with title text `STATUS` SHALL appear

#### Scenario: STATUS subcard appears when the first relay tab arrives

- **WHEN** a desktop session card is rendered with the browser plugin enabled and zero relay tabs
- **AND** a `browser_relay_status` message then reports one tab, with no session broadcast
- **THEN** an element with title text `STATUS` SHALL appear containing the browser relay badge

#### Scenario: STATUS subcard hides again when the last relay tab closes

- **WHEN** the STATUS subcard is showing only the browser relay badge
- **AND** a `browser_relay_status` message reports zero tabs
- **THEN** no element with title text `STATUS` SHALL appear

#### Scenario: Relay status is received with no session card mounted

- **WHEN** the browser plugin is enabled and no session card is rendered
- **AND** a `browser_relay_status` message reports one tab
- **THEN** the relay store SHALL hold that snapshot
- **AND** a session card mounted afterwards SHALL show the `STATUS` subcard with the badge

#### Scenario: Relay snapshot is refreshed after reconnect

- **WHEN** the relay store holds a snapshot with one tab
- **AND** the shell connection drops and reconnects while the relay now reports zero tabs
- **THEN** the relay store SHALL be refreshed to zero tabs
- **AND** no element with title text `STATUS` SHALL appear for a session with no goal and no
  automation run

#### Scenario: Failed refresh after reconnect clears the snapshot

- **WHEN** the relay store holds a snapshot with one tab
- **AND** the shell connection reconnects and the relay status refresh request fails
- **THEN** the relay store SHALL be cleared
- **AND** no element with title text `STATUS` SHALL appear for a session with no goal and no
  automation run

#### Scenario: Composer STATUS group hidden with zero relay tabs

- **WHEN** the chat composer is rendered for a session with no goal and no automation run
- **AND** the browser plugin is enabled and the latest relay status reports zero tabs
- **THEN** the composer SHALL render no STATUS group label

#### Scenario: Every session-card-badge registry claim is gated

- **WHEN** the generated plugin registry is loaded
- **THEN** every registry claim on slot `session-card-badge` SHALL declare a `predicate` or
  `shouldRender`
