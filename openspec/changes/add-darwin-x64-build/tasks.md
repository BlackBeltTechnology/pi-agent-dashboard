# Tasks

## 1. Workflow matrix

- [ ] Verify `macos-13` runner image is still listed as available in
      [GitHub-hosted runners](https://docs.github.com/en/actions/using-github-hosted-runners/about-github-hosted-runners/about-github-hosted-runners#standard-github-hosted-runners-for-public-repositories).
      If retired sooner than expected, abandon this change and pivot to the
      universal-binary route.
- [x] Add the `darwin/x64` matrix row to
      `.github/workflows/publish.yml > jobs.electron.strategy.matrix.include`
      (between the existing `macos-14` row and the linux block, alphabetical
      by platform-then-arch is fine):

      ```yaml
      - os: macos-13
        platform: darwin
        arch: x64
        node-arch: x64
      ```

- [x] Confirm no other workflow step needs an `if:` adjustment. The existing
      `Make Electron distributables` and `Upload artifacts` steps already
      parameterize on `${{ matrix.arch }}`, so they should pick up the new
      row automatically.
- [x] Confirm `bundle-offline-packages.mjs --platform=darwin-x64` is a valid
      invocation — the script already accepts this string per the
      `electron-offline-bundled-packages` change.

## 2. Verify rename behavior

Decision: rename arm64 to include `-arm64` for symmetry (per proposal
section 3). This task verifies the rename happens automatically.

- [ ] Inspect the most recent release page on GitHub:
      `https://github.com/BlackBeltTechnology/pi-agent-dashboard/releases/latest`
- [ ] Note the current darwin-arm64 DMG filename. Expected: missing arch
      suffix (e.g. `PI-Dashboard-<ver>.dmg`).
- [ ] After adding the matrix row and running a CI build, confirm the
      arm64 DMG output is now named `PI-Dashboard-darwin-arm64-<ver>.dmg`
      (Forge's maker-dmg adds the `--arch=` suffix automatically when
      multiple arches are built in the same workflow). If it still ships
      without a suffix, configure `maker-dmg.name` explicitly via
      `packagerConfig` per-arch override or a Forge hook.
- [ ] Confirm the x64 DMG is named `PI-Dashboard-darwin-x64-<ver>.dmg`.

## 3. README

- [x] Update install-instructions section to:
      - Show two macOS DMG download links (Apple Silicon vs. Intel) with
        explicit arch labels.
      - Explain how to identify which Mac you have (`uname -m` → `arm64`
        vs. `x86_64`, or Apple menu → About This Mac).
      - Note the rename: previous releases shipped
        `PI-Dashboard-<ver>.dmg` (Apple Silicon, no suffix); from this
        release onwards the file is `PI-Dashboard-darwin-arm64-<ver>.dmg`.
- [x] Update any "Download" badges or shields if they exist.

## 4. CHANGELOG (Unreleased)

- [x] Add two entries under `## [Unreleased]`:
      - `- **Added**: Electron Intel Mac DMG (\`darwin-x64\`) alongside
         Apple Silicon. Fixes "cannot be opened" error on Intel Macs.`
      - `- **Changed (breaking for direct download links)**: macOS Apple
         Silicon DMG renamed from \`PI-Dashboard-<ver>.dmg\` to
         \`PI-Dashboard-darwin-arm64-<ver>.dmg\` for symmetry with the
         new Intel build. External deep links to the old filename will
         404 — please update to the new naming or link to the GitHub
         Releases page instead.`

## 5. Site (Astro marketing site)

- [x] Inspect `site/src/components/DownloadSection.astro` and
      `site/src/lib/github-release.ts`. The classifier already tags
      `arm64` / `x64` / `apple` / `intel` substrings, so the new x64
      DMG enters the macOS bucket cleanly — but it lands under "Other
      downloads" because there is only one `primary` slot per bucket.
- [x] Update `DownloadSection.astro` to render **two stacked buttons**
      in the macOS card when both arches are present (Apple Silicon
      first, Intel second), each with its own size badge. Fall back to
      single-button behavior when only one is present (so the site
      renders correctly during the brief window before the cutover
      release ships x64).
- [x] If needed, add a `primaryByArch?: Record<"arm64" | "x64",
      ReleaseAsset>` field to `PlatformBundle` in `github-release.ts`
      (or compute it inline in the Astro template — either is fine, the
      lib choice is a refactor preference).
- [x] Verify the local `npm run build` inside `site/` succeeds and the
      built `dist/index.html` shows both buttons when the cached
      `latest-release.json` has been updated post-release.
- [ ] Push site changes — the `deploy-site` workflow auto-rebuilds on
      `release: { types: [published] }` AND on push to `develop`, so
      both the dual-button layout AND the new release data land
      together.

## 5. Verification

- [ ] Push a feature branch with the workflow change to trigger a CI
      run on a tag (or use `workflow_dispatch` if available).
- [ ] Confirm GitHub Actions:
      - `electron (darwin, x64)` job succeeds.
      - `electron (darwin, arm64)` job still succeeds (no regression).
      - Artifact `electron-darwin-x64` is uploaded.
- [ ] Download the produced x64 DMG to an Intel Mac (or Intel Mac mini /
      Cloud-hosted Intel host like MacStadium / GitHub Codespace with
      Intel arch where available).
- [ ] Manually verify:
      - DMG mounts.
      - App launches without "cannot be opened" error.
      - Wizard runs, offline-cache install completes (this is the most
        likely regression — confirms the darwin-x64 cacache is actually
        x64-clean).
      - Server starts; dashboard loads in default browser.
      - Open a session, verify node-pty terminal works (most likely
        secondary regression — confirms darwin-x64 node-pty prebuild is
        present).
- [ ] If the GitHub-hosted macos-13 runner cannot resolve, document the
      blocker and defer.

## 6. Local builder — arch-aware caching + `--mac-both`

- [x] In `packages/electron/scripts/build-installer.sh`, add a sentinel
      file `resources/.last-arch` recording the (platform, arch) of
      the last build. At the start of each native-build run on darwin,
      compare the requested arch against the sentinel; on mismatch,
      delete:
        - `resources/node/`
        - `resources/server/`
        - `resources/offline-packages/`
      Then write the new sentinel.
- [x] Detect cross-arch case (host=arm64, requested=x64) and:
        - Verify Rosetta 2 is installed (probe
          `arch -x86_64 /usr/bin/true`); fail fast with a clear
          message pointing to `softwareupdate --install-rosetta
          --agree-to-license` if absent.
        - Wrap the `bundle-server.sh` invocation in `arch -x86_64`
          so npm installs x64 prebuilt binaries (especially
          node-pty's prebuild bundle).
- [x] In `bundle-server.sh`, pass through an optional `TARGET_ARCH`
      env var that sets `npm_config_target_arch` for the `npm install`
      step (defense-in-depth in case the `arch -x86_64` wrapper is
      bypassed).
- [x] Add `--mac-both` flag to `build-installer.sh`:
        - On Apple Silicon: runs `--arch arm64` then `--arch x64` in
          sequence (sentinel-driven cache wipe between them).
        - On Intel: print a clear error and exit non-zero.
        - On non-darwin host: print clear error and exit non-zero.
- [x] Add a smoke step at end of `--mac-both`: list the two produced
      DMGs with their `file` output verifying Mach-O arch tags
      (`Mach-O 64-bit executable arm64` / `... x86_64`).
- [ ] Manually validate on an Apple Silicon mac:
        - `./build-installer.sh --arch arm64` works (baseline).
        - `./build-installer.sh --arch x64` produces a working x64
          DMG; mount it on an Intel mac (or VM) and verify the app
          launches and the terminal works.
        - `./build-installer.sh --mac-both` produces both DMGs in
          one invocation, both verified runnable.

## 7. Release skills (stale artifact-count fix)

- [x] `.pi/skills/release-cut/SKILL.md` line ~178 — update the
      auto-printed `Next steps (human)` block:
        - Change `"build Electron installers (macOS DMG, ...)"` to
          `"build Electron installers (macOS DMG × 2 — Intel +
          Apple Silicon, Linux DEB+AppImage, Windows NSIS+ZIP+portable)"`.
        - Change `"all 6 platform artifacts are attached"` to
          `"all 7 platform artifacts are attached"`.
- [x] `.pi/skills/release-cut/SKILL.md` — grep the rest of the file
      for any other artifact-count or platform-list assumptions and
      fix them. The skill is the human releaser's checklist; stale
      guidance → the releaser thinks artifacts are missing and
      delays publish.
- [x] `.pi/skills/release-revoke/SKILL.md` — scan for stale
      platform-count or DMG-singular assumptions; update if found.
      The skill is largely artifact-count-agnostic
      (`gh release delete` handles all attached artifacts) so this
      may be a no-op, but verify.
- [x] If `.pi/skills/release-cut/scripts/` contains any artifact
      verification helper that hard-codes a count or list, update
      it too.

## 8. Documentation

- [x] Update `AGENTS.md` `.github/workflows/publish.yml` row to mention
      that the matrix now covers all 5 platform-arch tuples (was 4 with
      macOS x64 missing).
- [x] Update `AGENTS.md` `packages/electron/scripts/build-installer.sh`
      row (add it if missing) to document the `--mac-both` flag, the
      sentinel-driven cache invalidation, and the Rosetta requirement
      for cross-arch on Apple Silicon hosts.
- [x] Update `AGENTS.md` `.pi/skills/release-cut/` row to note the
      artifact count (`7 artifacts: 2 macOS DMG, 2 Linux .deb,
      1 Linux .AppImage, 1 Windows NSIS, plus ZIP / portable .exe
      per Windows arch — verify with the skill's checklist`).
- [x] Update `docs/architecture.md` if any section enumerates supported
      platforms (search for "darwin" / "macOS" / "Intel").
- [x] Update `README.md` Maintainer / Building section (if it exists)
      to document `--mac-both` for producing both DMGs locally before
      release.
