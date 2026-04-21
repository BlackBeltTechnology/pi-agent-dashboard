## Why

The Electron DMG / DEB / AppImage / NSIS / ZIP builds today bundle only Node.js
and the dashboard server. On first run, `installStandalone()` in
`packages/electron/src/lib/dependency-installer.ts` calls `npm install
@mariozechner/pi-coding-agent @fission-ai/openspec tsx` against the public npm
registry to complete setup. This fails — with no offline fallback — on:

- Air-gapped Windows machines (enterprise, customer demos, factory floors).
- Machines behind corporate proxies that block registry.npmjs.org.
- "Download the ZIP, unzip, run" handoffs where the user never touches the
  wizard with live network access.

Symptom reported by users: **"I copied the portable/ZIP Windows build and pi
agent not found."** ToolRegistry can't resolve `pi-coding-agent` because no
runtime ever wrote it to `%USERPROFILE%\.pi-dashboard\node_modules\`.

Measured on 2026-04-21 from a clean install of the three packages:

- 3 top-level `.tgz` tarballs: **4.6 MB** — but transitive deps (662 packages,
  ~200 MB on disk) still come from the registry. Partial offline only.
- Full compressed npm cacache (`--prefer-offline` source): **~50 MB per
  platform** — works fully offline, any transitive state.

We ship the cacache (tier B). +50 MB per platform installer is acceptable for
deterministic offline-capable first-run.

## What Changes

### 1. Build-time: produce a per-platform npm cacache snapshot

- New script `packages/electron/scripts/bundle-offline-packages.sh`:
  - For each target platform (win32-x64, darwin-arm64, darwin-x64,
    linux-x64, linux-arm64), run

    ```
    npm install --prefix <tmp>/<platform> \
      --cache <tmp>/<platform>/npm-cache \
      --os=<os> --cpu=<cpu> --ignore-scripts \
      @mariozechner/pi-coding-agent@<pin> \
      @fission-ai/openspec@<pin> \
      tsx@<pin>
    ```

    (Electron Forge builds run on the target platform, so we only populate
    one cacache per build job — not all five.)
  - Tar+gzip the resulting `_cacache/` tree into
    `resources/offline-packages/npm-cache.tar.gz`.
  - Emit `resources/offline-packages/manifest.json` with the three pinned
    versions, `bundledAt`, and `targetPlatform`.
- Version pins live in `packages/electron/offline-packages.json` (reviewable
  in code review).
- `forge.config.ts` conditionally adds `./resources/offline-packages` to
  `extraResource` when the manifest is present.
- `.github/workflows/publish.yml` runs the bundle step in each platform job
  (matrix entry).

### 2. Runtime: cache-offline install

- `dependency-installer.ts` gains `resolveOfflinePackages()` that reads
  `${process.resourcesPath}/offline-packages/manifest.json`.
- On first run, if the manifest is present:
  1. Extract `npm-cache.tar.gz` into
     `${MANAGED_DIR}/.offline-cache/_cacache/` (one-time, ~3 s on SSD).
  2. Run ONE command:

     ```
     npm install --prefix <MANAGED_DIR> \
       --cache <MANAGED_DIR>/.offline-cache \
       --offline \
       @mariozechner/pi-coding-agent@<pin> \
       @fission-ai/openspec@<pin> \
       tsx@<pin>
     ```
     `--offline` forces npm to fail (not fall back to the network) if anything
     is missing from the cache — **deterministic offline contract**.
  3. Delete `.offline-cache/` after success to reclaim ~140 MB on the user's
     disk. The source tarball in `resources/` stays untouched for re-runs.
- If the manifest is absent (dev `npm run make` without the bundle step),
  behaviour is unchanged — falls through to today's registry install.

### 3. Doctor + diagnostics

- `packages/electron/src/lib/doctor.ts` adds an "Offline packages bundle" row
  showing present/absent, the target platform, and the three pinned versions.

### 4. Documentation

- `docs/installation-windows.md` gains a "First-run offline" subsection.
- `AGENTS.md` Key Files entries added.

## Out of Scope

- Offline install support for the `npm i -g pi-dashboard` CLI path — that
  install route assumes registry access by definition.
- Auto-refreshing the bundled cacache post-install — upgrades remain
  user-initiated via the existing Settings → Packages "Update pi" UI,
  which uses the registry.
- Cross-platform merged cacache (tier C). Per-platform (tier B) keeps each
  installer focused on the platform it actually runs on.
- Cryptographic verification beyond what `npm install` already performs on
  cached tarballs via the integrity SRI in `_cacache/index-v5/`.
- Shrinking the Electron archive below the +50 MB line.

## ⚠ Precondition

`unified-bootstrap-install` SHOULD land first. If it lands, §2 updates
`packages/shared/src/bootstrap-install.ts` instead of
`packages/electron/src/lib/dependency-installer.ts`. If not, edits stay in the
Electron file and the shared-module migration absorbs them later. Both
orderings are safe; confirm in task 0.1.
