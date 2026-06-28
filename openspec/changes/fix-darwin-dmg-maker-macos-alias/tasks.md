## Tasks

### 1. Postinstall hook

- [x] 1.1 Create `packages/electron/scripts/ensure-macos-alias.mjs`: pure ESM Node script; skip on non-darwin; locate `macos-alias` via `require.resolve` + walk-up; test `build/Release/volume.node`; run `npm rebuild macos-alias --prefix=<resolved>` if absent; print actionable suggestion + exit zero on failure.
- [x] 1.2 Add `"postinstall": "node scripts/ensure-macos-alias.mjs"` to `packages/electron/package.json`.
- [x] 1.3 Smoke-test on a darwin host: `rm -rf node_modules/.pnpm/macos-alias@*/node_modules/macos-alias/build`; run `pnpm install`; verify the postinstall self-heals.

### 2. Build-time gate

- [x] 2.1 In `packages/electron/scripts/build-installer.sh`, before the `electron-forge make` invocation, add a darwin-only gate: search `node_modules` for `macos-alias/build/Release/volume.node`; if absent, invoke `node packages/electron/scripts/ensure-macos-alias.mjs --rebuild`; exit non-zero with a clear message if still absent.
- [x] 2.2 Add a `--rebuild` flag handler to `ensure-macos-alias.mjs` that always attempts rebuild (used by the build gate, separate from the auto-heal postinstall mode).
- [x] 2.3 Smoke-test by deleting the `build/` dir then running `./packages/electron/scripts/build-installer.sh`; verify the rebuild self-heals before forge runs.

### 3. Doctor diagnostic

- [x] 3.1 In `packages/shared/src/doctor-core.ts`, add a darwin-only check for `macos-alias-volume` returning `{ state, suggestion }`.
- [x] 3.2 Wire the new check into `runSharedChecks()` under the existing "Electron build prerequisites" (or "Build") section in `SECTION_OF`.
- [x] 3.3 Verify the row renders correctly in the Doctor window (`packages/electron/src/renderer/doctor.html` already iterates rows generically; no renderer change needed).

### 4. Tests

- [x] 4.1 Unit test `packages/shared/src/__tests__/doctor-macos-alias.test.ts` covering the predicate (file present → ok, absent → warn, non-darwin → row omitted).

### 5. Documentation

- [x] 5.1 Update `docs/file-index-electron.md` with rows for `ensure-macos-alias.mjs` and the new build-installer.sh gate.
- [x] 5.2 Add a `docs/faq.md` entry: "Local `electron-forge make` fails with `Cannot find module 'volume.node'` — what now?" → "Run `pnpm install` (postinstall self-heals) or `xcode-select --install` if CLT is missing."

### 6. Release

- [x] 6.1 CHANGELOG entry under `## [Unreleased]` → `### Build`: "Electron darwin: self-heal `macos-alias` native module; fail loudly with actionable message when Xcode CLT is missing (fix-darwin-dmg-maker-macos-alias)".
