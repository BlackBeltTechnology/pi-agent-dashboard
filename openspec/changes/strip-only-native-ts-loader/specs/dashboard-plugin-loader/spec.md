## MODIFIED Requirements

### Requirement: Every shipped plugin loads from a published install

No plugin workspace SHALL depend on monorepo-only module resolution. CI SHALL
verify this dynamically: for each workspace whose `pi-dashboard-plugin`
manifest declares a `server` entry, pack the workspace, extract it outside the
repository, install its dependencies, and import the server entry under plain Node with the dashboard's Node-native
TypeScript loader (the same strip-only loader the server uses) and no
repository `tsconfig` reachable, so a plugin whose TypeScript is not erasable
fails here instead of at a user's server boot. The check SHALL assert `typeof mod.default === "function"`, the
same contract the loader enforces.

First-party workspace dependencies SHALL be installed from locally packed
tarballs, not resolved from the registry, so the verified graph is the working
tree. Registry resolution would test a stale published copy and would fail
spuriously on a release-prep PR whose versions are not yet published.

Workspaces whose manifest declares no `server` entry (for example the
`fixture: true` demo plugin) are out of scope for this check.

This check complements `scripts/verify-published-imports.mjs`, which remains
the static gate; it removes the need for that script's per-specifier waivers,
not the script itself.

#### Scenario: Plugin with a monorepo-only specifier fails CI
- **GIVEN** a plugin whose server entry imports a specifier resolvable only via repository `tsconfig` `paths`
- **WHEN** the install-load verification runs
- **THEN** it SHALL exit non-zero naming the plugin and the unresolvable specifier

#### Scenario: Working-tree runtime is the one under test
- **GIVEN** a PR that changes `dashboard-plugin-runtime`
- **WHEN** the install-load verification runs
- **THEN** the extracted plugin SHALL import the packed working-tree runtime, not a registry version

#### Scenario: Server-less plugin is skipped, not failed
- **GIVEN** a workspace whose `pi-dashboard-plugin` manifest declares no `server` entry
- **WHEN** the install-load verification runs
- **THEN** that workspace SHALL be skipped and reported as skipped

#### Scenario: Plugin with non-erasable TypeScript fails CI
- **GIVEN** a plugin whose server entry graph declares an `enum` or a constructor parameter property
- **WHEN** the install-load verification runs
- **THEN** it SHALL exit non-zero naming the plugin and the offending file

## ADDED Requirements

### Requirement: Plugin server TypeScript must be erasable
A dashboard plugin's server entry and everything it imports from TypeScript source SHALL use only syntax accepted by Node's strip-only type stripping (no `enum`, runtime `namespace`, or constructor parameter properties) and SHALL import type-only symbols with `import type`, because the dashboard server loads it with the Node-native strip-only loader. A third-party plugin that violates this SHALL fail to load in isolation, per "Plugin failure does not crash the shell", with the load error naming the offending file.

#### Scenario: Non-erasable third-party plugin is isolated
- **GIVEN** an installed plugin whose server entry declares a class with a constructor parameter property
- **WHEN** the dashboard server boots
- **THEN** the server SHALL start and other plugins SHALL load
- **AND** `/api/health` `plugins[]` SHALL report that plugin with an error naming the file
