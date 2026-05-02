## ADDED Requirements

### Requirement: Electron devDependency pinned to literal version
The `packages/electron/package.json` `devDependencies.electron` field SHALL be a literal semver string (e.g. `"32.3.3"`), NOT a range (`"^32.0.0"`). `app-builder-lib`'s `getElectronVersionFromInstalled` does not walk up the workspace tree to find an electron module hoisted to the root `node_modules/`, so it falls back to reading the version literal from `packages/electron/package.json` and applying a fixed-version regex (`/^\d/`). A range value beginning with `^` or `~` fails the regex and produces `Cannot compute electron version from installed node modules` on Windows NSIS builds (the only consumer of electron-builder under the hood). Pinning the literal value is the workaround electron-builder itself recommends in [issue #3984](https://github.com/electron-userland/electron-builder/issues/3984#issuecomment-504968246).

#### Scenario: electron field is a literal version
- **WHEN** `packages/electron/package.json` is parsed
- **THEN** `devDependencies.electron` SHALL match the regex `^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$` (a literal semver, no `^` or `~` prefix)

#### Scenario: Windows NSIS build resolves electron version
- **WHEN** the electron matrix's `windows-latest` variant runs `electron-forge make` and the NSIS maker invokes `app-builder-lib`
- **THEN** `getElectronVersionFromInstalled` SHALL return successfully without throwing `Cannot compute electron version from installed node modules`

## MODIFIED Requirements

### Requirement: Bundled dashboard server
The packaged Electron app SHALL include the dashboard server source and dependencies as an extraResource, so the server can run on a clean OS without npm install. The bundling logic SHALL be implemented in `packages/electron/scripts/bundle-server.mjs` (Node-native, runnable on every host) — NOT a bash script — so it works identically on Windows runners without depending on Git for Windows' MSYS2 layer.

#### Scenario: Server bundled via Node-native build script
- **WHEN** `node packages/electron/scripts/bundle-server.mjs` runs
- **THEN** it SHALL copy `packages/server/`, `packages/shared/`, and `packages/extension/` source, the built web client, and a workspace `package.json` to `resources/server/`

#### Scenario: Source-only mode for cross-platform builds
- **WHEN** `node packages/electron/scripts/bundle-server.mjs --source-only` runs
- **THEN** it SHALL copy source and client only, skipping `npm install` (native modules must be built on the target platform)

#### Scenario: Native modules built per platform
- **WHEN** building for Linux via Docker
- **THEN** `docker-make.sh` SHALL run `npm install` inside the container and copy the built `pty.node` to `prebuilds/linux-x64/`
- **AND** it SHALL remove macOS and Windows prebuilds from the Linux package

#### Scenario: Server bundle root package.json
- **WHEN** the server bundle is created
- **THEN** the root `package.json` SHALL NOT have `"type": "module"` (to prevent CJS dependencies like node-pty from being loaded as ESM)

#### Scenario: Bundle script runs on Windows without bash
- **WHEN** the electron matrix's `windows-latest` variant invokes the server-bundling step
- **THEN** the step SHALL execute via `node` (not `bash`) and SHALL NOT depend on `cp`, `find`, `chmod`, `du`, `rm -rf`, or `xattr` external binaries
