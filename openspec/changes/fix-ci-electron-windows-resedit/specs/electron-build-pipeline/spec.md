## ADDED Requirements

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
