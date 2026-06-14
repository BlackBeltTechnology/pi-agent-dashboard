## MODIFIED Requirements

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

### Requirement: CI produces Windows x64 NSIS installer
The CI `windows-latest` x64 leg SHALL produce a Setup.exe installer AND a ZIP archive. It SHALL NOT produce a portable.exe (the 7-Zip SFX portable target was removed by this change).

#### Scenario: CI produces Windows x64 artifacts
- **WHEN** the CI workflow runs on `windows-latest` runner with `arch: x64`
- **THEN** it SHALL produce `PI-Dashboard-Setup-${version}-x64.exe` (NSIS) AND `PI-Dashboard-win32-x64.zip` (ZIP)
- **AND** it SHALL NOT invoke any `electron-builder --win portable` step

### Requirement: CI produces Windows arm64 NSIS installer
The CI `windows-latest` arm64 leg SHALL produce a Setup.exe installer AND a ZIP archive. arm64 NSIS support is provided by electron-builder's native arm64 NSIS templating.

#### Scenario: CI produces Windows arm64 artifacts
- **WHEN** the CI workflow runs on `windows-latest` runner with `arch: arm64`
- **THEN** it SHALL produce `PI-Dashboard-Setup-${version}-arm64.exe` (NSIS) AND `PI-Dashboard-win32-arm64.zip` (ZIP)
- **AND** it SHALL NOT invoke any `electron-builder --win portable` step

## REMOVED Requirements

### Requirement: Windows portable .exe artifact
**Reason:** The 7-Zip SFX portable target accumulated three structural problems (SFX path drift across launches, SmartScreen blocks unsigned SFX before extraction, ephemeral `%LOCALAPPDATA%\Temp\<random>\` working dir incompatible with the per-user managed-dir bootstrap model). The use case ("single-file no-installer experience") is now served by Setup.exe (real installer) and `.zip` (extract-and-run).

**Migration:** Users on portable.exe migrate to either Setup.exe or `.zip`. Their `~/.pi/` user data is untouched in either path. The active `fix-windows-portable-exe` proposal's §4 (Drop path) is taken by this change; that proposal SHALL be archived once this lands.

The following scenarios are removed:
- `Scenario: CI produces Windows x64 NSIS installer` clause "and a portable `.exe`" (replaced by the modified scenario above).
- `Scenario: CI produces Windows arm64 ZIP and portable` (entire scenario; replaced by the modified arm64 scenario above).
- All `out/make/portable/` artifact paths in upload globs.

## ADDED Requirements

### Requirement: CI smoke-tests the NSIS installer on the build runner
The `windows-latest` legs that build Setup.exe SHALL smoke-test it on the same runner, after the build, via a `.github/workflows/_electron-build.yml` step (`if: matrix.platform == 'win32'`). Because the installer is per-user (`/S` needs no admin), the smoke runs unprivileged on the runner with no VM and no external QA harness. Install, registry, and uninstall assertions SHALL be hard gates (fail the job). The x64 leg SHALL also run the launch assertion inline. The arm64 Electron shell cannot execute on the x64 build runner, so a separate `smoke-win-arm64` job (`runs-on: windows-11-arm`, `needs: build`) SHALL download the arm64 artifact and run the full install→launch→uninstall smoke natively on arm64. Launch assertions MAY be non-fatal while first-run bootstrap timing is being characterised.

#### Scenario: x64 leg runs full install→uninstall smoke
- **WHEN** the `windows-latest` x64 leg finishes building `PI-Dashboard-Setup-${version}-x64.exe`
- **THEN** the workflow SHALL run `qa/tests/windows-nsis-install.ps1`, `windows-nsis-no-permachine.ps1`, `windows-nsis-branding.ps1`, and `windows-nsis-uninstall.ps1` as hard gates against the built artifact
- **AND** it SHALL run `qa/tests/windows-nsis-launch.ps1` (asserting `/api/health` returns 200), allowed to be non-fatal
- **AND** a hard-gate failure SHALL fail the job

#### Scenario: arm64 build leg runs non-launch smoke inline
- **WHEN** the `windows-latest` arm64 leg finishes building `PI-Dashboard-Setup-${version}-arm64.exe`
- **THEN** the inline smoke step SHALL run the install, no-per-machine, branding, and uninstall scripts (arch-independent file/registry ops) as hard gates
- **AND** it SHALL skip the inline launch assertion (an arm64 binary cannot execute on the x64 runner)

#### Scenario: arm64 launch smoke runs natively on windows-11-arm
- **WHEN** the build job produces the `electron-win32-arm64` artifact
- **THEN** the `smoke-win-arm64` job (`runs-on: windows-11-arm`, `needs: build`) SHALL download that artifact and run `qa/tests/windows-nsis-install.ps1`, `windows-nsis-no-permachine.ps1`, `windows-nsis-branding.ps1`, and `windows-nsis-uninstall.ps1` as hard gates against the arm64 Setup.exe
- **AND** it SHALL run `qa/tests/windows-nsis-launch.ps1` natively (allowed non-fatal)
- **AND** the build path SHALL remain unchanged (arm64 still cross-built on `windows-latest`, bundling x64 Node for WoW64)

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
