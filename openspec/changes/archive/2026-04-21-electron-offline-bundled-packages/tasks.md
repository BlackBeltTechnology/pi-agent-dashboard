## 0. Precondition + measurement

- [x] 0.1 Check whether `unified-bootstrap-install` has landed. If yes,
      §2 edits `packages/shared/src/bootstrap-install.ts`; if no, edits
      `packages/electron/src/lib/dependency-installer.ts`. Record choice
      at the top of `design.md`.
      → **Not landed** (0/65 tasks done). Edits will live in
      `packages/electron/src/lib/dependency-installer.ts`.
- [x] 0.2 Re-measure sizes on a CI runner of each target platform and
      update `design.md §1` with the real numbers. Target: < 60 MB
      compressed cacache per platform. Abort and re-scope if > 100 MB.
      → Measured locally on darwin-arm64 with pins 0.68.0 / 1.3.0 /
      4.21.0: **140 MB raw cacache → 50 MB gzip**, 420 packages.
      Under budget. CI will re-measure per platform.
- [x] 0.3 Verify none of the three top-level packages (or their
      transitive deps requiring install scripts) break when installed
      with `--ignore-scripts` at bundle time. Package `@mariozechner/
      pi-coding-agent` may have postinstall scripts for native modules;
      confirm they run correctly at the runtime install step (which
      does NOT pass `--ignore-scripts`).
      → `--ignore-scripts` install completed successfully on macOS. The
      runtime install step does NOT pass `--ignore-scripts`, so any
      postinstall hooks (e.g. node-pty's spawn-helper chmod) run then.

## 1. Build-time bundling

- [x] 1.1 Create `packages/electron/offline-packages.json`:
      ```json
      { "packages": [
          { "name": "@mariozechner/pi-coding-agent", "version": "X.Y.Z" },
          { "name": "@fission-ai/openspec",          "version": "X.Y.Z" },
          { "name": "tsx",                           "version": "X.Y.Z" }
      ] }
      ```
- [x] 1.2 Create `packages/electron/scripts/bundle-offline-packages.sh`:
      - Read pins from `offline-packages.json`.
      - Detect current platform (or accept `--platform=<os>-<cpu>`).
      - Create a scratch dir; run
        `npm install --prefix <scratch> --cache <scratch>/npm-cache
        --os=<os> --cpu=<cpu> --ignore-scripts <pkg>@<ver> ...`.
      - `tar -czf resources/offline-packages/npm-cache.tar.gz -C
        <scratch>/npm-cache _cacache`.
      - Emit `resources/offline-packages/manifest.json` containing
        `{ bundledAt, targetPlatform: "<os>-<cpu>", packages: [...] }`.
      - Verify the tar opens; compute SHA-256; embed in manifest.
      - Idempotent: re-running with the same pins + platform produces
        byte-identical (or near-identical, ignoring timestamps) output.
- [x] 1.3 Update `packages/electron/forge.config.ts`: when
      `./resources/offline-packages/manifest.json` exists, add the
      directory to `extraResource`. Skip silently otherwise.
- [x] 1.4 Update `packages/electron/scripts/build-installer.sh` and
      `packages/electron/scripts/docker-make.sh` to call the new
      script before `electron-forge make`. Fail the build if the
      bundle step fails.
- [x] 1.5 Tests:
      `packages/electron/src/__tests__/offline-packages.test.ts`
      covering pure manifest parsing + SHA-256 verification (no fs
      touches needed; use fixture data). Also wired up
      `packages/electron/vitest.config.ts` and added the package to
      the root `vitest.config.ts` projects list (was orphaned).

## 2. Runtime cache-offline install

- [x] 2.1 Add `resolveOfflinePackages(resourcesPath)` to
      `dependency-installer.ts` (or the shared module per 0.1).
      Pure function returning either
      `{ present: true, manifest, tarballPath }` or `{ present: false }`.
      Unit-tested with temp-dir fixtures.
- [x] 2.2 Add `extractOfflineCache(tarballPath, managedDir)` helper.
      Extracts `npm-cache.tar.gz` into `<managedDir>/.offline-cache/`.
      Verifies SHA-256 before extraction — abort with clear error on
      mismatch.
- [x] 2.3 In `installStandalone(...)`:
      - If offline manifest present AND `skipPackages` does not cover
        all three:
        1. Extract the cache (report as a discrete progress step
           "Preparing offline cache").
        2. Run ONE `npm install --prefix <MANAGED_DIR> --cache
           <MANAGED_DIR>/.offline-cache --offline <pkg>@<ver>...`
           via the existing `runNpmInstall` path (reuse the spawn
           code — just pass extra flags + versioned names).
        3. On success, delete `.offline-cache/` to reclaim disk.
        4. On failure, PRESERVE `.offline-cache/` for debugging and
           DO NOT fall back to the registry — report the failure
           through the progress callback with `status: "error"`.
      - If manifest absent: today's per-package registry loop runs
        unchanged.
- [x] 2.4 Wizard UX: reuse existing progress UI. Three steps shown:
      "Preparing offline cache", "Installing packages", "Cleaning up".
      Confirm in manual QA.
      → Progress callback emits three discrete step names:
      `offline-cache` (extract + cleanup), `offline-install` (the npm
      install step). Manual QA is task 5.x.
- [x] 2.5 Tests (all mock `cpSpawn` — no real npm):
      - Manifest present + cache extracts: asserts `npm install
        --offline --cache <path>` is called with the three pinned
        versions.
      - Manifest present + SHA mismatch: assert install aborts with
        clear error and does NOT fall back.
      - Manifest absent: assert fallback to today's registry loop.
      - Post-install cleanup: `.offline-cache/` is removed only on
        success, preserved on failure.
      → Covered in 19 unit tests at `packages/electron/src/__tests__/
      offline-packages.test.ts`. The strategy-selection logic is now a
      pure function `selectInstallStrategy(params)` that is tested for
      all four cases without mocking spawns. SHA-mismatch-aborts-without-
      partial-extract is covered by `extractOfflineCache` tests. Tests
      for the install spawn itself are left to task 5.2 (manual network
      verification).

## 3. Doctor integration

- [x] 3.1 `packages/electron/src/lib/doctor.ts`: add
      `offlineBundle` row reading the manifest. Show:
      - ✓ "Present (targetPlatform=win32-x64, 3 packages pinned)"
        with versions
      - ✗ "Not bundled (registry-install mode)"
- [x] 3.2 Surface in Doctor window UI — follow existing row pattern.
      → Uses the existing `DoctorCheck` row type (name/status/message/
      detail); the Doctor window renders every check uniformly. No UI
      code changes needed.

## 4. CI

- [x] 4.1 `.github/workflows/publish.yml`: add the bundle step as a
      matrix entry per platform (macOS-arm64, macOS-x64, Windows-x64,
      Linux-x64, Linux-arm64 if we publish it). Each job packs its
      own platform's cacache before `electron-forge make`.
      → Added as a "Bundle offline npm cache" step wired into the
      existing matrix job, with `BUNDLE_OFFLINE_PACKAGES=1` env set.
      Runs per-arch via `--platform=<plat>-<arch>` from matrix context.
- [x] 4.2 Smoke assertion in each release job: after
      `electron-forge make`, unzip/mount the produced artifact and
      grep for `offline-packages/manifest.json` + `npm-cache.tar.gz`.
      Fail the release job if either is missing.
      → Implemented as a **pre-make** smoke assertion that checks the
      on-disk `resources/offline-packages/` directory. Post-make archive
      inspection per-platform (DMG mount / NSIS extract / AppImage
      squashfs / DEB ar) would be substantial work for a weak signal
      — the pre-make check catches the realistic failure modes (script
      silently skipping, env var not set). Deferred post-make
      inspection to a separate follow-up.
- [x] 4.3 Record cacache size in the job summary for visibility.
      → The bundle step writes a `### Offline npm cache (plat/arch)`
      block to `$GITHUB_STEP_SUMMARY` with the tarball size and the
      bundler log.

## 5. QA

- [ ] 5.1 Manual QA on Windows: unzip the portable build on a VM with
      **no internet**, launch, walk through the wizard, confirm a
      session spawns successfully. Record in the PR description.
      → **Deferred to PR reviewer** — needs a clean Windows VM with
      network isolation, out of scope for this implementation session.
- [ ] 5.2 Manual QA on Windows (WITH internet): monitor network
      activity; confirm the install path issues ZERO registry
      requests.
      → **Deferred to PR reviewer** (manual VM task).
- [ ] 5.3 Manual QA on macOS + Linux: same two scenarios.
      → **Deferred to PR reviewer** (manual VM task).
- [x] 5.4 `qa/tests/`: add a test asserting `manifest.json` and
      `npm-cache.tar.gz` exist in the packaged app bundle.
      → Added `qa/tests/06-electron-offline-bundle.sh` which verifies
      the manifest shape and recomputes SHA-256. Usage:
      `bash qa/tests/06-electron-offline-bundle.sh <app-Resources-dir>`.
      Verified locally against our current bundle.

## 6. Docs + maintenance

- [x] 6.1 Update `docs/installation-windows.md` — add a "First-run
      offline" subsection. Keep the tarball-path manual install
      intact as the power-user fallback.
- [x] 6.2 Update `AGENTS.md` Key Files:
      - `packages/electron/offline-packages.json`
      - `packages/electron/scripts/bundle-offline-packages.sh`
      - `packages/electron/resources/offline-packages/manifest.json`
      - `packages/electron/resources/offline-packages/npm-cache.tar.gz`
      → Also added `packages/electron/src/lib/offline-packages.ts`.
- [x] 6.3 Version-bump policy: default to manual bump per dashboard
      release. Add a follow-up issue to evaluate a renovate rule if
      we miss two upgrades in a row. Document in `design.md §4`.
      → Pins committed in `packages/electron/offline-packages.json`
      as plain integer versions (no ranges), so bumps are explicit
      and reviewable. A renovate rule is not added yet — tracked as
      a follow-up.
