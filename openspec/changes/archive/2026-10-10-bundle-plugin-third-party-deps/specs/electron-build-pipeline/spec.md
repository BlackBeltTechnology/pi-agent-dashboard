## ADDED Requirements

### Requirement: Bundled plugins' third-party runtime dependencies are installed into the bundle

The bundled dashboard server SHALL install every third-party (non-`@blackbelt-technology/*`)
package listed in the `dependencies` of each bundled plugin (`piDashboard.bundledPlugins`,
fixtures excluded) into the bundle's shared `node_modules`, so a bundled plugin's imports
resolve without relying on another package happening to depend on the same module. Packages
listed only in `devDependencies`, `peerDependencies` or `optionalDependencies` SHALL NOT be
added. Client-only dependencies SHALL NOT be skipped by this rule (install-all default).

#### Scenario: Plugin-only dependency is installed

- **WHEN** a bundled plugin declares a third-party dependency (e.g. `gmail-plugin` →
  `oauth4webapi`) that no bundle workspace package declares
- **AND** the Electron server bundle is built
- **THEN** that dependency SHALL be present in the bundle's shared `node_modules`
- **AND** it SHALL be resolvable from `resources/plugins/<id>/`

#### Scenario: Dev-only and peer dependencies are not added

- **WHEN** a bundled plugin lists a package only in `devDependencies`, `peerDependencies` or
  `optionalDependencies`
- **THEN** the build SHALL NOT add it to the bundle because of that plugin

### Requirement: Conflicting plugin dependency declarations fail the build

The bundle build SHALL fail, naming the package and every declaring package with its specifier,
when a third-party dependency declared by a bundled plugin is declared with a different
specifier string by another bundled plugin or by a bundle workspace package. The build SHALL
also fail when a bundled plugin declares a third-party dependency with a specifier containing
`:` or `/` (e.g. `workspace:`, `file:`, `link:`, `portal:`, git or URL specifiers, `npm:`
aliases, `user/repo` shorthand). The build SHALL NOT silently pick one version.

#### Scenario: Two plugins disagree on a range

- **WHEN** plugin A declares `yaml@^2.9.0` and plugin B declares `yaml@^1.10.0`
- **THEN** the bundle build SHALL exit non-zero
- **AND** the error SHALL name `yaml`, plugin A with `^2.9.0`, and plugin B with `^1.10.0`

#### Scenario: Plugin disagrees with a bundle workspace

- **WHEN** a bundled plugin declares `jose@^5.0.0` and the server workspace declares `jose@^6.0.0`
- **THEN** the bundle build SHALL exit non-zero naming `jose`, the plugin and the server workspace

#### Scenario: Identical specifiers merge

- **WHEN** several plugins and the server workspace declare `@fastify/rate-limit@^11.2.0`
- **THEN** the build SHALL install it once and SHALL NOT fail

#### Scenario: Non-registry specifier rejected

- **WHEN** a bundled plugin declares a third-party dependency as `file:../vendor/x`
- **THEN** the bundle build SHALL exit non-zero naming the plugin and the dependency

### Requirement: Built-bundle gate asserts every bundled plugin dependency resolves

After the server bundle is built, the bundle-completeness gate SHALL verify, for every plugin
directory under `resources/plugins/`, that each package in its `dependencies` (first-party and
third-party) is installed in a `node_modules` directory on the path from that plugin directory up
to, and no higher than, the bundle root. The gate SHALL exit non-zero listing every unresolved
`<plugin> → <dependency>` pair. The gate checks declared dependencies, not import sites. A
plugin directory without a `package.json` SHALL be skipped by this check (the presence check owns
it). On success the gate SHALL print the installed version of every resolved third-party plugin
dependency. The gate SHALL run on every CI electron build leg and SHALL be invoked by the local
installer build after the server bundle is (re)built.

#### Scenario: Missing dependency fails the gate

- **WHEN** `resources/plugins/gmail-plugin/package.json` declares `oauth4webapi`
- **AND** no `node_modules/oauth4webapi/` exists between that plugin directory and the bundle root
- **THEN** the gate SHALL exit non-zero and report `gmail-plugin → oauth4webapi`

#### Scenario: Dependency outside the bundle root does not count

- **WHEN** a dependency is reachable only from a `node_modules` above the bundle root
- **THEN** the gate SHALL report it as unresolved

#### Scenario: Complete bundle passes

- **WHEN** every declared dependency of every bundled plugin resolves inside the bundle
- **THEN** the gate SHALL exit zero
- **AND** its output SHALL list each third-party plugin dependency with its installed version

### Requirement: Built-bundle load gate asserts every bundled plugin loads

The built-bundle plugin-load gate SHALL boot the bundled server with every bundled plugin
enabled (config keyed by manifest id) and SHALL pass only when the server log contains
`Loaded plugin "<id>"` for every bundled plugin manifest id whose manifest declares a `server`
entry (e.g. `gmail`, not the directory name `gmail-plugin`) and contains no
`Failed to load plugin` and no `Skipping plugin` line. The gate exercises eager imports of each
server entry; lazily imported modules are covered only by the resolvability gate. A `Loaded`,
`Failed to load` or `Skipping` line SHALL count as that id's verdict; the gate SHALL stop waiting
once every expected id has a verdict, or when no new verdict has appeared for the verdict idle
timeout. On failure
it SHALL list each plugin id that did not load and print the server log tail.

#### Scenario: A plugin fails to import a dependency

- **WHEN** the bundled server logs `Failed to load plugin "gmail": Cannot find module 'oauth4webapi'`
- **THEN** the gate SHALL exit non-zero and name `gmail`

#### Scenario: A plugin is skipped

- **WHEN** the bundled server logs `Skipping plugin "<id>" — missing/disabled dep: …`
- **THEN** the gate SHALL treat that as the id's verdict without waiting for the deadline
- **AND** SHALL exit non-zero naming the id

#### Scenario: A plugin silently never loads

- **WHEN** a bundled plugin id has no verdict line and no new verdict appears for the idle timeout
- **THEN** the gate SHALL exit non-zero and name that id

#### Scenario: Many sequential activations do not exhaust the budget

- **WHEN** 20 plugins each take a few seconds to activate, totalling more than one idle timeout
- **AND** each activation produces a verdict line within the idle timeout of the previous one
- **THEN** the gate SHALL keep waiting and SHALL pass when all are loaded

#### Scenario: Server-less plugin is not expected to log

- **WHEN** a bundled plugin's manifest declares no `server` entry
- **THEN** the gate SHALL NOT require a `Loaded plugin` line for it

#### Scenario: Default-disabled plugin is still exercised

- **WHEN** a bundled plugin's manifest sets `defaultEnabled: false` (e.g. `browser`)
- **THEN** the gate SHALL enable it for the boot and require `Loaded plugin "<id>"`

## MODIFIED Requirements

### Requirement: First-party runtime plugins are bundled into resources/plugins/

The bundled dashboard server SHALL include every non-fixture runtime plugin in `packages/*`
(each package whose `package.json` carries a `pi-dashboard-plugin` manifest with
`fixture !== true`) so a fresh Electron install exposes every plugin surface with no user-side
install step. (`BUNDLED_PLUGINS` in scenario names below refers to this list.) A plugin that is also a bundle workspace package (e.g. `mcp-client-plugin`) SHALL
still be included, because the loader discovers plugins from `resources/plugins/`, not
`node_modules`. The set is declared by `packages/server/package.json#piDashboard.bundledPlugins`,
and each entry SHALL be copied into `resources/plugins/<plugin-dir>/`. The list SHALL contain no
stale entry (an entry with no matching runtime plugin on disk).

#### Scenario: Every runtime plugin dir is listed in BUNDLED_PLUGINS

- **WHEN** a non-fixture runtime plugin exists in `packages/*` (has a `pi-dashboard-plugin`
  manifest, `fixture !== true`)
- **THEN** its directory name SHALL appear in `piDashboard.bundledPlugins`
- **AND** `bundle-server.mjs` SHALL copy it into `resources/plugins/<plugin-dir>/`

#### Scenario: grammar-plugin ships in the installer

- **WHEN** the Electron app is packaged
- **THEN** `resources/plugins/grammar-plugin/` SHALL be present
- **AND** a fresh install SHALL show the Settings ▸ Plugins ▸ "Grammar & Spelling" surface

#### Scenario: No stale BUNDLED_PLUGINS entry

- **WHEN** a plugin dir is removed from `packages/*`
- **THEN** its name SHALL NOT remain in `piDashboard.bundledPlugins` (the completeness invariant
  rejects entries with no matching runtime plugin on disk)

### Requirement: Bundle freshness invalidation

`build-installer.sh` SHALL re-invoke `bundle-server.mjs` whenever ANY of the following sources is newer than `resources/server/.bundle-stamp`, OR the stamp file does not exist:

- `packages/<ws>/src/` (recursive mtime) and `packages/<ws>/package.json` for every `<ws>` in `BUNDLED_WORKSPACE_PKGS`
- `packages/<id>/src/` (recursive mtime) and `packages/<id>/package.json` for every `<id>` in `packages/server/package.json#piDashboard.bundledPlugins`
- `packages/server/package.json`
- `packages/dist/index.html` (Vite client output; `packages/client/vite.config.ts` `outDir: ../dist`)
- `packages/electron/scripts/bundle-server.mjs`

The watched workspace packages and plugins SHALL be derived from `BUNDLED_WORKSPACE_PKGS` in `bundle-server.mjs` and `piDashboard.bundledPlugins` at build time, not hardcoded in `build-installer.sh`.

`bundle-server.mjs` SHALL write `<resources/server>/.bundle-stamp` ONLY on successful exit (post-verify passed).

#### Scenario: First build, no stamp file

- **WHEN** `build-installer.sh` runs AND `resources/server/.bundle-stamp` does not exist
- **THEN** the script SHALL run `bundle-server.mjs`

#### Scenario: Server source modified after last bundle

- **WHEN** `packages/server/src/server.ts` has an mtime newer than `resources/server/.bundle-stamp`
- **THEN** `build-installer.sh` SHALL re-invoke `bundle-server.mjs`
- **AND** SHALL NOT skip with "Bundled server already present"

#### Scenario: Shared protocol package modified after last bundle

- **WHEN** any file under `packages/shared/src/` has an mtime newer than `resources/server/.bundle-stamp`
- **THEN** `build-installer.sh` SHALL re-invoke `bundle-server.mjs`

#### Scenario: Bundled plugin dependency changed after last bundle

- **WHEN** `packages/gmail-plugin/package.json` has an mtime newer than `resources/server/.bundle-stamp`
- **THEN** `build-installer.sh` SHALL re-invoke `bundle-server.mjs`

#### Scenario: Client rebuilt after last bundle

- **WHEN** `packages/dist/index.html` mtime > `.bundle-stamp` mtime
- **THEN** `build-installer.sh` SHALL re-invoke `bundle-server.mjs`

#### Scenario: Cache is fresh

- **WHEN** the stamp file exists AND every watched source has mtime <= stamp mtime
- **THEN** the script SHALL skip the bundler invocation

### Requirement: Bundled dashboard server ships the pi runtime
The packaged Electron app SHALL ship the following as an extraResource, so the server runs on a clean OS with no user-side `npm install`:
- the dashboard server source;
- the production-dependency tree of every workspace it imports;
- pi (`@earendil-works/pi-coding-agent`), `@fission-ai/openspec` and `tsx`.

`packages/electron/scripts/bundle-server.mjs` SHALL implement the bundling in Node, so it runs on every host. pi, openspec and tsx SHALL arrive in the bundled tree as regular production dependencies of the server workspace. They SHALL NOT be installed at runtime into `~/.pi-dashboard/`, and SHALL NOT come from an offline cache.

#### Scenario: Server bundled via Node-native build script
- **WHEN** `node packages/electron/scripts/bundle-server.mjs` runs
- **THEN** it SHALL copy to `resources/server/`:
  - the source of every `BUNDLED_WORKSPACE_PKGS` package (at least `packages/server/`, `packages/shared/`, `packages/extension/` and `packages/dashboard-plugin-runtime/`);
  - the built web client;
  - a synthetic workspace `package.json`.

#### Scenario: Source-only mode for cross-platform builds
- **WHEN** `node packages/electron/scripts/bundle-server.mjs --source-only` runs
- **THEN** it SHALL run every copy step that precedes `npm install`, and SHALL skip `npm install` (native modules must be built on the target platform) along with every step that depends on its output

#### Scenario: Bundled tree ships the pi runtime
- **WHEN** the Electron app is packaged AND `bundle-server.mjs` runs WITHOUT `--source-only`
- **THEN** `resources/server/node_modules/` SHALL contain `fastify`, `ws`, `node-pty`, and the other deps the bundled `cli.ts` imports
- **AND** `resources/server/node_modules/` SHALL contain `@earendil-works/pi-coding-agent`, `@fission-ai/openspec` and `tsx`
- **AND** `resources/server/node_modules/` SHALL NOT contain the legacy `@mariozechner/pi-coding-agent` fork

#### Scenario: Synthetic package.json declares no dependencies directly
- **WHEN** `bundle-server.mjs` writes `resources/server/package.json`
- **THEN** the file SHALL list the bundled workspaces
- **AND** it SHALL NOT hand-declare any dependency (pi, openspec, tsx or other)
- **AND** pi, openspec and tsx SHALL be pulled in only through the server workspace's own `dependencies`

#### Scenario: Synthetic root carries the bundled-plugin dependency union
- **WHEN** `bundle-server.mjs` writes `resources/server/package.json`
- **THEN** its `dependencies` block SHALL equal the third-party runtime dependencies collected from the bundled plugins' `dependencies`, and nothing else

#### Scenario: Bundle script runs on Windows without bash
- **WHEN** the electron matrix's `windows-latest` variant invokes the server-bundling step
- **THEN** the step SHALL execute via `node` (not `bash`) and SHALL NOT depend on `cp`, `find`, `chmod`, `du`, `rm -rf`, or `xattr` external binaries
