## MODIFIED Requirements

### Requirement: Bundled dashboard server ships the pi runtime
The packaged Electron app SHALL ship the following as an extraResource, so the server runs on a clean OS with no user-side `npm install`:
- the dashboard server source;
- the production-dependency tree of every workspace it imports;
- pi (`@earendil-works/pi-coding-agent`), `@fission-ai/openspec` and `tsx`.

`packages/electron/scripts/bundle-server.mjs` SHALL implement the bundling in Node, so it runs on every host. pi, openspec and tsx SHALL arrive in the bundled tree as regular production dependencies of the server workspace. They SHALL NOT be installed at runtime into `~/.pi-dashboard/`, and SHALL NOT come from an offline cache.

#### Scenario: Server bundled via Node-native build script
- **WHEN** `node packages/electron/scripts/bundle-server.mjs` runs
- **THEN** it SHALL copy to `resources/server/`:
  - the source of every `BUNDLED_WORKSPACE_PKGS` package (at least `packages/server/`, `packages/shared/`, `packages/extension/` and `packages/dashboard-plugin-runtime/`) as the `npm install` workspace input;
  - the built web client;
  - a synthetic workspace `package.json`.

#### Scenario: Workspace source ships once, under node_modules
- **WHEN** `bundle-server.mjs` completes WITHOUT `--source-only`, or `docker-make.sh` completes
- **THEN** each bundled workspace package's source SHALL exist under `resources/server/node_modules/@blackbelt-technology/<pkg>/`
- **AND** `resources/server/packages/` SHALL contain no directory other than `dist`
- **AND** `resources/server/package.json` SHALL carry no `workspaces` field

#### Scenario: Release-lock audit precedes workspace deletion
- **WHEN** `bundle-server.mjs --release-lock=<X>` runs
- **THEN** `auditInstalledTree` SHALL run while `packages/<dir>` still exists, and SHALL pass
- **AND** the `packages/<dir>` deletion SHALL happen only after the audit and the materialization

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
- **THEN** the file SHALL list the bundled workspaces as the input of the bundle's install step
- **AND** it SHALL NOT hand-declare any dependency (pi, openspec, tsx or other)
- **AND** pi, openspec and tsx SHALL be pulled in only through the server workspace's own `dependencies`

#### Scenario: Synthetic root carries the bundled-plugin dependency union
- **WHEN** `bundle-server.mjs` writes `resources/server/package.json`
- **THEN** its `dependencies` block SHALL equal the third-party runtime dependencies collected from the bundled plugins' `dependencies`, and nothing else

#### Scenario: Bundle script runs on Windows without bash
- **WHEN** the electron matrix's `windows-latest` variant invokes the server-bundling step
- **THEN** the step SHALL execute via `node` (not `bash`) and SHALL NOT depend on `cp`, `find`, `chmod`, `du`, `rm -rf`, or `xattr` external binaries

## ADDED Requirements

### Requirement: Bundled server tree is pruned by one shared helper

`scripts/lib/prune-bundle.mjs` SHALL prune the bundled server tree last, in every builder
(`bundle-server.mjs` full mode, before the keyring gate; `docker-make.sh`). Third-party packages
SHALL lose `*.md`, `*.map`, `CHANGELOG*`, `LICENSE*` and `*.d.{ts,mts,cts}` files and
`__tests__`/`test`/`tests` directories. `@blackbelt-technology/*` and `resources/plugins/*` SHALL lose only
`AGENTS.md`/`*.AGENTS.md` outside `.pi/` and `__tests__` directories.

#### Scenario: Declaration variants are pruned
- **WHEN** a third-party dependency ships `index.d.mts` and `index.d.cts` next to `index.js`
- **THEN** the bundle SHALL keep `index.js` and SHALL contain neither declaration file

#### Scenario: Third-party licence notice survives
- **WHEN** `@napi-rs/keyring-linux-*` ships `LICENSE.third-party.md`
- **THEN** the file SHALL be present in the bundle after the prune

#### Scenario: Package named like a pruned directory
- **WHEN** a dependency is installed at `node_modules/test` or `node_modules/a/node_modules/tests`, each containing a `package.json`
- **THEN** the prune SHALL NOT remove that package directory

#### Scenario: Bridge extension skills and licences survive
- **WHEN** the bundle contains `node_modules/@blackbelt-technology/pi-dashboard-extension/.pi/skills/browser/{SKILL.md,LICENSE,UPSTREAM.md}`
- **THEN** all three files SHALL be present after the prune
- **AND** the bundled extension's `commands/*.md` and `agents/*.md` files SHALL be present

#### Scenario: First-party DOX sidecars are pruned
- **WHEN** a materialized workspace copy contains `src/AGENTS.md` and `src/cli.ts.AGENTS.md`
- **THEN** neither file SHALL be present after the prune
- **AND** `src/cli.ts` SHALL be present

#### Scenario: Prune failure fails the build
- **WHEN** the helper cannot remove a matched path (e.g. `EPERM` or `EBUSY`)
- **THEN** the builder SHALL exit non-zero and the log SHALL name the failing path

#### Scenario: Served web client untouched
- **WHEN** `node_modules/@blackbelt-technology/pi-dashboard-web/dist` or `packages/dist/client` contain `*.map` or licence files
- **THEN** the prune SHALL leave them in place

### Requirement: Packaged file-count budget gate

Every Electron build leg SHALL run `scripts/assert-bundle-file-budget.mjs` on the packaged app's
`resources/` directory, after the existing GO/NO-GO gates. It SHALL count regular files via `lstat`,
never following symlinks, and SHALL exit non-zero above the budget pinned for that platform and
arch, printing the 20 directories with the most files.

#### Scenario: Bundle within budget
- **WHEN** the packaged `resources/` file count is at or below the pinned budget
- **THEN** the gate SHALL exit 0 and print the count and the budget

#### Scenario: Leg without a pinned budget
- **WHEN** the gate runs for a platform/arch with no pinned budget
- **THEN** it SHALL print the count and exit 0

#### Scenario: Bundle grows past budget
- **WHEN** a new dependency pushes the packaged file count above the pinned budget
- **THEN** the gate SHALL exit non-zero and list the top-20 directories by file count

### Requirement: Windows install timing is reported

The win32-x64 NSIS smoke step in `_electron-build.yml` SHALL time the silent install of the built
`Setup.exe`. It SHALL write `install_seconds`, the runner image and `installed_file_count` (the
budget gate's counting rule, applied to the install directory after `/S` returns) to the job summary. The timing SHALL be informational and
SHALL NOT fail the job.

#### Scenario: Timing appears in the job summary
- **WHEN** the win32-x64 NSIS smoke step installs `PI-Dashboard-Setup-<v>-x64.exe` with `/S`
- **THEN** the job summary SHALL contain the elapsed install seconds and the installed file count

### Requirement: CI exercises the NSIS upgrade from the previous release

The win32-x64 Electron leg SHALL install the latest published release's `Setup.exe` silently, then
install the newly built `Setup.exe` over it, start the app once, and assert the pi settings
registration of the dashboard bridge extension.

#### Scenario: Upgrade leaves exactly the node_modules extension registered
- **WHEN** the new `Setup.exe /S` runs over an installed previous release and the app has started once
- **THEN** `~/.pi/agent/settings.json` `packages` SHALL contain `<install>/resources/server/node_modules/@blackbelt-technology/pi-dashboard-extension`
- **AND** it SHALL NOT contain any path ending in `resources/server/packages/extension`
