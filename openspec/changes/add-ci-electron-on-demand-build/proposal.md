## Why

Electron installers (DMG / AppImage / DEB / Windows ZIP + portable .exe) are produced only by the release pipeline (`.github/workflows/publish.yml`), which requires a SemVer tag, an npm publish, and a GitHub Release. There is no way to:

- Smoke-test that the matrix still builds green on a feature branch before cutting a tag.
- Hand a teammate a one-off installer to reproduce a packaging-layer bug.
- Verify a `bundle-server.mjs` / `forge.config.ts` change without irreversibly burning a SemVer slot.

Today these scenarios force a "throwaway prerelease" cut (e.g. `0.5.3-rc.99`) that publishes to npm, creates a GitHub Release, and pollutes the version space. We want on-demand builds with zero side effects on the registry, Releases page, or installed users' update channels.

## What Changes

- Add `.github/workflows/ci-electron.yml`: `workflow_dispatch`-only workflow that builds the full Electron matrix (6 legs) for the dispatching branch, with the matrix subset selectable via input.
- Extract the existing `electron` job from `publish.yml` into a new reusable workflow `.github/workflows/_electron-build.yml` (`on: workflow_call`) so both `publish.yml` and `ci-electron.yml` share one definition. The release flow keeps its current behaviour bit-for-bit.
- Define a CI build-version slug: `<base>-ci.<UTC-stamp>.<branch-slug>.<sha7>` where `base` is the root `package.json` version, `UTC-stamp` is `YYYYMMDD-HHMMSS`, `branch-slug` sanitises non-SemVer chars (`[^a-zA-Z0-9.-]` → `-`) and caps at 20 chars, and `sha7` is the short commit SHA. The slug is applied via `npm version` at the start of the reusable workflow.
- Artifacts uploaded via `actions/upload-artifact@v4`, 14-day retention, named `electron-<platform>-<arch>-<sha7>`. Downloadable from the Actions run page only — **no GitHub Release, no npm publish** for CI-dispatched runs.
- Resolve the bundle-server registry-dep question (see design.md): CI dev builds use `bundle-server.mjs --source-only` so the bundled server resolves `@blackbelt-technology/*` packages from local workspace source, not from the registry. The release flow remains unchanged.
- Concurrency: `cancel-in-progress: true` keyed on `branch + workflow`, so re-dispatching cancels the prior in-flight run on the same branch.

## Capabilities

### New Capabilities

- `ci-electron-on-demand-build`: contract for the dispatch-triggered electron build pipeline — inputs, version-slug shape, matrix-subset selector, artifact naming, retention, and the safety invariants that keep installed users' auto-update channels untouched.

### Modified Capabilities

- `ci-cd-pipeline`: extracts a shared reusable workflow for electron builds; `publish.yml` is refactored to consume it via `workflow_call` instead of inlining the 200-line `electron` job. No behavioural change to the release flow.

## Impact

- **Code**: new `.github/workflows/ci-electron.yml`, new `.github/workflows/_electron-build.yml` (reusable), `publish.yml` electron job replaced by a `uses:` reference. No source code under `packages/` changes.
- **Bundle script**: `packages/electron/scripts/bundle-server.mjs` — only verified, not modified. The `--source-only` mode already exists per its header comment; design.md task 1 confirms it produces a working bundle when used alone in CI.
- **Repo lint**: `packages/shared/src/__tests__/publish-workflow-contract.test.ts` updated to pin the `uses:` reference and the `needs: [prepare, publish]` ordering once the reusable workflow is consumed. Reasoning matches the existing lint's intent: prevent silent CI drift.
- **Update channels**: zero impact. CI dev builds never publish to npm, never create a GitHub Release. The `-ci.<...>` prerelease suffix means even an accidental Release publish would SemVer-rank below any stable, so `electron-updater` (default `allowPrerelease: false`) would not surface it.
- **CI burn**: each manual dispatch costs ~90min of runner time (6 legs × ~15 min). Matrix-subset input mitigates iteration cost when chasing a single-platform bug.
- **Out of scope**: PR auto-build label, nightly cron, code signing, notarisation, GitHub Release-based artifact hosting, public anonymous download. These can layer on later without re-designing the reusable workflow.
