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
The packaged Electron app SHALL include the dashboard server source and dependencies as an extraResource, so the server can run on a clean OS without npm install.

#### Scenario: Server bundled via build script
- **WHEN** `scripts/bundle-server.sh` runs
- **THEN** it SHALL copy `packages/server/` and `packages/shared/` source, the built web client, and a workspace `package.json` to `resources/server/`

#### Scenario: Source-only mode for cross-platform builds
- **WHEN** `scripts/bundle-server.sh --source-only` runs
- **THEN** it SHALL copy source and client only, skipping `npm install` (native modules must be built on the target platform)

#### Scenario: Native modules built per platform
- **WHEN** building for Linux via Docker
- **THEN** `docker-make.sh` SHALL run `npm install` inside the container and copy the built `pty.node` to `prebuilds/linux-x64/`
- **AND** it SHALL remove macOS and Windows prebuilds from the Linux package

#### Scenario: Server bundle root package.json
- **WHEN** the server bundle is created
- **THEN** the root `package.json` SHALL NOT have `"type": "module"` (to prevent CJS dependencies like node-pty from being loaded as ESM)

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
The Windows maker SHALL use NSIS to produce a standard installation wizard.

#### Scenario: NSIS installer configuration
- **WHEN** the Windows installer is built
- **THEN** it SHALL use `@felixrieseberg/electron-forge-maker-nsis` with one-click install mode and per-user installation directory

#### Scenario: NSIS installer compatible with electron-updater
- **WHEN** the app is installed via NSIS on Windows
- **THEN** `electron-updater` auto-update SHALL function correctly (download + replace flow)

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
