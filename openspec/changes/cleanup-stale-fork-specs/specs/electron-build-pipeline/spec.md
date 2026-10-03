## ADDED Requirements

### Requirement: Bundled dashboard server ships the pi runtime
The packaged Electron app SHALL ship the following as an extraResource, so the server runs on a clean OS with no user-side `npm install`:
- the dashboard server source;
- the production-dependency tree of every workspace it imports;
- pi (`@earendil-works/pi-coding-agent`), `@fission-ai/openspec` and `tsx`.

`packages/electron/scripts/bundle-server.mjs` SHALL implement the bundling in Node, so it runs on every host. pi, openspec and tsx SHALL arrive in the bundled tree as regular production dependencies of the server workspace. They SHALL NOT be installed at runtime into `~/.pi-dashboard/`, and SHALL NOT come from an offline cache.

#### Scenario: Server bundled via Node-native build script
- **WHEN** `node packages/electron/scripts/bundle-server.mjs` runs
- **THEN** it SHALL copy to `resources/server/`:
  - the `packages/server/`, `packages/shared/`, `packages/extension/` and `packages/dashboard-plugin-runtime/` source;
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
- **THEN** the file SHALL list the bundled workspaces and SHALL NOT contain a `dependencies` block
- **AND** pi, openspec and tsx SHALL be pulled in only through the server workspace's own `dependencies`

#### Scenario: Bundle script runs on Windows without bash
- **WHEN** the electron matrix's `windows-latest` variant invokes the server-bundling step
- **THEN** the step SHALL execute via `node` (not `bash`) and SHALL NOT depend on `cp`, `find`, `chmod`, `du`, `rm -rf`, or `xattr` external binaries

## MODIFIED Requirements

### Requirement: NSIS install location is bootstrap-agnostic
The NSIS install location SHALL NOT be hardcoded anywhere in the Electron, server, or shared code. The Electron main process SHALL resolve the running install location dynamically, from `process.resourcesPath` and `process.execPath`. This guarantees the `selectLaunchSource()` resolver in `packages/electron/src/lib/launch-source.ts` works identically for the per-user default (`%LOCALAPPDATA%\Programs\PI Dashboard\`) and any user-chosen path like `D:\MyApps\PI Dashboard\`.

#### Scenario: Setup.exe-installed app resolves via existing launch source regardless of install dir
- **WHEN** the user launches `PI Dashboard.exe` from any directory chosen during install (per-user default or user-chosen)
- **THEN** `selectLaunchSource()` SHALL resolve to the same `bundled` source (from `<process.resourcesPath>/server/`) as every other packaged install, when no `attach`, `localLink` or `overlay` source applies first
- **AND** no new source kind SHALL be added to handle Setup.exe installs
- **AND** no module under `packages/electron/src/`, `packages/server/src/`, or `packages/shared/src/` SHALL contain a hardcoded path matching `%LOCALAPPDATA%\Programs\PI Dashboard` outside of documentation strings

### Requirement: Local builder produces correct artifacts across arches
The local-build helper `packages/electron/scripts/build-installer.sh` SHALL produce arch-correct macOS DMGs when invoked back-to-back with different `--arch` values, without requiring the user to manually clean intermediate caches between runs.

#### Scenario: Stale-arch caches are invalidated automatically
- **WHEN** `build-installer.sh` runs on darwin with a requested arch that differs from the previously-built arch (tracked via `resources/.last-arch` sentinel)
- **THEN** it SHALL delete `resources/node/` and `resources/server/` before re-running the corresponding bundle steps
- **AND** it SHALL update the sentinel after the bundle completes

#### Scenario: Cross-arch native modules built via Rosetta
- **WHEN** `build-installer.sh` runs on an Apple Silicon host (`uname -m` = `arm64`) with `--arch x64`
- **THEN** it SHALL verify Rosetta 2 is installed by probing `arch -x86_64 /usr/bin/true` and exit non-zero with an actionable error message (`softwareupdate --install-rosetta --agree-to-license`) if the probe fails
- **AND** it SHALL invoke `bundle-server.mjs` under `arch -x86_64` so that npm installs x64 prebuilt binaries (notably node-pty's `prebuilds/darwin-x64/pty.node`)

#### Scenario: Intel host cannot cross-build arm64 locally
- **WHEN** `build-installer.sh` runs on an Intel host (`uname -m` = `x86_64`) with `--arch arm64`
- **THEN** it SHALL exit non-zero with a clear message that Intel hosts cannot cross-build arm64 locally (Rosetta is one-way) and recommend using CI for arm64 validation

#### Scenario: --mac-both produces both DMGs in one run
- **WHEN** `build-installer.sh --mac-both` runs on an Apple Silicon host
- **THEN** it SHALL build the arm64 DMG, invalidate per-arch caches, build the x64 DMG, and emit a final smoke summary listing both output files with their Mach-O arch tags from `file`
- **AND** it SHALL fail fast on Intel hosts and on non-darwin hosts with a clear error message

## REMOVED Requirements

### Requirement: Bundled-server tree intentionally excludes pi-coding-agent
**Reason**: Inverted by the R3 dependency lift. pi, openspec and tsx are now bundled in `resources/server/node_modules/`. The managed-dir, offline-cacache and `installStandalone()` model this requirement defended is gone, along with `offline-packages.json` and the `@mariozechner/*` pins.
**Migration**: None. See change `eliminate-electron-runtime-install`. Bundle contents are now specified by "Bundled dashboard server ships the pi runtime" above.

### Requirement: Bundled dashboard server
**Reason**: It said pi, openspec and tsx are NOT bundled and come from the managed dir through `installStandalone()` and the offline cacache. The R3 dependency lift in `eliminate-electron-runtime-install` inverted that.
**Migration**: Replaced by "Bundled dashboard server ships the pi runtime" (ADDED above).

### Requirement: Bundled-extensions step in publish workflow
**Reason**: `bundle-recommended-extensions.sh` and `bundle-server.sh` no longer exist. The release workflow (`.github/workflows/_electron-build.yml`) runs only `bundle-server.mjs`, and the `bundled-extensions` resource was removed with the runtime install.
**Migration**: None. See change `eliminate-electron-runtime-install`. Bundle contents are specified by "Bundled dashboard server ships the pi runtime" above.
