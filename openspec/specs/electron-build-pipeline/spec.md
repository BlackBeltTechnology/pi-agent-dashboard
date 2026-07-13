## Purpose

Electron desktop packaging pipeline. Defines forge project config, bundled
Node + server tree, per-platform installers (DMG/DEB/AppImage/Windows ZIP +
NSIS Setup.exe), CI build matrix, version/branding metadata, and — on Windows — the
embedded dugite-native git+sh bundle.
## Requirements
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
A GitHub Actions workflow SHALL build Electron installers for all target platforms AND every supported (platform, arch) tuple. The matrix SHALL include exactly one row per published artifact; missing rows are a regression.

#### Scenario: CI produces macOS arm64 DMG
- **WHEN** the CI workflow runs on `macos-14` runner
- **THEN** it SHALL produce a `.dmg` for arm64
- **AND** the matrix row SHALL declare `platform: darwin, arch: arm64, node-arch: arm64`

#### Scenario: CI produces macOS x64 DMG
- **WHEN** the CI workflow runs on the GitHub-hosted Intel x86_64 macOS runner (currently `macos-15-intel`; was `macos-13` until its retirement on 2025-12-08)
- **THEN** it SHALL produce a `.dmg` for x64
- **AND** the matrix row SHALL declare `platform: darwin, arch: x64, node-arch: x64`
- **AND** the row SHALL NOT be omitted on the grounds that `forge.config.ts` declares `packagerConfig.arch: "universal"` — the workflow's `--arch=${{ matrix.arch }}` CLI flag overrides packagerConfig and the universal hint is a no-op in the current pipeline
- **AND** when GitHub retires `macos-15-intel` (announced end-of-life 2027-08), the team MUST migrate to a universal-binary build OR a self-hosted Intel runner OR drop x64 macOS support — there will be no GitHub-hosted Intel x86_64 replacement after that date

#### Scenario: CI produces Linux x64 artifacts
- **WHEN** the CI workflow runs on `ubuntu-latest` runner
- **THEN** it SHALL produce an `.AppImage` and `.deb` for x64

#### Scenario: CI produces Linux arm64 artifacts
- **WHEN** the CI workflow runs on `ubuntu-24.04-arm` runner
- **THEN** it SHALL produce a `.deb` for arm64
- **AND** AppImage SHALL be skipped (appimagetool has no arm64 build)

#### Scenario: CI produces Windows x64 NSIS installer
- **WHEN** the CI workflow runs on `windows-latest` runner with `arch: x64`
- **THEN** it SHALL produce a `PI-Dashboard-Setup-${version}-x64.exe` (NSIS) and a ZIP archive
- **AND** it SHALL NOT produce a portable `.exe` (the 7-Zip SFX portable target was removed by this change)

#### Scenario: CI produces Windows arm64 NSIS installer
- **WHEN** the CI workflow runs on `windows-latest` runner with `arch: arm64`
- **THEN** it SHALL produce a `PI-Dashboard-Setup-${version}-arm64.exe` (NSIS) and a ZIP archive
- **AND** it SHALL NOT produce a portable `.exe`
- **AND** arm64 NSIS support SHALL be provided by electron-builder's native arm64 NSIS templating

#### Scenario: CI installs Linux build dependencies
- **WHEN** the CI workflow runs on any Linux runner
- **THEN** it SHALL install `dpkg`, `fakeroot`, `libarchive-tools`, `libfuse2`, and `squashfs-tools` before building

#### Scenario: Per-(platform, arch) artifact upload
- **WHEN** any matrix row completes successfully
- **THEN** its artifacts SHALL be uploaded with name `electron-${platform}-${arch}` so the `github-release` job can collect every distributable

### Requirement: macOS deployment target is pinned
The macOS DMG SHALL declare a deployment target of macOS 10.15 (Catalina) so binaries launch on every macOS version from Catalina forward, regardless of which macOS version the GitHub-hosted runner image happens to be on. The pin MUST be defensive: even if a future change introduces a native module compiled from source on the runner, the produced bundle SHALL still launch on Sonoma and Ventura.

#### Scenario: forge.config.ts pins LSMinimumSystemVersion
- **WHEN** the Electron app is packaged on any macOS runner (currently `macos-14` for arm64, `macos-15-intel` for x64)
- **THEN** `packages/electron/forge.config.ts > packagerConfig.extendInfo` SHALL set `LSMinimumSystemVersion: "10.15"`
- **AND** the produced `<App>.app/Contents/Info.plist` SHALL contain `<key>LSMinimumSystemVersion</key><string>10.15</string>`

#### Scenario: Workflow exports MACOSX_DEPLOYMENT_TARGET
- **WHEN** the `Make Electron distributables` step runs on any darwin matrix row
- **THEN** the step's environment SHALL include `MACOSX_DEPLOYMENT_TARGET=10.15`
- **AND** any native module compiled from source by `node-gyp` during the build SHALL inherit that target via the standard Xcode toolchain env-var contract

#### Scenario: CI verifies the produced floor matches the spec
- **WHEN** the produced DMG is mounted post-build
- **THEN** the workflow SHALL extract `LSMinimumSystemVersion` from `<App>.app/Contents/Info.plist` and fail the job if the value is anything other than `10.15`
- **AND** the workflow SHALL run `otool -l` against the inner Mach-O `pi-dashboard` binary and apply a per-arch `minos` floor check: `darwin/x64` SHALL have `LC_BUILD_VERSION.minos` major-version equal to `10` (10.15 target), `darwin/arm64` SHALL have major-version equal to `11` (Apple Silicon hardware launched on macOS Big Sur 11.0; arm64 binaries cannot declare a lower minos)
- **AND** the job SHALL fail if the major version exceeds the arch's expected floor (e.g., `12` on x64 or `12` on arm64), which would indicate the runner's host SDK leaked into the produced binary
- **AND** the job SHALL emit a `::warning::` (not fail) if `minos` cannot be extracted at all (e.g., binary uses an unrecognized load-command format), so the verification is robust to future Mach-O format changes

### Requirement: Local builder produces correct artifacts across arches
The local-build helper `packages/electron/scripts/build-installer.sh` SHALL produce arch-correct macOS DMGs when invoked back-to-back with different `--arch` values, without requiring the user to manually clean intermediate caches between runs.

#### Scenario: Stale-arch caches are invalidated automatically
- **WHEN** `build-installer.sh` runs on darwin with a requested arch that differs from the previously-built arch (tracked via `resources/.last-arch` sentinel)
- **THEN** it SHALL delete `resources/node/`, `resources/server/`, and `resources/offline-packages/` (when present) before re-running the corresponding bundle steps
- **AND** it SHALL update the sentinel after the bundle completes

#### Scenario: Cross-arch native modules built via Rosetta
- **WHEN** `build-installer.sh` runs on an Apple Silicon host (`uname -m` = `arm64`) with `--arch x64`
- **THEN** it SHALL verify Rosetta 2 is installed by probing `arch -x86_64 /usr/bin/true` and exit non-zero with an actionable error message (`softwareupdate --install-rosetta --agree-to-license`) if the probe fails
- **AND** it SHALL invoke `bundle-server.sh` under `arch -x86_64` so that npm installs x64 prebuilt binaries (notably node-pty's `prebuilds/darwin-x64/pty.node`)

#### Scenario: Intel host cannot cross-build arm64 locally
- **WHEN** `build-installer.sh` runs on an Intel host (`uname -m` = `x86_64`) with `--arch arm64`
- **THEN** it SHALL exit non-zero with a clear message that Intel hosts cannot cross-build arm64 locally (Rosetta is one-way) and recommend using CI for arm64 validation

#### Scenario: --mac-both produces both DMGs in one run
- **WHEN** `build-installer.sh --mac-both` runs on an Apple Silicon host
- **THEN** it SHALL build the arm64 DMG, invalidate per-arch caches, build the x64 DMG, and emit a final smoke summary listing both output files with their Mach-O arch tags from `file`
- **AND** it SHALL fail fast on Intel hosts and on non-darwin hosts with a clear error message

### Requirement: NSIS Windows installer
The Windows installer SHALL be produced by `electron-builder --win nsis` extended with a custom include script at `packages/electron/build/installer.nsh` (consumed via electron-builder's `nsis.include` config option). The installer SHALL be a per-user assisted wizard install — NOT a one-click silent install AND NOT a multi-user install — that lets the user choose the install directory. The installer SHALL NOT present an install-mode page and SHALL NOT offer a per-machine ("Install for everyone") option. Installer filename, default install directory, Start Menu shortcut, Apps & Features registry entry, and uninstaller display name SHALL all be pinned explicitly via electron-builder NSIS config so that defaults derived from the npm package name cannot reintroduce mismatches. The `appId` SHALL be `hu.blackbelt.pi-dashboard` and SHALL NOT change once shipped.

#### Scenario: NSIS toolchain
- **WHEN** the Windows installer is built
- **THEN** it SHALL be produced by `npx electron-builder --win nsis --<arch> --config electron-builder-nsis.json`
- **AND** the electron-builder config SHALL reference `packages/electron/build/installer.nsh` via the `nsis.include` option
- **AND** the build SHALL NOT use `@felixrieseberg/electron-forge-maker-nsis` (removed in v0.5.0 and not reintroduced)
- **AND** the build SHALL NOT use `nsis.script` (full script replacement — we extend electron-builder's generated script, not replace it)

#### Scenario: Per-user assisted wizard install
- **WHEN** the user runs Setup.exe
- **THEN** electron-builder NSIS config SHALL set `oneClick: false`, `perMachine: false`, `allowToChangeInstallationDirectory: true`, and `allowElevation: true`
- **AND** the config SHALL NOT omit `perMachine` (omission would enable multi-user mode, which is forbidden)
- **AND** the wizard SHALL present, in order: Welcome → Choose Install Location (editable, pre-filled with the per-user default) → Install progress → Finish
- **AND** the wizard SHALL NOT present an install-mode page
- **AND** the Finish page SHALL offer a "Launch PI Dashboard" checkbox (default checked)

#### Scenario: Per-user install (default path)
- **WHEN** the user accepts the default install location
- **THEN** the install SHALL proceed without UAC elevation
- **AND** the default install dir SHALL be `%LOCALAPPDATA%\Programs\PI Dashboard\`
- **AND** the Add/Remove Programs entry SHALL be registered under `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\PI Dashboard`
- **AND** the Start Menu shortcut SHALL be created under the user's per-profile Start Menu
- **AND** the installer SHALL NOT write to `HKLM` and SHALL NOT register a per-machine entry

#### Scenario: User-chosen install location
- **WHEN** the user changes the install location in the Choose-Install-Location page (or passes `/D=<path>` on a silent install)
- **THEN** the installer SHALL install to that path
- **AND** the executable SHALL be `<chosen path>\PI Dashboard.exe`
- **AND** the uninstaller SHALL be written to `<chosen path>\Uninstall PI Dashboard.exe`
- **AND** the Add/Remove Programs entry's `InstallLocation` registry value SHALL contain the chosen path

#### Scenario: Start Menu shortcut
- **WHEN** installation completes
- **THEN** a Start Menu shortcut named `PI Dashboard` SHALL exist under `%APPDATA%\Microsoft\Windows\Start Menu\Programs\`
- **AND** the shortcut target SHALL be `%LOCALAPPDATA%\Programs\PI Dashboard\PI Dashboard.exe`

#### Scenario: Add/Remove Programs entry contents
- **WHEN** installation completes
- **THEN** the Add/Remove Programs entry (under HKCU — per-user only) SHALL contain: DisplayName `PI Dashboard`, Publisher `BlackBelt Technology`, DisplayVersion matching the release version, DisplayIcon pointing at `<install dir>\PI Dashboard.exe`, UninstallString and QuietUninstallString pointing at `<install dir>\Uninstall PI Dashboard.exe`, InstallLocation equal to the actual install dir, EstimatedSize, NoModify=1, NoRepair=1
- **AND** the entry SHALL be visible in Settings → Apps → Installed apps

#### Scenario: Uninstaller preserves user data
- **WHEN** the user runs the uninstaller
- **THEN** it SHALL remove `%LOCALAPPDATA%\Programs\PI Dashboard\` and the Add/Remove Programs entry
- **AND** it SHALL NOT delete `%USERPROFILE%\.pi\` (agent runtime, sessions, settings)
- **AND** it SHALL NOT delete `%USERPROFILE%\.pi-dashboard\` (managed dependencies, version markers)
- **AND** the uninstaller's final page SHALL display a notice that user data has been preserved and how to remove it manually

#### Scenario: Installer artifact naming
- **WHEN** the Windows installer is built
- **THEN** the produced artifact SHALL be named `PI-Dashboard-Setup-${version}-${arch}.exe` (e.g. `PI-Dashboard-Setup-0.5.5-x64.exe`)
- **AND** the artifact SHALL be uploaded to the GitHub Release alongside the `.zip` artifacts
- **AND** the filename SHALL satisfy the marketing-site classifier in `site/src/lib/github-release.ts` such that it is routed to `kind: "Installer (.exe)"` with priority 0

#### Scenario: NSIS compatible with electron-updater
- **WHEN** the app is installed via Setup.exe on Windows
- **THEN** the on-disk layout SHALL be compatible with `electron-updater`'s NSIS differ channel (wiring of the channel itself is out of scope for this requirement; see `fix-electron-auto-update-pipeline`)

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

### Requirement: macOS Catalina support
The Electron app SHALL support macOS 10.15 (Catalina) and newer.

#### Scenario: Electron version
- **WHEN** the app is built
- **THEN** it SHALL use Electron 32.x (the last version supporting macOS 10.15)

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

### Requirement: Windows VERSIONINFO derived from 4-integer build version under prerelease slugs

When `forge.config.ts` is evaluated with a `package.json#version` that is not a plain SemVer triple (i.e. contains a prerelease suffix such as the slug ci-electron.yml produces), the configuration SHALL produce a 4-integer build version for Windows PE VERSIONINFO consumption AND SHALL scope the `appVersion` override to Windows build hosts so that darwin/linux artifacts continue to carry the full SemVer slug in their platform-native version surfaces.

The 4-integer version SHALL be derived from:

- components 1–3: the leading `MAJOR.MINOR.PATCH` integer triple of `package.json#version` (missing or non-integer components default to `0`)
- component 4: `process.env.GITHUB_RUN_NUMBER` parsed as an integer (defaults to `0` when undefined / empty / non-integer)

Result format: matches `^\d+\.\d+\.\d+\.\d+$` for all inputs.

#### Scenario: plain release slug — both Windows and POSIX get the same version

- **WHEN** `package.json#version` equals `0.5.3` AND `GITHUB_RUN_NUMBER` equals `42`
- **THEN** `packagerConfig.buildVersion` SHALL equal `"0.5.3.42"`
- **AND** on darwin/linux, `packagerConfig.appVersion` SHALL be unset (defaults to `pkgVersion`)
- **AND** on Windows, `packagerConfig.appVersion` SHALL equal `"0.5.3.42"`

#### Scenario: ci-electron prerelease slug — base triple preserved, suffix dropped

- **WHEN** `package.json#version` equals `0.5.3-ci.20260525-141712.feat-enable-standalo.2206c1e` AND `GITHUB_RUN_NUMBER` equals `42`
- **THEN** `packagerConfig.buildVersion` SHALL equal `"0.5.3.42"` (suffix discarded, base triple kept)
- **AND** on Windows, `packagerConfig.appVersion` SHALL also equal `"0.5.3.42"`
- **AND** on darwin/linux, `packagerConfig.appVersion` SHALL remain unset so `CFBundleShortVersionString` shows the full SemVer slug

#### Scenario: local build — no GITHUB_RUN_NUMBER

- **WHEN** `GITHUB_RUN_NUMBER` is undefined AND `package.json#version` equals `0.5.3`
- **THEN** `packagerConfig.buildVersion` SHALL equal `"0.5.3.0"`
- **AND** `tsx packages/electron/forge.config.ts` SHALL load without throwing

#### Scenario: `@electron/packager resedit` accepts the derived version on Windows

- **WHEN** `electron-forge make` runs on `windows-latest` with `packagerConfig.buildVersion = "0.5.3.42"` AND `packagerConfig.appVersion = "0.5.3.42"`
- **THEN** `WindowsApp.runResedit` SHALL succeed (no `parseVersionString` throw)
- **AND** the produced `pi-dashboard.exe` Windows PE VERSIONINFO SHALL carry `FileVersion = 0.5.3.42` AND `ProductVersion = 0.5.3.42`

#### Scenario: `app.getVersion()` reflects the full SemVer slug regardless of platform

- **WHEN** the Windows-packaged artifact runs AND user code calls `app.getVersion()`
- **THEN** the return value SHALL equal `package.json#version` at package time (full SemVer slug, e.g. `0.5.3-ci.20260525-141712.feat-enable-standalo.2206c1e`)
- **AND** the 4-integer VERSIONINFO override SHALL be visible only in Windows Explorer → Properties → Details, not in the running app

### Requirement: VERSIONINFO `LegalCopyright` and Info.plist `NSHumanReadableCopyright` carry a BlackBelt-branded string

`forge.config.ts` SHALL set `packagerConfig.appCopyright` to a non-empty string containing the token `BlackBelt Technology`. The field is universal (not Windows-gated): `@electron/packager` maps it to Windows VERSIONINFO `LegalCopyright` AND macOS Info.plist `NSHumanReadableCopyright`. Without the override, both platforms inherit the Electron framework's default (`"Copyright (C) 2015 GitHub, Inc."`), which is visible in Windows Explorer → Properties → Details → Copyright and macOS Finder → Get Info.

The year SHALL be a fixed integer (not `new Date().getFullYear()`) so builds are deterministic.

#### Scenario: Windows artifact Copyright field shows BlackBelt branding

- **WHEN** the user opens `pi-dashboard.exe` Properties → Details on Windows
- **THEN** the `Copyright` row SHALL begin with `Copyright © <year> BlackBelt Technology`
- **AND** SHALL NOT contain `GitHub, Inc.`

#### Scenario: macOS artifact Get Info shows BlackBelt branding

- **WHEN** the user opens `PI-Dashboard.app` Get Info on macOS
- **THEN** the `Copyright` row SHALL contain `BlackBelt Technology`
- **AND** SHALL NOT contain `GitHub, Inc.`

#### Scenario: textual pin catches removal of `appCopyright`

- **WHEN** a future change removes or renames `packagerConfig.appCopyright` in `forge.config.ts`
- **THEN** the textual-pin test under `packages/electron/src/__tests__/forge-config-windows-version.test.ts` SHALL fail
- **AND** the failure message SHALL include the regex `/appCopyright\s*:\s*["']Copyright\s+\u00a9\s+\d{4}\s+BlackBelt Technology["']/`

### Requirement: `packages/electron/package.json` declares `author`

`packages/electron/package.json` SHALL declare a non-empty `author` field. `@electron/packager` rejects Windows packaging with `Author is required to package an application for Windows` when this field is missing.

#### Scenario: author field present

- **WHEN** `packages/electron/package.json` is read at package time
- **THEN** the `author` field SHALL be present AND non-empty
- **AND** the Windows leg of `electron-forge package` SHALL NOT throw `Author is required`

### Requirement: `forge.config.ts` Windows-version wiring SHALL be pinned by a textual test

A vitest under `packages/electron/src/__tests__/` SHALL parse `forge.config.ts` as text AND assert (a) the import of `deriveWindowsBuildVersion` from `./src/lib/build-version.js`, (b) the helper call with `pkgVersion` and `process.env.GITHUB_RUN_NUMBER`, (c) the `isWindowsBuildHost = process.platform === "win32"` declaration, (d) the unconditional shorthand `buildVersion,` in `packagerConfig`, (e) the conditional spread `...(isWindowsBuildHost ? { appVersion: buildVersion } : {})`, and (f) an explanatory comment naming `productVersion` plus at least one of `win32.js` / `VERSIONINFO` / `parseVersionString`.

The textual-pin pattern matches the existing `forge-config-dmg-naming.test.ts`; both tests defend against silent regressions when `forge.config.ts` is refactored.

#### Scenario: textual pin catches removal of the Windows override

- **WHEN** a future change removes or renames the conditional `appVersion` spread in `forge.config.ts`
- **THEN** the textual-pin test SHALL fail
- **AND** the failure message SHALL include the regex that did not match, pointing the engineer to the missing override

### Requirement: Windows electron builds embed git + bash via dugite-native

Every electron build leg targeting `platform: win32` SHALL fetch a pinned
`desktop/dugite-native` GitHub Release tarball matching the target arch,
verify it against a SHA-256 recorded in
`packages/electron/scripts/_git-version.json`, and extract it to
`packages/electron/resources/git/` before `electron:make` runs. Builds
targeting `darwin` or `linux` SHALL NOT fetch or extract the tarball.

#### Scenario: Win32 x64 build embeds matching x64 git tarball

- **WHEN** the `_electron-build.yml` matrix leg with
  `platform=win32, arch=x64` runs `bundle-server.mjs`
- **THEN** `packages/electron/resources/git/cmd/git.exe`,
  `packages/electron/resources/git/usr/bin/sh.exe`, and
  `packages/electron/resources/git/THIRD-PARTY-LICENSE.txt` SHALL all
  exist before the `electron:make` step is invoked

#### Scenario: Win32 arm64 build embeds matching arm64 git tarball

- **WHEN** the matrix leg with `platform=win32, arch=arm64` runs
- **THEN** the same three paths SHALL exist, sourced from the
  `dugite-native-v<tag>-windows-arm64.tar.gz` tarball (not the x64 one)

#### Scenario: macOS and Linux builds do NOT embed git

- **WHEN** any matrix leg with `platform in {darwin, linux}` runs
- **THEN** `packages/electron/resources/git/` SHALL NOT exist in the
  produced artifact
- **AND** no network fetch for a `dugite-native` tarball SHALL occur on
  that leg

#### Scenario: SHA-256 mismatch fails the build

- **WHEN** the downloaded tarball's SHA-256 does not match the value
  recorded in `_git-version.json` for the target arch
- **THEN** `download-git-windows.mjs` SHALL exit non-zero before
  extraction
- **AND** the leg SHALL fail with a clear "checksum mismatch — refusing
  to extract" error

#### Scenario: GO/NO-GO guard on incomplete embed

- **WHEN** any of `resources/git/cmd/git.exe`,
  `resources/git/usr/bin/sh.exe`, or
  `resources/git/THIRD-PARTY-LICENSE.txt` is missing on a win32 target
- **THEN** `bundle-server.mjs` SHALL fail the build with a "bundled git
  GO/NO-GO failed" error listing the missing paths

### Requirement: Bundled git ships with verbatim GPL v2 attribution

The Windows electron bundle SHALL include a verbatim copy of the GPL v2
text and the MSYS2/MinGW64 transitive notices used by dugite-native,
plus a pointer to the corresponding-source location, in
`resources/git/THIRD-PARTY-LICENSE.txt`. The Electron About dialog SHALL
expose a link to this file when running on Windows.

#### Scenario: License file is present and non-empty

- **WHEN** any win32 build artifact is unpacked
- **THEN** `resources/git/THIRD-PARTY-LICENSE.txt` SHALL contain the
  string `GNU GENERAL PUBLIC LICENSE` and the URL
  `https://github.com/desktop/dugite-native`

#### Scenario: About dialog links to the license file (Windows)

- **WHEN** the user opens the Electron About dialog on Windows
- **THEN** a row "Bundled Git for Windows v<version>" SHALL be visible
- **AND** clicking it SHALL open `resources/git/THIRD-PARTY-LICENSE.txt`
  in the system default text viewer

### Requirement: CI smoke-tests the NSIS installer on the build runner
The `windows-latest` legs that build Setup.exe SHALL smoke-test it on the same runner, after the build, via a `.github/workflows/_electron-build.yml` step (`if: matrix.platform == 'win32'`). Because the installer is per-user (`/S` needs no admin), the smoke runs unprivileged with no VM and no external QA harness. The step SHALL run install, no-per-machine, branding, and uninstall assertions as **hard gates** (fail the job). It SHALL NOT launch the app: `pi-dashboard.exe` is a GUI-subsystem binary and GitHub-hosted runners have no interactive desktop session, so the Electron main process never reaches the server-spawn step (observed: process stays alive, `~/.pi/dashboard/server.log` never created, stdout/stderr empty). Launch + server-start validation is therefore out of scope for the build-runner smoke; it runs on a VM with a real desktop (`qa/tests/07-electron-bootstrap-v2.ps1` + `windows-nsis-launch.ps1` via the `automate-windows-remote-qa` harness) or by manual install.

#### Scenario: each win32 leg runs install→uninstall hard gates
- **WHEN** a `windows-latest` win32 leg finishes building `PI-Dashboard-Setup-${version}-${arch}.exe`
- **THEN** the workflow SHALL run `qa/tests/windows-nsis-install.ps1`, `windows-nsis-no-permachine.ps1`, `windows-nsis-branding.ps1`, and `windows-nsis-uninstall.ps1` as hard gates against the built artifact
- **AND** a hard-gate failure SHALL fail the job
- **AND** the workflow SHALL NOT attempt to launch the app on the runner (no display; GUI Electron cannot start the server headlessly)

#### Scenario: launch / server-start validated off the build runner
- **WHEN** launch / server-start needs verification (e.g. the nodejs#58515 Node-version regression)
- **THEN** it SHALL be validated on a VM with a desktop session via `qa/tests/07-electron-bootstrap-v2.ps1` / `windows-nsis-launch.ps1`, or by manual install
- **AND** the build-runner smoke SHALL NOT be relied upon for server-start coverage

### Requirement: NSIS install location is bootstrap-agnostic
The NSIS install location SHALL NOT be hardcoded anywhere in the bootstrap, server, or shared code. The bootstrap state machine SHALL resolve the running install location dynamically via `app.getPath('exe')` and `process.resourcesPath`. This guarantees the existing `selectLaunchSource()` resolver in `packages/electron/src/lib/launch-source.ts` works identically for the per-user default (`%LOCALAPPDATA%\Programs\PI Dashboard\`) and any user-chosen path like `D:\MyApps\PI Dashboard\`.

#### Scenario: Setup.exe-installed app resolves via existing launch source regardless of install dir
- **WHEN** the user launches `PI Dashboard.exe` from any directory chosen during install (per-user default or user-chosen)
- **THEN** `selectLaunchSource()` SHALL resolve to the same `installed` / `extracted` branch that today's `.zip`-extracted install resolves to
- **AND** no new source kind SHALL be added to handle Setup.exe installs
- **AND** no module under `packages/electron/src/`, `packages/server/src/`, or `packages/shared/src/` SHALL contain a hardcoded path matching `%LOCALAPPDATA%\Programs\PI Dashboard` outside of documentation strings

### Requirement: NSIS appId is stable across releases
The electron-builder NSIS `appId` value SHALL be pinned to `hu.blackbelt.pi-dashboard` and SHALL NOT change between releases once the first NSIS release has shipped. Changing the appId strands users on the old appId (their uninstaller stays registered under the old GUID and the new installer registers a second, parallel entry).

#### Scenario: appId pinned in config
- **WHEN** the electron-builder NSIS config is read
- **THEN** the `appId` field SHALL equal exactly the literal string `hu.blackbelt.pi-dashboard`
- **AND** subsequent releases SHALL use the same value
- **AND** the value SHALL be documented in `docs/release-process.md` as immutable

### Requirement: Pi-branded installer assets
The NSIS installer SHALL display Pi branding throughout the wizard: a Pi-branded installer icon on the Setup.exe binary, a Pi-branded uninstaller icon on the uninstaller binary, a Pi-branded welcome / finish page bitmap (164×314 BMP), a Pi-branded header bitmap on the Choose-Install-Location and Install-progress pages (150×57 BMP), and the branding text `BlackBelt Technology — PI Dashboard` in the bottom-left of every page. Assets SHALL be derived deterministically at build time from a single Pi master asset (`packages/electron/build/installer-assets/master.png`) by `packages/electron/scripts/build-installer-assets.mjs`.

#### Scenario: Installer icon is Pi-branded
- **WHEN** the user views Setup.exe in File Explorer
- **THEN** the icon SHALL be the Pi mark (derived from `master.png`), NOT the electron-builder default electron-logo icon
- **AND** the icon SHALL include multi-resolution entries (16, 24, 32, 48, 64, 128, 256) so Windows can pick the appropriate size for taskbar / file-list / large-icon view

#### Scenario: MUI2 page bitmaps are Pi-branded
- **WHEN** the installer wizard is open on the Welcome or Finish page
- **THEN** the left-edge side bitmap SHALL render as Pi-branded `welcome-banner.bmp` (164×314, 24-bit BMP)
- **WHEN** the installer wizard is on any other page (Choose Install Location, Install Progress)
- **THEN** the top header bitmap SHALL render as Pi-branded `header-banner.bmp` (150×57, 24-bit BMP)

#### Scenario: Uninstaller icon is Pi-branded
- **WHEN** the user views `Uninstall PI Dashboard.exe` in File Explorer
- **THEN** the icon SHALL be the Pi-branded uninstaller variant (derived from `master.png` with deterministic differentiation, e.g. red tint or grayscale), NOT the electron-builder default

#### Scenario: Branding text on every page
- **WHEN** the installer wizard is open on any page
- **THEN** the bottom-left brand area SHALL display `BlackBelt Technology — PI Dashboard` via the NSIS `BrandingText` macro

#### Scenario: Asset derivation is deterministic
- **WHEN** `node packages/electron/scripts/build-installer-assets.mjs` runs against an unchanged `master.png`
- **THEN** the output ICO + BMP files SHALL be byte-identical across runs (deterministic SHA-256)
- **AND** the script SHALL print per-asset SHA-256 so CI can detect master-asset drift

#### Scenario: Branding asset generation runs in CI
- **WHEN** the CI workflow runs the NSIS build step on a `windows-latest` leg
- **THEN** `node packages/electron/scripts/build-installer-assets.mjs` SHALL run before `electron-builder --win nsis`
- **AND** the produced assets in `packages/electron/build/installer-assets/` SHALL be consumed by electron-builder via the `installerIcon` / `uninstallerIcon` / `installerSidebar` / `installerHeader` config keys

### Requirement: NSIS is a CI-only artifact
The Docker cross-build path SHALL produce ZIP only for Windows. NSIS Setup.exe SHALL be produced exclusively by the CI `windows-latest` legs. Local builds on macOS/Linux hosts SHALL NOT attempt to build NSIS (no Wine dependency in `Dockerfile.build`).

#### Scenario: Docker cross-build skips NSIS
- **WHEN** `packages/electron/scripts/docker-make.sh` runs with Windows target
- **THEN** it SHALL produce `PI-Dashboard-win32-${arch}.zip` only
- **AND** it SHALL NOT invoke `electron-builder --win nsis`
- **AND** the script SHALL log a clear message: "Docker path produces ZIP only; NSIS Setup.exe is CI-only (windows-latest)"

#### Scenario: Local Windows-host build optionally produces NSIS
- **WHEN** `packages/electron/scripts/build-windows-zip.sh` runs on a Windows host (`$OSTYPE` matches `msys`, `cygwin`, or equivalent) with the `--with-nsis` flag
- **THEN** it MAY invoke `electron-builder --win nsis` after the ZIP step
- **AND** without `--with-nsis` (or on non-Windows hosts) it SHALL skip NSIS silently

### Requirement: Update-metadata files generated for every release artifact

The Electron build pipeline SHALL produce update-metadata YAML files alongside every installer/binary artifact, in the format consumed by `electron-updater`. These metadata files SHALL be named `latest.yml` (Windows), `latest-mac.yml` (macOS, listing both arm64 and x64 entries in `files[]`), and `latest-linux.yml` (Linux). Each metadata file SHALL contain `version`, `path`, `sha512`, `releaseDate`, and a `files[]` array describing every artifact.

#### Scenario: Windows build emits latest.yml

- **WHEN** the Windows electron build runs
- **THEN** the output directory SHALL contain `latest.yml` listing the NSIS installer's filename, sha512, and size
- **AND** the file's `version` field SHALL match the workspace package version

#### Scenario: macOS build emits unified latest-mac.yml

- **WHEN** both arm64 and x64 macOS builds have completed
- **THEN** a single `latest-mac.yml` SHALL be produced whose `files[]` array contains both DMGs
- **AND** the metadata SHALL be byte-identical regardless of which arch builder ran last (deterministic merge)

#### Scenario: Linux build emits latest-linux.yml

- **WHEN** the Linux electron build runs
- **THEN** the output directory SHALL contain `latest-linux.yml` listing the AppImage's filename, sha512, and size

#### Scenario: sha512 in metadata matches binary

- **WHEN** any `latest*.yml` is generated
- **THEN** every `sha512` field SHALL equal the actual sha512 of the corresponding artifact file as it will be uploaded to the GitHub Release (no post-upload edit may invalidate the hash)

### Requirement: GitHub publish configuration embedded in packaged app

The Electron build SHALL configure `publish: { provider: 'github', owner: 'blackbelt-technology', repo: 'pi-agent-dashboard' }` so that `electron-builder` writes `app-update.yml` into the packaged app's resources. The runtime updater reads this file at startup; build and runtime SHALL therefore agree on the release stream by construction.

#### Scenario: app-update.yml present in packaged resources

- **WHEN** any production Electron build completes
- **THEN** the packaged app's resources directory SHALL contain `app-update.yml`
- **AND** the file SHALL declare `provider: github`, `owner: blackbelt-technology`, `repo: pi-agent-dashboard`

#### Scenario: app-update.yml ships as a packaged resource

- **WHEN** the mac/linux build runs electron-builder in `--prepackaged` mode (which skips the packaging phase that would otherwise emit `app-update.yml`)
- **THEN** `app-update.yml` SHALL still be present in the packaged app's resources directory, shipped via Forge `extraResource` (`packages/electron/resources/app-update.yml`)
- **AND** its `provider`/`owner`/`repo` SHALL match the build-time `publish` configuration

### Requirement: macOS build is Developer-ID-signed and notarised

Every macOS DMG produced by the publish pipeline SHALL be code-signed with a Developer ID Application certificate AND notarised by Apple's notarisation service before being uploaded to a GitHub Release. Squirrel.Mac (the macOS arm of `electron-updater`) refuses to apply unsigned updates; this requirement is the gate.

#### Scenario: DMG stapled with notarisation ticket

- **WHEN** a macOS DMG is produced for a production tag
- **THEN** `xcrun stapler validate <path>.dmg` SHALL exit zero
- **AND** the inner `.app` SHALL pass `codesign --verify --deep --strict`

#### Scenario: Missing signing secrets fails the build

- **GIVEN** any of `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` is missing in CI
- **WHEN** the macOS build step runs on a production tag (matching `^v\d+\.\d+\.\d+$`)
- **THEN** the build step SHALL exit non-zero and fail the workflow

#### Scenario: Local dev builds may skip signing

- **WHEN** a developer runs the macOS build locally without signing secrets in their environment
- **THEN** the build SHALL still succeed
- **AND** the resulting DMG SHALL be marked with `identity: null` (ad-hoc / unsigned) and clearly logged as not-update-eligible

### Requirement: Update-metadata uploaded with installers in the same release

Every upload to the GitHub Release SHALL include the matching `latest*.yml` metadata file alongside the corresponding installer. Upload of installer-without-metadata or metadata-without-installer SHALL be considered a failed release.

#### Scenario: Windows release contains installer + latest.yml

- **WHEN** a production tag publishes
- **THEN** the GitHub Release SHALL contain the NSIS `.exe` AND `latest.yml`

#### Scenario: macOS release contains DMGs + latest-mac.yml

- **WHEN** a production tag publishes
- **THEN** the GitHub Release SHALL contain both arm64 and x64 `.dmg` files AND a single `latest-mac.yml` referencing both

#### Scenario: Linux release contains AppImage + latest-linux.yml

- **WHEN** a production tag publishes
- **THEN** the GitHub Release SHALL contain the `.AppImage` AND `latest-linux.yml`

### Requirement: Build-config parity lint

A repo-lint test SHALL assert that the Forge config (`packages/electron/forge.config.ts`) and the electron-builder config declare the same `appId`, `productName`/executable name, icon paths, and version source. Drift between the two configs caused historical packaging bugs (e.g. `pi-dashboard` vs `pi-dashboard-electron` mismatches); auto-update is sensitive to the same drift because the packaged app's `app-update.yml` is written by electron-builder while other artifacts may originate from Forge.

#### Scenario: Lint passes when configs agree

- **WHEN** both configs declare the same `appId` (`com.blackbelt-technology.pi-dashboard`), `productName` (`PI Dashboard`), executable name (`pi-dashboard`), and icon paths
- **THEN** the parity test SHALL pass

#### Scenario: Lint fails on appId or productName drift

- **GIVEN** Forge declares `appId: 'foo'` and electron-builder declares `appId: 'bar'`
- **WHEN** the parity test runs
- **THEN** the test SHALL fail with a message naming the drift fields

### Requirement: Bundle freshness invalidation

`build-installer.sh` SHALL re-invoke `bundle-server.mjs` whenever ANY of the following sources is newer than `resources/server/.bundle-stamp`, OR the stamp file does not exist:

- `packages/server/src/` (recursive mtime)
- `packages/shared/src/` (recursive mtime)
- `packages/extension/src/` (recursive mtime)
- `packages/dashboard-plugin-runtime/src/` (recursive mtime)
- `packages/dist/index.html` (Vite client output; `packages/client/vite.config.ts` `outDir: ../dist`)
- `packages/electron/scripts/bundle-server.mjs`

The watched workspace packages SHALL mirror `BUNDLED_WORKSPACE_PKGS` in `bundle-server.mjs` (`server`, `shared`, `extension`, `dashboard-plugin-runtime`).

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

#### Scenario: Client rebuilt after last bundle

- **WHEN** `packages/dist/index.html` mtime > `.bundle-stamp` mtime
- **THEN** `build-installer.sh` SHALL re-invoke `bundle-server.mjs`

#### Scenario: Cache is fresh

- **WHEN** the stamp file exists AND every watched source has mtime <= stamp mtime
- **THEN** the script SHALL skip the bundler invocation

### Requirement: Client materialization post-condition

`bundle-server.mjs` SHALL fail loudly (non-zero exit, error message identifying the failed step) when ANY of:

- `clientSrc` (built client directory) cannot be located.
- `<SERVER_BUNDLE>/node_modules/@blackbelt-technology/pi-dashboard-web/dist/index.html` does not exist after the materialization step completes.

The script SHALL NOT print a warning and continue under these conditions.

#### Scenario: No built client

- **WHEN** `bundle-server.mjs` runs AND neither `dist/client/` nor `packages/client/dist/` nor `packages/dist/client/` contains `index.html`
- **THEN** the script SHALL exit non-zero
- **AND** the error message SHALL instruct running `npm run build` first

#### Scenario: Materialization step did not place pi-dashboard-web

- **WHEN** the bundler completes its materialization step AND `<SERVER_BUNDLE>/node_modules/@blackbelt-technology/pi-dashboard-web/dist/index.html` does not exist
- **THEN** the script SHALL exit non-zero
- **AND** SHALL NOT write the stamp file

#### Scenario: Successful bundle

- **WHEN** every step of `bundle-server.mjs` succeeds AND the post-verify check passes
- **THEN** the script SHALL write `<SERVER_BUNDLE>/.bundle-stamp` with content `<git-sha>-<unix-ts>` (or equivalent identifier)
- **AND** SHALL exit zero

### Requirement: Repo-lint covering committed bundles

A vitest under `packages/shared/src/__tests__/` SHALL assert that for every `resources/server/` directory present in the workspace, `node_modules/@blackbelt-technology/pi-dashboard-web/dist/index.html` resolves (file or symlink).

#### Scenario: Committed bundle missing materialization

- **WHEN** the lint test runs AND a `resources/server/` directory exists without the expected `pi-dashboard-web/dist/index.html`
- **THEN** the test SHALL fail with a message naming the offending directory

