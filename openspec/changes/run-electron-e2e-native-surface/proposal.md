# Run the Playwright-Electron native-surface E2E suite on CI

## Why

`electron-attach-ownership-fixes` added four behaviours whose only faithful verification is launching the **real packaged Electron app** — they live on native surfaces (or in the real main process) that unit tests, the web-client Docker E2E, and CDP cannot reach:

1. **Zombie-adoption modal** — native `dialog.showMessageBox`.
2. **Doctor version-skew row** — DOM in the Electron doctor window.
3. **Tray "Server managed externally" row** — native OS context menu.
4. **Job Object kill-on-close (Windows)** — `spawnDetached({ detach: false })` + `taskkill /F` cascade.

That change **built** the verification infrastructure: a Playwright-`_electron` harness (`tests/e2e-electron/`), three specs, a Windows Job-Object smoke script, and the `ci-e2e-electron.yml` matrix workflow (ubuntu under xvfb + windows-latest). But GitHub only allows `workflow_dispatch` for workflows **present on the default branch** — while the workflow lived only on the feature branch it returned HTTP 404 on dispatch, so the suite never ran on CI. The koffi Tier-2 Windows smoke and the Windows checkout were separately blocked (fixed in `_smoke.yml` and by removing a colon-named path) and are now green.

This change closes the loop: land the suite on `develop`, dispatch it, confirm every native-surface flow passes on both OS legs, stabilize any flakiness the real-app launch surfaces, and decide the run cadence.

## What Changes

### Already delivered (in `electron-attach-ownership-fixes`)

- `tests/e2e-electron/electron-lifecycle.ts` — packaged-app launch, `FakeHealthServer`, throwaway-HOME config, native `dialog`/`Menu` stubbing via `electronApp.evaluate`, per-OS binary resolver, `isPortInUse` local-safety guard.
- Specs: `zombie-adoption.electron.spec.ts`, `doctor-version-skew.electron.spec.ts`, `tray-ownership.electron.spec.ts`.
- `scripts/windows-job-object-smoke.ts` — spawn-mode `taskkill /F` cascade check.
- `ci-e2e-electron.yml` — matrix `os: [ubuntu-latest, windows-latest]` + a `job-object-windows` job.
- `playwright.electron.config.ts` + `npm run test:e2e:electron`.

### This change

- **Validate on CI:** with the workflow on `develop`, dispatch `ci-e2e-electron.yml` and confirm the five specs pass on ubuntu (xvfb) + windows-latest, and the Job-Object smoke passes on windows.
- **Stabilize:** triage and fix any flakiness the real-app launch surfaces — the dialog/Menu stub-install-vs-attach-arm race (widen the fake-health delay), `:8000` contention, packaged-binary boot timing, xvfb readiness.
- **Cadence decision:** keep `workflow_dispatch`-only, OR add an automatic trigger — a `pull_request` path-filter on `packages/electron/**` + `tests/e2e-electron/**`, or a nightly `schedule`. Document the choice and wire it.

## Capabilities

### Modified Capabilities

- `electron-qa-coverage` — adds a requirement that the native-surface Electron flows are covered by a CI-run Playwright-`_electron` suite across ubuntu + windows.

## Impact

- **Scope:** CI/QA only. No runtime, protocol, or user-facing change. The infrastructure already ships; this change is validation + stabilization + a cadence wiring decision (≤ ~30 LOC of workflow/timing tweaks expected).
- **Cost:** Windows Electron packaging + launch is slow (~15–25 min/run). `workflow_dispatch`-only keeps it off the PR hot path; an opt-in path-filter or nightly trigger bounds the spend if promoted.
- **Risk:** low. Advisory suite; a red run blocks nothing until/unless promoted to a required check. The native-surface stubs (dialog/Menu) can only assert the flow reaches them + each choice's outcome — the pixel-modal itself remains inherently manual.
- **Out of scope:** promoting the suite to a **required** merge gate (revisit once green-stability is demonstrated over several runs); macOS Electron E2E leg (the flows are OS-portable; ubuntu+windows cover the platform branches).

## Discipline Skills

- `systematic-debugging` — triage real-app-launch flakiness (stub/attach-arm race, port contention, boot timing) from evidence rather than guessing.
- `doubt-driven-review` — before wiring an automatic trigger (cadence decision), stress-test the CI-minutes cost vs signal.
