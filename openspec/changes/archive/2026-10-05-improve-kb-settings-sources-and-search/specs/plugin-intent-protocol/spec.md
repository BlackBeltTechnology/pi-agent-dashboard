## MODIFIED Requirements

### Requirement: Plugins SHALL emit UI intents via the bridge instead of running React code in the client

Plugin server entries SHALL describe per-session UI contributions as JSON `IntentNode` trees and broadcast them via `ServerPluginContext.broadcastToSubscribers` with message type `"plugin_intents"`. The plugin's client-side code (if any) SHALL NOT call `useUiPrimitive(...)` and SHALL NOT import shell components directly. The single exception is the transient input primitive exception defined by `plugin-ui-primitive-registry`: a not-yet-migrated client claim MAY look up a stateless modal input primitive (for example `ui:path-picker`) with `useUiPrimitiveOrNull` only. The shell, on each connected client, SHALL render incoming intents by resolving primitive names through its local primitive registry.

Plugins that ALREADY emit intent broadcasts (after migration) SHALL NOT also register React component claims for the same slot — the migration is per-claim, not parallel. Plugins that have NOT yet migrated MAY keep their refs-registry claims; the slot consumer renders the legacy claim until the intent path is wired.

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
- **AND** a call to the strict `useUiPrimitive` from that claim remains non-conforming
