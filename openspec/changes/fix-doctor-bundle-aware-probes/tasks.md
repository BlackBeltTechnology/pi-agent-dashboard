# Tasks

## 1. Shared bundle-probe helper

- [ ] 1.1 Add `packages/shared/src/bundle-package-lookup.ts` exporting pure helper `findBundledPackage(resourcesPath: string | null, pkgName: string): { packageJsonPath: string; version: string | null; binPath?: string } | null`.
  - Returns `null` when `resourcesPath` is null (standalone arm) or when the package directory does not exist.
  - Reads `package.json#version` and `package.json#bin` (handles both string and object forms).
  - Resolves `bin` to an absolute path; verifies it exists before returning.
- [ ] 1.2 Unit tests in `packages/shared/src/__tests__/bundle-package-lookup.test.ts`:
  - null resourcesPath → null result
  - missing pkg dir → null
  - present pkg with version + string bin → returns shape
  - present pkg with object bin → picks the entry matching pkgName (e.g. `@earendil-works/pi-coding-agent → { pi: "./dist/cli.js" }`)
  - scoped package name (e.g. `@earendil-works/pi-coding-agent`) resolves to `node_modules/@earendil-works/pi-coding-agent/` (verifies the helper handles the slash in scoped names without joining literally)
  - malformed package.json → null (no throw)

## 1b. Fix `probeServer()` field name (sibling task)

- [ ] 1b.1 In `packages/electron/src/lib/doctor.ts:121` (inside `probeServer()`), change `starter: typeof health.starter === "string" ? health.starter : null,` to read `launchSource` instead. Pattern:
  ```ts
  starter: typeof health.launchSource === "string"
    ? health.launchSource
    : (typeof health.starter === "string" ? health.starter : null),  // legacy fallback
  ```
  The legacy fallback covers a user attaching to an actually-old server (pre-eliminate-electron-runtime-install). Drop the fallback in a follow-up release.
- [ ] 1b.2 Unit test: stub `fetch` returning `{ launchSource: "electron", … }`; assert Doctor's `Server starter` row reports `electron` with status `ok` (not `Unknown (old server?)`).
- [ ] 1b.3 Unit test legacy path: stub `fetch` returning `{ starter: "standalone" }` (no `launchSource`); assert `Server starter` is `standalone` (fallback fires).

## 2. Wire bundle-aware lookups into Doctor

- [ ] 2.1 Extend `runSharedChecks(opts)` signature with `resourcesPath?: string | null`. Default null. Document in jsdoc.
- [ ] 2.2 In the `TypeScript loader` check (line ~556), prepend two lookups via `findBundledPackage(resourcesPath, "jiti")` and `findBundledPackage(resourcesPath, "tsx")`. On hit, return `{status: "ok", message: "jiti v<ver> (bundled) at <path>"}`. Existing managed-dir + PATH probes stay as fallbacks.
- [ ] 2.3 In the `pi CLI` check, prepend `findBundledPackage(resourcesPath, "@earendil-works/pi-coding-agent")` then fallback to legacy `"pi-coding-agent"` (unscoped) for builds that still ship that. On hit, return `{status: "ok", message: "pi (bundled) at <binPath>"}`. Note: the entry script is `dist/cli.js`, not a `bin` map field — inspect `package.json#bin.pi` first (it's there), then fall back to `dist/cli.js` if `bin` is absent.
- [ ] 2.4 In the `openspec CLI` check, prepend `findBundledPackage(resourcesPath, "@fission-ai/openspec")` then fallback to legacy `"openspec"`. On hit, return `{status: "ok"}`.
- [ ] 2.5 Update `packages/electron/src/lib/doctor.ts`: where it calls `runSharedChecks(...)`, pass `resourcesPath: process.resourcesPath`. Where the standalone server calls (if it does), pass `null` explicitly.

## 3. Remediation message audit

- [ ] 3.1 In `packages/shared/src/doctor-core.ts` SUGGESTIONS map, change the "TypeScript loader" / "pi CLI" / "openspec CLI" remediation text. When `resourcesPath` is set AND the binary is missing from the bundle, the message SHALL say: "Bundled <name> missing from `<expected-path>`. This indicates a corrupted Electron install; reinstall from the official Releases page." (Not "run the setup wizard" — the setup wizard cannot repair a missing bundled dep post `eliminate-electron-runtime-install`.)
- [ ] 3.2 When `resourcesPath` is null (standalone arm), keep the existing "run the setup wizard" text — that arm still has a writable target.

## 4. Tests

- [ ] 4.1 Integration test in `packages/shared/src/__tests__/doctor-core-bundle-probes.test.ts`: stub a fake `resourcesPath` with a synthetic `server/node_modules/{jiti,pi-coding-agent,openspec}/package.json` tree, run `runSharedChecks`, assert all three sections report ✅ with `(bundled)` in the message.
- [ ] 4.2 Negative integration test: stub `resourcesPath` with the dir present but the `jiti/pi-coding-agent/openspec` subdirs missing. Assert the corrupted-install remediation text appears, NOT the setup-wizard text.
- [ ] 4.3 Standalone-arm test: pass `resourcesPath: null`. Assert behaviour is identical to today (existing managed-dir + PATH probes).

## 5. Validate (initial scope)

- [ ] 5.1 Run `npm test`, all green.
- [ ] 5.2 Manual smoke on Windows VM (the spike artifact): open Doctor, confirm three formerly-failing rows turn ✅ with `(bundled)` annotations.
- [ ] 5.3 Manual smoke on macOS Electron build: open Doctor, confirm same (and confirm the message reads `at /Applications/PI Dashboard.app/Contents/Resources/server/...`).
- [ ] 5.4 Manual smoke on standalone (`npm i -g`) install: open Doctor (via `/api/doctor` REST or however the standalone surface exposes it). Confirm behaviour unchanged.

## 6. Lift bundled-runtime rows into runSharedChecks (extended scope)

- [ ] 6.1 Extend `SharedChecksDeps` with:
  - `detectBundledNode?: (resourcesPath: string) => { found: boolean; path?: string; version?: string }` — production impl in `doctor-core.ts` (or a sibling helper) probes `<res>/node/node.exe` on win32, `<res>/node/bin/node` on POSIX, and `--version`-runs the binary to get the version.
  - `detectBundledNpm?: (resourcesPath: string) => { found: boolean; path?: string; version?: string }` — probes `<res>/node/node_modules/npm/bin/npm-cli.js` and `node <path> --version`.
  - `fetchHealth?: () => Promise<{ launchSource?: string; starter?: string; version?: string } | null>` — production impl GETs `http://localhost:<port>/api/health`. Returns `null` on 404 / network error.
  - `resolveDashboardServerCli?: (resourcesPath: string) => { found: boolean; path?: string; version?: string }` — mirrors the existing Electron-side `detectBundledServerCli` logic in `doctor.ts`.
- [ ] 6.2 In `runSharedChecks`, when `resourcesPath` is non-null, push five additional checks BEFORE the existing Setup / Diagnostics sections:
  - `Bundled Node.js` (runtime section). status `ok` on hit; `error` on miss with corrupted-install remediation.
  - `Bundled npm` (runtime section). Same shape.
  - `Bundled Node runtime` (runtime section). One-line summary: which Node binary the server is actually running under. Source: `process.execPath` + `process.versions.node`.
  - `Dashboard server code` (server section). Reports path + version of the bundled server cli.
  - `Server starter` (server section). Reads `launchSource` with `starter` legacy fallback (covered by task 1b but applied here too).
- [ ] 6.3 When `resourcesPath` is null (standalone arm), do not push the five rows.
- [ ] 6.4 In `packages/electron/src/lib/doctor.ts`, remove the five corresponding direct check-pushes (Bundled Node, Bundled npm, Bundled Node runtime, Dashboard server code, Server starter). Keep only the `Electron <version>` row.
- [ ] 6.5 In `packages/server/src/routes/doctor-routes.ts`, ensure the route passes `resourcesPath: process.resourcesPath ?? null` to `runSharedChecks`. (The Electron-launched server inherits `process.resourcesPath` from the Electron parent; the standalone server has it undefined — coerce to `null`.)

## 7. Filter bundled-node from System Node check

- [ ] 7.1 In the `System Node.js` check in `runSharedChecks`, after `detectSystemNode()` returns `{ found, path }`:
  - If `resourcesPath` is non-null AND `path` resolves under `<resourcesPath>/node/` (path-prefix match; lowercase both sides on win32), treat as `found: false` and emit the existing `Not found on PATH (bundled Node will be used)` warning row.
  - Add a detail line indicating that a binary at the bundled path was filtered out, so a confused user can trace the behaviour.
- [ ] 7.2 Implement the prefix check as a pure helper `isUnderBundledNode(systemPath: string, resourcesPath: string, platform: NodeJS.Platform): boolean` in `doctor-core.ts` or a sibling. Inject it through deps for testability if it grows.

## 8. Tests for extended scope

- [ ] 8.1 In `packages/shared/src/__tests__/doctor-core-bundle-probes.test.ts` (or new sibling), add tests:
  - With `resourcesPath` set + `detectBundledNode`/`detectBundledNpm` stubs returning `found: true`: assert the five new rows are present with the expected sections.
  - With `resourcesPath: null`: assert the five new rows are absent.
  - With Electron-side double-emission attempted: spec scenario "no double-emission" (verify only-once invariant).
- [ ] 8.2 Test `isUnderBundledNode`:
  - win32: `"C:\\res\\node\\node.exe"` under `"C:\\res"` → true.
  - win32 lowercase: `"c:\\res\\node\\node.exe"` under `"C:\\res"` → true.
  - win32 non-match: `"C:\\Program Files\\nodejs\\node.exe"` under `"C:\\res"` → false.
  - POSIX: `/app/Resources/node/bin/node` under `/app/Resources` → true.
  - POSIX case-sensitive: `/App/Resources/...` under `/app/Resources` → false (POSIX paths are case-sensitive).
- [ ] 8.3 Update Electron-side `packages/electron/src/lib/__tests__/doctor.test.ts` (or its successor): assert the five lifted rows are NO LONGER emitted by `lib/doctor.ts` directly.

## 9. Validate extended scope

- [ ] 9.1 Run `npm test`, all green (root + per-package).
- [ ] 9.2 Build the bundle: `node packages/electron/scripts/bundle-server.mjs`.
- [ ] 9.3 Push to `feat/enable-standalone-npm-install`. Dispatch `ci-electron.yml legs: win32-x64`. Smoke on Windows VM:
  - Settings → Diagnostics SHALL show ≥12 rows (only `Electron <version>` may be Electron-only).
  - `System Node.js` row SHALL read `Not found on PATH` (not the bundled path).
  - `Bundled Node.js`, `Bundled npm`, `Server starter` SHALL all read ✅ with bundled paths.
  - Doctor window SHALL show no duplicate rows (each lifted row exactly once).
