## ADDED Requirements

### Requirement: electron-forge project configuration
The project SHALL include a `packages/electron/` directory with Electron main process entry point, preload script, and forge configuration.

#### Scenario: Forge config exists
- **WHEN** the project is set up for Electron builds
- **THEN** `packages/electron/forge.config.ts` SHALL define makers for macOS (DMG), Linux (DEB + AppImage), and Windows (NSIS)

#### Scenario: Main process entry point
- **WHEN** the Electron app starts
- **THEN** it SHALL load `packages/electron/src/main.ts` as the main process entry point

#### Scenario: Executable name
- **WHEN** the app is packaged
- **THEN** the binary SHALL be named `pi-dashboard` (via `executableName` in packagerConfig)

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
### Requirement: Node.js binary included as extraResources
The build pipeline SHALL download and include the correct Node.js binary for the target platform in the packaged app's resources.

#### Scenario: extraResources configured
- **WHEN** the app is packaged
- **THEN** the stripped Node.js binary (node + npm only) SHALL be placed in `resources/node/`

#### Scenario: Bundled Node available only when present
- **WHEN** the bundled Node directory does not exist (local dev without download)
- **THEN** `forge.config.ts` SHALL skip including it in extraResources (conditional inclusion)

### Requirement: CI build matrix
A GitHub Actions workflow SHALL build Electron installers for all target platforms.

#### Scenario: CI produces macOS arm64 DMG
- **WHEN** the CI workflow runs on `macos-14` runner
- **THEN** it SHALL produce a `.dmg` for arm64

#### Scenario: CI produces macOS x64 DMG
- **WHEN** the CI workflow runs on `macos-13` runner
- **THEN** it SHALL produce a `.dmg` for x64

#### Scenario: CI produces Linux x64 artifacts
- **WHEN** the CI workflow runs on `ubuntu-latest` runner
- **THEN** it SHALL produce an `.AppImage` and `.deb` for x64

#### Scenario: CI produces Windows NSIS installer
- **WHEN** the CI workflow runs on `windows-latest` runner
- **THEN** it SHALL produce an NSIS `.exe` installer for x64

#### Scenario: CI installs Linux build dependencies
- **WHEN** the CI workflow runs on `ubuntu-latest`
- **THEN** it SHALL install `dpkg`, `fakeroot`, and `libarchive-tools` before building

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
### Requirement: AppImage Linux package
The Linux build SHALL produce an AppImage in addition to the existing DEB package.

#### Scenario: AppImage maker configured
- **WHEN** the Linux build runs
- **THEN** `@pengx17/electron-forge-maker-appimage` SHALL produce a single `.AppImage` file that runs on any Linux distribution

#### Scenario: AppImage includes app icon
- **WHEN** the AppImage is built
- **THEN** it SHALL embed the app icon for display in desktop environments

### Requirement: DEB package configuration
The DEB maker SHALL produce a properly branded Debian package.

#### Scenario: DEB metadata
- **WHEN** the DEB package is built
- **THEN** it SHALL include productName "PI Dashboard", description, icon, categories (Development, Utility), and a custom desktop entry with StartupWMClass, Terminal=false, and Keywords

### Requirement: DMG configuration
The DMG maker SHALL produce a properly branded macOS disk image.

#### Scenario: DMG branding
- **WHEN** the DMG is built
- **THEN** it SHALL use the app icon, title "PI Dashboard", and name "PI Dashboard"

### Requirement: macOS Catalina support
The Electron app SHALL support macOS 10.15 (Catalina) and newer.

#### Scenario: Electron version
- **WHEN** the app is built
- **THEN** it SHALL use Electron 32.x (the last version supporting macOS 10.15)

### Requirement: Cross-platform build script
A build script SHALL support building installers for all platforms from a single macOS or Linux host.

#### Scenario: Native build
- **WHEN** `npm run electron:build` runs without flags
- **THEN** it SHALL build an installer for the current platform

#### Scenario: Docker cross-build for Linux
- **WHEN** `npm run electron:build -- --linux` runs
- **THEN** it SHALL use Docker to build Linux DEB + AppImage with correct native modules

#### Scenario: Docker cross-build for Windows
- **WHEN** `npm run electron:build -- --windows` runs
- **THEN** it SHALL use Docker with NSIS to build a Windows installer

#### Scenario: All platforms
- **WHEN** `npm run electron:build -- --all` runs
- **THEN** it SHALL build native + Linux + Windows installers

### Requirement: npm scripts for Electron
The project SHALL add npm scripts for Electron development and building.

#### Scenario: Electron dev script
- **WHEN** `npm run electron:dev` is run
- **THEN** it SHALL start Electron in dev mode pointing at the external dev server

#### Scenario: Electron build script
- **WHEN** `npm run electron:make` is run
- **THEN** it SHALL produce platform installers in `out/`

#### Scenario: Electron full build script
- **WHEN** `npm run electron:build` is run
- **THEN** it SHALL run the build-installer.sh script which handles client build, server bundling, Node.js download, and `electron-forge make`

#### Scenario: Icon generation script
- **WHEN** `npm run icons` is run from `packages/electron/`
- **THEN** it SHALL generate `.icns`, `.ico`, and resized PNGs from the master icon

### Requirement: Bundled-extensions step in publish workflow
The CI publish workflow SHALL run `packages/electron/scripts/bundle-recommended-extensions.sh` before `packages/electron/scripts/bundle-server.sh` on every release build, with `BUNDLE_RECOMMENDED_EXTENSIONS=1` set.

#### Scenario: Release build order
- **WHEN** `.github/workflows/publish.yml` builds a release artifact
- **THEN** it SHALL execute `bundle-recommended-extensions.sh` before `bundle-server.sh` with the opt-in env var set

#### Scenario: Non-release builds skip bundling
- **WHEN** a feature-branch or PR build runs locally (`npm run build`, forge make without the env var)
- **THEN** the bundling script SHALL be a no-op and `resources/bundled-extensions/` SHALL NOT be created

#### Scenario: Fresh clone of each release
- **WHEN** the bundling script runs in CI
- **THEN** it SHALL clone the configured ref (default: default branch HEAD) fresh every time — no caching of previously bundled source trees between CI runs

### Requirement: Size budget enforcement in CI
The CI workflow SHALL report and gate on the size of `resources/bundled-extensions/` after bundling.

#### Scenario: Size reported
- **WHEN** bundling completes in CI
- **THEN** the workflow step SHALL print the total bundled size and per-id breakdown to the CI log

#### Scenario: Size exceeds threshold
- **WHEN** the total bundled size exceeds 15 MB
- **THEN** the CI workflow SHALL fail before proceeding to `forge make`

### Requirement: Electron devDependency pinned to literal version
The `packages/electron/package.json` `devDependencies.electron` field SHALL be a literal semver string (e.g. `"32.3.3"`), NOT a range (`"^32.0.0"`). `app-builder-lib`'s `getElectronVersionFromInstalled` does not walk up the workspace tree to find an electron module hoisted to the root `node_modules/`, so it falls back to reading the version literal from `packages/electron/package.json` and applying a fixed-version regex (`/^\d/`). A range value beginning with `^` or `~` fails the regex and produces `Cannot compute electron version from installed node modules` on Windows NSIS builds (the only consumer of electron-builder under the hood). Pinning the literal value is the workaround electron-builder itself recommends in [issue #3984](https://github.com/electron-userland/electron-builder/issues/3984#issuecomment-504968246).

#### Scenario: electron field is a literal version
- **WHEN** `packages/electron/package.json` is parsed
- **THEN** `devDependencies.electron` SHALL match the regex `^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$` (a literal semver, no `^` or `~` prefix)

#### Scenario: Windows NSIS build resolves electron version
- **WHEN** the electron matrix's `windows-latest` variant runs `electron-forge make` and the NSIS maker invokes `app-builder-lib`
- **THEN** `getElectronVersionFromInstalled` SHALL return successfully without throwing `Cannot compute electron version from installed node modules`

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
