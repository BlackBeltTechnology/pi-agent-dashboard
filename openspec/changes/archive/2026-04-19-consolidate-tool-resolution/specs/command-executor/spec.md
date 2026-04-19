## MODIFIED Requirements

### Requirement: Binary resolution happens in the runner
The runner SHALL resolve the command name (first element of `recipe.argv(input)`) to an absolute path before spawning. For names registered in `ToolRegistry`, the runner SHALL delegate to `registry.resolve(name).path` so that user overrides, managed-install strategies, and diagnostic trails apply uniformly. For unregistered names (fallback path), the runner SHALL delegate to `ToolResolver.which(name)` as before. The runner's own per-command `resolverCache` SHALL be removed — caching is now owned by the registry.

#### Scenario: Registered tool resolves via registry
- **WHEN** `run(recipe, input)` is called and the command name (e.g., `"npm"`, `"openspec"`, `"git"`) is registered in `ToolRegistry`
- **THEN** the runner SHALL call `registry.resolve(name)` and spawn using `Resolution.path`
- **AND** a registered override for that tool SHALL take effect without any changes to the Recipe

#### Scenario: Unregistered tool falls back to ToolResolver
- **WHEN** `run(recipe, input)` is called with a command name not registered in `ToolRegistry`
- **THEN** the runner SHALL call `ToolResolver.which(name)` directly
- **AND** the result SHALL NOT be cached inside the runner (the runner's own `resolverCache` no longer exists)

#### Scenario: Test-only rescan hook
- **WHEN** a test calls `registry.rescan()` between two `run()` invocations for the same registered command
- **THEN** the second `run()` SHALL re-resolve via the registry and SHALL observe any path change

#### Scenario: Absolute / relative path argv short-circuits resolution
- **WHEN** `recipe.argv(input)[0]` is an absolute or relative filesystem path
- **THEN** the runner SHALL skip both registry and `ToolResolver` lookup and use the path directly (existing behavior preserved)
