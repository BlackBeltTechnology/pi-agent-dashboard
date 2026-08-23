# mobile-resilience Specification

## Purpose

Makes the dashboard usable on a phone and on a flaky network. Covers responsive breakpoints and the mobile navigation shell, touch-friendly interactions and a reliable swipe-back gesture, mobile placements for the workspace dropdown, markdown preview, OpenSpec commands and attach/detach, collapsed tool calls, horizontally scrollable code blocks, disabled pull-to-refresh, and the connectivity contract: WebSocket auto-reconnect, a connection status indicator, and an offline queue for outgoing messages.
## Requirements
### Requirement: Responsive layout breakpoints
The web client SHALL adapt its layout based on a mobile predicate evaluated as `viewport width < 768px OR viewport height < 600px`. The three layouts are:

- **Desktop** (≥ 1024px wide AND ≥ 600px tall): workspace bar (top) + session sidebar (left, 280px) + chat view (remaining)
- **Tablet** (768px–1023px wide AND ≥ 600px tall): workspace dropdown (top) + session sidebar (left, 240px) + chat view
- **Mobile** (width < 768px OR height < 600px): workspace dropdown (top) + session drawer (hidden, swipe/hamburger) + chat view (full width)

The mobile predicate SHALL be implemented as a single `matchMedia` query using the comma-OR form (`(max-width: 767px), (max-height: 599px)`), evaluated by the existing `useMediaQuery` hook with no wrapper changes.

#### Scenario: Desktop layout
- **WHEN** the viewport is 1200px × 900px
- **THEN** the workspace bar, sidebar, and chat view SHALL all be visible simultaneously

#### Scenario: Mobile layout — narrow portrait
- **WHEN** the viewport is 375px × 812px
- **THEN** only the workspace dropdown and chat view SHALL be visible; sidebar accessible via hamburger menu

#### Scenario: Mobile layout — landscape phone (height arm)
- **WHEN** the viewport is 844px × 390px (e.g. iPhone 14 in landscape) or 915px × 412px (Pixel 8 landscape)
- **THEN** the layout SHALL be mobile (single-panel with hamburger), NOT the desktop two-panel layout
- **BECAUSE** the height predicate (< 600px) catches landscape-phone heights even though the width predicate (< 768px) does not

#### Scenario: Tablet portrait stays desktop
- **WHEN** the viewport is 768px × 1024px (iPad portrait)
- **THEN** the layout SHALL be tablet (sidebar 240px + chat), NOT mobile
- **BECAUSE** neither the width predicate (768 is not < 768) nor the height predicate (1024 is not < 600) is satisfied

#### Scenario: Tablet landscape stays desktop
- **WHEN** the viewport is 1024px × 768px (iPad landscape)
- **THEN** the layout SHALL be desktop (sidebar 280px + chat), NOT mobile

#### Scenario: Desktop short window (documented side effect)
- **WHEN** the viewport is 1200px × 500px (desktop user manually shrinks window vertically)
- **THEN** the layout SHALL be mobile (single-panel)
- **BECAUSE** the height predicate (< 600px) is satisfied; this is the explicit and accepted side effect of the dumb-OR predicate

### Requirement: Workspace dropdown on mobile
On tablet and mobile viewports, the workspace bar SHALL collapse into a dropdown selector instead of tabs.

#### Scenario: Workspace selection on mobile
- **WHEN** a user taps the workspace dropdown on mobile
- **THEN** a dropdown menu SHALL appear listing all workspaces with active session counts

### Requirement: Tool calls collapsed on mobile
On mobile viewports, all tool call steps SHALL be collapsed by default with no exception. Tapping SHALL expand them (with lazy-loaded content).

#### Scenario: Tool call on mobile
- **WHEN** a tool call is rendered on a mobile viewport
- **THEN** it SHALL show only the one-line summary with a tap-to-expand affordance

### Requirement: Code block horizontal scroll
Code blocks SHALL use horizontal scrolling instead of line wrapping, with a visible scrollbar on touch devices.

#### Scenario: Wide code on mobile
- **WHEN** a code block contains lines wider than the viewport
- **THEN** the code SHALL scroll horizontally with a visible scrollbar

### Requirement: WebSocket auto-reconnect
The browser client SHALL automatically reconnect to the dashboard server with exponential backoff when the WebSocket connection drops. Backoff schedule: 1s, 2s, 4s, 8s, 16s, max 30s. Reset to 1s on successful connection.

#### Scenario: Connection lost
- **WHEN** the WebSocket connection drops
- **THEN** the client SHALL show a "Reconnecting..." indicator and attempt reconnection with backoff

#### Scenario: Successful reconnect
- **WHEN** the client reconnects to the server
- **THEN** it SHALL re-subscribe to all previously subscribed sessions with their last known sequence numbers, and the server SHALL replay missed events

#### Scenario: Max backoff
- **WHEN** reconnection has failed 5+ times
- **THEN** the backoff SHALL cap at 30 seconds and the client SHALL show "Connection lost. Retrying every 30s..."

### Requirement: Connection status indicator
The web client SHALL display a connection status indicator visible at all times:
- 🟢 "Connected" (normal state, subtle/hidden)
- 🟡 "Reconnecting..." (during backoff, with countdown)
- 🔴 "Disconnected" (after extended failure, with manual retry button)

#### Scenario: Show reconnecting state
- **WHEN** the WebSocket disconnects
- **THEN** the indicator SHALL show "🟡 Reconnecting..." within 1 second

#### Scenario: Manual retry
- **WHEN** the indicator shows "Disconnected" and the user clicks retry
- **THEN** the client SHALL immediately attempt reconnection (reset backoff)

### Requirement: Offline outgoing message queue
When the WebSocket is disconnected, the browser SHALL queue outgoing messages (prompts, commands) and deliver them when the connection is restored.

#### Scenario: Send while disconnected
- **WHEN** a user sends a message while the WebSocket is disconnected
- **THEN** the message SHALL be queued locally and a "Will send when connected" indicator SHALL appear

#### Scenario: Queue delivery on reconnect
- **WHEN** the WebSocket reconnects and there are queued messages
- **THEN** the queued messages SHALL be sent in order immediately after the connection is established

#### Scenario: Queue limit
- **WHEN** more than 10 messages are queued while disconnected
- **THEN** the input SHALL disable and show "Too many queued messages. Please wait for connection."

### Requirement: Touch-friendly interactions
All interactive elements SHALL meet minimum touch target sizes (44×44px) on mobile viewports. This includes: session list items, tool call expand/collapse buttons, autocomplete dropdown items, send button, workspace selector items.

#### Scenario: Session list item touch target
- **WHEN** a session list item is rendered on mobile
- **THEN** it SHALL have a minimum height of 44px and be tappable across its full width

### Requirement: All detail routes use MobileShell navigation
On mobile viewports, all detail-level routes (`/settings`, `/tunnel-setup`) SHALL render inside `MobileShell` as depth-1 detail panels with the same slide-in transition and swipe-back gesture as session chat and terminal views.

This SHALL remain true for every surface converted to a route-backed overlay. Converting a surface's desktop container to a `Dialog` SHALL NOT change its mobile presentation: on mobile the surface SHALL continue to render inside `MobileShell` at its declared depth, with the same slide-in transition and swipe-back gesture. The dialog container is a desktop-only rendering decision.

Plugin `shell-overlay-route` claims SHALL follow the same split — dialog on desktop, `MobileShell` depth panel on mobile — except where a claim declares `presentation: "page"`, which SHALL render full-viewport on both desktop and mobile, outside the `MobileShell` detail panel.

#### Scenario: Settings page on mobile
- **WHEN** a user navigates to `/settings` on a mobile viewport
- **THEN** the Settings panel SHALL slide in from the right as a MobileShell detail panel with swipe-back to return to the session list

#### Scenario: Tunnel setup page on mobile
- **WHEN** a user navigates to `/tunnel-setup` on a mobile viewport
- **THEN** the Zrok Install Guide SHALL slide in from the right as a MobileShell detail panel with swipe-back to return to the session list

#### Scenario: Swipe back from settings on mobile
- **WHEN** a user performs a swipe-back gesture on the Settings page on mobile
- **THEN** the app SHALL navigate to `/` showing the session list

#### Scenario: A converted surface renders as a depth panel, not a dialog, on mobile
- **GIVEN** a surface converted to a route-backed overlay
- **WHEN** a user navigates to it on a mobile viewport
- **THEN** it SHALL render inside `MobileShell` at its declared depth with the standard slide-in transition
- **AND** it SHALL NOT render as a desktop-style dialog

#### Scenario: A plugin overlay claim renders as a depth panel on mobile
- **GIVEN** the Goals board claim at `/folder/:encodedCwd/goals` with `depth: 2`, `parentPath: /folder/:encodedCwd`, and no declared `presentation`
- **WHEN** a user navigates to it on a mobile viewport
- **THEN** it SHALL render as a `MobileShell` detail panel at its declared depth with swipe-back
- **AND** swipe-back SHALL return to `/folder/<encodedCwd>`, NOT to `/`

#### Scenario: A `presentation: "page"` claim bypasses the MobileShell panel
- **GIVEN** a claim declaring `presentation: "page"`
- **WHEN** a user navigates to its path on a mobile viewport
- **THEN** it SHALL render full-viewport outside the `MobileShell` detail panel

### Requirement: Reliable swipe-back gesture
The swipe-back gesture SHALL use a 40px left-edge activation zone and SHALL listen for touch events at the document level so that scrollable child elements (e.g., ChatView, SettingsPanel) do not intercept the gesture.

#### Scenario: Swipe-back over scrollable content
- **WHEN** a user starts a swipe from the left 40px edge over a scrollable ChatView
- **THEN** the swipe-back gesture SHALL activate and navigate back

#### Scenario: Touch outside edge zone
- **WHEN** a user touches the screen more than 40px from the left edge
- **THEN** the swipe-back gesture SHALL NOT activate

### Requirement: Markdown preview accessible from sidebar on mobile
The OpenSpec markdown preview (triggered by P/S/D/T artifact buttons or the Read button) SHALL render as a top-level MobileShell detail panel, independent of session selection.

#### Scenario: Tap artifact letter from sidebar without session selected
- **WHEN** a user taps a P/S/D/T artifact button in the sidebar on mobile with no session selected
- **THEN** the markdown preview SHALL slide in as the detail panel

#### Scenario: Back from preview returns to list
- **WHEN** a user navigates back from a markdown preview opened from the sidebar
- **THEN** the session list SHALL be shown

### Requirement: OpenSpec commands in mobile kebab menu
When a change is attached to a session, the mobile kebab menu (⋮) SHALL display context-aware OpenSpec commands matching the desktop sidebar card behavior.

#### Scenario: Attached change in planning state
- **WHEN** a session has an attached change in planning state and the user opens the kebab menu
- **THEN** the menu SHALL show Read, Explore, Continue, and Fast-Forward commands

#### Scenario: Attached change ready for implementation
- **WHEN** a session has an attached change in ready or implementing state
- **THEN** the menu SHALL show Read, Explore, and Apply commands

#### Scenario: Attached change complete
- **WHEN** a session has an attached change in complete state
- **THEN** the menu SHALL show Read, Explore, Verify, and Archive commands

### Requirement: Separate attach/detach icon in mobile session header
The mobile session header SHALL display a paperclip icon button for attach/detach operations, separate from the kebab menu.

#### Scenario: No change attached
- **WHEN** no change is attached and available changes exist
- **THEN** tapping the paperclip icon SHALL show a dropdown listing available changes to attach

#### Scenario: Change is attached
- **WHEN** a change is attached to the session
- **THEN** the paperclip icon SHALL appear in blue and tapping it SHALL show the attached change name with a detach option

### Requirement: Disable browser pull-to-refresh
The dashboard SHALL disable the browser's native pull-to-refresh gesture and overscroll bounce effects on all viewports. Normal in-page scrolling (chat views, sidebars, settings) SHALL NOT be affected.

#### Scenario: Pull down on mobile
- **WHEN** a user pulls down past the top of the page on a mobile browser
- **THEN** the browser SHALL NOT trigger a page refresh or show a refresh indicator

#### Scenario: Overscroll bounce disabled
- **WHEN** a user scrolls past the top or bottom boundary of the page
- **THEN** the browser SHALL NOT show an overscroll bounce effect

#### Scenario: Normal scrolling unaffected
- **WHEN** a user scrolls within a chat view or sidebar
- **THEN** scrolling SHALL work normally without any interference

