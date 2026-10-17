## MODIFIED Requirements

### Requirement: One pane tab per relay tab

The browser plugin SHALL claim the editor-pane prefix `browser`. A pane tab `browser:<instanceId>:<tabId>` SHALL subscribe to that relay tab's frames while the pane tab is mounted and the relay tab is viewable, and SHALL unsubscribe when the pane tab unmounts, the relay tab becomes `detached`, or the relay tab disappears from `browser_relay_status`. The tab label SHALL show the relay tab's current title (falling back to its URL host, then "Browser tab") and a state indicator for live, idle (`no-frames`), detached, or `client-screencast-active` (agent is screencasting; no live view). The label SHALL stay current while the pane tab is in the background. When the relay tab goes from `detached` back to a viewable state while the pane tab is active, the pane tab SHALL send exactly one new subscribe without being reopened. When the pane tab runs in the Electron window whose registered operator host owns the instance, every subscribe it sends SHALL carry `local: true` and it SHALL render frames from `window.piDashboard.browserHost.onFrame` for that `(instanceId, tabId)` instead of `browser_relay_frame`; in any other window subscribes SHALL carry no `local` field.

#### Scenario: Opening subscribes, closing unsubscribes
- **WHEN** the user opens `browser:inst-1:42` in the pane and later closes the tab
- **THEN** exactly one `browser_relay_subscribe {instanceId: "inst-1", tabId: 42}` (with `local: true` only in the owning operator window) SHALL be sent on open, and exactly one `browser_relay_unsubscribe` for the same pair on close

#### Scenario: Background pane tab keeps no subscription
- **WHEN** another pane tab becomes active while `browser:inst-1:42` stays open
- **THEN** the browser tab SHALL unsubscribe, and SHALL re-subscribe once when it becomes active again

#### Scenario: Re-subscribe when the tab becomes viewable
- **WHEN** the active pane tab's relay tab goes from `detached` (`no-session` or `devtools`) to `live` or `no-frames`
- **THEN** exactly one new `browser_relay_subscribe` for that pair SHALL be sent

#### Scenario: Relay tab closed while open in the pane
- **WHEN** `browser_relay_status` no longer lists tab 42 of `inst-1`
- **THEN** the pane tab SHALL show "This browser tab is no longer available" with a Close action and SHALL NOT send input

#### Scenario: Operator views their own tab
- **WHEN** the operator's Electron window, registered as host H, opens a pane tab for a tab of an instance whose `host` is H
- **THEN** the subscribe SHALL carry `local: true` and the rendered frame SHALL come from `onFrame`

#### Scenario: Another device views the same tab
- **WHEN** a phone opens a pane tab for that same relay tab
- **THEN** its subscribe SHALL carry no `local` field and it SHALL render `browser_relay_frame` messages
