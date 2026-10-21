## MODIFIED Requirements

### Requirement: Plugins SHALL emit UI intents via the bridge instead of running React code in the client

Plugin server entries that contribute per-session UI from the server or bridge SHALL describe it as JSON `IntentNode` trees and broadcast them via `ServerPluginContext.broadcastToSubscribers` with message type `"plugin_intents"`. Intents SHALL remain the only path for bridge- or server-originated UI, and the only path for plugins whose client code is not trusted. Trusted plugin client code — bundled into the build, or runtime-loaded after operator trust (`plugin-runtime-client-loading`) — MAY render React claims and MAY call `useUiPrimitive(...)` and `useUiPrimitiveOrNull(...)` from the public host API (`plugin-host-api`). Plugin client code SHALL NOT import shell components directly. The shell, on each connected client, SHALL render incoming intents by resolving primitive names through its local primitive registry.

A plugin MAY both broadcast intents and register React claims for the same slot. Slot consumers render both per `dashboard-plugin-loader` "Slot consumers SHALL accept BOTH refs-registry claims AND intent broadcasts": for `one-active` slots the intent takes precedence when both come from the same plugin; for `many` slots both render. Plugins that have NOT migrated MAY keep only their refs-registry claims.

#### Scenario: Plugin broadcasts an intent, every connected client receives it

- **WHEN** a plugin running on the server calls `ctx.broadcastToSubscribers({type:"plugin_intents", pluginId:"flows", sessionId:"abc", slot:"session-card-action-bar", intent:{primitive:"action-list", props:{actions:[...]}}})`
- **THEN** every connected client subscribed to session "abc" SHALL receive the message via the existing WebSocket fanout
- **AND** each client's `useMessageHandler` SHALL dispatch on `case "plugin_intents"` to store the intent in the local IntentStore
- **AND** each client's `SessionCardActionBarSlot` for session "abc" SHALL render the action-list intent via IntentRenderer
- **AND** the rendered UI SHALL be identical across all clients

#### Scenario: Intent with nested primitives

- **WHEN** the intent payload is `{primitive:"agent-card", props:{name:"Explore", body:{primitive:"markdown", props:{content:"..."}}}}`
- **THEN** IntentRenderer SHALL resolve "agent-card" from the registry and render with `name` as a string, AND resolve "markdown" from the registry for the `body` prop, passing its rendered React element as the AgentCardShell's body prop

#### Scenario: Plugin clears its contribution by emitting null intent

- **WHEN** plugin broadcasts `{type:"plugin_intents", pluginId:"flows", sessionId:"abc", slot:"content-view", intent:null}`
- **THEN** every client SHALL remove the previously-cached intent for that key from its IntentStore
- **AND** the slot SHALL no longer render anything from that plugin for that session

#### Scenario: Legacy client claim uses a transient input primitive

- **WHEN** a not-yet-migrated plugin client claim calls `useUiPrimitiveOrNull(UI_PRIMITIVE_KEYS.pathPicker)`
- **THEN** this is permitted, and the claim imports no shell component directly
- **AND** a call to the strict `useUiPrimitive` from a trusted claim is equally permitted

#### Scenario: Trusted client claim uses primitives directly

- **WHEN** a bundled plugin client claim calls `useUiPrimitive(UI_PRIMITIVE_KEYS.markdownContent)`
- **THEN** this is permitted, and the claim imports no shell component directly

#### Scenario: Untrusted runtime client gets no client path

- **WHEN** a runtime-delivered plugin is not trusted by the operator
- **THEN** none of its client code SHALL run, and its UI SHALL reach the dashboard only through intents broadcast by its server entry
