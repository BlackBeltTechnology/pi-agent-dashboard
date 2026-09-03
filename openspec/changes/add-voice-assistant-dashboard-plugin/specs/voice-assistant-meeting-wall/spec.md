## ADDED Requirements

### Requirement: Vendored wall server binds its own loopback port
The system SHALL bind the vendored `WallServer` (via `runWall(cfg, { port })`) to its own loopback HTTP port per active project, serving upstream's own static wall UI (`wall/public/index.html`, `wall.js`, `wall.css`, `wall-core.mjs`) unmodified. The system SHALL NOT reimplement the wall UI as a dashboard React component.

#### Scenario: Wall server starts when meeting copilot starts
- **WHEN** meeting-copilot capture starts for a project
- **THEN** the vendored `WallServer` for that project is bound to a loopback port and begins serving upstream's own wall UI

### Requirement: Embed the wall via live-server-preview, not a custom content-view
Embedding depends on the core live-target bridge specified in `voice-assistant-live-target-bridge`; `startLiveServer` alone returns a path and does not mount a viewer. When that capability is unavailable the wall SHALL fall back to the full-page main-origin `/live/<id>/` URL rather than silently failing to open.
The system SHALL provide a `session-card-action-bar` "View live wall" action that opens the running wall server through the dashboard's existing `live-server-preview` mechanism (`startLiveServer({ host: "127.0.0.1", port })` + `LiveServerViewer`'s sandboxed, SSRF-guarded reverse-proxy iframe). The plugin manifest SHALL NOT declare a `content-view`/`command-route` claim for the wall.

#### Scenario: User opens the live wall
- **WHEN** the user clicks "View live wall" on a session card while meeting-copilot is active for that project
- **THEN** the dashboard registers the wall server's loopback port via `startLiveServer` and opens it in a `live-server-preview` tab, embedded inside the dashboard shell

#### Scenario: Wall not yet running
- **WHEN** the user clicks "View live wall" before meeting-copilot has started for that project
- **THEN** the action is disabled/hidden until a wall server is bound for that project

#### Scenario: Bridge unavailable falls back to full page
- **WHEN** the live-target bridge is not available in the running shell
- **THEN** the wall opens at its full-page main-origin `/live/<id>/` URL, and the user is not left with a button that does nothing

### Requirement: Popout uses the viewer's own main-origin link, not TabActions
`EditorPane` computes `tabActionTarget` as `null` for pseudo-tab viewers, so a live-server tab exposes **no** `TabActions` "Open in system browser" action; only real files and `url:` tabs do. The system SHALL therefore rely on `LiveServerViewer`'s own inline link to the main-origin `/live/<id>/…` path, and SHALL NOT claim or depend on a `window.open`/`openExternal` popout path for the wall.

#### Scenario: Popout opens the proxied main-origin URL
- **WHEN** the user activates the wall viewer's popout link
- **THEN** it opens the dashboard's own `/live/<id>/…` proxied URL, which serves the same live wall content

#### Scenario: No system-open action is assumed
- **WHEN** the wall is embedded as a live-server pseudo-tab
- **THEN** the implementation does not depend on a `TabActions` system-open affordance being present, because none is rendered for that tab kind

### Requirement: Target session replies are mirrored into the wall server's own event stream
The system SHALL subscribe to `ctx.onEvent` for a meeting-copilot's target session while it is active, filter to that session's id, and mirror the assistant's resulting text into the vendored `WallServer`'s own event stream (`ingest()`) — the same funnel the raw transcript already goes through.

#### Scenario: Target session responds to a copilot batch
- **WHEN** the target pi session produces assistant text in response to a forwarded transcript batch
- **THEN** that text is ingested into the project's `WallServer` as a copilot event, without the plugin tailing any on-disk session transcript file

#### Scenario: Subscription is scoped and cleaned up
- **WHEN** meeting-copilot stops for a session
- **THEN** the plugin's `onEvent` subscription for that session is unsubscribed and the project's `WallServer` is stopped

### Requirement: Redaction is preserved
The system SHALL apply the same redaction rules the vendored `WallServer` already applies (`redaction.ts`) before anything reaches an embedded or popped-out wall client; the plugin SHALL NOT bypass or duplicate redaction logic. The iframe's sandbox isolation (`allow-scripts allow-forms allow-popups`, no `allow-same-origin`) is an additional, independent boundary — the wall server's own redaction is not a substitute for it and vice versa.

#### Scenario: Redacted content stays redacted
- **WHEN** a transcript line matches an existing redaction rule
- **THEN** the content delivered to the wall server's own clients (embedded or popped-out) contains the redacted form, identical to what upstream's own wall client would have shown

### Requirement: The wall's HTTP surface is unauthenticated and treated as such
`/live/:id/*` is served by a reverse proxy registered with no `preHandler`, and `/live/` is excluded from the CSP guard; only the WebSocket upgrade is ticket-gated. Anyone able to reach the dashboard origin — including over a public tunnel — can fetch the wall knowing only the target id. The system SHALL treat wall content as exposed at that boundary rather than assuming the dashboard's session auth protects it.

#### Scenario: Exposure is disclosed where the wall is opened
- **WHEN** the user opens the live wall for a meeting
- **THEN** the interface discloses that the wall URL is reachable by anyone who can reach the dashboard origin and is not individually access-controlled

#### Scenario: Exposure window is bounded by capture lifetime
- **WHEN** meeting copilot stops
- **THEN** the wall server is stopped and its live-server registration removed, so the URL ceases to resolve rather than remaining live indefinitely

#### Scenario: Redaction is not relied on as an access control
- **WHEN** the wall applies upstream redaction to transcript content
- **THEN** redaction is documented as content reduction, not as a security boundary, and does not justify treating the surface as safe to expose

### Requirement: Live-server registration lifecycle
Live-server registrations are persisted to preferences and reseeded on boot, and appear in the user's saved-targets list. The system SHALL deregister the wall target when capture stops, and SHALL NOT rely on a previously registered port remaining valid across a dashboard restart.

#### Scenario: Registration removed on stop
- **WHEN** the wall server stops
- **THEN** its live-server registration is removed rather than left persisted

#### Scenario: No stale rows accumulate across restarts
- **WHEN** the dashboard restarts and the wall is started again on a fresh port
- **THEN** the plugin does not accumulate additional stale registrations pointing at dead ports
