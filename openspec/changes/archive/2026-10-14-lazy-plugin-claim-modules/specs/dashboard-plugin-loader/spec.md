## ADDED Requirements

### Requirement: Claims MAY name a lazily-loaded component module
A plugin manifest claim that names a `component` MAY also name a `module`: a path, relative to the plugin package root, of a client module that exports that component. For such a claim the generated plugin registry SHALL NOT import the component statically; it SHALL bind the claim's `Component` to a lazily-loaded component that fetches `module` the first time the claim renders, at most once per page. `predicate`, `shouldRender` and `labelComponent` references SHALL always resolve from the plugin's main client entry (they run before a claim renders and stay eager). Claims without `module` keep today's static named import. Every slot consumer that renders a claim `Component` SHALL render it inside a suspense boundary nested within the existing per-claim error boundary, so a pending load renders the slot's fallback (default: nothing) and a failed load is contained to that claim.

Registry generation SHALL fail when a `module` file does not exist or does not export the named `component`, and SHALL fail when the plugin's main client entry also exports that component (a static path would pin the module into the eager bundle and defeat the split).

#### Scenario: Lazy claim stays out of the cold-landing load
- **GIVEN** a plugin claims `{ "slot": "settings-section", "component": "FooSettings", "module": "./src/client/FooSettings.tsx" }`
- **WHEN** the production client is built
- **THEN** `FooSettings` is emitted in a chunk that is not part of the landing graph (entry script, `modulepreload` links and their static imports)

#### Scenario: Lazy claim renders after its module loads
- **WHEN** the Settings view first shows the plugin's settings page
- **THEN** the module is fetched once and `FooSettings` renders after it loads
- **AND** rendering the claim again does not refetch it

#### Scenario: Eager references stay eager
- **GIVEN** a lazy claim with `"predicate": "isFoo"`
- **WHEN** the registry is generated
- **THEN** `isFoo` is imported statically from the plugin's main client entry

#### Scenario: Failed lazy load is contained
- **WHEN** a lazy claim's module request fails
- **THEN** that claim renders its error-boundary state and other claims in the same slot render normally

#### Scenario: Module re-exported from the main entry is rejected
- **WHEN** the plugin's main client entry exports the component named by a claim with `module`
- **THEN** registry generation fails with an error naming the plugin, the component and the module

#### Scenario: Missing module export is rejected
- **WHEN** a claim's `module` does not export the named `component`
- **THEN** registry generation fails with an error naming the plugin, the slot, the component and the module
