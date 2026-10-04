## MODIFIED Requirements

### Requirement: macOS deployment target is pinned
The macOS DMG SHALL declare a deployment target of macOS 12.0 (Monterey) so binaries
launch on every macOS version from Monterey forward, regardless of which macOS version
the GitHub-hosted runner image happens to be on. The pin MUST be defensive: even if a
future change introduces a native module compiled from source on the runner, the
produced bundle SHALL still launch on Monterey and Ventura.

The floor SHALL be enforced at four independent points — the declared intent
(`forge.config.ts`), the compiler contract (`MACOSX_DEPLOYMENT_TARGET`), a
post-build verification step, and a canary proving the verification step's
extractor is not blind — so that a runner-image upgrade, a source-compiled
module, or a silently-degraded extractor cannot raise it unnoticed.

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
