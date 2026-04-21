## Context

The Electron app currently ships Node + npm + the dashboard server inside
`resources/`, but **all pi extensions — including the two first-party,
dashboard-critical ones (`pi-anthropic-messages`, `pi-flows`) — are
installed dynamically on first run** by `installRecommendedExtensions()`
in `packages/electron/src/lib/dependency-installer.ts:204`. That function
delegates to pi's own `DefaultPackageManager.installAndPersist(source)`,
which clones the git repo, `npm install`s it into
`~/.pi/agent/packages/<id>/`, and appends the source to
`~/.pi/agent/settings.json` `packages[]`.

The existing bundling pattern (see `packages/electron/scripts/bundle-server.sh`)
demonstrates the convention: copy source trees into
`packages/electron/resources/<name>/` at CI time, list them in
`forge.config.ts` `extraResource`, and consume from `process.resourcesPath`
at runtime.

**Stakeholders**: dashboard end-users (first-run UX), CI (build time +
installer size), release engineering (extra script to maintain).

## Goals / Non-Goals

**Goals:**
- Guarantee that `pi-anthropic-messages` and `pi-flows` work out-of-the-box
  with zero network access on first launch.
- Make the bundled-extension set *data-driven* (one manifest constant) so
  adding or removing a bundled id is a one-line change — not a rewrite.
- Keep installer growth bounded to source-only (no native modules, no
  Playwright, no per-platform variants for the bundled extensions).
- Preserve pi's existing update path — the bundled copy must *not* block
  `manager.update(...)` from later replacing it with a fresh git clone.
- Gate the whole feature on a CI env var so rollback is a single flag flip.

**Non-Goals:**
- Bundling third-party extensions (pi-subagents, pi-web-access,
  pi-agent-browser). Each has independent licensing and/or native deps
  that make it a separate decision.
- Replacing the dynamic install path for the general case. All other
  recommended extensions continue to use the existing flow.
- Offline install of **pi itself** — out of scope; handled by
  `bundled-node-runtime` + existing wizard.
- Bundling extensions into the non-Electron (bare CLI) distribution.

## Decisions

### 1. Bundle source only, not `node_modules`

**Decision**: Ship only the cloned source tree (`package.json`, `src/`,
`dist/` if published). Run `npm install` at first-run-copy time, not at
CI time.

**Why**: pi's `DefaultPackageManager` manages dependency installation as
part of `installAndPersist`; re-running its install semantics on the
bundled source keeps the on-disk shape identical to a normal install and
keeps `~/.pi/agent/packages/<id>/` update-compatible. Also avoids shipping
per-platform native binaries (neither extension has any today, but this
is future-proofing).

**Alternatives considered**:
- *Ship `node_modules` pre-installed*: smaller first-run time, but breaks
  cross-platform builds (current CI already hits this: `bundle-server.sh`
  has `--source-only` mode for exactly this reason) and risks drift vs.
  pi's expected layout.
- *Ship a tarball*: an extra extraction step with no real benefit over
  a plain directory tree — `resources/` is already extracted.

### 2. Copy bundled tree into pi's git cache, then persist the git URL

**Decision** (revised after task 1 spike): On first run, for each bundled id:
1. Compute pi's git install path
   `~/.pi/agent/git/<host>/<path>/` using the `source` git URL from
   `RECOMMENDED_EXTENSIONS`. This mirrors what `DefaultPackageManager.installGit`
   would create.
2. If the path already exists → skip (respect existing user install).
3. Otherwise, copy the bundled tree from
   `<resourcesPath>/bundled-extensions/<id>/` into that location and, if
   the extension has a `package.json`, run `npm install --omit=dev` inside
   it (same post-clone step pi does). This step is skipped if the
   extension declares no runtime `dependencies`.
4. Call `manager.addSourceToSettings(gitUrl, { local: false })` and
   `await manager.settingsManager.flush()` so the git URL lands in
   `~/.pi/agent/settings.json`.

**Why**: the task-1 spike confirmed that pi has no single-call API to
"install from a local path but persist a git URL" —
`installAndPersist(source)` always persists the exact `source` it received
(after normalization). Passing a local path makes pi persist the local
path, which breaks `manager.update()`. The 2-step approach above produces
the same on-disk shape as a normal `installGit` run (`~/.pi/agent/git/...`
tree + `packages[]` entry), so pi's later `update()` naturally picks it
up and `git fetch && reset --hard` replaces the bundled copy with upstream.

**Alternatives considered**:
- *`installAndPersist("local:<path>")`*: pi's `parseSource` has no
  `local:` scheme — it treats the entire string as a filesystem path
  relative to `cwd` and the installed source recorded in `settings.json`
  is that local path, not the git URL. Rejected for the reason above.
- *Pure bypass (copy files + hand-write `settings.json`)*: indistinguishable
  on disk from the chosen 2-step, but reimplements pi's settings
  serialization. Rejected — using `addSourceToSettings` is one call and
  rides pi's normalization/dedup logic.
- *Wait for a pi change to accept `installAndPersist(git, { localOverride })`*:
  blocks this work on upstream. Rejected — our 2-step is small, local,
  and reversible.

### 3. One manifest: `BUNDLED_EXTENSION_IDS` in shared

**Decision**: Add a single exported const in
`packages/shared/src/recommended-extensions.ts`:
```ts
export const BUNDLED_EXTENSION_IDS: readonly string[] = [
  "pi-anthropic-messages",
  "pi-flows",
];
```
Both the build script and the runtime installer read from this list.

**Why**: one source of truth; adding a future id (e.g., pi-subagents) is
a one-line change plus a license review. Keeps CI + runtime in sync by
construction.

### 4. CI opt-in via `BUNDLE_RECOMMENDED_EXTENSIONS=1`

**Decision**: The new `bundle-recommended-extensions.sh` is a no-op
unless `BUNDLE_RECOMMENDED_EXTENSIONS=1` is set. Default to on in
`.github/workflows/publish.yml`, off in local dev and feature branches.

**Why**: local `npm run build` stays fast; release artifacts get the
bundle; rollback is a single env-var flip without code changes.

### 5. First-run detection via presence of `resources/bundled-extensions/<id>/`

**Decision**: `installBundledExtensions()` enumerates subdirectories of
`resources/bundled-extensions/` (present → bundled, absent → skip). No
separate manifest file shipped. Skip ids already installed in
`~/.pi/agent/packages/<id>/`.

**Why**: idempotent, survives partial bundles, works identically whether
the CI flag was on or off at build time.

## Risks / Trade-offs

- **Drift between bundled version and upstream**: Bundled copy is frozen
  at the commit CI snapshotted. **Mitigation**: record the commit SHA in
  a sidecar file (`resources/bundled-extensions/<id>/.bundled-sha`) for
  forensics; rely on pi's `update()` path to replace it the first time
  the user updates. Accept that pre-update, users run a pinned version.
- **Pi internals might change**: `installAndPersist` signature / semantics
  could shift across pi versions. **Mitigation**: the `recommended-extensions`
  capability already consumes `DefaultPackageManager` — adding a `local:`
  form is one extra call site under the same brittleness. If pi breaks,
  both paths break together; fix in one place.
- **Unknown: does pi accept `local:` source URLs?** → listed under Open
  Questions; verified in the first task before further implementation.
- **Installer size**: +~5–12 MB per platform for both extensions combined.
  Within noise for an Electron installer (~100 MB baseline). **Mitigation**:
  CI job emits size delta per PR; failing CI if growth exceeds +15 MB.
- **License drift**: both extensions are first-party today. A future
  re-license or repo transfer could invalidate redistribution rights.
  **Mitigation**: `bundle-recommended-extensions.sh` reads the `LICENSE`
  file from each cloned repo and fails the build if it doesn't match the
  expected SPDX identifier. Explicit allowlist.
- **Race with user's pre-existing install**: user already has
  `pi-anthropic-messages` installed from CLI before launching Electron.
  **Mitigation**: skip-if-present check on `~/.pi/agent/packages/<id>/`;
  bundled copy is ignored, existing install wins.
- **Wizard complexity**: adding a "Bundled ✓" state is cosmetic and safe;
  the wizard already distinguishes pending/running/done/error.

## Migration Plan

**Deploy**:
1. Land the shared manifest + bundle script + installer + wizard changes
   behind `BUNDLE_RECOMMENDED_EXTENSIONS=0` (no behavior change).
2. Enable `=1` in a release branch; cut a pre-release; smoke-test installer
   on macOS/Linux/Windows VMs (qa/ suite already covers this).
3. Promote to `main` CI default.

**Rollback**:
- *Minor issue* (bundled extension breaks first-run for some users): set
  `BUNDLE_RECOMMENDED_EXTENSIONS=0` in CI, cut a patch release. No code
  revert needed.
- *Major issue* (pi internals change, `installAndPersist` local: form
  regressed): revert the change in `dependency-installer.ts` only; leave
  the bundle on disk (inert). Next release ships without activation.

**Compatibility**:
- Users upgrading from a prior release: the first-run check is
  presence-of-dir-in-`~/.pi/agent/packages/`; existing installs are
  respected. No migration script needed.
- Users on Electron-bundled-server without pi installed at all: the
  bundled extensions land in `~/.pi/agent/packages/` alongside the
  normal install flow — nothing is different from their perspective
  except that extensions are present immediately.

## Blockers discovered during implementation

- **`pi-flows` repo declares no SPDX license.** As of the commit snapshotted by the bundling spike (`3618a417...`), `github.com/BlackBeltTechnology/pi-flows` has neither a top-level `LICENSE`/`COPYING` file nor a `license` field in `package.json`. The new `bundle-recommended-extensions.sh` correctly refuses to bundle it under the "License allowlist enforcement" requirement. **Action required before release**: ask the pi-flows maintainers to add a SPDX-conformant `LICENSE` file and/or `"license"` field (MIT preferred, per the other BlackBelt repos). Until then, `BUNDLED_EXTENSION_IDS` can ship just `["pi-anthropic-messages"]` — this is a one-line change once the block is cleared.
- **`pi-flows` has runtime `dependencies`**: confirmed from the clone. `installBundledExtensions()` will run `npm install --omit=dev` inside the copied tree on first launch, which requires network access on that run. Fully-offline first launch is only guaranteed for dep-free bundled extensions (today: only `pi-anthropic-messages`). Tracked as a followup for runtime-only bundle mode.

## Open Questions

1. ~~**Pi `local:` source support**~~ **Resolved** (spike
   `packages/electron/scripts/spike-local-install.mjs`): pi has no
   `local:` scheme; `installAndPersist(localPath)` persists the local
   path (relative to `agentDir`), not the original git URL. See
   decision 2 above for the 2-step workaround.
2. **Size budget threshold** — is +15 MB the right CI-fail threshold, or
   should it be configurable per release? Deferred to first PR review.
3. **Should the bundled SHA be surfaced in the About dialog** (so users
   can see what snapshot they're running)? Nice-to-have, not required.
   Tracked as a follow-up.
