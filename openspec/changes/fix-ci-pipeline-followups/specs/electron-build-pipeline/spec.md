## MODIFIED Requirements

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
- **AND** the job SHALL emit a `::warning::` (not fail) if `minos` cannot be extracted from the produced app binary (e.g., an unrecognized load-command format), so the verification is robust to future Mach-O format changes — PROVIDED the extractor has first proven itself on the installed Electron prebuilt: before inspecting the produced binary the job SHALL run the same extractor over `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron` and SHALL fail (not warn) when that returns no value, naming the extractor and the sample, because a blind extractor would otherwise disable the upstream-floor tripwire silently

#### Scenario: Blind extractor fails the job instead of passing it
- **GIVEN** an `otool -l` output shape the extractor does not recognise
- **WHEN** the floor check runs on macOS
- **THEN** the canary over the installed Electron prebuilt SHALL return no `minos` value and the job SHALL fail with `::error::` naming `extractMinosValues` and the prebuilt path

#### Scenario: Novel shape on the produced binary alone still warns
- **GIVEN** the canary extracted a value from the prebuilt
- **WHEN** the produced app binary yields no `minos`
- **THEN** the job SHALL emit `::warning::` and pass, as before
