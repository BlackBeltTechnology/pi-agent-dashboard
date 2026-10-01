## ADDED Requirements

### Requirement: Live-view tile handles non-viewable tabs

The live-view tile SHALL render a tab reported `detached` with `reason: "no-session"` with an overlay reading "Tab not viewable yet — the agent has not attached to it (extension pages cannot be viewed)" instead of "Waiting for frames…", and SHALL NOT forward input for it. When the tab's reported state leaves `detached`, the tile SHALL send `browser_relay_subscribe {instanceId, tabId}` again without being remounted.

#### Scenario: No-session overlay

- **WHEN** `browser_relay_status` reports the tile's tab as `detached` with `reason: "no-session"`
- **THEN** the tile SHALL show the no-session overlay and SHALL NOT show "Waiting for frames…"

#### Scenario: Re-subscribe on attach

- **WHEN** the tile's tab transitions from `detached/no-session` to `live` or `no-frames`
- **THEN** the tile SHALL send exactly one new `browser_relay_subscribe` for that `{instanceId, tabId}`

### Requirement: Live view can be dismissed and re-opened

The tile's **Close** action SHALL hide the live view for the current page load until either a material instance/tab change occurs or the user re-opens it. The `browser-relay-badge` pill SHALL be an accessible button (`aria-label` naming the action) that re-opens a dismissed live view; activating it SHALL NOT prevent the enclosing session card from being selected.

#### Scenario: Re-open from the badge

- **WHEN** the user closed the live view and then activates the `browser-relay-badge` button
- **THEN** the live view SHALL be shown again for the selected session on the desktop layout

#### Scenario: Keyboard re-open

- **WHEN** the badge button has focus and the user presses Enter or Space
- **THEN** the live view SHALL be re-opened

### Requirement: Content-view gate follows plugin predicate changes

The shell's decision to render the `content-view` slot instead of the chat SHALL be re-evaluated whenever a plugin signals a slot-claims change, without requiring any session event.

#### Scenario: Relay status arrives on an idle session

- **WHEN** the selected session is idle and a `browser_relay_status` makes the live-view predicate true
- **THEN** the live view SHALL replace the chat without any other state change
