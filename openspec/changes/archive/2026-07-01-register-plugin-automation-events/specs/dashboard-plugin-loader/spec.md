## ADDED Requirements

### Requirement: Cross-plugin service seam

`ServerPluginContext` SHALL expose `provide(name: string, value: unknown): void` and `consume<T = unknown>(name: string): T | undefined`, backed by a single host-owned registry shared across all plugins in the process. `provide` SHALL store the value under `name` (last write wins). `consume` SHALL return the value previously provided under `name`, or `undefined` when none exists. The seam SHALL be in-process only; values SHALL NOT cross the bridge.

The loader's existing topological load order (by `manifest.dependsOn`) SHALL guarantee that a provider plugin's `registerPlugin` runs before any plugin that declares it in `dependsOn`, so a dependent's `consume` observes the provided value.

#### Scenario: Consumer observes provider's value

- **WHEN** plugin A calls `ctx.provide("automation.action-registry", registry)` in `registerPlugin`, and plugin B declares `dependsOn: ["A"]` and calls `ctx.consume("automation.action-registry")`
- **THEN** B SHALL receive the same registry instance A provided.

#### Scenario: Missing provider degrades gracefully

- **WHEN** a plugin calls `ctx.consume("absent-service")` and nothing was provided under that name
- **THEN** `consume` SHALL return `undefined` and SHALL NOT throw.
