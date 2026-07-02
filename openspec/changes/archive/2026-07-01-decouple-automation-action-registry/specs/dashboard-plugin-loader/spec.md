## ADDED Requirements

### Requirement: Prefix enumeration over the service board

`ServerPluginContext` SHALL expose `consumeAll<T = unknown>(prefix: string): Array<{ key: string; value: T }>` returning every value published via `provide(name, …)` whose `name` starts with `prefix`, paired with its key. It SHALL read the same host-owned in-process service registry as `consume`; values SHALL NOT cross the bridge. Order of results is unspecified. An empty result SHALL be returned (never throw) when no key matches.

`consumeAll` enables publish/collect: a producer `provide`s a namespaced key and a consumer enumerates the namespace lazily, independent of plugin load order.

#### Scenario: Collect all publishers under a namespace

- **WHEN** plugin A calls `provide("automation.action.flows", cA)` and plugin B calls `provide("automation.action.core", cB)`, then a consumer calls `consumeAll("automation.action.")`
- **THEN** the consumer SHALL receive entries for both keys with values `cA` and `cB`.

#### Scenario: Order independence

- **WHEN** a consumer calls `consumeAll(prefix)` after all plugins have loaded
- **THEN** it SHALL observe every matching contribution regardless of the order in which producers and the consumer were loaded.

#### Scenario: No match

- **WHEN** `consumeAll("nope.")` is called and no provided key starts with `nope.`
- **THEN** it SHALL return an empty array and SHALL NOT throw.
