# dashboard-plugin-loader — delta

## ADDED Requirements

### Requirement: Every shipped plugin loads from a published install

No plugin workspace SHALL depend on monorepo-only module resolution. CI SHALL
verify this dynamically: for each workspace whose `pi-dashboard-plugin`
manifest declares a `server` entry, pack the workspace, extract it outside the
repository, install its dependencies, and import the server entry under plain
node+jiti with `JITI_TSCONFIG_PATHS` unset and no repository `tsconfig`
reachable. The check SHALL assert `typeof mod.default === "function"`, the
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

### Requirement: Clean-install QA boot proves plugins actually load

The `qa/` clean-install smoke SHALL install the dashboard AND at least one
plugin package into a clean prefix, then prove that plugin loaded. It SHALL
assert, in order:

1. discovery is non-empty and contains the installed plugin id — a clean
   prefix otherwise discovers zero plugins and every later assertion passes
   vacuously;
2. every discovered plugin is enabled in config before the asserted boot —
   plugins may declare `defaultEnabled: false`, so a boot that never attempts
   the broken plugin reports no failures. Since a config cannot be written
   before discovery has run, the smoke SHALL discover first (boot or probe)
   and assert on a subsequent boot;
3. no attempted plugin load failed. The assertion SHALL NOT be
   `loaded == discovered`: the loader legitimately reports `loaded: false`
   for unmet dependencies and unmet declared requirements, which a clean VM
   produces on healthy builds;
4. each loaded plugin's resolved path lies inside the install prefix, because
   discovery walks up from the loader module and can otherwise exercise a
   monorepo checkout present on the same host.

#### Scenario: Empty prefix cannot pass
- **GIVEN** a clean prefix with no plugin installed
- **WHEN** the smoke runs
- **THEN** it SHALL fail on the non-empty-discovery assertion

#### Scenario: Disabled-by-default plugin cannot hide a load failure
- **GIVEN** an installed plugin declaring `defaultEnabled: false` whose server entry is broken
- **WHEN** the smoke runs
- **THEN** it SHALL enable that plugin and SHALL fail

#### Scenario: Dependency-gated plugin does not fail the run
- **GIVEN** a plugin reported `loaded: false` for a missing dependency or unmet requirement
- **WHEN** the smoke evaluates results
- **THEN** that plugin SHALL NOT count as a failure

#### Scenario: Monorepo checkout cannot masquerade as the install
- **GIVEN** a monorepo checkout present on the host
- **WHEN** the smoke boots the installed dashboard
- **THEN** every loaded plugin path SHALL be inside the install prefix
