## Why

`add-ci-electron-on-demand-build` task 7.2 surfaced a Windows-only build failure when `ci-electron.yml` dispatches on non-release branches:

```
An unhandled rejection has occurred inside Forge:
Error: Incorrectly formatted version string:
  "0.5.3-ci.20260525-141712.feat-enable-standalo.2206c1e".
  Should have at least one and at most four components
  at parseVersionString (.../@electron/packager/dist/resedit.js:37:15)
  at resedit (.../@electron/packager/dist/resedit.js:92:42)
  at async WindowsApp.runResedit (.../@electron/packager/dist/win32.js:68:9)
```

`@electron/packager`'s `resedit` step writes the Windows PE VERSIONINFO resource into `pi-dashboard.exe`. VERSIONINFO supports at most 4 numeric components (`A.B.C.D`); the prerelease slug `ci-electron.yml` produces encodes 5 dotted segments and includes non-numeric tokens (`-ci`, `feat-enable-standalo`, `2206c1e`). `parseVersionString` rejects it.

Inspecting `node_modules/@electron/packager/dist/win32.js`:

```js
productVersion: this.opts.appVersion              // ← no override path
fileVersion:    this.opts.buildVersion || appVersion
```

Both fields go through `parseVersionString`. Setting `packagerConfig.buildVersion` alone only fixes `FileVersion`; `ProductVersion` still throws on the SemVer slug because the only source path is `opts.appVersion`.

The release flow (`publish.yml`) emits a plain `vX.Y.Z` tag, so production builds have never seen this. ci-electron on prerelease branches is the only consumer of the slug.

## What Changes

- Add `packages/electron/src/lib/build-version.ts` exporting `deriveWindowsBuildVersion(pkgVersion, runNumber)`: a pure function that extracts the `MAJOR.MINOR.PATCH` integer triple from any input string and appends `GITHUB_RUN_NUMBER` (or `0` when undefined / non-integer) as the 4th component. Always returns a 4-integer dot-separated string.
- Wire `forge.config.ts`:
  - `packagerConfig.buildVersion` = `deriveWindowsBuildVersion(pkgVersion, process.env.GITHUB_RUN_NUMBER)` — applied unconditionally (affects `FileVersion` only on Windows; darwin/linux ignore it).
  - `packagerConfig.appVersion` = same 4-integer value, **but only when `process.platform === "win32"`** — narrows the override to Windows build hosts so darwin/linux artifacts keep the full SemVer slug in `CFBundleShortVersionString` / Info.plist visibility.
- Add `packages/electron/src/__tests__/forge-config-windows-version.test.ts`: textual pin over `forge.config.ts` to prevent silent regressions (import path, helper signature, `isWindowsBuildHost` predicate, unconditional `buildVersion`, conditional `appVersion`, explanatory comment).
- Add `packages/electron/src/lib/__tests__/build-version.test.ts`: 9 cases covering plain releases, ci-electron prerelease slugs, missing/empty/non-integer run numbers, malformed pkgVersion, multi-digit components, and the invariant that output always matches `^\d+\.\d+\.\d+\.\d+$`.
- Add the `author` field to `packages/electron/package.json` (required by `@electron/packager`; surfaced as a separate failure mode on a clean re-run after the version fix).
- Set `packagerConfig.appCopyright = "Copyright © 2026 BlackBelt Technology"`. Without this override, `@electron/packager` copies the Electron framework's default string (`"Copyright (C) 2015 GitHub, Inc."`) into Windows VERSIONINFO `LegalCopyright` (Explorer → Properties → Details → Copyright) AND macOS `NSHumanReadableCopyright` (Info.plist). The field is universal — not Windows-gated — because both platforms inherit the wrong default. Year is hardcoded to match `LICENSE`; avoids non-deterministic builds from `new Date().getFullYear()`.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `electron-build-pipeline`: add (a) a requirement that the Windows VERSIONINFO override SHALL be derived from a 4-integer build version when the slug is not a plain release tag, AND that the override is scoped to Windows build hosts so it does not leak into darwin/linux artifacts; (b) a requirement that `packagerConfig.appCopyright` SHALL be set to a BlackBelt-branded string so the produced Windows `.exe` `LegalCopyright` and macOS `NSHumanReadableCopyright` do not carry the Electron framework default (`"Copyright (C) 2015 GitHub, Inc."`).

## Impact

- **Code**: `packages/electron/src/lib/build-version.ts` (new, ~50 LOC, pure), `packages/electron/forge.config.ts` (modified — adds import, declares `buildVersion` + `isWindowsBuildHost`, plugs both into `packagerConfig`, sets `appCopyright`), `packages/electron/package.json` (add `author` field).
- **Tests**: `packages/electron/src/lib/__tests__/build-version.test.ts` (9 cases, all green), `packages/electron/src/__tests__/forge-config-windows-version.test.ts` (6 pins, all green).
- **CI**: unblocks `ci-electron.yml` Windows legs (`win32-x64`, `win32-arm64`) on any branch with a prerelease slug. Was 2/6 failing on run 26405031631 before the fix.
- **Release flow**: unaffected. `publish.yml` emits plain `vX.Y.Z` tags; `deriveWindowsBuildVersion("0.5.4", "<run>")` returns `0.5.4.<run>`, a valid 4-integer FileVersion that users never see (`app.getVersion()` returns the SemVer from `package.json#version`).
- **darwin / linux**: unaffected. `appVersion` override is gated on `process.platform === "win32"`; `buildVersion` is harmless on those platforms (only consumed by Windows `resedit`).
- **Migration**: none. New builds pick up the fix automatically.
- **Rollback**: revert `forge.config.ts` + delete `build-version.ts` + delete the two test files. Windows legs return to failing on prerelease slugs; release flow continues to work.
- **Risk**: low. The helper is a pure string transformation with 9 unit tests pinning behavior across input shapes. The textual pin test catches refactors that silently drop the override.
- **Alternative considered**: pass `--app-version=<X.Y.Z.N>` to `electron-forge package` on Windows via CLI. Rejected — `electron-forge` does not pipe a `--app-version` flag through to `@electron/packager` in a way the maker reads; the only reliable surface is `packagerConfig.appVersion`. Also rejected: sanitizing the slug upstream in `ci-electron.yml`. The slug is intentionally human-readable (encodes branch + commit) and is consumed by other artifacts (DMG basename, log labels); changing it has a larger blast radius than scoping a Windows-only override.
