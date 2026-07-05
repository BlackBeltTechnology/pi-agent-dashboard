# Design — Run the Playwright-Electron native-surface E2E suite on CI

## Context

The infrastructure exists; the gap is operational. GitHub's `workflow_dispatch` API resolves the workflow file **on the repository default branch**, so a workflow that only exists on a feature branch is undispatchable (HTTP 404). Landing `ci-e2e-electron.yml` on `develop` is the precondition for ever running the native-surface suite in CI. This design records the harness shape (so the validation/stabilization work has a fixed reference) and the cadence trade-off.

## Why real-app launch (and its ceiling)

The four behaviours cannot be reached by cheaper layers:

| Surface | Why unit/CDP can't reach it | How the suite reaches it |
|---|---|---|
| Zombie modal | native `dialog.showMessageBox` (OS-modal, not DOM) | stub `dialog.showMessageBox` in main via `electronApp.evaluate`; assert it was called with the zombie PID + each choice's outcome |
| Doctor version-skew row | Electron-only DOM window | launch attached to a version-mismatched `FakeHealthServer`; click loading-page `#doctor-btn`; assert the WARN row + suggestion in the doctor window DOM |
| Tray "managed externally" row | native OS context menu (no read-back API) | monkeypatch `Menu.buildFromTemplate` in main; assert the built template has the disabled row and no "Restart server" |
| Job Object kill-on-close | needs a real spawned server + forced parent kill | spawn-mode launch (no fake attach); `taskkill /F` the parent; assert the server pid dies + `:8000` frees |

**Ceiling (documented, not a defect):** native automation cannot *click* an OS modal or *read back* a tray menu. The suite proves the flow **reaches** the native surface with correct arguments and that each returned choice drives the right outcome — the maximum any harness can do without a human.

## Determinism levers (where flakiness will surface)

- **Stub-install vs attach-arm race.** `maybePromptZombieAdoption` fetches `/api/health` shortly after the window opens. The stub must be installed first. The `FakeHealthServer` adds a health-response delay (~400 ms; 1200 ms for the tray spec) to guarantee ordering. If CI shows the modal firing before the stub lands, widen the delay — do not add production test seams.
- **`:8000` contention.** The Doctor version fetcher hard-codes `:8000`, so specs pin that port and `isPortInUse`-skip locally. CI runners are clean; if a leftover process lingers, add an explicit pre-step port check.
- **Boot timing.** `_electron.launch` against a freshly `electron-forge package`-d binary + xvfb readiness on Linux. Generous `timeout: 90_000`; bump if the packaged boot is slower on the runner.
- **Job Object on the runner.** GitHub's windows-latest (Server 2022) supports nested job objects; the smoke distinguishes `INFRA` (server never booted — execpath-fallback issue) from `FAIL` (server survived the parent kill — invariant broke) so a runner-setup problem is never misread as a regression.

## Cadence — trade-off

| Option | Pro | Con |
|---|---|---|
| `workflow_dispatch`-only (current) | zero PR-hot-path cost; run on demand | easy to forget; regressions land silently |
| `pull_request` path-filter (`packages/electron/**`, `tests/e2e-electron/**`) | catches electron regressions at PR time | ~15–25 min Windows leg on every electron PR |
| nightly `schedule` | bounded daily cost; catches drift | up to 24 h to surface a regression |

Recommendation, pending a few green runs: **path-filtered `pull_request`** so only electron-touching PRs pay the cost, kept **advisory** (not a required check) until stability is demonstrated. The decision is wired in this change and recorded in the spec + `docs`.

## Open questions

- Should the Job-Object smoke run the **full** electron build (bundled Node) instead of `electron-forge package` (execpath-fallback), to boot the server the way end users do? The fallback is functionally sufficient for the cascade test; the full build is heavier. Deferred unless the fallback proves unreliable on the runner.
