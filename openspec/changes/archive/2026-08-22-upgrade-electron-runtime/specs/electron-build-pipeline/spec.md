# electron-build-pipeline delta

## RENAMED Requirements

- FROM: `### Requirement: macOS Catalina support`
- TO: `### Requirement: macOS Monterey support`

## MODIFIED Requirements

### Requirement: macOS Monterey support
The Electron app SHALL support macOS 12 (Monterey) and newer.

macOS 10.15 (Catalina) and 11 (Big Sur) are NOT supported. Both are past Apple's own
security-support window (Catalina 2022-09, Big Sur 2023-09), and Electron dropped them at
v33 and v38 respectively.

#### Scenario: Electron version
- **WHEN** the app is built
- **THEN** it SHALL use an Electron version on a currently-supported release line (one of the latest three stable majors at the time the pin is set)
- **AND** the version SHALL NOT be from a line that has reached end-of-life and no longer receives security backports
- **AND** the pinned major SHALL be greater than or equal to `43`, so a later change cannot silently regress the runtime to an unsupported line

### Requirement: macOS deployment target is pinned
The macOS DMG SHALL declare a deployment target of macOS 12.0 (Monterey) so binaries
launch on every macOS version from Monterey forward, regardless of which macOS version
the GitHub-hosted runner image happens to be on. The pin MUST be defensive: even if a
future change introduces a native module compiled from source on the runner, the
produced bundle SHALL still launch on Monterey and Ventura.

The floor SHALL be enforced at three independent points — the declared intent
(`forge.config.ts`), the compiler contract (`MACOSX_DEPLOYMENT_TARGET`), and a
post-build verification step — so that a runner-image upgrade or a source-compiled
module cannot silently raise it.

#### Scenario: forge.config.ts pins LSMinimumSystemVersion
- **WHEN** the Electron app is packaged on any macOS runner (currently `macos-14` for arm64, `macos-15-intel` for x64)
- **THEN** `packages/electron/forge.config.ts > packagerConfig.extendInfo` SHALL set `LSMinimumSystemVersion: "12.0"`
- **AND** the produced `<App>.app/Contents/Info.plist` SHALL contain `<key>LSMinimumSystemVersion</key><string>12.0</string>`

#### Scenario: Workflow exports MACOSX_DEPLOYMENT_TARGET
- **WHEN** the `Make Electron distributables` step runs on any darwin matrix row
- **THEN** the step's environment SHALL include `MACOSX_DEPLOYMENT_TARGET=12.0`
- **AND** any native module compiled from source by `node-gyp` during the build SHALL inherit that target via the standard Xcode toolchain env-var contract

#### Scenario: CI verifies the produced floor matches the spec
- **WHEN** the produced DMG is mounted post-build
- **THEN** the workflow SHALL extract `LSMinimumSystemVersion` from `<App>.app/Contents/Info.plist` and fail the job if the value is anything other than `12.0`
- **AND** the workflow SHALL run `otool -l` against the inner Mach-O `pi-dashboard` binary and require `LC_BUILD_VERSION.minos` major-version to be **exactly** `12` for both `darwin/x64` and `darwin/arm64` — a mismatch in **either** direction SHALL fail the job
- **AND** the previous per-arch expectation (`10` for x64, `11` for arm64) SHALL be removed rather than re-based, since at a 12.0 floor both arches converge
- **AND** the equality check replaces the previous upward-only (`-gt`) comparison: under the old 10.15 target a below-floor `minos` was unreachable on x64 (10 was already the minimum expressible), whereas at a 12.0 floor a below-floor value becomes reachable and MUST NOT pass
- **AND** the step's diagnostic text SHALL NOT attribute this binary's `minos` to `MACOSX_DEPLOYMENT_TARGET`: the otooled binary is the renamed **Electron prebuilt**, whose `LC_BUILD_VERSION` is baked by the upstream Electron release and copied verbatim. This check therefore functions as an **upstream-floor tripwire** (it fails when a future Electron raises its own macOS floor), and its diagnostic SHALL say so
- **AND** the `minos` extractor SHALL be multi-slice-safe: a universal/fat Mach-O emits one load-command set per architecture, so an extractor that reads only the first match SHALL either check every slice or fail explicitly when more than one is present
- **AND** the job SHALL emit a `::warning::` (not fail) if `minos` cannot be extracted at all (e.g., binary uses an unrecognized load-command format), so the verification is robust to future Mach-O format changes

### Requirement: Electron devDependency pinned to literal version
The `packages/electron/package.json` `devDependencies.electron` field SHALL be a literal semver string (e.g. `"43.4.1"`), NOT a range (`"^43.0.0"`). `app-builder-lib`'s `getElectronVersionFromInstalled` does not walk up the workspace tree to find an electron module hoisted to the root `node_modules/`, so it falls back to reading the version literal from `packages/electron/package.json` and applying a fixed-version regex (`/^\d/`). A range value beginning with `^` or `~` fails the regex and produces `Cannot compute electron version from installed node modules` on Windows NSIS builds (the only consumer of electron-builder under the hood). Pinning the literal value is the workaround electron-builder itself recommends in [issue #3984](https://github.com/electron-userland/electron-builder/issues/3984#issuecomment-504968246).

#### Scenario: electron field is a literal version
- **WHEN** `packages/electron/package.json` is parsed
- **THEN** `devDependencies.electron` SHALL match the regex `^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$` (a literal semver, no `^` or `~` prefix)

#### Scenario: Windows NSIS build resolves electron version
- **WHEN** the electron matrix's `windows-latest` variant runs `electron-forge make` and the NSIS maker invokes `app-builder-lib`
- **THEN** `getElectronVersionFromInstalled` SHALL return successfully without throwing `Cannot compute electron version from installed node modules`

## ADDED Requirements

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

#### Scenario: The minimum-system-version value is a full Darwin semver triple
- **WHEN** the `minimumSystemVersion` value is chosen for a macOS 12 floor
- **THEN** it SHALL be `21.0.0` — the **Darwin kernel** version corresponding to macOS 12, expressed as a complete three-component semver
- **AND** the marketing form (`"12.0"`) SHALL be treated as a defect: it is not valid strict semver, so `semver.lt` throws before any comparison happens — and it is on the wrong scale regardless, since `os.release()` returns the Darwin version
- **AND** the bare Darwin major (`"21"`) SHALL equally be treated as a defect, for the same parse reason
- **AND** because both defective spellings throw, are caught, and fall through to "update supported" while emitting only a log warning, the value SHALL be verified behaviourally (a below-floor OS release string is actually rejected) rather than by inspection

#### Scenario: The gate is scoped to macOS only
- **WHEN** the `minimumSystemVersion` field is injected into update metadata
- **THEN** it SHALL be written ONLY to the macOS metadata (`latest-mac.yml`)
- **AND** `latest-linux.yml` and `latest.yml` SHALL NOT carry the field, because `checkIfUpdateSupported` applies no platform guard and would compare a Linux kernel version or a Windows version against the Darwin value
- **AND** this constraint is a fail-**closed** hazard (every client on those platforms would be denied updates), in contrast to the fail-open hazards of a malformed value, and SHALL therefore be asserted explicitly rather than assumed from the injection step's intent

#### Scenario: A client below the floor is not offered the update
- **WHEN** a shipped client running on macOS 10.15 or 11 (Darwin 19.x / 20.x) performs its recurring update check
- **THEN** `checkIfUpdateSupported` SHALL return false and the update SHALL NOT be downloaded or installed
- **AND** a client on macOS 12 or newer (Darwin 21.x+) SHALL still be offered the update
- **AND** the below-floor client SHALL remain on its currently-installed version rather than entering a repeating failed-install cycle

#### Scenario: The gate is only effective if the shipped client supports it
- **WHEN** the floor-raising release is prepared
- **THEN** the `electron-updater` version bundled in the **already-shipped** build SHALL be confirmed to implement `checkIfUpdateSupported`
- **AND** this SHALL be established BEFORE the value is wired, since it determines whether the gate reaches any client at all
- **AND** if it does not, the limitation SHALL be recorded explicitly, since no change to the new release can retroactively add the gate to clients already in the field
