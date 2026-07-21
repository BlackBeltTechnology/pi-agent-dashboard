# dashboard-plugin-loader — delta

## ADDED Requirements

### Requirement: plugin_action dispatches by pluginId fan-out

The server's browser-gateway SHALL route a `plugin_action` message to the handler
registered by the plugin whose id matches `message.pluginId`, so multiple plugins
can service `plugin_action` concurrently without one shadowing another.

#### Scenario: Two plugins register plugin_action, both reachable

- **GIVEN** `flows-plugin` and `goal-plugin` each register a `plugin_action`
  handler
- **WHEN** a `plugin_action` with `pluginId:"flows"` arrives, then one with
  `pluginId:"goal"` arrives
- **THEN** each SHALL be delivered to its own plugin's handler, regardless of
  plugin load order

#### Scenario: Unknown pluginId errors, never silent-drops

- **WHEN** a `plugin_action` arrives with a `pluginId` that has no registered
  handler
- **THEN** the gateway SHALL surface a structured "no handler for pluginId" error
  to the sender and SHALL NOT silently discard the message

### Requirement: flows, kb, and automation expose working plugin_action handlers

`flows-plugin`, `kb-plugin`, and `automation-plugin` SHALL each register a
production `plugin_action` handler that dispatches to its existing server core.

#### Scenario: flows plugin_action runs a flow

- **WHEN** a `plugin_action` with `pluginId:"flows"`, `action:"flow.run"` and a
  valid payload arrives
- **THEN** flows-plugin SHALL invoke its flow-run path (not a logging stub) and
  report the outcome

#### Scenario: kb and automation mutations reach their cores

- **WHEN** a `plugin_action` targets `kb` (e.g. reindex) or `automation` (e.g. run)
  with a valid payload
- **THEN** the respective plugin SHALL execute the operation through its existing
  server core and return a result
