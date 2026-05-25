# Design — fix-ci-electron-windows-resedit

## Problem

`@electron/packager` writes the Windows PE VERSIONINFO resource (`FileVersion`, `ProductVersion`) via `resedit.js`'s `parseVersionString`. The contract:

```
MAJOR.MINOR.BUILD[.REVISION]
```

— at most 4 dotted components, each an integer. SemVer prereleases are rejected.

`ci-electron.yml` produces slug-versions of the form:

```
0.5.3-ci.20260525-141712.feat-enable-standalo.2206c1e
```

5 dotted segments, 4 non-integer tokens. Every Windows dispatch throws at the `WindowsApp.runResedit` step. Release builds (`publish.yml`) use plain `vX.Y.Z` and have never seen this — the failure is scoped to ci-electron prerelease dispatches.

## Why both `buildVersion` AND `appVersion` need overriding

`node_modules/@electron/packager/dist/win32.js` wires VERSIONINFO like this:

```js
productVersion: this.opts.appVersion              // ← no override path
fileVersion:    this.opts.buildVersion || appVersion
```

Both go through `parseVersionString`. Three observations:

1. `buildVersion` is read **only** by Windows packaging — darwin/linux make no use of it. Setting it unconditionally is safe.
2. `appVersion` is read by **all platforms**:
   - Windows → ProductVersion (must be 4-integer).
   - macOS → `CFBundleShortVersionString` in Info.plist (user-visible "Version" in Finder Get Info; should be the SemVer slug for traceability).
   - Linux → ignored by AppImage/DEB, but Electron's `app.getVersion()` falls back to it when `package.json#version` is unset (it's not; we set it).
3. Therefore the override must be **scoped to Windows**: `...(isWindowsBuildHost ? { appVersion: buildVersion } : {})`.

`process.platform === "win32"` is the right predicate because the ci-electron matrix builds Windows artifacts **only** on `windows-latest` runners. There is no Linux→Windows cross-compile path (NSIS is Windows-native; Wine cross-compile is not in the matrix). If a future matrix row adds cross-compile for win32, this check will need to be augmented (e.g. read `TARGET_PLATFORM` from the maker context).

## Why a derived 4-integer rather than parsing the slug

The slug is human-readable on purpose — it encodes the branch and 7-char SHA so artifacts uploaded to the Actions tab are identifiable. We do **not** want to truncate or sanitize the slug itself; that would harm artifact basenames (`pi-dashboard-0.5.3-ci…-feat-enable-standalo-2206c1e-mac.dmg`) and log readability.

Instead we synthesize a Windows-only build version:

```
deriveWindowsBuildVersion("0.5.3-ci.20260525-141712.feat-enable-standalo.2206c1e", "42")
  → "0.5.3.42"
```

Properties of the synthesized version:

- Always 4-integer (regex `^\d+\.\d+\.\d+\.\d+$`).
- `MAJOR.MINOR.PATCH` come from the head of `pkg.version` so Windows shows the right product line.
- The 4th component is `GITHUB_RUN_NUMBER` — monotonically increasing per workflow file, sufficient for `electron-updater` (Windows reads VERSIONINFO when comparing local-vs-remote on staged updates) and human readers parsing Properties → Details.
- Local builds (no `GITHUB_RUN_NUMBER`) get `0.5.3.0` — fine for `electron-forge package` smoke tests; nobody publishes a Windows artifact from a laptop.

## Why `app.getVersion()` is unaffected

`app.getVersion()` reads `package.json#version` at runtime, **not** the PE VERSIONINFO. The pipeline does `npm pkg set version=<slug>` before make; the in-app version display, log labels, About dialog, and `/api/health.version` continue to show the full SemVer slug. The 4-integer build version is visible only in Windows Explorer → Properties → Details, which is the convention any user opening that dialog expects.

## Why a textual pin test on `forge.config.ts`

`forge.config.ts` evaluates `process.env` and `process.platform` at import time, so the conditional spread cannot be exercised by `tsx`-loading the module in a vitest run (each test would only see one platform). The existing `forge-config-dmg-naming.test.ts` solved the same problem by parsing the file as text via `fs.readFileSync` and matching regex pins. We follow that pattern verbatim:

- Strict regex over the import statement.
- Tolerant regex over the function call (trailing comma allowed for Prettier).
- Pin on the conditional-spread syntax so a refactor to a ternary or `if`-branch is caught.

Trade-off: the pin is brittle against legitimate refactors (rename `isWindowsBuildHost` to `isWindows` and the test fails). Accepted — the alternative (no pin) silently lost the override in past forge.config refactors (see DMG naming history); the brittleness forces a conscious test update, which is the right signal.

## Why `author` is required

After fixing `buildVersion` + `appVersion`, the Windows leg surfaced a second hard error:

```
Author is required to package an application for Windows
```

`@electron/packager` requires `package.json#author` to populate the VERSIONINFO `CompanyName` field. It was missing from `packages/electron/package.json` (root package had it; the workspace package didn't). Added in commit d6e9738c. Out-of-scope for the slug-shape fix per se, but blocked Windows packaging once the slug issue was unblocked, so co-shipped.

## Rejected alternatives

- **Truncate the slug to MAJOR.MINOR.PATCH at the workflow level.** Loses artifact-traceability. The slug appears in 5 unrelated places (artifact basenames, log labels, DMG filenames, `/api/health.version`, About dialog).
- **Pass `--app-version` to `electron-forge package` CLI.** `electron-forge` does not pipe an `--app-version` flag through to `@electron/packager` via the maker chain. Confirmed by reading `@electron-forge/core/dist/api/package.ts`.
- **Override via `packagerConfig.win32metadata.FileVersion`.** This sets `FileVersion` but does **not** override `ProductVersion`. `win32.js` reads `ProductVersion` only from `opts.appVersion`. Verified by greping `node_modules/@electron/packager/dist/win32.js`.
- **Migrate from `@electron/packager` to `electron-builder`.** Bigger blast radius than a 50-LOC helper. Open as a future option only if `@electron/packager` continues to constrain VERSIONINFO handling.

## Risk

- **Future @electron/packager upgrade changes the resedit constraint** — low. The 4-integer requirement is a Windows PE-format invariant, not a packager-specific choice. Any change there would be a Windows-OS-level change.
- **Future cross-compile path adds Linux→Windows.** Build-host check breaks. Mitigation: explicit comment in `forge.config.ts` calling out the build-host assumption; textual pin test catches refactors that rename or remove `isWindowsBuildHost`.
- **`electron-updater` reads VERSIONINFO for staged-update comparisons.** With the 4th component as `GITHUB_RUN_NUMBER`, comparisons are monotonic per workflow but not across release vs. ci-electron. Acceptable — ci-electron artifacts are not published to the auto-update channel (no Release created).
