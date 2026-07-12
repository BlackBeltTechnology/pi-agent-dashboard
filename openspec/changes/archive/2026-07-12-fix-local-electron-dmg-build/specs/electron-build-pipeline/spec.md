# electron-build-pipeline — delta

Reconcile the pipeline spec to the `electron-builder --prepackaged` reality (the `@electron-forge/maker-dmg` maker was removed by `fix-electron-auto-update-pipeline` D1) and fix the local `build-installer.sh` wrapper to match CI (`_electron-build.yml`).

## MODIFIED Requirements

### Requirement: Cross-platform build script
A build script SHALL support building installers for all platforms from a single macOS or Linux host. On the native host it SHALL produce the same artifacts as CI (`.github/workflows/_electron-build.yml`): a macOS DMG (via `electron-forge package` → `electron-builder --mac dmg --prepackaged`) or a Linux `.deb` + AppImage (via `electron-forge make` → `electron-builder --linux AppImage --prepackaged`), each with the `latest-*.yml` + `app-update.yml` update metadata electron-updater requires.

#### Scenario: Native macOS build
- **WHEN** `npm run electron:build` runs on a darwin host
- **THEN** `build-installer.sh` SHALL run `electron-forge package --platform=darwin --arch=<host-or-requested-arch>` to produce (and, when `APPLE_IDENTITY` is set, sign) the `.app`
- **AND** SHALL then run `electron-builder --mac dmg --prepackaged "<.app path>" --config electron-builder.yml` with `CSC_IDENTITY_AUTO_DISCOVERY=false` so the DMG wraps the Forge-signed `.app` without re-signing
- **AND** SHALL emit the DMG plus `latest-mac.yml` + `app-update.yml` under `out/`

#### Scenario: Native Linux build
- **WHEN** `npm run electron:build` runs on a linux host
- **THEN** `build-installer.sh` SHALL run `electron-forge make` for the `.deb` (Forge `maker-deb`)
- **AND** SHALL run `electron-builder --linux AppImage --prepackaged "<packaged dir>" --config electron-builder.yml` for the AppImage + `latest-linux.yml` + `app-update.yml`

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
- **THEN** it SHALL run `build-installer.sh` which handles client build, server bundling, Node.js download, `electron-forge package`/`make`, and the `electron-builder --prepackaged` DMG/AppImage step

#### Scenario: Icon generation script
- **WHEN** `npm run icons` is run from `packages/electron/`
- **THEN** it SHALL generate `.icns`, `.ico`, and resized PNGs from the master icon

### Requirement: DMG configuration
The macOS DMG SHALL be produced by `electron-builder` in `--prepackaged` mode (config: `electron-builder.yml`), NOT by a Forge maker. Its artifact filename SHALL uniquely identify the target architecture so the GitHub Release can carry per-arch DMG assets without basename collision.

#### Scenario: DMG basename includes version and architecture
- **WHEN** `electron-builder --mac dmg --prepackaged` runs against a `darwin/arm64` Forge-packaged `.app`
- **THEN** the produced DMG basename SHALL match `PI-Dashboard-${version}-arm64.dmg` per `electron-builder.yml` `mac.artifactName`
- **AND WHEN** it runs against a `darwin/x64` `.app`
- **THEN** the basename SHALL match `PI-Dashboard-${version}-x64.dmg`
- **AND** `${version}` SHALL be `packages/electron/package.json#version`

#### Scenario: DMG icon
- **WHEN** the DMG is built
- **THEN** `electron-builder.yml` `mac.icon` SHALL point at `resources/icon.icns`

#### Scenario: GitHub Release contains two distinct DMG assets per release
- **WHEN** a release tag is pushed AND the publish workflow's `electron` matrix completes both the `darwin/arm64` and `darwin/x64` legs
- **THEN** the resulting GitHub Release SHALL contain exactly two DMG assets with distinct arch-identifying basenames
- **AND** neither asset SHALL have an arch-ambiguous basename such as `PI Dashboard.dmg`

#### Scenario: Config parity test pins the DMG identity
- **WHEN** the test suite runs in `packages/electron/`
- **THEN** `build-config-parity.test.ts` SHALL assert `appId`, `productName`, and `executableName` agree across `forge.config.ts`, `electron-builder.yml`, and `electron-builder-nsis.json`
- **AND** there SHALL be NO test asserting a `@electron-forge/maker-dmg` resolved `name` field (the maker was removed)

## REMOVED Requirements

### Requirement: macos-alias native module readiness on darwin
**Reason**: `macos-alias` (with its `build/Release/volume.node`) was a transitive dependency of `@electron-forge/maker-dmg`. That maker was removed (`fix-electron-auto-update-pipeline` D1); the DMG is now built by `electron-builder`'s `dmg` target, which uses `hdiutil` + `app-builder` and does NOT need `macos-alias`. The build-time `volume.node` gate in `build-installer.sh` is obsolete and removed by this change.

**Migration**: None required for the DMG. If any environment still installs `macos-alias`, its readiness no longer affects the build. The `ensure-macos-alias.mjs` postinstall hook is removed (or left dormant per the change's verify decision).

### Requirement: Doctor diagnostic for DMG prerequisites
**Reason**: This Doctor row surfaced `macos-alias` `volume.node` readiness — a prerequisite only of the removed DMG maker. With `electron-builder` producing the DMG, the row reports a non-existent prerequisite and is removed.

**Migration**: None. Contributors building DMGs need only `electron-builder` (already a dependency) and Xcode CLT for any native rebuilds triggered by `electron-forge package`.
