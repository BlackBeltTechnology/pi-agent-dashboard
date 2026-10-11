## ADDED Requirements

### Requirement: Staged overlay rejects plugins with unresolved dependencies

After materializing the first-party plugins of runtime release X, staging SHALL verify that
every package in each materialized plugin's `dependencies` resolves by Node module resolution
from that plugin's directory, searching `node_modules` directories no higher than the staged
release root. Any unresolved dependency SHALL fail staging with error code
`plugin_deps_unresolved` naming each `<plugin> → <dependency>` pair, SHALL remove the partial
staging directory, and SHALL leave the pending request unchanged.

#### Scenario: Nested-only dependency lost during materialization

- **WHEN** npm installed a plugin's dependency only under that plugin's own nested `node_modules`
- **AND** materialization copies the plugin without its nested `node_modules`
- **THEN** staging SHALL fail with `plugin_deps_unresolved` naming the plugin and the dependency
- **AND** no `versions/X` directory SHALL be committed

#### Scenario: Dependency above the release root does not count

- **WHEN** a plugin dependency is reachable only from a `node_modules` above the staged release root
- **THEN** staging SHALL fail with `plugin_deps_unresolved`

#### Scenario: Fully resolvable release stages normally

- **WHEN** every dependency of every materialized plugin resolves inside the staged root
- **THEN** staging SHALL proceed to the existing verification and commit steps
