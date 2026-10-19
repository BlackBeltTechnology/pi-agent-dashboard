## Why

`bundle-server.mjs` installs the Electron app's bundled server with `npm install --omit=dev --no-package-lock` against the declared ranges (`packages/electron/scripts/bundle-server.mjs:346-360`). The installed tree is whatever the registry serves on the day of the build, not what `pnpm-lock.yaml` or any release lock says. The 2026-10-18 spike shows the effect: a bundle built from a lockfile pinned at pi 1.1.0 shipped pi `1.3.0`.

For a release X, the runtime overlay already installs an exact tree from `runtime-lock.json`, published inside `@blackbelt-technology/pi-dashboard-server@X` before the Electron job runs (`publish.yml:549-550`). The installer for the same X is built from a different, floating resolution. The same version can therefore ship two different dependency trees: one in the installer, another once the overlay activates.

## What Changes

- **Release builds install the published runtime lock.** When the Electron build runs with a release-lock version X, the bundle step SHALL install the bundled server's third-party tree from `server@X`'s `runtime-lock.json` with `npm ci`. Each tarball is verified against the lock's `integrity`.
  - The lock is rebased onto the bundle's workspace layout: bundled workspace packages become workspace links to the local `packages/<name>` sources; the web client and non-workspace bundled plugins are removed (they are materialized locally); third-party entries are kept verbatim.
  - A post-install audit verifies the installed tree against the rebased lock and that no first-party package came from the registry.
  - The bundle layout, the launcher and the synthetic `package.json` contract stay as they are.
- **Fail closed.** The bundle step fails, never falling back to the floating install, when:
  - the lock cannot be fetched or is for another version;
  - it holds an unmapped first-party package or a third-party entry without `integrity`;
  - `npm ci` or the audit fails;
  - the release-lock input is empty or combined with source-only mode.

  On every release-lock build, a post-bundle assertion requires the bundle to record that it installed from the lock, and a workflow-contract test keeps the release workflow from dropping the input. Lock-level defects are caught **before** the server is published, because a publish cannot be undone.
- **Callers.** `publish.yml` and `nightly.yml` set `release_lock: true`; the version comes from the existing `version` input. The nightly publishes to its per-leg Verdaccio in release order (all but server and root, then lock + lint, then server, then root), so the release path runs on all six legs every night. PR, develop, on-demand and electron-e2e builds keep today's floating `npm install`.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `electron-build-pipeline`: new requirement that release-lock bundles install the published runtime lock (third-party versions pinned and integrity-verified, first-party only from bundled sources, fail-closed), while other bundles keep the floating install.
- `ci-cd-pipeline`: the reusable Electron build workflow gains a `release_lock` boolean input; the release workflow's electron job sets it and the on-demand workflow does not.
- `monorepo-workspace-structure`: the npm-survivor list gains the bundle step's runtime-tree assembly (`npm install`, `npm pack`, `npm ci`) and runtime-lock generation.
- `nightly-verification`: the nightly bundle takes first-party packages from the working tree (bundled workspace or Verdaccio) and builds through the release-lock path, with the lock generated against Verdaccio.

## Impact

- **Code:**
  - `packages/electron/scripts/bundle-server.mjs`: release-lock mode, lock fetch, rebase, `npm ci`, post-install audit, exit-status checks;
  - a new plain-Node rebase/audit helper with unit tests, and two optional fields in the shared runtime-manifest parser;
  - `.github/workflows/_electron-build.yml` (new input and assertion), `publish.yml` (input and pre-publish lock lint), `nightly.yml` and `scripts/nightly-verdaccio-publish.mjs` (release-order publish with lock generation);
  - the install-argv contract test.
- **Release pipeline:** the lock is generated and published with `server@X` in the `publish` job (`publish.yml:424-430`), and the `electron` job runs after it (`publish.yml:549-550`), so the lock is on the registry when the bundle step runs.
- **Users:** none directly. For the same X, every third-party package version in the installer is one the overlay's lock pins. The installer omits the web client's build-time closure, which it does not need.
- **Coordinates with:**
  - `refresh-electron-bundled-components`: edits the same `bundle-server.mjs` and `_electron-build.yml`; rebase only.
  - `add-bundle-mode-marker`: its stamp defines `mode: full | source-only` with `npmInstallSucceeded` tied to `npm install`. A release-lock bundle is `full` and installs with `npm ci`. Its wording is amended in a separate commit to read "the install step (`npm install` or `npm ci`)". This change records the install path in `runtime-manifest.json` (`installMode`), not in that stamp.
  - `fix-npm12-remote-tarball-install`: owns the npm 12 `allow-remote` problem (removes the URL-tarball dependency); this change adds no `allow-remote` workaround.
  - `macos-notarization`, `windows-authenticode-signing`, `raise-node-floor-to-26`, `server-launch-smoke-suite`: edit `publish.yml` / `_electron-build.yml`.
  - `bundle-python-runtime`, `add-codegraph-code-plane`: add gates to `bundle-server.mjs`.

  All of these are rebase-only.
- **Rollback:** revert. Release builds return to the floating install.

## Discipline Skills

- `doubt-driven-review`: changes how every shipped installer's dependency tree is produced. The first real lock arrives with the first release after merge; only the nightly path (against a Verdaccio-generated lock) can exercise it beforehand.
- `security-hardening`: the release lock is fetched from the registry and drives what ships. Integrity pinning (`npm ci` verifies each tarball against the lock's `integrity`) is the control. The server entry carries no integrity by design (`generate-runtime-lock.mjs` header), which is moot here because the rebase turns it into a link to the bundled source.
- `observability-instrumentation`: a new external call (registry fetch of `server@X`) and a new nightly path; the bundle step logs the install mode, the lock source and the audited package counts.
- `review-code`: non-trivial build-pipeline change before commit.
