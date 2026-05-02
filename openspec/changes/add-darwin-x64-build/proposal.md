## Why

**This is a regression-fix change, not a new feature.**
`openspec/specs/electron-build-pipeline/spec.md` already declares
`Scenario: CI produces macOS x64 DMG — WHEN the CI workflow runs on macos-13
runner, THEN it SHALL produce a .dmg for x64`. The current workflow does
not honor that requirement. We are bringing the implementation back into
compliance and tightening the spec to prevent re-drift.

The published Electron release for macOS is **arm64-only**. Intel Mac users who
download the DMG from the GitHub Release see a "PI Dashboard cannot be opened"
error on launch (or, depending on macOS version, a silent quarantine). Rosetta 2
cannot translate arm64 → x86_64; it only goes the other direction, so there is
no runtime fallback.

Root cause: `.github/workflows/publish.yml` declares only one macOS row in the
electron build matrix:

```yaml
- os: macos-14         # Apple Silicon runner
  platform: darwin
  arch: arm64
  node-arch: arm64
```

There is no `darwin/x64` row. Linux and Windows each have x64 + arm64 entries;
macOS does not. `forge.config.ts` *intends* a universal build via
`packagerConfig.arch: "universal"`, but the workflow's `electron:make
-- --arch=${{ matrix.arch }}` flag overrides `packagerConfig.arch`, so the
hint is dead code. The artifact is a single-arch arm64 DMG.

Intel Mac is still a meaningful slice of the developer-laptop installed base
through end-of-life of the 2019–2020 MBP/MBA fleet; declaring it unsupported by
omission is not the intent.

## What Changes

### 1. Build matrix — add `darwin/x64`

In `.github/workflows/publish.yml`, add one row to the `electron.strategy.matrix.include`
list:

```yaml
- os: macos-13         # last GitHub-hosted Intel runner
  platform: darwin
  arch: x64
  node-arch: x64
```

This reuses every existing per-arch step unchanged: bundled Node.js download
(`scripts/download-node.sh v22.12.0 darwin x64`), per-platform offline npm cache
(`--platform=darwin-x64`), node-pty native rebuild on the host runner, and
`electron:make -- --arch=x64`. The pipeline is already designed around
per-(platform, arch) artifacts — no shared steps, no merging.

### 2. No changes to `forge.config.ts`

Leave the `arch: "universal"` hint in place — it is harmless when the CLI
`--arch=` flag is present. Removing it is out of scope for this change. We are
NOT pursuing a universal binary because three pieces of the bundling pipeline
are arch-specific (bundled Node.js Mach-O, node-pty `prebuilds/darwin-*/pty.node`,
offline npm cache). Per-arch artifacts is the path of least resistance and
matches the existing Linux/Windows model.

### 3. Rename existing arm64 DMG for symmetry (decided)

Two macOS DMGs will be published per release, both with explicit arch
suffix:

- `PI-Dashboard-darwin-arm64-<ver>.dmg` (Apple Silicon)
- `PI-Dashboard-darwin-x64-<ver>.dmg`   (Intel)

The previous releases shipped the arm64 DMG without an arch suffix
(`PI-Dashboard-<ver>.dmg`). Decision: **rename arm64 to include
`-arm64`**, accepting one-time link breakage on any external sites that
linked the unsuffixed file directly. Reasoning: asymmetric naming is
worse for discovery and would confuse the site's classifier (which keys
on `arm64` / `x64` substrings). One-time breakage is acceptable for a
0.x project; CHANGELOG will call it out.

The default output filename pattern from `@electron-forge/maker-dmg`
already includes the arch suffix when invoked with `--arch=`, so no
maker config change is needed — the rename is automatic by adding the
new matrix row and verifying the existing arm64 output filename.

### 4. Update three surfaces (decided)

Three user-facing surfaces need install-instruction updates:

1. **`README.md`** — the canonical "how to install" doc.
2. **GitHub Release notes** (auto-generated from `CHANGELOG.md` by
   `.github/workflows/publish.yml`) — the first release after this
   change MUST call out the rename + Intel availability so users
   following "latest release" links land on the right artifact.
3. **`site/`** (the Astro marketing site) — `DownloadSection.astro`
   already classifies macOS DMGs by `arm64` / `x64` / `apple` / `intel`
   substrings and groups them under the macOS bucket via
   `lib/github-release.ts`. Without changes, the new x64 DMG would be
   buried under "Other downloads". The site SHALL render Apple Silicon
   and Intel as **two equally prominent download buttons** inside the
   macOS card so Intel users don't have to open a disclosure to find
   their build. Implementation: split the macOS card's `primary` slot
   into two stacked buttons when both arches are present; fall back to
   single-button behavior when only one is present (so the site still
   renders correctly during the cutover release before x64 is
   available).

### 5. Local builder — fix arch-aware caching and add `--mac-both` (decided)

`packages/electron/scripts/build-installer.sh` currently produces
**silently broken artifacts on a second arch run** because three caches
are skipped without arch awareness:

| Cache | Skip guard (build-installer.sh) | Failure when reused across arches |
|---|---|---|
| `resources/node/` | `if [ ! -f .../bin/node ]` (line ~191) | Wrong-arch Node binary in DMG |
| `resources/server/node_modules/` | `if [ ! -d ... ]` (line ~175) | Wrong-arch node-pty prebuild |
| `resources/offline-packages/` | `if [ ! -f manifest.json ]` (line ~185, when `BUNDLE_OFFLINE_PACKAGES=1`) | Wrong-arch npm cacache |

Additionally, `scripts/bundle-server.sh` runs `npm install --omit=dev`
against host arch with no `--target_arch=` or `arch -x86_64` wrapper, so
node-pty's native prebuild is always host-arch.

Fix:

1. **Per-arch cache directories.** Rename / re-target the three caches
   to embed arch in the path (`resources/node-arm64/`,
   `resources/server-darwin-arm64/`,
   `resources/offline-packages-darwin-arm64/`) and symlink the
   active-arch directory to the names Forge expects right before
   `forge make`. Or simpler alternative: **always wipe** the three
   caches at the start of a build when the host platform is darwin
   AND the requested arch differs from the previously-built arch (track
   in a `resources/.last-arch` sentinel). The simpler-wipe path is
   recommended unless the rebuild cost is unacceptable in practice
   (~30 s on M1 for the server bundle).

2. **Cross-arch native module rebuild on Apple Silicon hosts.** When
   building x64 on an arm64 host, wrap the npm install in
   `arch -x86_64 npm install ...` so node-pty downloads the x64
   prebuilt-binary and any compiled native modules target x64. Detect
   the cross-arch case in `build-installer.sh` and emit a clear log
   line. Document that Intel hosts CANNOT cross-build arm64 locally
   (Rosetta is one-way — maintainers on Intel must rely on CI for
   arm64 validation).

3. **`--mac-both` convenience mode.** Add a flag to
   `build-installer.sh` that runs both arch builds in sequence with
   per-arch cache invalidation:

   ```bash
   ./build-installer.sh --mac-both        # produces arm64 + x64 DMGs
   ```

   On Intel hosts the flag prints a clear error and exits non-zero
   ("--mac-both requires an Apple Silicon host; use CI for both arches
   from Intel").

4. **Doctor-style preflight.** `--mac-both` SHALL fail fast (before
   any npm install) if `arch` command is missing or Rosetta 2 is not
   installed (probe via `arch -x86_64 /usr/bin/true; echo $?`). The
   error message points to `softwareupdate --install-rosetta`.

### 6. Out of scope (explicit non-goals)

- **Universal binary.** Requires `lipo`-merging the bundled Node.js, dual
  node-pty prebuilds, and a merged offline npm cacache. Three new failure
  surfaces, ~2× artifact size. Tracked separately if the macos-13 runner is
  ever retired (see "Risks").
- **Cross-compiling x64 from arm64 in CI.** CI uses one runner per arch
  (matrix); cross-arch is only addressed in the LOCAL builder above.
- **Cross-arch node-pty rebuild on Intel hosts.** Rosetta is one-way;
  Intel → arm64 has no clean local path. Out of scope by physics.
- **Code signing / notarization changes.** Both macOS arches use the same
  `APPLE_IDENTITY` / notarization flow; no changes needed.

## Impact

- **Affected files**:
  - `.github/workflows/publish.yml` — one matrix entry added
  - `.github/workflows/sync-release-version.yml` — no change (asset list
    is generic; new DMG picked up automatically)
  - `.github/workflows/deploy-site.yml` — no change (triggers on
    `release: published`, site update covered separately)
  - `.github/workflows/ci.yml` — no change (no Electron build steps)
  - `scripts/sync-versions.js` — no change (version-bump only, not
    artifact-aware)
  - `packages/electron/scripts/build-installer.sh` — arch-aware cache
    invalidation, cross-arch shim, `--mac-both` mode, Rosetta preflight
  - `packages/electron/scripts/bundle-server.sh` — honor `--target_arch=`
    or arch-shim (decision in implementation)
  - `packages/electron/scripts/download-node.sh` — already arch-aware,
    no change
  - `.pi/skills/release-cut/SKILL.md` — update stale
    `"all 6 platform artifacts"` text → `7`, mention macOS DMG × 2
  - `.pi/skills/release-revoke/SKILL.md` — audit for stale
    artifact-count / platform-list assumptions; likely no-op
  - `README.md` — install-instructions clarification +
    "build both DMGs locally" note for maintainers
  - `CHANGELOG.md` — note added under Unreleased (incl. rename callout)
  - `site/src/components/DownloadSection.astro` — dual-button macOS slot
    when both arches are present
  - `site/src/lib/github-release.ts` — may need a `primaryByArch` field
    on `PlatformBundle` to support the dual-button rendering (decision
    deferred to implementation)
  - `openspec/specs/electron-build-pipeline/spec.md` — strengthened CI matrix
    requirement (delta)
- **Affected users**: Intel Mac users (currently broken → working).
  Apple Silicon users: no change.
- **CI cost**: +1 macos-13 runner per release. macOS minutes are 10× normal,
  but a release runs ~5–8× per month. Net additional cost is small.
- **Release artifact count**: GitHub Release goes from 7 → 8 downloadable
  artifacts.
- **No code changes** in `packages/electron/`, no changes to `forge.config.ts`,
  no changes to bundling scripts.

## Risks

### Risk: macos-13 runner retirement

GitHub-hosted `macos-13` (Intel) is the last Intel runner image. Per GitHub's
Actions runner deprecation schedule it remains available through approximately
end of 2026, but a hard date is not published. When retired, this build path
breaks and the choice is:

1. Move x64 macOS to a self-hosted Intel mac mini (operational burden).
2. Cross-compile x64 from `macos-14` arm64 (technically possible, native
   modules are the rough edge).
3. Drop x64 macOS support (this proposal becomes a stopgap).
4. Pursue universal binary (the deferred option from #4 above).

This is acceptable risk for a stopgap — Intel Mac share is strictly declining,
and we'd want to revisit before macos-13 is retired anyway.

### Risk: existing arm64 release artifact filename rename

Previous releases shipped `PI-Dashboard-<ver>.dmg` without an arch
suffix. The new arm64 DMG will be `PI-Dashboard-darwin-arm64-<ver>.dmg`
(per decision in section 3). Direct deep links to the old filename in
external blog posts / READMEs / chat archives will 404.

Mitigation: CHANGELOG entry calls it out; release notes for the cutover
release lead with the rename. Acceptable break for a 0.x project.

### Risk: tests

There is no automated end-to-end test that validates a darwin-x64 DMG launches
on an Intel Mac (we don't run e2e tests on macOS at all today). Smoke testing
post-release is manual — same situation as darwin-arm64 today.

### Risk: local-builder cache invalidation regresses speed

Wiping `resources/node/` and `resources/server/node_modules/` on every
arch switch costs ~30 s extra on Apple Silicon (server bundle re-install
dominates). For maintainers who only ever build one arch this is no
change (sentinel matches, no wipe). For `--mac-both` this is unavoidable
overhead but bounded.

### Risk: Rosetta dependency on Apple Silicon

Apple Silicon hosts need Rosetta 2 installed to cross-build x64. Rosetta
is a one-time install (`softwareupdate --install-rosetta --agree-to-license`)
and the proposal's preflight check fails fast with the install command
in the error message. Acceptable for a maintainer-only tool.

## Open questions

_All open questions from initial draft were resolved during exploration
and are now captured in sections 3 and 4 above._
