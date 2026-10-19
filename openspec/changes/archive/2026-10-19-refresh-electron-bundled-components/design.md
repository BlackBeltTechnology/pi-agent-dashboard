## Context

See proposal.md (Why). Evidence below comes from an end-to-end spike run on 2026-10-18 in a throwaway worktree off `develop@6ae41e4f6`:

- macOS arm64: `electron-forge package`, then the app launched with a throwaway HOME, `--user-data-dir` and port 18765.
- Linux arm64: `build-installer.sh --linux --arch arm64` (`.deb` via Forge, AppImage via electron-builder `--prepackaged`), then `test-deb-install.sh --skip-build`.

The spike diff is archived at `/tmp/spike-forge8-electron44.patch` (not committed).

Current state that shapes the approach:

- **Preloads.** Main-process preload paths are hard-coded to `.js` and fall back to the non-existent path when the file is missing:
  - `getMainPreloadPath()` returns `preload-main.js` (`packages/electron/src/main.ts:419-428`);
  - `getPreloadPath()` (`packages/electron/src/lib/remote-connect-window.ts:46-48`) and the connecting window's wizard preload both use `preload.js`.

  Both preload Vite configs set `build.lib` with `formats: ["cjs"]` but no output filename, so the name comes from the Forge Vite plugin's preload config: `@electron-forge/plugin-vite@7.11.2` `dist/config/vite.preload.config.js` sets `entryFileNames: '[name].js'`, and `8.0.1` sets `'[name].cjs'` (both read from the published tarballs). The package is `"type": "module"` (`packages/electron/package.json`). Production already ships these CJS bundles named `.js` and loads them, because Forge 7 names them `[name].js`.
- **Extra resources.** `extraResource` lists the bundled `node`, `server` and `git` directories (`packages/electron/forge.config.ts:13`, `:98-120`). `bundle-server.mjs` already knows Node's `fs.cp` turns relative symlinks absolute, but materializes only the `@blackbelt-technology/*` workspace links (`packages/electron/scripts/bundle-server.mjs:500-545`). A fresh bundle still holds 53 relative `node_modules/.bin/*` links (spike count; the gitignored local `resources/server` from an older build has 37). The downloaded Node tree holds `bin/npm -> ../lib/node_modules/npm/bin/npm-cli.js`.
- **The macOS floor appears in many places:**
  - `packages/electron/scripts/macos-floor.mjs`: `MACOS_FLOOR_MARKETING`, `MACOS_FLOOR_MINOS_MAJOR`, `UPDATE_MINIMUM_SYSTEM_VERSION`;
  - `forge.config.ts`: `LSMinimumSystemVersion` plus the explanatory comments around it;
  - `.github/workflows/_electron-build.yml`: `:171` and `:479` (`MACOSX_DEPLOYMENT_TARGET`), `:716` (step name), `:755-756` (hard equality check on `LSMinimumSystemVersion`), and `:763-765`, `:790`, `:800` (comments and log text);
  - tests: `electron-version-pin.test.ts` (`MIN_SUPPORTED_MAJOR = 43`, `MACOS_FLOOR_MARKETING` `"12.0"`, a `/Monterey/` match on the forge source), `macos-floor-check.test.ts` (`MACOS_FLOOR_MINOS_MAJOR` `12` and `expectedMajor: 12` fixtures), `update-min-system-version.test.ts` (`21.0.0`, Darwin 21 admitted);
  - docs: `README.md:70`, `docs/electron-session.md:352`; and the comment in `qa/tests/09-electron-mac-launch.sh`.
- **openspec.**
  - Pinned exactly in `packages/server/package.json` and `packages/extension/package.json`.
  - `scripts/verify-release-deps.mjs:109,120` enforce `minVersion: "1.11.0"` with a substring check (`declared.includes(minVersion)`, `:415-428`). An exact pin of any other version fails the guard. A caret of the same version (`^1.14.3`) still passes, so the single-source spec's "caret is not accepted" scenario is not enforced by this guard today.
  - `qa/tests/13-openspec-offline-regen.sh` checks `generatedBy` against `1.6.0`, which is already stale.
  - The vendored `.pi/skills/openspec-*` are gitignored (`.pi/.gitignore:2`) and regenerated per worktree.

## Goals / Non-Goals

**Goals:**
- Every bundled component other than pi is at its current release.
- Both Forge 8 regressions are fixed, each with an automated guard that fails CI if it comes back (D7).
- The symlink fix is generic, so later extra resources (`bundle-python-runtime` venv, `add-codegraph-code-plane`) are covered without edits.

**Non-Goals:**
- Vite 8. The Forge 8 Vite plugin imports the project's own `vite` (no dependency or peer on it), and the client is on Vite 6.
- Node v26 (`raise-node-floor-to-26`), pi (`update-pi-core-1-3-adopt-apis`), and making the bundle's own `npm install` reproducible (`pin-electron-bundle-dependency-tree`).
- The local Docker build path's existing defects. The spike found that `docker-make.sh` ships API-only bundles (`bundle-server.mjs --source-only` exits at `:322-329`, before the `pi-dashboard-web` materialization at `:549`) and builds an x64 AppImage runtime for `--arch arm64`. CI is unaffected (released v0.8.0 and v0.9.0 arm64 AppImages carry `aarch64` runtimes). These are tracked separately.
- Async `safeStorage`. The sync API is still supported in 44. It is deprecated in 45 and removed in 46. `server-keyring.ts` and `browser-host/` move before the next Electron major.
- `packages/electron/scripts/patch-appimage-fix.sh`, which was already unreferenced before this change. It is left as is.
- Spec drift that predates this change and is untouched by it:
  - `electron-build-pipeline` requirements that still describe a Forge NSIS maker or `electron-forge make` producing the Windows installer (NSIS has come from electron-builder since `restore-windows-nsis-installer`).

  This goes to a spec-coherence follow-up. The AppImage statements *are* corrected here ("electron-forge project configuration", "AppImage Linux package", and the "CI build matrix" arm64 scenario), because removing the maker package makes them newly false. The narrowed Forge-configuration scenario makes no claim about DMG or NSIS, so it does not contradict the NSIS requirements left untouched.
- Follow-ups recorded, not done here:
  - an exact-version check in `verify-release-deps.mjs` for the openspec rules (caret enforcement);
  - checksum verification of the Node download in `download-node.sh`;
  - pinning the global `openspec` install in `docker/Dockerfile`;
  - the dead `SKIP_APPIMAGE` write in `_electron-build.yml:254-256`.
- `scripts/__tests__/merge-latest-mac.test.mjs` `minimumSystemVersion: "21.0.0"` fixtures. They test the merge's agree/disagree logic, not the floor value, so they stay.

## Decisions

### D1. Electron 44 and the macOS 13 floor, moved together everywhere the floor is encoded
Electron 44's prebuilt declares `minos 13.0`, so the floor cannot stay at 12. The spike confirmed this: `verify-macos-floor.mjs` failed with "expected exactly major=12" against `electron@44.9.0`.

Every site listed in Context moves in one commit:
- values: `13.0`, minos `13`, `22.0.0` (Darwin 22 = macOS 13), `MIN_SUPPORTED_MAJOR` `44`;
- step names, log text and comments, so no `12.0` floor reference remains in a live file.

The spec's four enforcement *categories* (declared intent, compiler contract, post-build verification, canary) are unchanged; only their values move.

The update gate needs no new mechanism. The v0.9.0 tag's `pnpm-lock.yaml` resolves `electron-updater@6.8.9`, which implements `checkIfUpdateSupported`, so the spec precondition "gate is only effective if the shipped client supports it" holds.

*Alternative:* stay on 43.8.0 (supported until 46 ships) and keep macOS 12. Rejected by the user (scope C).

### D2. Preload filenames: pin `.js` in our preload configs, not in the runtime loaders
Add `rollupOptions.output.entryFileNames: "[name].js"` to `vite.preload.config.ts` and `vite.preload-main.config.ts`. The Forge plugin merges the user config last, so it wins. This keeps exactly the filenames, format and module type that production ships today.

Spike evidence:
- Forge 7 config: `preload-main.js`
- Forge 8 config: `preload-main.cjs`
- Forge 8 config plus our pin: `preload-main.js`, with `window.piDashboard` defined in the packaged main window

Vite 6 logs `Unknown output options: codeSplitting` for the plugin's Rolldown-only option. This is harmless: the preloads have no dynamic imports and already build to a single chunk.

*Alternative:* change the loaders to `.cjs`. Rejected: several runtime call sites plus the `PW_ELECTRON_DEV` esbuild path (`tests/e2e-electron/electron-lifecycle.ts`) and tests would all have to change. A build-config pin keeps runtime code untouched.

### D3. Symlinks: re-relativize after packager's extra-resource copy, for every copied resource
Add a `packagerConfig.afterCopyExtraResources` hook. Packager ≥ 19 (Forge 8 ships 20) calls hooks with a single object argument (`{ buildPath, electronVersion, platform, arch }`, promisified). The positional `(buildPath, …, callback)` form is packager 18 and must not be used.

How the hook works:
- It derives the resources directory from `buildPath` and the platform.
- It runs after packager has copied **all** extra resources (`afterCopyExtraResources` fires after the `Promise.all` copy), so every cross-resource target already exists.
- It builds a map from each `packagerConfig.extraResource` string entry, resolved against the Forge project directory (`__dirname` of `forge.config.ts`, not `cwd`), to its destination `resources/<basename>`. Packager itself places entries by basename and accepts only string entries, so the mapping is unambiguous. File entries (e.g. `app-update.yml`) are valid link targets but are not walked.
- It iterates over **every directory entry in that map**. It must not use a hard-coded name list (the spike's hard-coded `server`/`git`/`node` list was a shortcut, not the design).
- Any symlink whose target is absolute and lies inside **any** entry's source directory (compared on both the given and the real path, since `/tmp` is `/private/tmp` on macOS) is rewritten as a relative link to that file's copy inside the bundle. This covers links from one copied resource into another.
- Links pointing anywhere else are left untouched, and the D7 scan reports them.

Spike evidence:
- Without the hook: 53 absolute links, and strict codesign verify fails with `invalid destination for symbolic link in bundle`.
- With the hook: 0 absolute links, 0 dangling, strict verify passes, and `server/node_modules/.bin/openspec --version` prints `1.14.3`.
- The electron-builder `--prepackaged` AppImage built from that output keeps the fix: its payload has 54 links, 0 absolute, 0 dangling.

*Alternatives considered:*
- (a) Delete or replace `.bin` links in `bundle-server.mjs`. Rejected: the doctor tells users to put `server/node_modules/.bin` on PATH (`packages/shared/src/doctor-core.ts:501-511`), and it would not cover `node/bin/npm`.
- (b) Wait for upstream. `@electron/packager@20.3.0` `platform.js:309` copies extra resources without `verbatimSymlinks`, while its own `move()` fallback at `:323-329` passes `verbatimSymlinks: true`. An upstream issue gets filed, but nothing should block on it.
- (c) `derefSymlinks`. Rejected: it does not apply to the extra-resource copy.

### D4. Cross-device staging needs no handling (no task)
When packager's staging directory is on another device, `move()` falls back to `fs.promises.cp(..., { verbatimSymlinks: true })`. Spike: with `TMPDIR` on a separate APFS volume, the move crossed devices and the result had 68 links, 0 absolute, 0 dangling.

### D5. Toolchain cleanup
- Remove `@pengx17/electron-forge-maker-appimage` and its patch file. It depends on `@electron-forge/maker-base@^7.3.0` (keeping Forge 7 internals in the tree), and `forge.config.ts` declares only `@electron-forge/maker-deb`.
- `patch-package`, `scripts/maybe-patch-package.cjs` and the `postinstall` hook stay. With no `patches/` directory the script exits 0, and the mechanism is generic and still valid for future patches. Removing it would touch the root package's published `files` and `postinstall`.
- Set `electron-winstaller: false` in `pnpm-workspace.yaml` `allowBuilds`. pnpm 11 inserts a `set this to true or false` placeholder on install, and Squirrel is not used.

### D6. Runtime pins
- Node `v24.22.0` in `_node-version.sh`, plus the static copy in `test-electron-install.sh`.
- dugite `_git-version.json`: `dugiteNativeTag: "v2.53.0-4"`, `assetInfix: "v2.53.0-4098283"`, `gitVersion: "2.53.0.windows.4"` (read from the x64 `git.exe` strings), with these SHA-256 values (GitHub asset digests, verified locally by download):
  - `windows-x64`: `7b76bc5c32c0d7c5984efdc2a8a32697cf1e8a43bc55176fbf9869c0ee995130`
  - `windows-arm64`: `1abbeb3a2ce06e9b80e75bb888dce959b6c73bdb11ccc670a01a71d64f4422a5`
- openspec `1.14.3` (exact) in server and extension. Both `verify-release-deps.mjs` rules move to `minVersion: "1.14.3"`, and their evidence text records that 1.12–1.14.3 changed CLI JSON output only additively (the `requires` edges on `status --json` in 1.12), so `openspec-poller.ts` stays compatible.
- node-pty `1.2.0-beta.15` (exact). koffi `^3.3.3` in `optionalDependencies` (it is declared there, not in `dependencies`).
- tsx, fastify and ws keep their declared ranges, which already cover the current releases. Raising `ws` would make the server's specifier differ from `browser-plugin`'s `^8.18.0` and fail the bundle's plugin dependency-conflict gate. Their lockfile resolutions refresh within range.

Spike evidence: the bundle installed openspec 1.14.3, node-pty beta.15 with all 6 prebuild triples, koffi 3.3.3, tsx 4.23.15, fastify 5.12.7 and ws 8.22.0. The server came up healthy from the bundled Node in 2.3 s on macOS. On Linux the `.deb` installed and launched, and the health, sessions and spawn checks passed.

### D7. Guards that fail CI if either fix regresses
- **Preloads:** a build-contract unit test asserts both preload Vite configs pin `entryFileNames: "[name].js"`. A post-build step in the electron package step fails the leg unless `.vite/build/preload.js` and `.vite/build/preload-main.js` exist.
- **Symlinks:** a new script under `packages/electron/scripts/` scans the packaged app's resources directory. It fails on any symlink that is absolute, dangles, or whose real path falls outside the packaged app root. It runs on every electron leg (darwin, linux, win32) after packaging. The hook's re-relativizing logic is a pure function with unit tests over a synthetic resource tree, including an extra-resource name the code has never seen.
- **darwin only:** ad-hoc-sign a copy of the packaged `.app` and run `codesign --verify --deep --strict` on it, so the check also runs on legs without `APPLE_IDENTITY`.

## Risks / Trade-offs

- **macOS 12 users are stranded on 0.9.x.** → The update gate (D1) keeps them on a working build instead of a failed-install loop. CHANGELOG, README and `docs/electron-session.md` state the new floor.
- **Electron 44 behavioural changes we did not exercise.** The `select-client-certificate` handler may now receive a null `webContents`, and `openAsHidden` was removed from login items. → Neither API is used in `packages/electron/src`.
- **Forge 8 requirements.** It is ESM-only, the release notes require Node ≥ 22.17 (package `engines` say ≥ 22.13), and custom makers or plugins need a default export. → `_electron-build.yml:157` installs `node-version: '22'`, which resolves to the latest 22.x (≥ 22.17). We have no custom makers, and `forge.config.ts` uses none of the string templating (`${version}`) that Forge 8 removed.
- **Paths not exercised locally:** the macOS DMG (electron-builder wrapping the `.app`), macOS x64, Linux x64 and every win32 path. → They run on the PR's existing CI matrix, and the D7 symlink scan runs on each.
- **No universal macOS build exists.** `forge.config.ts` sets `arch: "universal"` in `packagerConfig`, but Forge passes its own arch (CLI `--arch`, else the host arch). The spike ran a bare `electron-forge package --platform=darwin` with no `--arch` and got `PI-Dashboard-darwin-arm64`. No path in CI, `build-installer.sh` or a bare local run performs a universal merge, so the symlink fix has no universal case to cover. The stale "universal .app" comment at `_electron-build.yml:483`, and the same assumption in `macos-notarization/design.md:3,82`, are flagged to that change.
- **Windows links.** Windows npm creates `.cmd` shims, and the Node zip and dugite tarball are expected to carry no symlinks, so D3 should do nothing there. If any link or junction exists, the hook rewrites only absolute targets inside their source entry. → The D7 scan on the win32 legs is the authority.
- **Rebase churn with the in-flight changes listed in the proposal Impact,** notably `macos-notarization`, which edits the same workflow steps and `forge.config.ts`. → Whichever lands second rebases those blocks; no behaviour conflicts.

## Migration Plan

Merge as one PR. The release that carries it is the first with the macOS 13 floor, so its release notes MUST call it out as BREAKING for macOS 12.

Rollback: revert the PR. Re-lowering the floor in a later release is safe only for clients that never received a 13.0 build, and the gate value must be re-derived together with the floor.
