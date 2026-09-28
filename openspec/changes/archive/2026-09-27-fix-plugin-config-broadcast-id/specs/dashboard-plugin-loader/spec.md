## MODIFIED Requirements

### Requirement: Reactive plugin config broadcast

When any plugin's config changes (whether via REST endpoint or server-side `updatePluginConfig`), the dashboard server SHALL broadcast `plugin_config_update { id, config }` to all subscribed browsers. The client-side `pluginContext.usePluginConfig<T>()` hook SHALL subscribe to this event and re-render its consumers with the new config within one frame.

The broadcast payload SHALL contain only the calling plugin's namespace, never other plugins' configs.

#### Scenario: All clients receive the update

- **WHEN** plugin A writes its config and three browsers are subscribed
- **THEN** all three browsers SHALL receive `plugin_config_update { id: "A", config }`.

#### Scenario: Hook re-renders on update

- **WHEN** a `usePluginConfig<T>()` hook in plugin A's settings React component is mounted, and a config write happens
- **THEN** the component SHALL re-render with the new config; React state derived from old config SHALL be replaced.

#### Scenario: Cross-plugin config not exposed in broadcast

- **WHEN** plugin A writes its config
- **THEN** the broadcast payload SHALL NOT contain plugin B's namespace; clients can only learn other plugins' configs by subscribing to those plugins (which is not currently supported).

#### Scenario: Server-side updatePluginConfig broadcast carries the plugin id

- **WHEN** plugin A's server entry calls `ctx.updatePluginConfig(partial)`
- **THEN** the server SHALL broadcast `plugin_config_update { id: "A", config }` with the merged, client-redacted config
- **AND** the client SHALL apply it to plugin A's config store (never under an undefined or missing id)
