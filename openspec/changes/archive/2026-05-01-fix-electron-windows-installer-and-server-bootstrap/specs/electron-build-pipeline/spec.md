## ADDED Requirements

### Requirement: Single user-visible name `pi-dashboard` across every Windows install layer
The Electron app SHALL present a single, consistent name `pi-dashboard` (lowercase, no spaces, no `-electron` suffix) at every Windows install layer that is visible to the end user. The four layers covered: NSIS installer filename, install directory under `%LOCALAPPDATA%\Programs\`, Start Menu shortcut target, and Apps & Features registry display name.

#### Scenario: NSIS installer filename uses `pi-dashboard`
- **WHEN** the electron build matrix runs `electron-forge make` for `win32/x64`
- **THEN** the produced NSIS installer SHALL be named `pi-dashboard-Setup-${version}.exe` (no `-electron` suffix, no embedded productName like "PI Dashboard")

#### Scenario: Install directory uses `pi-dashboard`
- **WHEN** an end user runs the NSIS installer
- **THEN** the app SHALL install to `%LOCALAPPDATA%\Programs\pi-dashboard\`
- **AND NOT** to `%LOCALAPPDATA%\Programs\@blackbelt-technologypi-dashboard-electron\`
- **AND NOT** to `%LOCALAPPDATA%\Programs\pi-dashboard-electron\`

#### Scenario: Start Menu shortcut targets the actual binary
- **WHEN** the NSIS installer creates the Start Menu shortcut
- **THEN** the shortcut SHALL point to `%LOCALAPPDATA%\Programs\pi-dashboard\pi-dashboard.exe`
- **AND** Windows SHALL NOT display the "Missing Shortcut" dialog when the user clicks the shortcut

#### Scenario: Apps & Features displays a clean name
- **WHEN** an end user opens Apps & Features in Windows Settings
- **THEN** the entry SHALL display as `pi-dashboard` (NOT `pi-dashboard-electron`, NOT `@blackbelt-technologypi-dashboard-electron`)

### Requirement: `productName` and NSIS config explicit override
The `packages/electron/package.json` `productName` field SHALL be the literal string `"pi-dashboard"`. The Forge NSIS maker config in `packages/electron/forge.config.ts` SHALL extend its `getAppBuilderConfig` callback to return an object that explicitly pins `productName`, `appId`, and `nsis.artifactName` / `shortcutName` / `uninstallDisplayName`. The override is required because electron-builder's NSIS install-dir name fallback chain reads the npm `name` field with slashes stripped — without the explicit override, the install dir is `@blackbelt-technologypi-dashboard-electron` regardless of `productName`.

#### Scenario: package.json productName is `pi-dashboard`
- **WHEN** `packages/electron/package.json` is parsed
- **THEN** the `productName` field SHALL equal the literal string `"pi-dashboard"`

#### Scenario: NSIS maker config pins all visible names
- **WHEN** Forge resolves the NSIS maker's `getAppBuilderConfig` callback
- **THEN** the returned object SHALL contain:
  - `productName: "pi-dashboard"`
  - `appId: "com.blackbelt-technology.pi-dashboard"` (no `-electron` suffix)
  - `nsis.artifactName: "pi-dashboard-Setup-${version}.exe"`
  - `nsis.shortcutName: "pi-dashboard"`
  - `nsis.uninstallDisplayName: "pi-dashboard"`

#### Scenario: existing `publish: null` injection preserved
- **WHEN** the NSIS maker's `getAppBuilderConfig` callback runs
- **THEN** the returned object SHALL also contain `publish: null` (preserves the existing pre-fix behaviour that prevents electron-builder from attempting auto-publish)

### Requirement: Bundled-server tree intentionally excludes pi-coding-agent
The `packages/electron/scripts/bundle-server.mjs` script SHALL NOT declare `@mariozechner/pi-coding-agent`, `@mariozechner/jiti`, `@fission-ai/openspec`, `tsx`, or any other dependency that lives in the managed dir (`~/.pi-dashboard/`) as a dependency of the synthetic workspace `package.json` it writes. The bundled server tree (`resources/server/`) SHALL contain only workspace deps that the bundled `cli.ts` directly imports (`fastify`, `ws`, `node-pty`, etc.). Bundled-server-runtime concerns that depend on pi/openspec/tsx SHALL be satisfied via the managed dir, populated by `installStandalone()` on first run from the offline cacache pinned in `packages/electron/offline-packages.json`.

#### Scenario: Synthetic package.json has no pi-coding-agent dependency
- **WHEN** `bundle-server.mjs` runs and writes `resources/server/package.json`
- **THEN** the resulting file SHALL NOT contain a `dependencies` block
- **AND SHALL NOT** declare `@mariozechner/pi-coding-agent`, `@mariozechner/jiti`, `@fission-ai/openspec`, or `tsx` anywhere in its `dependencies` / `devDependencies` / `optionalDependencies`

#### Scenario: Bundle source has documenting comment
- **WHEN** `bundle-server.mjs` source is read
- **THEN** the synthetic workspace package.json construction SHALL be preceded by a comment block that explains the architectural reason pi is NOT bundled (managed dir / offline cacache model) and cites change `fix-electron-windows-installer-and-server-bootstrap`

#### Scenario: Bundled tree size stays minimal
- **WHEN** `bundle-server.mjs` runs without `--source-only`
- **THEN** `resources/server/` SHALL be approximately 80MB (workspace deps only) and not approximately 160MB (which would indicate pi was incorrectly bundled)

## MODIFIED Requirements

### Requirement: NSIS Windows installer
The Windows maker SHALL use NSIS to produce a standard installation wizard whose installer filename, install directory, Start Menu shortcut, and Apps & Features registry entry all use the single name `pi-dashboard`. The maker's `getAppBuilderConfig` callback SHALL pin the productName, appId, and NSIS-specific fields explicitly so electron-builder's defaults cannot reintroduce mismatches.

#### Scenario: NSIS installer configuration
- **WHEN** the Windows installer is built
- **THEN** it SHALL use `@felixrieseberg/electron-forge-maker-nsis` with one-click install mode and per-user installation directory

#### Scenario: NSIS installer compatible with electron-updater
- **WHEN** the app is installed via NSIS on Windows
- **THEN** `electron-updater` auto-update SHALL function correctly (download + replace flow)

#### Scenario: NSIS install layers all use `pi-dashboard`
- **WHEN** the Windows installer runs and creates its install artifacts
- **THEN** the install directory, Start Menu shortcut, registry entry, and uninstaller display name SHALL all use the single string `pi-dashboard` (NO `-electron` suffix anywhere)

### Requirement: Bundled dashboard server
The packaged Electron app SHALL include the dashboard server source AND the production-dependency tree of every workspace it directly imports as an extraResource, so the server can run on a clean OS without any user-side `npm install` for those packages. The bundling logic SHALL be implemented in `packages/electron/scripts/bundle-server.mjs` (Node-native, runnable on every host). pi/openspec/tsx are deliberately NOT part of the bundled tree — they live in the managed dir (`~/.pi-dashboard/`) and are installed there by `installStandalone()` from the offline cacache (see `electron-shell` spec for the runtime resolution chain).

#### Scenario: Server bundled via Node-native build script
- **WHEN** `node packages/electron/scripts/bundle-server.mjs` runs
- **THEN** it SHALL copy `packages/server/`, `packages/shared/`, and `packages/extension/` source, the built web client, and a synthetic workspace `package.json` to `resources/server/`

#### Scenario: Source-only mode for cross-platform builds
- **WHEN** `node packages/electron/scripts/bundle-server.mjs --source-only` runs
- **THEN** it SHALL copy source and client only, skipping `npm install` (native modules must be built on the target platform)

#### Scenario: Bundled tree has only workspace-level dependencies
- **WHEN** the Electron app is packaged AND `bundle-server.mjs` runs WITHOUT `--source-only`
- **THEN** `resources/server/node_modules/` SHALL contain `fastify`, `ws`, `node-pty`, and other deps imported by the bundled `cli.ts`
- **AND** `resources/server/node_modules/` SHALL NOT contain `@mariozechner/pi-coding-agent` (those live in the managed dir)
- **AND** the bundled server's `cli.ts` SHALL be loadable via the managed dir's tsx loader (or fallback jiti) which is populated by `installStandalone()` on first launch

#### Scenario: Bundle script runs on Windows without bash
- **WHEN** the electron matrix's `windows-latest` variant invokes the server-bundling step
- **THEN** the step SHALL execute via `node` (not `bash`) and SHALL NOT depend on `cp`, `find`, `chmod`, `du`, `rm -rf`, or `xattr` external binaries
