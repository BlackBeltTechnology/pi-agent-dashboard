# Test Plan — upgrade-electron-runtime

Stage: design   Generated: 2026-08-21

All clarification gaps were resolved via the HARD gate before this file was written:

- **G1** → the injected `minimumSystemVersion` value lives as a **repo constant** that both
  the CI injection step and the L1 test read. Scenarios U2/U3 assert the real value, not a
  duplicated literal.
- **G2** → launch-refusal on a below-floor macOS is **`manual-only`** (no macOS 11/10.15
  VM or runner exists). Recorded as M1; the automated coverage stops at the declared floor
  and the updater gate, and does not claim enforcement.
- **G3** → the Linux floor is **Ubuntu 22.04 / glibc 2.35**. Scenario X4 tests against that
  threshold.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Electron devDependency pinned to literal version | EP (valid/invalid partition) | L1 | automated | `packages/electron/package.json` with `devDependencies.electron = "43.4.1"` | parse + apply regex `^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$` | matches; and the same assertion **fails** for `"^43.0.0"` / `"~43.0.0"` (fixture cases), proving the guard is not vacuous |
| E2 | macOS Monterey support — pinned major floor | BVA (just-below / at / above) | L1 | automated | pinned electron version string | assert major `>= 43` | `43.4.1` passes; fixture `32.3.3` and `42.9.3` **fail**; `44.0.0` passes. Pins the "cannot silently regress to an unsupported line" clause |
| E3 | macOS deployment target is pinned — declared intent | EP | L1 | automated | `forge.config.ts` `packagerConfig.extendInfo` | read `LSMinimumSystemVersion` | exactly `"12.0"`; a fixture value of `"10.15"` fails the assertion |
| E4 | CI verifies the produced floor — comparison operator | decision-table (observed × expected) | L1 | automated | `minos` major ∈ {11, 12, 13} vs expected 12 | evaluate the floor-check predicate | `11` → **fail**, `12` → pass, `13` → **fail**. Directly pins the `-gt` → equality change; under `-gt` the `11` case would wrongly pass |
| E5 | CI verifies the produced floor — multi-slice safety | EP (1 slice / N slices) | L1 | automated | `otool -l` output fixture with **two** `LC_BUILD_VERSION` blocks (`minos 12.0` + `minos 11.0`) | run the extractor | either both slices are checked (→ fail on the `11.0` slice) or the extractor errors explicitly; a first-match-and-exit extractor that returns `12.0` and passes is a defect |
| E6 | Build-config parity holds after the bump | decision-table | L1 | automated | the three build configs post-change | run `build-config-parity.test.ts` | appId / productName / executableName still agree across `forge.config.ts`, `electron-builder.yml`, `electron-builder-nsis.json` |

### Update-gate (error-handling class — the change's fail-open/fail-closed surface)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| U1 | Update stream gated on min supported OS — metadata carries field | EP | ci | automated | the emitted `packages/electron/out/make/latest-mac.yml` from a darwin leg | parse the YAML | root key `minimumSystemVersion` present and equal to the repo constant (G1). Asserted against the **emitted file**, never the `electron-builder.yml` config key (which is a no-op under `--prepackaged`) |
| U2 | Value is a full Darwin semver triple — blocks below floor | BVA on the Darwin scale | L1 | automated | the repo constant (G1), expected `21.0.0` | `semver.lt(os, value)` for os ∈ {`19.6.0`, `20.6.0`} | both `true` → Catalina (Darwin 19) and Big Sur (Darwin 20) are **blocked** |
| U3 | Value is a full Darwin semver triple — admits at/above floor | BVA (at boundary, above, far above) | L1 | automated | same constant | `semver.lt(os, value)` for os ∈ {`21.0.0`, `21.6.0`, `25.0.0`} | all `false` → macOS 12.0 exactly, 12.7, and macOS 26 (Darwin 25) are all **allowed**. The `21.0.0` case is the boundary that a naive `<=` would get wrong |
| U4 | Both inert spellings are rejected | fault-injection (malformed value) | L1 | automated | candidate values `"12.0"` and `"21"` | `semver.lt("19.6.0", v)` | **throws** for both. Guards the exact fail-open trap: `checkIfUpdateSupported` catches the throw and returns `true`, so a string-equality test would pass on these while the gate is dead |
| U5 | Gate is scoped to macOS only | decision-table (3 metadata files × field present/absent) | ci | automated | emitted `latest-mac.yml`, `latest-linux.yml`, `latest.yml` | inspect each for `minimumSystemVersion` | present **only** in `latest-mac.yml`. This is the fail-**closed** hazard: the field in the Linux/Windows files would compare kernel `6.5.0` / `10.0.19045` against `21.0.0` and deny updates to every client |
| U6 | Field survives the arm64+x64 merge | state-transition (two inputs → merged output) | ci | automated | both per-leg `latest-mac.yml` files, both carrying the field | run the merge at `publish.yml:576-597` | merged output retains `minimumSystemVersion`; and a fixture where **only the x64 leg** carries it exposes the glob-order dependency (merge seeds from the arm64 file) |
| U7 | Shipped client implements the gate | EP | L1 | automated | `git show v0.7.0:pnpm-lock.yaml` | resolve `electron-updater` version | `6.8.9`, a version that implements **and invokes** `checkIfUpdateSupported`. Fails if a release in the support window resolves a version without it |

### Frontend-quirk / runtime behaviour

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | App boots on the new runtime | state-transition (cold start) | electron | automated | the packaged app on macOS | launch, wait for convergence | dashboard renders; `/api/health` returns 200; no `FATAL` in Electron stdout. Converges — not "visible after N ms" |
| F2 | Native surfaces survive 11 majors | state-transition | electron | automated | packaged app | drive tray + dialog flows | `tray-ownership`, `zombie-adoption`, `doctor-version-skew` specs pass unchanged |
| F3 | DMG launch path (the leg with no CI coverage) | state-transition | electron | automated | built DMG on **macOS** | mount, copy out, exec inner Mach-O | app boots. Note `dmg-build-launch.electron.spec.ts:124` is darwin-skipped and `ci-e2e-electron.yml` has no macOS leg — this row is only satisfied by a **local macOS run**, which is why it is called out separately from F2 |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | node-pty under the execpath fallback | fault-injection (remove dependency) | electron | automated | packaged app with `resources/node` renamed/removed | launch, open a terminal session | server starts under `ELECTRON_RUN_AS_NODE=1` and the PTY works — node-pty loaded against **Electron's** Node ABI. This is the one path where the "bundled Node isolates us" claim does not hold |
| X2 | Windows NSIS resolves the electron version | fault-injection (the known regression) | ci | automated | `package.json` with the literal pin | `electron-forge make` → NSIS maker → `app-builder-lib` | `getElectronVersionFromInstalled` returns without throwing `Cannot compute electron version from installed node modules` |
| X3 | Upstream-floor tripwire fires | fault-injection (simulated upstream drift) | L1 | automated | fixture `otool` output with `minos 13.0` | run the floor check with expected `12` | job fails, and the diagnostic names an **upstream Electron floor change** — not `MACOSX_DEPLOYMENT_TARGET`, which does not set this binary's `minos` |
| X4 | Linux glibc floor not silently raised | EP against the documented floor | L2 | automated | Electron 43 runtime on **Ubuntu 22.04 / glibc 2.35** (G3) | launch the AppImage / `.deb` headless | starts and reaches `/api/health`. A current-Ubuntu-only smoke would pass regardless, so the older image is the whole point of the row |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | A below-floor macOS actually refuses the build | — | — | manual-only | the signed DMG on real macOS 11 (or 10.15) hardware/VM | attempt to launch | launchd refuses; and the 32.x client on that OS is **not** offered the update. **No automatable signal exists** — the repo has no macOS 11/10.15 VM and GitHub offers no such runner (`qa/tests/09-electron-mac-launch.sh` already documents this as an unimplemented gap). Automated coverage stops at the *declared* floor (E3) and the *updater* gate (U2–U4); enforcement itself is unverified |
| M2 | Release notes state the dropped platforms | — | — | manual-only | CHANGELOG `## [Unreleased]` | human reads before release | names macOS 10.15 and 11 explicitly, states affected users remain on the last 32.x build, gives the security reason. Editorial judgment — no automatable observable |

---

## Coverage summary

- Requirements covered: 5/5 (macOS Monterey support · deployment target pinned · literal
  version pin · update-stream gate · — plus the retained build-parity invariant)
- Scenarios by class: edge 6 · update-gate 7 · frontend/runtime 3 · error 4 · manual 2
- Scenarios by level: L1 11 · L2 1 · electron 4 · ci 4 · — (manual) 2
- Scenarios by disposition: **automated 20 · manual-only 2**

## New infra needed

- **A repo constant for the update-gate value** (G1 decision): a single source of truth
  read by BOTH the CI injection step and the L1 tests U2–U4. Without it those tests assert
  a duplicated literal and would stay green while CI injects something else.
- **A fixture-driven harness for the floor check** (E4/E5/X3): the `minos` comparison and
  extractor currently live only as inline shell in `_electron-build.yml`, which is not
  unit-testable. Either extract the predicate into a testable script or assert against
  captured `otool` fixtures.
- **An Ubuntu 22.04 smoke leg** (X4): the existing Linux smoke runs on a current image
  only, so it cannot detect a raised glibc floor.
- No new *level* is required — L1 / L2 / electron / ci all exist.
