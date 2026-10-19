## Why

Everything the Electron installer ships, other than pi, is one to three releases behind upstream: the Electron runtime (43.4.1, latest 44.9.0), the bundled Node.js (v24.15.0, latest v24 LTS v24.22.0), the Windows git+sh bundle (dugite-native v2.53.0-3, latest -4), the openspec CLI (1.11.0, latest 1.14.3), the native modules (node-pty `1.2.0-beta.13` → `beta.15`, koffi 3.1.6 → 3.3.3), and the packaging toolchain (Electron Forge 7.11.2 → 8.0.1). A local end-to-end spike (2026-10-18; macOS arm64 `.app`, Linux arm64 `.deb` install + launch) showed the bump is feasible. It also showed that Forge 8 breaks the build in two silent ways, and that Electron 44 raises the macOS floor. Those have to be decided deliberately, not discovered by a red release.

pi itself is out of scope: `update-pi-core-1-3-adopt-apis` owns that bump.

## What Changes

- **BREAKING (macOS 12 users): Electron `43.4.1` → `44.9.0`.** Electron 44 drops macOS 12. Its prebuilt declares `LC_BUILD_VERSION.minos 13.0`, and the existing upstream-floor tripwire (`verify-macos-floor.mjs`) refuses the build until the floor moves. The macOS floor rises **12.0 → 13.0** at every enforcement point, and the update gate value moves `21.0.0` → `22.0.0` (Darwin 22 = macOS 13). Already-shipped macOS 12 clients are therefore not offered the update, rather than entering a failed-install loop. Electron 44 embeds Node 24.22.0, the same version as the bundled Node below.
- **Electron Forge `^7.6.0` → `^8.0.1`** (`@electron-forge/cli`, `maker-deb`, `plugin-vite`; brings `@electron/packager` 20). Two fixes are required:
  - **Preload filenames.** Forge 8's Vite plugin emits preloads as `[name].cjs`, while `main.ts` and `remote-connect-window.ts` load `preload-main.js` and `preload.js` and silently run without a preload when the file is missing. Our preload Vite configs SHALL pin the `.js` filename.
  - **Symlinks in extra resources.** Packager 20 copies `extraResource` with `fs.promises.cp` and no `verbatimSymlinks`, which rewrites every relative symlink to an absolute build-host path. That affects 53 `server/node_modules/.bin/*` links and `node/bin/npm`. The packaged app then carries dangling links, and `codesign --verify --strict` fails with `invalid destination for symbolic link in bundle`. A packager hook SHALL re-relativize links that point inside a copied resource.
- **Remove `@pengx17/electron-forge-maker-appimage`** and its `patches/` file. It depends on `@electron-forge/maker-base@^7.3.0` (Forge 7 internals) and has been unused since AppImage moved to electron-builder `--prepackaged`.
- **Bundled Node.js `v24.15.0` → `v24.22.0`** (stays on the v24 LTS line; `raise-node-floor-to-26` still owns the move to v26).
- **dugite-native `v2.53.0-3` → `v2.53.0-4`** (same Git 2.53.0, rebuilt; new `assetInfix` and per-arch SHA-256).
- **openspec CLI `1.11.0` → `1.14.3`** at every exact pin (server and extension), per the single-source rule. All JSON output changes in 1.12–1.14 are additive.
- **node-pty `1.2.0-beta.13` → `1.2.0-beta.15`** (exact) and **koffi `^3.1.0` → `^3.3.3`** (optional dependency). tsx, fastify and ws keep their declared ranges: raising `ws` would trip the bundle's plugin dependency-conflict gate against `browser-plugin`'s `^8.18.0`. Only their lockfile resolutions refresh.
- **`allowBuilds`:** declare `electron-winstaller: false` (new transitive build script; Squirrel is not used).
- **Regression guards** for both Forge 8 fixes, run on every electron CI leg:
  - a build check that both preload files exist;
  - a packaged-app scan for absolute or dangling symlinks;
  - on darwin, `codesign --verify --deep --strict` on an ad-hoc-signed copy.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `electron-build-pipeline`: macOS floor 12.0 → 13.0 at every enforcement point and the update gate value `21.0.0` → `22.0.0`; the Forge-configuration, AppImage and CI-matrix (arm64) requirements corrected to the shipped producer (electron-builder `--prepackaged` builds the AppImage on x64 and arm64, not the removed Forge maker); new requirements that the packaged preloads keep the filenames the main process loads, and that packaged extra resources contain no symlink pointing outside the bundle.
- `electron-build-pipeline` (continued): `macOS Monterey support` is removed and replaced by `Supported macOS versions` (macOS 13+, pinned Electron major ≥ 44).
- `openspec-cli-version-single-source`: the single exact openspec version moves `1.11.0` → `1.14.3`.
- `openspec-cli-session-provisioning`: the session shim's pinned-CLI scenario names `1.14.3`.

## Impact

- **Users:** macOS 12 (Monterey) users stay on the last 0.9.x build; they are not offered the update. Every other platform is unaffected.
- **Code:**
  - `packages/electron/{package.json, forge.config.ts, vite.preload.config.ts, vite.preload-main.config.ts}`
  - `packages/electron/scripts/{_node-version.sh, _git-version.json, macos-floor.mjs}` and a new packaged-app symlink check
  - `.github/workflows/_electron-build.yml` (floor literals and the floor-verify step; new guard steps)
  - `scripts/verify-release-deps.mjs` (openspec floor)
  - the floor-pinning tests in `packages/electron/src/__tests__/`
  - `qa/tests/13-openspec-offline-regen.sh`
  - `packages/server/package.json`, `packages/extension/package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `patches/`
- **Build:** Forge 8 requires Node ≥ 22.13 per its `engines` (≥ 22.17 per its release notes; `_electron-build.yml` installs Node `22`, which resolves to the latest 22.x). `@electron/notarize` v3 removes `altool`, which matters to `macos-notarization` (that change already uses notarytool).
- **Coordinates with:**
  - `update-pi-core-1-3-adopt-apis` and `add-bundle-mode-marker`: lockfile, `server/package.json` and `bundle-server.mjs` rebase only.
  - `add-pi-spec-driven-schema` and `move-workflow-schema-status-to-poll-worker`: key cached schema status on the local CLI version, so the openspec bump triggers one recompute of those caches; no behaviour conflict.
  - `macos-notarization`: edits the same darwin package and floor-verify steps of `_electron-build.yml` and adds `osxSign`/`osxNotarize` to `forge.config.ts`, next to this change's hook. Whichever lands second rebases those blocks.
  - `raise-node-floor-to-26`: its stated starting point becomes v24.22.0 (`proposal.md:40`, `design.md:20`). Its test fixtures that use `v24.15.0` as a below-floor example stay valid and are not touched.
  - `macos-notarization`, `bundle-python-runtime` and `add-codegraph-code-plane`: they add signed or symlinked extra resources and rely on the generic symlink fix, so the fix must not be hard-coded to today's resource names.
- **Rollback:** each bump is an independent pin; revert the commit. Raising the floor again later stays possible; lowering it after a 13.0 release still needs the update gate re-derived.

## Discipline Skills

- `doubt-driven-review`: dropping macOS 12 is an irreversible, user-facing platform change (an already-released floor cannot be lowered for clients that were refused the update).
- `review-code`: non-trivial build-pipeline change before commit.
