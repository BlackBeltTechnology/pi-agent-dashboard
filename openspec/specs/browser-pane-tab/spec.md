# browser-pane-tab Specification

## Purpose
Render one browser-relay tab as an editor-pane tab: live frames, allowlisted input from desktop and touch devices, viewport fit, and a human-takeover Done action, opened manually or by the agent.

## Requirements

### Requirement: One pane tab per relay tab

The browser plugin SHALL claim the editor-pane prefix `browser`. A pane tab `browser:<instanceId>:<tabId>` SHALL subscribe to that relay tab's frames while the pane tab is mounted and the relay tab is viewable, and SHALL unsubscribe when the pane tab unmounts, the relay tab becomes `detached`, or the relay tab disappears from `browser_relay_status`. The tab label SHALL show the relay tab's current title (falling back to its URL host, then "Browser tab") and a state indicator for live, idle (`no-frames`), detached, or `client-screencast-active` (agent is screencasting; no live view). The label SHALL stay current while the pane tab is in the background. When the relay tab goes from `detached` back to a viewable state while the pane tab is active, the pane tab SHALL send exactly one new subscribe without being reopened.

#### Scenario: Opening subscribes, closing unsubscribes
- **WHEN** the user opens `browser:inst-1:42` in the pane and later closes the tab
- **THEN** exactly one `browser_relay_subscribe {instanceId: "inst-1", tabId: 42}` SHALL be sent on open, and exactly one `browser_relay_unsubscribe` for the same pair on close

#### Scenario: Background pane tab keeps no subscription
- **WHEN** another pane tab becomes active while `browser:inst-1:42` stays open
- **THEN** the browser tab SHALL unsubscribe, and SHALL re-subscribe once when it becomes active again

#### Scenario: Re-subscribe when the tab becomes viewable
- **WHEN** the active pane tab's relay tab goes from `detached` (`no-session` or `devtools`) to `live` or `no-frames`
- **THEN** exactly one new `browser_relay_subscribe` for that pair SHALL be sent

#### Scenario: Relay tab closed while open in the pane
- **WHEN** `browser_relay_status` no longer lists tab 42 of `inst-1`
- **THEN** the pane tab SHALL show "This browser tab is no longer available" with a Close action and SHALL NOT send input

### Requirement: Frame rendering and idle state

The pane tab SHALL render the most recent frame fitted to the pane by default, preserving aspect ratio, with a toggle to 1:1 scale. When the relay reports `no-frames`, the pane tab SHALL keep showing the last frame unobscured and SHALL show a non-blocking idle indicator with a `Bring to front` action. Before the first frame it SHALL show "Waiting for frames…". When the relay reports `detached` with reason `devtools` or `no-session`, it SHALL hide the frame, show the matching explanation, and block input.

#### Scenario: Static page stays visible
- **WHEN** a frame was rendered and the tab then reports `no-frames`
- **THEN** the last frame SHALL remain fully visible, and an idle indicator with `Bring to front` SHALL be shown without covering the frame

#### Scenario: DevTools takes the tab
- **WHEN** the relay reports the tab `detached` with reason `devtools`
- **THEN** the frame SHALL be hidden, "DevTools open on this tab — close it to resume" SHALL be shown, and no input SHALL be sent

### Requirement: Toolbar

The pane tab SHALL show a toolbar with:
- the relay tab's current URL, read-only;
- an Input on/off toggle that defaults to on;
- Fit/1:1;
- Bring to front;
- a Done action, shown only while a browser takeover is pending for the owning session.

The displayed URL SHALL never include a query string or fragment for `chrome-extension:` URLs.

#### Scenario: Input toggled off
- **WHEN** the user switches Input off
- **THEN** pointer, wheel and key events on the frame SHALL NOT produce `browser_relay_input`, and `Bring to front` SHALL still work

### Requirement: Desktop and touch input

While input is on and the tab is not detached, the pane tab SHALL translate pointer press/release into a `mouse` click, pointer movement into a `mouse` move, wheel into `scroll`, and key down/up into `key` input. All `mouse` and `scroll` coordinates SHALL be normalized to `[0,1]` of the rendered frame. Touch taps SHALL produce the same `mouse` click as a pointer click. Pointer interaction on the frame SHALL NOT select or drag dashboard text or images.

#### Scenario: Tap on a phone
- **WHEN** the user taps the frame at its exact center on a touch device
- **THEN** one `mouse` click with `x: 0.5, y: 0.5` SHALL be sent

#### Scenario: Drag does not select dashboard text
- **WHEN** the user presses, moves and releases the pointer across the frame
- **THEN** no dashboard text selection SHALL result

### Requirement: Text-entry bridge for soft keyboards

The pane tab SHALL offer a text-entry control below the frame that, when focused, raises the device's soft keyboard. Characters typed into it SHALL be sent as `key` input to the relay tab, and Enter, Backspace and Tab SHALL be sent as their key events. The control's own value SHALL not be retained after each send.

#### Scenario: Typing a username on a phone
- **WHEN** the user focuses the text-entry control and types `abc` followed by Enter
- **THEN** `key` input for `a`, `b`, `c` and `Enter` SHALL be sent in order, and the control SHALL be empty afterwards

### Requirement: Viewport follows the pane

While input is on, the pane tab SHALL request that the relay tab's viewport match the pane's rendered CSS size. While the relay reports `agentEmulation: true` for the tab, the pane tab SHALL send no resize requests and SHALL use Fit. It SHALL resume resize requests when the flag clears. The request SHALL be sent at most once per 500 ms during a resize, and only after the size changes by at least 16 px in either dimension. While input is off, no resize SHALL be requested and the frame SHALL be scaled instead.

#### Scenario: Divider drag
- **WHEN** the user drags the split divider continuously for 2 s with input on
- **THEN** at most 4 resize requests SHALL be sent, and the last SHALL carry the final pane size

### Requirement: Opening a browser tab in the pane

A browser pane tab SHALL be openable in two ways:
1. From the session-card browser badge menu, which lists every live relay tab with an "Open in pane" action.
2. By the agent, when the host announces `editor_tab_open` for a `browser:` path (from `browser_show_in_pane` or `browser_await_human`).

Manual opens target the pane of the session whose badge was activated. An agent-initiated open targets the session named in the announcement, and follows the `editor-pane-plugin-tabs` rules for which clients act on it. No browser tab SHALL ever open, or replace the chat, without one of these triggers.

#### Scenario: New relay tab appears
- **WHEN** a relay tab appears and no open trigger occurred
- **THEN** no pane tab SHALL open and the chat SHALL remain visible

#### Scenario: Agent asks to show the browser
- **WHEN** the host emits `editor_tab_open {sessionId: "S", path: "browser:inst-1:42"}` and this client is on session `S`'s route
- **THEN** the client SHALL open (or focus) `browser:inst-1:42` in session `S`'s pane; a client on another session or an overlay SHALL do nothing

### Requirement: Login takeover Done action

The browser plugin SHALL provide a pi tool `browser_await_human {instanceId, reason}`. When it is invoked from session `S`:
1. The tool SHALL open the instance's most recent tab in `S`'s pane, as `browser_show_in_pane` does.
2. It SHALL raise a confirm prompt through the session's normal prompt path. The prompt's plugin metadata SHALL identify the browser plugin with `kind: "browser-takeover"` and `instanceId`, and the prompt SHALL show `reason`.
3. It SHALL block until that prompt is answered, cancelled or times out.

When the calling session has no interactive UI, the tool SHALL raise no prompt and SHALL return `cancelled` with reason `no-ui`.

While such a prompt is pending, the pane tabs of that instance in `S`'s pane SHALL show a Done action. Activating Done SHALL answer the prompt through the same response path as answering it in chat. Once the prompt is answered or cancelled anywhere, Done SHALL disappear from every client. The tool result SHALL report `done` when the prompt is confirmed, and `cancelled` for every other ending (declined, cancelled or timed out).

#### Scenario: Human finishes logging in
- **WHEN** the agent called `browser_await_human {instanceId: "inst-1", reason: "Sign in to GitHub"}` and the user clicks Done in the pane tab
- **THEN** the prompt SHALL resolve exactly once, the chat SHALL show it as answered, and the tool SHALL return `done`

#### Scenario: Answered from chat instead
- **WHEN** the user answers the same prompt in the chat
- **THEN** the Done action SHALL disappear from the pane tab and the tool SHALL return the chat answer's outcome

#### Scenario: Headless session
- **WHEN** `browser_await_human` is called from a session without interactive UI
- **THEN** no prompt SHALL be raised and the tool SHALL return `cancelled` with reason `no-ui`

#### Scenario: Nobody answers
- **WHEN** the takeover prompt times out
- **THEN** the Done action SHALL disappear and the tool SHALL return `cancelled`
