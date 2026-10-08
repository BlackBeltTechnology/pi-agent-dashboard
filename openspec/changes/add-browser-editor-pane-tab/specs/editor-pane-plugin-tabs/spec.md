## Purpose

Let a dashboard plugin contribute editor-pane tabs addressed by a virtual-path prefix it owns, so plugin surfaces (the browser relay first) sit beside file, terminal, diff and live-preview tabs instead of replacing the chat.

## ADDED Requirements

### Requirement: Plugin claims an editor-pane tab prefix

A plugin SHALL be able to claim the `editor-pane-tab` slot with a body component, a `pathPrefix` (lowercase, matching `^[a-z][a-z0-9-]{1,31}$`), and an optional label component. The editor pane SHALL treat a tab opened with path `<pathPrefix>:<rest>` as owned by that claim. For it, the pane SHALL:
- render the body component with the tab path, the session, an `isActive` flag and a close callback;
- render the label component, when given, in the tab strip with the tab path, session and plugin context (otherwise the prefix);
- never render it with a file viewer;
- never issue a file read or file-metadata request for its path.

The label SHALL stay rendered while the tab is in the background.

#### Scenario: Claimed prefix renders the plugin component
- **WHEN** an enabled plugin claims `editor-pane-tab` with `pathPrefix: "browser"` and the tab `browser:inst-1:42` is active in a session's pane
- **THEN** the pane SHALL render that plugin's body component for `browser:inst-1:42` and SHALL make no `/api/file` request for it

#### Scenario: Background tab keeps a live label
- **WHEN** the plugin tab is not the active tab and its label component's data changes
- **THEN** the tab strip SHALL show the updated label

#### Scenario: Unclaimed path opened as a file stays a file
- **WHEN** a path that matches no claimed prefix is opened as a file
- **THEN** the pane SHALL handle it exactly as it handles a file path today

### Requirement: Built-in pseudo-tab prefixes win and collisions are rejected

The built-in prefixes `diff`, `term`, `url` and `live` SHALL always resolve to their built-in viewers.

Manifest validation SHALL reject an `editor-pane-tab` claim that:
- has no body component or no `pathPrefix`;
- has a malformed prefix;
- declares a built-in prefix.

The rejection error SHALL name the plugin and the prefix. Two plugins claiming the same prefix SHALL fail plugin registry generation with an error naming both plugins and the prefix.

#### Scenario: Built-in prefix is refused
- **WHEN** a plugin manifest claims `editor-pane-tab` with `pathPrefix: "term"`
- **THEN** manifest validation SHALL fail with an error naming the plugin and `term`, and no claim SHALL be registered

#### Scenario: Two plugins claim the same prefix
- **WHEN** two plugins both claim `pathPrefix: "browser"`
- **THEN** registry generation SHALL fail with a collision error naming both plugins and `browser`

### Requirement: Plugin tabs persist and degrade when their plugin is gone

Plugin tabs SHALL persist in the per-session pane state like other tabs. When a persisted plugin tab's prefix has no enabled claim, whether the plugin is disabled, uninstalled or failed to load, the pane SHALL keep the tab and render an "unavailable" placeholder naming the prefix, with a Close action.

Restoring pane state SHALL discard only individual persisted tabs whose viewer is unknown to the running client. It SHALL keep every other tab and keep the active tab when that tab survives.

#### Scenario: Plugin disabled after a tab was opened
- **WHEN** a session's pane restored a `browser:…` tab and the browser plugin is disabled
- **THEN** the tab SHALL render the unavailable placeholder, and activating Close SHALL remove the tab from the persisted state

#### Scenario: One unknown persisted tab does not wipe the pane
- **WHEN** a session's persisted pane holds three tabs and one has a viewer the running client does not know
- **THEN** the pane SHALL restore the other two tabs, and SHALL keep the previously active tab active if it is one of them

### Requirement: Plugin tabs open through a deep link

The session editor route SHALL accept one or more `tab=<virtual-path>` query parameters. For each value in order whose prefix has an enabled `editor-pane-tab` claim, following the link SHALL open the tab in that session's pane, or focus it if already open. The last applied tab SHALL be active. This SHALL happen each time the link is followed, including after the user closed the tab. A `tab` value whose prefix has no enabled claim, or is a built-in prefix, SHALL be ignored without opening anything and without error UI.

#### Scenario: Deep link opens a plugin tab
- **WHEN** the client navigates to `/session/<id>/editor?tab=browser%3Ainst-1%3A42`
- **THEN** the pane for session `<id>` SHALL show the `browser:inst-1:42` tab as active

#### Scenario: Re-opening focuses the existing tab
- **WHEN** the same deep link is followed while that tab is already open
- **THEN** the pane SHALL focus the existing tab and SHALL NOT create a duplicate

#### Scenario: Re-opening after close
- **WHEN** the user closed the tab and the same deep link is followed again
- **THEN** the tab SHALL be opened again

#### Scenario: Several tabs in one link
- **WHEN** the client navigates to `/session/<id>/editor?tab=browser%3Ai%3A1&tab=browser%3Ai%3A2`
- **THEN** both tabs SHALL be open in that pane exactly once and `browser:i:2` SHALL be active

#### Scenario: Unclaimed deep link is ignored
- **WHEN** the client navigates to `?tab=unknown%3Ax`
- **THEN** no tab SHALL be opened and the pane SHALL keep its current state

### Requirement: Plugin servers can ask a session's viewers to open a plugin tab

The plugin server host SHALL offer plugins an operation to open a plugin tab for a given session. It SHALL accept a path only when the path's prefix is claimed by the calling plugin's own `editor-pane-tab` claim, and SHALL reject any other path with an error. On acceptance, it SHALL broadcast `editor_tab_open {sessionId, path}` to dashboard clients.

A client SHALL act on `editor_tab_open` only while its current route is that session's chat or editor route. It then opens or focuses the tab exactly as the deep link does. On any other route (another session, settings or other overlays, landing) it SHALL ignore the message and SHALL NOT navigate.

#### Scenario: Viewer of the session gets the tab
- **WHEN** a plugin owning prefix `browser` asks to open `browser:inst-1:42` for session `S`, and a client is on `/session/S`
- **THEN** that client SHALL show `browser:inst-1:42` active in `S`'s pane

#### Scenario: User elsewhere is not interrupted
- **WHEN** the same message arrives at a client showing the settings overlay, or another session
- **THEN** that client SHALL NOT navigate and its view SHALL be unchanged

#### Scenario: Foreign prefix is rejected
- **WHEN** the plugin owning `browser` asks to open `term:1` or `other:x`
- **THEN** the host SHALL reject the request and nothing SHALL be broadcast

