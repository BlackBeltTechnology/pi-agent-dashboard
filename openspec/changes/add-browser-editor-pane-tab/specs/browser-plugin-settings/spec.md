## ADDED Requirements

### Requirement: Browser badge lists relay tabs to open in the pane

The `browser-relay-badge` on a session card SHALL be shown while at least one relay instance has at least one listed tab. It SHALL be an accessible button whose `aria-label` names the action. Activating it SHALL open a menu listing every live relay tab (title, state indicator) with an "Open in pane" action per tab, plus "Open all in pane". "Open in pane" SHALL open the tab in the editor pane of the session whose card was activated and SHALL select that session. "Open all in pane" SHALL open every listed tab in that same pane, in list order, without duplicating already-open ones, leaving the last one active. Activating the badge SHALL NOT replace the chat with any browser surface.

#### Scenario: Open one tab from the badge
- **WHEN** the user activates the badge on session `S`'s card and chooses "Open in pane" for tab 42 of `inst-1`
- **THEN** session `S` SHALL become selected and its pane SHALL show `browser:inst-1:42` as the active tab, with the chat still visible in the split

#### Scenario: Open all
- **WHEN** two relay tabs are listed, one is already open in session `S`'s pane, and the user chooses "Open all in pane" on `S`'s card
- **THEN** `S`'s pane SHALL contain exactly one tab per relay tab, with the second listed tab active

#### Scenario: Keyboard use
- **WHEN** the badge has focus and the user presses Enter, then the arrow keys and Enter
- **THEN** the menu SHALL open, its items SHALL be traversable, and Enter SHALL perform the focused item's action

## REMOVED Requirements

### Requirement: Live-view tile

**Reason**: The live view moves from a full-content `content-view` takeover into an editor-pane tab (capability `browser-pane-tab`). The browser plugin no longer claims `content-view`.
**Migration**: The pane tab `browser:<instanceId>:<tabId>` provides frame rendering, allowlisted input, no-frames and DevTools handling, unsubscribe on unmount, and remote-viewer support over `/ws`. See `browser-pane-tab` requirements "One pane tab per relay tab", "Frame rendering and idle state" and "Desktop and touch input".

### Requirement: Live-view tile handles non-viewable tabs

**Reason**: Superseded together with the live-view tile.
**Migration**: Covered by `browser-pane-tab` "Frame rendering and idle state" (`detached` with `no-session`/`devtools` hides the frame and blocks input) and "One pane tab per relay tab" (re-subscribe when the tab becomes viewable).

### Requirement: Live view can be dismissed and re-opened

**Reason**: There is no takeover left to dismiss. The browser surface is a pane tab that the user closes like any other tab.
**Migration**: Close the pane tab to dismiss. Re-open from the badge menu (`Browser badge lists relay tabs to open in the pane`).

### Requirement: Content-view gate follows plugin predicate changes

**Reason**: This is generic shell behavior, and the browser plugin no longer claims `content-view`. The scenario, which was tied to the browser relay, would become false.
**Migration**: Moved to `dashboard-shell-slots` as "Content-view gate re-evaluates on slot-claims changes", with a plugin-agnostic scenario. `SessionContentGate` is unchanged.
