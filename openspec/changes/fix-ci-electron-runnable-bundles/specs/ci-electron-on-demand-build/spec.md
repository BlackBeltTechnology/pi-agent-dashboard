# ci-electron-on-demand-build — delta

## MODIFIED Requirements

### Requirement: Bundle-server install mode for CI dispatches
The on-demand workflow (`.github/workflows/ci-electron.yml`) SHALL pass `source_only_bundle: false` to the reusable build workflow. This produces a fully installed `resources/server/node_modules/` tree, identical in shape to release builds, where workspace packages (`@blackbelt-technology/*`) are resolved locally via the synthetic bundle's `workspaces:` field and external dependencies are fetched from the npm registry.

The Docker cross-compile path (`packages/electron/scripts/docker-make.sh` for Linux/Windows from macOS hosts) MAY still invoke `bundle-server.mjs --source-only` directly via its own script entrypoint, because the host-side install would otherwise pull host-arch native modules into a foreign-target bundle. The workflow input `source_only_bundle` SHALL remain available for any future caller with the same constraint, but both currently-active callers (`publish.yml`, `ci-electron.yml`) SHALL pass `false`.

#### Scenario: CI dispatch produces a runnable bundle
- **WHEN** `ci-electron.yml` is dispatched with default inputs
- **THEN** every leg SHALL produce an installer whose unpacked `resources/server/node_modules/@blackbelt-technology/pi-dashboard-server/src/cli.ts` exists and is a regular file (not a symlink, not a junction)

#### Scenario: Unpacked CI artifact launches the dashboard
- **WHEN** a CI artifact is downloaded from the Actions run page, unzipped on the matching OS, and the Electron .exe / .app / .AppImage / .deb is launched
- **THEN** the BundledServerMissingError dialog SHALL NOT appear, and the dashboard SHALL reach `/api/health` 200 within 30 s of the user clicking "Launch dashboard"

#### Scenario: Workspace cross-refs resolve locally
- **WHEN** `bundle-server.mjs` runs `npm install --omit=dev` in CI dispatch mode
- **THEN** no network request SHALL be made to the npm registry for any package matching `@blackbelt-technology/pi-dashboard-*`, even though the CI version slug `<base>-ci.<...>` is not published

### Requirement: Runnable-bundle assertion gate
After `bundle-server.mjs` completes in the reusable workflow, when `inputs.source_only_bundle == false`, the workflow SHALL execute an assertion step that verifies the runnable-bundle invariant. If the assertion fails, the leg SHALL fail with a precise error message naming the missing path.

The assertion SHALL run identically on Linux, macOS, and Windows runners (Node-native, no shell-script reliance), and SHALL be guarded by `inputs.source_only_bundle == false` so the Docker cross-compile path is not blocked.

#### Scenario: Missing cli.ts fails the leg
- **WHEN** the assertion runs and `resources/server/node_modules/@blackbelt-technology/pi-dashboard-server/src/cli.ts` does not exist
- **THEN** the leg SHALL fail with exit code non-zero and an error message containing the missing absolute path and a reference to the `fix-ci-electron-runnable-bundles` change

#### Scenario: Assertion is platform-agnostic
- **WHEN** the assertion step runs on a Windows runner
- **THEN** it SHALL NOT use `shell: bash` (per `no-bash-on-windows.test.ts` invariant) and SHALL succeed if the path exists, regardless of forward vs. backslash path separators in the workflow YAML

### Requirement: Lint pins the runnable-bundle contract
`packages/shared/src/__tests__/publish-workflow-contract.test.ts` SHALL assert two invariants:
1. `ci-electron.yml` passes `source_only_bundle: false` to the reusable workflow.
2. `_electron-build.yml` contains an assertion step (matched by name regex) guarding the runnable-bundle invariant.

Drift on either invariant SHALL fail the test.

#### Scenario: Test fails if flag is flipped back to true
- **WHEN** a future PR sets `source_only_bundle: true` in `ci-electron.yml`
- **THEN** the lint test SHALL fail in CI before the change can merge

#### Scenario: Test fails if assertion step is removed
- **WHEN** a future PR removes the runnable-bundle assertion step from `_electron-build.yml`
- **THEN** the lint test SHALL fail
