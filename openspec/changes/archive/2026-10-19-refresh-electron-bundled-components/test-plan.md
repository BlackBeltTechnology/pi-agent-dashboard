# Test Plan — refresh-electron-bundled-components

Stage: design   Generated: 2026-10-18

No clarifications needed: every Triple below resolves from the delta specs, design.md and the 2026-10-18 spike evidence.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Packaged preloads keep the filenames the main process loads | decision-table | L1 | automated | `vite.preload.config.ts` and `vite.preload-main.config.ts` source; a fixture config without `entryFileNames` | build-contract test parses both configs | both real configs set `rollupOptions.output.entryFileNames` to `"[name].js"`; the fixture without it fails the assertion |
| E2 | Packaged preloads keep the filenames the main process loads | EP | electron | automated | Forge 8 package step output `packages/electron/.vite/build/` | post-build preload check runs on every electron leg | leg passes only when both `preload.js` and `preload-main.js` exist; deleting either makes the step exit non-zero naming the missing file |
| E3 | Packaged extra resources contain no symlink that leaves the bundle | EP | L1 | automated | synthetic resource `server/` with `node_modules/.bin/x` → absolute `<SRC>/server/node_modules/pkg/bin.js` (what `fs.cp` produces) | re-relativize function runs over the copied tree | link becomes `../pkg/bin.js` and `realpath` resolves inside the copied `server/` |
| E4 | Packaged extra resources contain no symlink that leaves the bundle | EP | L1 | automated | two entries `server/` and `node/`; a link in `server/` → absolute `<SRC>/node/bin/node` | re-relativize function runs | link becomes a relative path to the copied `node/bin/node` and resolves inside the bundle |
| E5 | Packaged extra resources contain no symlink that leaves the bundle | BVA (path alias) | L1 | automated | source root given as `/tmp/x/resources`, link target recorded as `/private/tmp/x/resources/server/a` | re-relativize function runs | link is rewritten (real-path match), not left absolute |
| E6 | Packaged extra resources contain no symlink that leaves the bundle | EP (invalid class) | L1 | automated | link → absolute `/usr/bin/env` (outside every entry) | re-relativize function runs | link is left unchanged (the scan, not the hook, reports it) |
| E7 | Packaged extra resources contain no symlink that leaves the bundle ("Resources added later") | EP | L1 | automated | `extraResource` list containing an entry name the code has never seen (`./resources/codegraph`) with one absolute in-entry link | hook mapping + re-relativize run | link in `codegraph/` is rewritten; no code or config change needed |
| E8 | Packaged extra resources contain no symlink that leaves the bundle | EP | L1 | automated | `extraResource` list containing a file entry `./resources/app-update.yml` and a link elsewhere targeting its absolute source path | hook runs | the file entry is not walked (no error) and the link to it is rewritten to the copied file |
| E9 | Packaged extra resources contain no symlink that leaves the bundle | decision-table | L1 | automated | synthetic packaged tree with (a) absolute link, (b) dangling relative link, (c) relative link escaping the app root via `../../` to an existing host path, (d) valid in-bundle relative link | symlink scan script runs on the tree | exit code non-zero; output lists exactly a, b and c; a tree containing only (d) exits 0 |
| E10 | macOS deployment target is pinned | BVA | L1 | automated | `otool -l` text with minos `12.0`, `13.0`, `14.0` | floor predicate evaluates against `MACOS_FLOOR_MINOS_MAJOR = 13` | `13.0` passes; `12.0` and `14.0` both fail (equality in both directions) |
| E11 | macOS deployment target is pinned | decision-table | L1 | automated | `forge.config.ts` source and `_electron-build.yml` text | build-contract test compares every encoded floor literal (`LSMinimumSystemVersion`, both `MACOSX_DEPLOYMENT_TARGET` sites, the plist equality check) with `MACOS_FLOOR_MARKETING` | all equal `13.0`; a fixture with one site at `12.0` fails naming that site |
| E12 | Update stream is gated on the minimum supported OS | BVA | L1 | automated | `UPDATE_MINIMUM_SYSTEM_VERSION` and `os.release()` values `20.6.0`, `21.6.0`, `22.0.0`, `22.6.0` | gate predicate (same `semver.lt` path electron-updater uses) | `20.6.0` and `21.6.0` (macOS 11/12) rejected; `22.0.0` and `22.6.0` admitted; the constant is a strict 3-part semver equal to `22.0.0` |
| E13 | Update stream is gated on the minimum supported OS ("defective spellings") | EP (invalid class) | L1 | automated | candidate values `"13.0"` and `"22"` | gate value validator / test | both rejected as defects (not strict semver); `"22.0.0"` accepted |
| E14 | Supported macOS versions | BVA | L1 | automated | `devDependencies.electron` values `44.9.0`, `43.4.1`, `^44.9.0` | `electron-version-pin.test.ts` | `44.9.0` passes; `43.4.1` fails (major < 44); `^44.9.0` fails (not literal semver) |
| E15 | electron-forge project configuration | EP | L1 | automated | `packages/electron/package.json` and `forge.config.ts` source | build-contract test | no dependency name matches `maker-appimage`; the only maker in `forge.config.ts` is `@electron-forge/maker-deb` |
| E16 | The monorepo SHALL resolve one installed openspec version | EP | L1 | automated | `verify-release-deps.mjs` rules over server + extension declaring `1.14.3`, and a fixture declaring `1.11.0` | guard runs | `1.14.3` passes; `1.11.0` reports `Stale pin` for `@fission-ai/openspec` |
| E17 | Bridge SHALL make the openspec CLI resolvable in-session; Skill regeneration SHALL use the installed version | EP | L2 | automated | clean qa VM, no network, repo installed with openspec `1.14.3` | `qa/tests/12-openspec-shim.ps1` and `qa/tests/13-openspec-offline-regen.sh` run | shim `openspec --version` prints `1.14.3`; regenerated `openspec-*/SKILL.md` stamps `generatedBy: "1.14.3"`; no network fetch |
| E18 | (design D6) server openspec poller compatibility | EP | L1 | automated | `openspec list --json` + `openspec status --change <fixture> --json` payloads captured from the real 1.14.3 bin | `buildOpenSpecData` consumes them | result is non-empty with the parity shape (changes map, artifacts `{ id, status }`, `isComplete`), not the silent-empty `{ initialized: true, changes: [] }` |
| E19 | (design D6 / task 1.6) legacy-cleanup mirror | EP | L1 | automated | the mirrored list in `openspec-routes.ts` and `@fission-ai/openspec@1.14.3` `dist/core/legacy-cleanup.js` | parity test reads both | the two lists are equal |
| E20 | AppImage Linux package; CI build matrix (arm64) | EP | electron | automated | linux x64 and linux arm64 legs of `_electron-build.yml` | build completes | each leg's `out/make` contains one `.deb` and one `.AppImage` for its arch |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|

(none: no requirement in this change states a latency, throughput or memory budget; the existing boot-budget requirement is unchanged)

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Packaged preloads keep the filenames the main process loads ("Main window exposes its bridge") | state-transition | electron | automated | packaged app, throwaway HOME with pinned free port and first-run marker, `--user-data-dir` | launch via Playwright `_electron`, wait for the main window on the dashboard URL | in that window `typeof window.piDashboard === "object"` with `requestLaunch` and `openDoctor` present |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Packaged extra resources contain no symlink that leaves the bundle ("macOS strict signature verification") | fault-injection (abort) | electron | automated | darwin legs, packaged `.app` | ad-hoc sign a copy and run `codesign --verify --deep --strict` | exits 0 on the fixed build; with one planted absolute link the step fails and the log contains `invalid destination for symbolic link in bundle` |
| X2 | Packaged extra resources contain no symlink that leaves the bundle ("No absolute or dangling links") | fault-injection (abort) | electron | automated | every electron leg (darwin, linux, win32) after packaging | symlink scan script runs over the packaged resources directory | exits 0 on the fixed build; the leg fails if any link is absolute, dangling or resolves outside the app root |
| X3 | macOS deployment target is pinned (canary) | fault-injection (abort) | electron | automated | installed `electron@44.9.0` prebuilt (minos `13.0`) | `verify-macos-floor.mjs` canary + produced-binary check on darwin legs | passes with `MACOS_FLOOR_MINOS_MAJOR = 13`; with `12` the step fails with the upstream-floor tripwire `::error::` |
| X4 | Windows electron builds embed git + bash via dugite-native | fault-injection (abort) | electron | automated | win32 x64 and arm64 legs with `_git-version.json` at `v2.53.0-4` | `bundle-server.mjs` downloads and verifies the tarball | SHA-256 matches and the GO/NO-GO finds `cmd/git.exe`, `usr/bin/sh.exe`, `THIRD-PARTY-LICENSE.txt`; a corrupted SHA in a fixture run exits non-zero with "checksum mismatch — refusing to extract" |
| X5 | Update stream is gated on the minimum supported OS ("A client below the floor is not offered the update") | real-device | — | manual-only | a macOS 12 machine with 0.9.x installed | the recurring update check after the floor-raising release is published | [judgment: needs real macOS 12 hardware; the logic is covered by E12; verify the client reports no update available and does not loop] |
| X6 | Supported macOS versions (release signing) | real-signing | — | manual-only | the first release built with Electron 44 and Developer ID credentials | notarization of the release DMG | [judgment: needs the Apple notary service and release secrets; verify `spctl --assess` accepts the downloaded DMG's app on macOS 13+] |

---

## Coverage summary

- Requirements covered: 11/11 delta requirements (forge config, CI matrix, AppImage, macOS target, update gate, supported macOS, preload filenames, extra-resource symlinks, openspec single version, skill regen, session shim), plus design D6 compatibility checks
- Scenarios by class: edge 20 · perf 0 · frontend 1 · error 6
- Scenarios by level: L1 17 · L2 1 · electron 7 · L3 0 · manual 2
- Scenarios by disposition: automated 25 · manual-only 2

## New infra needed

- none: L1 rows extend existing vitest suites (`packages/electron/src/__tests__/`, `scripts/__tests__/`, `packages/shared/src/__tests__/`); electron rows add steps or scripts inside the existing `_electron-build.yml` legs and the existing `tests/e2e-electron/` Playwright harness.
