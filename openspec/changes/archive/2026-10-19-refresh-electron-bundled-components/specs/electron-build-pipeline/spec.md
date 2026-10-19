## MODIFIED Requirements

### Requirement: electron-forge project configuration
The project SHALL include a `packages/electron/` directory with Electron main process entry point, preload script, and forge configuration.

#### Scenario: Forge config exists
- **WHEN** the project is set up for Electron builds
- **THEN** `packages/electron/forge.config.ts` SHALL define the Linux DEB maker
- **AND** it SHALL NOT define an AppImage maker, and `packages/electron/package.json` SHALL NOT depend on one: the AppImage is produced by electron-builder (see `AppImage Linux package`)

#### Scenario: Main process entry point
- **WHEN** the Electron app starts
- **THEN** it SHALL load `packages/electron/src/main.ts` as the main process entry point

#### Scenario: Executable name
- **WHEN** the app is packaged
- **THEN** the binary SHALL be named `pi-dashboard` (via `executableName` in packagerConfig)

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
- **THEN** it SHALL produce a `.deb` and an `.AppImage` for arm64
- **AND** the AppImage SHALL be produced by electron-builder `--prepackaged` from the Forge-packaged arm64 app

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

### Requirement: AppImage Linux package
The Linux build SHALL produce an AppImage in addition to the existing DEB package.

#### Scenario: AppImage maker configured
- **WHEN** the Linux build runs
- **THEN** electron-builder `--linux AppImage --prepackaged <Forge-packaged dir>` SHALL produce a single `.AppImage` file that runs on any Linux distribution

#### Scenario: AppImage includes app icon
- **WHEN** the AppImage is built
- **THEN** it SHALL embed the app icon for display in desktop environments

### Requirement: macOS deployment target is pinned
The macOS DMG SHALL declare a deployment target of macOS 13.0 (Ventura) so binaries
launch on every macOS version from Ventura forward, regardless of which macOS version
the GitHub-hosted runner image happens to be on. The pin MUST be defensive: even if a
future change introduces a native module compiled from source on the runner, the
produced bundle SHALL still launch on Ventura and Sonoma.

The floor SHALL be enforced at four independent points — the declared intent
(`forge.config.ts`), the compiler contract (`MACOSX_DEPLOYMENT_TARGET`), a
post-build verification step, and a canary proving the verification step's
extractor is not blind — so that a runner-image upgrade, a source-compiled
module, or a silently-degraded extractor cannot raise it unnoticed.

#### Scenario: forge.config.ts pins LSMinimumSystemVersion
- **WHEN** the Electron app is packaged on any macOS runner (currently `macos-14` for arm64, `macos-15-intel` for x64)
- **THEN** `packages/electron/forge.config.ts > packagerConfig.extendInfo` SHALL set `LSMinimumSystemVersion: "13.0"`
- **AND** the produced `<App>.app/Contents/Info.plist` SHALL contain `<key>LSMinimumSystemVersion</key><string>13.0</string>`

#### Scenario: Workflow exports MACOSX_DEPLOYMENT_TARGET
- **WHEN** the `Make Electron distributables` step runs on any darwin matrix row
- **THEN** the step's environment SHALL include `MACOSX_DEPLOYMENT_TARGET=13.0`
- **AND** any native module compiled from source by `node-gyp` during the build SHALL inherit that target via the standard Xcode toolchain env-var contract

#### Scenario: CI verifies the produced floor matches the spec
- **WHEN** the produced DMG is mounted post-build
- **THEN** the workflow SHALL extract `LSMinimumSystemVersion` from `<App>.app/Contents/Info.plist` and fail the job if the value is anything other than `13.0`
- **AND** the workflow SHALL run `otool -l` against the inner Mach-O `pi-dashboard` binary and require `LC_BUILD_VERSION.minos` major-version to be **exactly** `13` for both `darwin/x64` and `darwin/arm64` — a mismatch in **either** direction SHALL fail the job
- **AND** the previous per-arch expectation (`10` for x64, `11` for arm64) SHALL be removed rather than re-based, since at the current floor both arches converge
- **AND** the equality check replaces the previous upward-only (`-gt`) comparison: under the old 10.15 target a below-floor `minos` was unreachable on x64 (10 was already the minimum expressible), whereas at the current floor a below-floor value becomes reachable and MUST NOT pass
- **AND** the step's diagnostic text SHALL NOT attribute this binary's `minos` to `MACOSX_DEPLOYMENT_TARGET`: the otooled binary is the renamed **Electron prebuilt**, whose `LC_BUILD_VERSION` is baked by the upstream Electron release and copied verbatim. This check therefore functions as an **upstream-floor tripwire** (it fails when a future Electron raises its own macOS floor), and its diagnostic SHALL say so
- **AND** the `minos` extractor SHALL be multi-slice-safe: a universal/fat Mach-O emits one load-command set per architecture, so an extractor that reads only the first match SHALL either check every slice or fail explicitly when more than one is present
- **AND** the job SHALL emit a `::warning::` (not fail) if `minos` cannot be extracted from the produced app binary (e.g., an unrecognized load-command format), so the verification is robust to future Mach-O format changes — PROVIDED the extractor has first proven itself on the installed Electron prebuilt: before inspecting the produced binary the job SHALL run the same extractor over the prebuilt at `<electron-dir>/dist/Electron.app/Contents/MacOS/Electron` and SHALL fail (not warn) unless that yields a NUMERIC `minos` major, naming the extractor and the sample. A non-numeric result SHALL fail the canary too, because `non-numeric` also maps to a passing `::warning::` on the produced binary, so accepting it would leave the upstream-floor tripwire just as silently disabled as a blind extractor would
- **AND** the job SHALL NOT pass when the produced app binary cannot be located at all: a mounted DMG whose `<App>/Contents/MacOS` holds no regular file SHALL fail the job, not emit a `::warning::` and skip the check, since skipping disables the tripwire on the lookup axis exactly as a blind extractor disables it on the extraction axis
- **AND** the canary's verdict logic SHALL live as a pure, `otool`-text-taking predicate beside `extractMinosValues` so it is covered by the electron build-contract vitest project, which runs on Linux where `otool` does not exist; only the `otool` invocation itself SHALL live in the CI-facing script

#### Scenario: Canary sample is installed before the floor check runs
- **GIVEN** `electron` declares no `scripts` field (its `install.js` is exposed as `bin.install-electron`), so no install lifecycle populates `<electron-dir>/dist`, and darwin builds package from the `@electron/get` cache
- **WHEN** the darwin legs of `_electron-build.yml` run
- **THEN** the job SHALL run `node install.js` in the directory reported by `node packages/shared/bin/pi-dashboard-resolve-tool.cjs electron` before the floor-check step, so the canary's reference binary exists
- **AND** the electron directory SHALL be obtained from that resolver rather than a hard-coded `node_modules/electron` path, with `_electron-build.yml` added to the hard-coded-path lint's scanned files so the literal cannot return

#### Scenario: Blind extractor fails the job instead of passing it
- **GIVEN** an `otool -l` output shape the extractor does not recognise
- **WHEN** the floor check runs on macOS
- **THEN** the canary over the installed Electron prebuilt SHALL return no `minos` value and the job SHALL fail with `::error::` naming `extractMinosValues` and the prebuilt path

#### Scenario: Canary cannot run its tool
- **GIVEN** `otool` cannot be executed at all — absent from `PATH`, or exiting non-zero
- **WHEN** the canary runs over the installed Electron prebuilt
- **THEN** the job SHALL fail with `::error::` naming the extractor and the sample, NOT degrade to the `::warning::` + exit 0 path the produced-binary check uses for an exec failure, because a floor check that cannot run its own tool is misconfigured rather than facing a novel binary

#### Scenario: Non-numeric canary result fails the job
- **GIVEN** an `otool -l` output whose `minos` major is present but not numeric
- **WHEN** the canary runs over the installed Electron prebuilt
- **THEN** the job SHALL fail with `::error::` rather than proceeding to the produced-binary check

#### Scenario: Missing produced binary fails the job
- **GIVEN** a mounted DMG whose `<App>/Contents/MacOS` contains no regular file
- **WHEN** the floor-check step looks up the main binary
- **THEN** the job SHALL emit `::error::`, detach the mount, and exit non-zero

#### Scenario: Novel shape on the produced binary alone still warns
- **GIVEN** the canary extracted a value from the prebuilt
- **WHEN** the produced app binary yields no `minos`
- **THEN** the job SHALL emit `::warning::` and pass, as before

### Requirement: Update stream is gated on the minimum supported OS
When a release raises the minimum supported OS above that of an already-shipped build,
the update stream SHALL prevent the already-shipped client from installing an artifact
its OS cannot launch. A release-notes statement is NOT sufficient: `electron-updater`
otherwise offers the new artifact to every client, and on macOS the install fails at
launch, leaving the user in a repeating failed-update cycle (the `electron-auto-update`
recurring check does not stop on failure).

`electron-updater` implements this gate as `checkIfUpdateSupported(updateInfo)`, which
reads `updateInfo.minimumSystemVersion` from the update metadata and compares it against
`os.release()` using the strict `semver.lt` parser. A comparison that throws is caught,
logged as a warning, and **falls through to "update supported"** — so a malformed value
disables the gate silently rather than failing loudly.

#### Scenario: Update metadata declares a minimum system version
- **WHEN** the macOS update metadata (`latest-mac.yml`) is produced for a release that raises the OS floor
- **THEN** the emitted `latest-mac.yml` SHALL carry a `minimumSystemVersion` field
- **AND** the requirement SHALL be verified against the **emitted metadata file**, NOT against a build-config key, because `mac.minimumSystemVersion` in `electron-builder.yml` does NOT propagate to update metadata: `app-builder-lib`'s update-info builder never writes the field, and its only consumer (`macPackager`) is skipped entirely under the `--prepackaged` invocation this pipeline uses
- **AND** the field SHALL survive the arm64 + x64 `latest-mac.yml` merge step, which MUST preserve fields it does not itself compose
- **AND** preservation alone is NOT sufficient: the merge seeds root keys from whichever file its glob yields first, so a leg-asymmetric injection would make the shipped gate depend on glob order rather than on intent. The merge SHALL therefore require every darwin leg to agree on `minimumSystemVersion` and SHALL FAIL when they disagree — including the case where one leg carries the field and the other does not, in either glob order. Silently inheriting the first leg's value is a defect

#### Scenario: The minimum-system-version value is a full Darwin semver triple
- **WHEN** the `minimumSystemVersion` value is chosen for a macOS 13 floor
- **THEN** it SHALL be `22.0.0` — the **Darwin kernel** version corresponding to macOS 13, expressed as a complete three-component semver
- **AND** the marketing form (`"13.0"`) SHALL be treated as a defect: it is not valid strict semver, so `semver.lt` throws before any comparison happens — and it is on the wrong scale regardless, since `os.release()` returns the Darwin version
- **AND** the bare Darwin major (`"22"`) SHALL equally be treated as a defect, for the same parse reason
- **AND** because both defective spellings throw, are caught, and fall through to "update supported" while emitting only a log warning, the value SHALL be verified behaviourally (a below-floor OS release string is actually rejected) rather than by inspection

#### Scenario: The gate is scoped to macOS only
- **WHEN** the `minimumSystemVersion` field is injected into update metadata
- **THEN** it SHALL be written ONLY to the macOS metadata (`latest-mac.yml`)
- **AND** `latest-linux.yml` and `latest.yml` SHALL NOT carry the field, because `checkIfUpdateSupported` applies no platform guard and would compare a Linux kernel version or a Windows version against the Darwin value
- **AND** this constraint is a fail-**closed** hazard (every client on those platforms would be denied updates), in contrast to the fail-open hazards of a malformed value, and SHALL therefore be asserted explicitly rather than assumed from the injection step's intent

#### Scenario: A client below the floor is not offered the update
- **WHEN** a shipped client running on macOS 12 or older (Darwin 21.x or below) performs its recurring update check
- **THEN** `checkIfUpdateSupported` SHALL return false and the update SHALL NOT be downloaded or installed
- **AND** a client on macOS 13 or newer (Darwin 22.x+) SHALL still be offered the update
- **AND** the below-floor client SHALL remain on its currently-installed version rather than entering a repeating failed-install cycle

#### Scenario: The gate is only effective if the shipped client supports it
- **WHEN** the floor-raising release is prepared
- **THEN** the `electron-updater` version bundled in the **already-shipped** build SHALL be confirmed to implement `checkIfUpdateSupported`
- **AND** this SHALL be established BEFORE the value is wired, since it determines whether the gate reaches any client at all
- **AND** if it does not, the limitation SHALL be recorded explicitly, since no change to the new release can retroactively add the gate to clients already in the field

## ADDED Requirements

### Requirement: Supported macOS versions
The Electron app SHALL support macOS 13 (Ventura) and newer.

macOS 12 (Monterey) and older are NOT supported. Electron 44 dropped macOS 12, and its
prebuilt declares `LC_BUILD_VERSION.minos 13.0`, so no build on a supported Electron line
can launch there.

#### Scenario: Electron version
- **WHEN** the app is built
- **THEN** it SHALL use an Electron version on a currently-supported release line (one of the latest three stable majors at the time the pin is set)
- **AND** the version SHALL NOT be from a line that has reached end-of-life and no longer receives security backports
- **AND** the pinned major SHALL be greater than or equal to `44`, so a later change cannot silently regress the runtime to an unsupported line

### Requirement: Packaged preloads keep the filenames the main process loads
Every preload bundle the main process attaches to a window SHALL be emitted under the exact filename the main process resolves, independent of the packaging toolchain's default output naming. A preload that is missing at its resolved path is skipped by Electron with only a console error, so the window would load without its bridge API instead of failing.

#### Scenario: Production build emits the expected preload files
- **WHEN** the Electron app is built for packaging
- **THEN** the build output SHALL contain `preload-main.js` and `preload.js`
- **AND** the build SHALL fail if either file is absent

#### Scenario: Main window exposes its bridge in the packaged app
- **WHEN** the packaged app opens its main window on a running dashboard
- **THEN** `window.piDashboard` SHALL be defined in that window

### Requirement: Packaged extra resources contain no symlink that leaves the bundle
Every symbolic link inside a resource copied into the packaged app (the bundled server, the bundled Node.js runtime, the Windows git bundle, and any resource added later) SHALL resolve to a target inside the packaged app. A link that is relative in the source resource SHALL remain relative after packaging, including a link from one copied resource into another. A link pointing at the build host's filesystem dangles on every user's machine and makes macOS code signing reject the bundle.

#### Scenario: No absolute or dangling links in the packaged app
- **WHEN** the app is packaged on any platform
- **THEN** no symbolic link under the packaged app's resources directory SHALL have an absolute target
- **AND** no symbolic link under it SHALL dangle
- **AND** every symbolic link under it SHALL resolve to a path inside the packaged app

#### Scenario: Relative bin links keep working
- **WHEN** the packaged app's bundled server is inspected
- **THEN** `server/node_modules/.bin/<name>` SHALL be a relative link that resolves to the package's bin file inside the bundle
- **AND** `node/bin/npm` SHALL resolve to the bundled npm CLI

#### Scenario: macOS strict signature verification accepts the bundle
- **WHEN** the packaged macOS app is signed (ad-hoc or Developer ID)
- **THEN** `codesign --verify --deep --strict` SHALL succeed

#### Scenario: Resources added later are covered without edits
- **WHEN** a new directory is added to the packaged extra resources
- **THEN** the same guarantee SHALL apply to it without a per-resource configuration change

## REMOVED Requirements

### Requirement: macOS Monterey support
**Reason**: Electron 44 dropped macOS 12 (Monterey); the floor moves to macOS 13 (Ventura) and the pinned-major lower bound moves to `44`.
**Migration**: Replaced by `Supported macOS versions`. macOS 12 clients stay on the last 0.9.x build; the update gate (`minimumSystemVersion: 22.0.0`) stops them being offered newer builds.
