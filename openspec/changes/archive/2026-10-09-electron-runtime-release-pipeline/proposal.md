## Why

`electron-runtime-overlay-updates` built the consumer side of runtime updates: the Electron app can stage, activate and roll back a runtime release X from npm or GitHub. Nothing publishes such a release yet. No published version ships `runtime-lock.json` or a GitHub runtime asset, so every npm/GitHub update fails with "ships no runtime-lock.json". This change builds the producer side (the release pipeline) and the end-to-end tests that need a real release shape. Split out so the consumer change can ship without CI/release work.

## What Changes

- **Runtime lock**: the release pipeline generates `runtime-lock.json` (npm lockfile v3) over meta + server + web + extension + plugin-runtime + every `piDashboard.bundledPlugins` id, all pinned at exactly X, and ships it in the `@blackbelt-technology/pi-dashboard-server@X` package `files`. It is not `npm-shrinkwrap.json`; Standalone `npm i -g` is unaffected.
- **Bundled-plugin registry gate**: after npm publish and before the lock / runtime asset are published, every `bundledPlugins` package must resolve on the registry at X (with retry); a miss fails the release naming the package.
- **Channels**: prereleases publish under the npm `beta` dist-tag and as GitHub prereleases.
- **GitHub runtime asset**: `pi-dashboard-runtime-<X>-<platform>-<arch>.tgz` + `.sha512` attached to the GitHub Release (shape confirmed by spike 1.1; per-platform is the interim default the consumer already looks up).
- **Tests**: workflow assertions for the gate and the published shape; Electron E2E for the full npm update cycle, broken-overlay fallback, and crash detection on an overlay, using a local npm registry fixture.

## Capabilities

### New Capabilities

- `electron-runtime-release`: publishing a runtime release X (lock, registry gate, beta channel, GitHub asset).

### Modified Capabilities

None. Consumer behaviour lives in `electron-runtime-overlay` (change `electron-runtime-overlay-updates`).

## Discipline Skills

- `security-hardening`: the pipeline publishes code other installs download and run; the lock pins integrity per package and the asset carries a sha512.
- `doubt-driven-review`: publishing is irreversible (npm versions cannot be reused); review the gate ordering before the workflow change stands.
- `observability-instrumentation`: the gate and publish steps report missing packages / asset names in `GITHUB_STEP_SUMMARY`.
- `performance-optimization`: not triggered.

## Impact

- **Release pipeline**: `.github/workflows/publish.yml` (and the Electron release workflow for the asset); new `scripts/` generator for `runtime-lock.json`; server package `files`.
- **Tests**: new workflow assertion step modelled on `packages/electron/scripts/assert-runnable-bundle.mjs`; new `tests/e2e-electron/runtime-overlay-update.electron.spec.ts`; verdaccio fixture in the electron E2E job.
- **Depends on**: `electron-runtime-overlay-updates` (not yet on develop) (consumer: stager, checker, `runtime-io.ts` asset-name lookup).
