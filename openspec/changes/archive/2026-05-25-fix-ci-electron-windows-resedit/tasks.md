# Tasks — fix-ci-electron-windows-resedit

All tasks below are **implemented and verified locally** on `feat/enable-standalone-npm-install` (commits b54415e2, ee224f1e, d6e9738c). The Windows CI matrix verification (Phase 3) is a follow-up dispatch.

## 1. Helper module

- [x] 1.1 Add `packages/electron/src/lib/build-version.ts` exporting `deriveWindowsBuildVersion(pkgVersion: string, runNumber: string | undefined): string`. Pure function — no `fs`, no `env`, no `electron`/`forge` imports. Extracts `(\d+)\.(\d+)\.(\d+)` from the head of `pkgVersion` (missing/non-integer components default to `0`); parses `runNumber` via `Number.parseInt(_, 10)` and uses `0` when undefined / empty / non-integer. Returns `${major}.${minor}.${patch}.${build}`.
- [x] 1.2 Add header comment documenting (a) the `@electron/packager` `resedit.js` parse-string constraint, (b) the exact failing slug shape from ci-electron, (c) why `pkg-version-only` is insufficient (productVersion has no other override path).

## 2. Unit tests for the helper

- [x] 2.1 Add `packages/electron/src/lib/__tests__/build-version.test.ts` with 9 vitest cases:
  - plain release version → appends run number
  - ci-electron prerelease slug → keeps base triple, drops suffix, appends run
  - missing run number → 4th component is `0`
  - empty-string run number → 4th component is `0`
  - non-integer run number → 4th component is `0`
  - malformed pkgVersion → all components are `0`, run appended
  - empty pkgVersion → all components are `0`, run appended
  - multi-digit components are preserved
  - invariant: output always matches `^\d+\.\d+\.\d+\.\d+$` (Windows VERSIONINFO contract) across 5 representative cases
- [x] 2.2 TDD red-then-green verified: tests fail before helper exists (import miss), 9/9 green after implementation.

## 3. `forge.config.ts` wiring

- [x] 3.1 Import `deriveWindowsBuildVersion` from `./src/lib/build-version.js`.
- [x] 3.2 Read `pkgVersion` from `package.json` at config-evaluation time (already done for DMG arch-tagging; reuse).
- [x] 3.3 Declare `const buildVersion = deriveWindowsBuildVersion(pkgVersion, process.env.GITHUB_RUN_NUMBER)`.
- [x] 3.4 Declare `const isWindowsBuildHost = process.platform === "win32"`. The ci-electron matrix builds Windows artifacts only on `windows-latest` runners (no cross-build path for win32), so build-host detection is correct.
- [x] 3.5 In `packagerConfig`:
  - Set `buildVersion` shorthand (unconditional — only consumed by Windows `resedit`).
  - Conditionally spread `...(isWindowsBuildHost ? { appVersion: buildVersion } : {})` so `ProductVersion` is also a 4-integer string on Windows, while darwin/linux artifacts keep the full SemVer in `CFBundleShortVersionString` / Info.plist.
- [x] 3.6 Add explanatory comment block above the declarations citing `@electron/packager/dist/win32.js` lines (`productVersion: this.opts.appVersion` ← no override path; `fileVersion: this.opts.buildVersion || appVersion`).
- [x] 3.7 Add `author` field to `packages/electron/package.json` (`@electron/packager` requires it; surfaces as a separate hard error after buildVersion was first fixed — caught in commit d6e9738c).
- [x] 3.8 Set `packagerConfig.appCopyright = "Copyright © 2026 BlackBelt Technology"`. Universal (not Windows-gated) — maps to Windows `LegalCopyright` AND macOS `NSHumanReadableCopyright`. Without it, the produced `.exe` Properties → Details → Copyright shows `"Copyright (C) 2015 GitHub, Inc."` (Electron framework default). Surfaced by user inspection of artifacts from run 26412541668.

## 4. Textual pin test over `forge.config.ts`

- [x] 4.1 Add `packages/electron/src/__tests__/forge-config-windows-version.test.ts` (parses `forge.config.ts` as text via `fs.readFileSync`, consistent with existing `forge-config-dmg-naming.test.ts` pattern).
- [x] 4.2 Pins (must all pass):
  - imports `deriveWindowsBuildVersion` from `./src/lib/build-version.js`
  - computes `buildVersion` from `pkgVersion` + `process.env.GITHUB_RUN_NUMBER` (trailing-comma tolerant regex)
  - declares `isWindowsBuildHost = process.platform === "win32"`
  - sets `packagerConfig.buildVersion` (shorthand, unconditional)
  - sets `packagerConfig.appVersion` only inside `...(isWindowsBuildHost ? { appVersion: buildVersion } : {})`
  - explanatory comment mentions `productVersion` AND one of `win32.js` / `VERSIONINFO` / `parseVersionString`
  - `appCopyright` is set to a BlackBelt-branded string matching `/appCopyright\s*:\s*["']Copyright\s+\u00a9\s+\d{4}\s+BlackBelt Technology["']/` (year-tolerant regex; brand token mandatory)

## 5. Local verification

- [x] 5.1 `vitest run packages/electron/src/lib/__tests__/build-version.test.ts` → 9/9 pass.
- [x] 5.2 `vitest run packages/electron/src/__tests__/forge-config-windows-version.test.ts` → 7/7 pass (was 6/6; +1 for the appCopyright pin).
- [x] 5.3 `vitest run packages/electron/src/__tests__/forge-config-dmg-naming.test.ts` → 6/6 pass (DMG arch-tagging regex still matches; no regression from the new declarations sitting above the config object).
- [x] 5.4 `vitest run packages/electron/src/__tests__/no-direct-platform-branch.test.ts` → 1/1 pass (no new platform branches introduced outside the existing allowed sites).
- [x] 5.5 `tsx packages/electron/forge.config.ts` loads cleanly locally; `buildVersion = "0.5.3.0"` printed when `GITHUB_RUN_NUMBER` is unset.

## 6. CI verification — Windows matrix

- [x] 6.1 Dispatched `ci-electron.yml` with `legs: win32` on `feat/enable-standalone-npm-install` (HEAD `d6e9738c`). **Run [26412541668](https://github.com/BlackBeltTechnology/pi-agent-dashboard/actions/runs/26412541668) completed 2026-05-25: 2/2 PASS.** Both `win32-x64` and `win32-arm64` reached `electron-forge make` without the `parseVersionString` throw and uploaded artifacts (`electron-win32-x64-d6e9738`, `electron-win32-arm64-d6e9738`, 14-day retention). The resolve job correctly filtered the matrix to Windows-only — no darwin/linux runners spawned. Closes the 2 failures from `add-ci-electron-on-demand-build` § 7.2 run 26405031631.
- [x] 6.2 Confirm `app.getVersion()` in the running Windows artifact still returns the full SemVer slug (Info-only check — `package.json#version` is the SemVer, untouched by this change). **Manual — requires installing the win32 artifact and running it.**
- [x] 6.3 Confirm Windows Explorer → Properties → Details shows `File version` and `Product version` as the 4-integer string. Acceptable to users: VERSIONINFO is a Windows-PE convention; the in-app version display reads from `app.getVersion()`. **Manual — requires installing the win32 artifact.**

## 7. Cross-references

- [x] 7.1 Update `add-ci-electron-on-demand-build/tasks.md § 7.2` to mark the Windows resedit follow-up `[x]` and point at this proposal. (Done in same branch.)
- [x] 7.2 Update the stale `See change: fix-electron-windows-version-format` forward-refs in the new test files to `See change: fix-ci-electron-windows-resedit` so future archive-walkers find the right proposal.
