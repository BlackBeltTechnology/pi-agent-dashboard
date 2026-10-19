# Proposal

## Why

The `job-object-windows` job in `ci-e2e-electron.yml` has never passed. Its job-level conclusion (`gh run list --workflow ci-e2e-electron.yml --limit 300 --json databaseId`, then `gh run view <id> --json jobs -q '.jobs[]|select(.name=="job-object-windows")|.conclusion'` for each id) was checked across all 208 workflow runs since it landed (job added in `fb85925f8`, 2026-07-04; first run 2026-07-05): 201 failures, 7 cancelled, 0 successes. It is red on `develop` and on every Electron-touching PR. It can't pass as written. It packages the app with `electron-forge package` but never runs `bundle-server.mjs`, so `resources/server` is never shipped. The packaged app's `selectLaunchSource()` then hits `BundledServerMissingError` (`packages/electron/src/lib/launch-source.ts:98`, thrown at `:376` when no source resolves), and every run ends with `INFRA: app never brought a server up on :8000`. Because the job is `continue-on-error`, the run still concludes `success`. The result is a red check that is always on and that everyone has learned to ignore. The decision is to remove the job, not repair it.

## What Changes

- Remove the `job-object-windows` job from `.github/workflows/ci-e2e-electron.yml`, along with its header-table column, its `continue-on-error` note, and its orphaned comment block above the `runtime-overlay-e2e` comment.
- Delete `scripts/windows-job-object-smoke.ts` and its sidecar `scripts/windows-job-object-smoke.ts.AGENTS.md`.
- Update `packages/shared/src/__tests__/e2e-electron-workflow-contract.test.ts`. It currently requires the job to exist, to be skipped on `schedule`, and to carry `continue-on-error`. After this change it must require that no job in the workflow carries `continue-on-error`.
- Correct the docs that claim the cascade is validated elsewhere: `docs/faq.md`, `docs/pipeline-map/5-ci.mmd`, `CONTRIBUTING.md`, and the `scripts/AGENTS.md` and `.github/workflows/AGENTS.md` rows. No qa VM test exercises the cascade. `qa/tests/08-electron-real-launch.sh` is Linux-only. `qa/tests/07-electron-bootstrap-v2.ps1` launches Electron on the Windows VM but only asserts the starter and health; it never force-kills the parent (no `taskkill`).
- **Coverage gap, accepted on purpose:** no automated test observes Windows `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` actually killing the server after a forced Electron kill. Two things remain. The precondition (server spawned with `detach: false`) stays pinned by `packages/electron/src/__tests__/server-lifecycle-spawn-options.test.ts`. Zombie detection and the adoption modal stay covered by `decideIsZombie` unit tests and `tests/e2e-electron/zombie-adoption.electron.spec.ts`, which drives a fake `/api/health`. No test asserts that a spawned server dies after a forced parent kill on Windows. Some `tests/e2e-electron/` specs SIGKILL the app in teardown, but they attach to a fake server and assert nothing about a child. The gap is stated in three durable places: one sentence in the `electron-qa-coverage` requirement itself, a `COVERAGE GAP` note in the `ci-e2e-electron.yml` header (next to the existing #531 note; task 2.1), and the FAQ (task 3.1). That way the `detach: false` unit pin is not mistaken for cascade coverage.
- Out of scope: `scripts/windows-liveness-smoke.ts`, archived changes, and `Prompt stories/**`, which are history.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `electron-qa-coverage`: the "Native-surface Electron flows are covered by a CI Playwright-`_electron` suite" requirement drops Windows Job Object kill-on-close from its covered behaviours, states explicitly that nothing automated covers it, and removes the "Windows Job Object cascades a forced parent kill" scenario. The schedule-gate wording stops naming `job-object-windows`. The whole MODIFIED requirement block is also applied to `openspec/specs/electron-qa-coverage/spec.md` directly in this change, because `openspec validate --strict` refuses a MODIFIED delta that omits a current scenario. The main spec therefore stops claiming the coverage in the same PR, and the archive sync becomes a no-op for this block.

## Impact

- CI: the always-red advisory Windows job disappears from Electron PRs, saving one `windows-latest` runner per run (install + Node download + package).
- Tests: the workflow contract test changes shape. `npm test` stays green.
- Specs: the main `electron-qa-coverage` spec is edited in the planning commit, before the job is deleted in the worktree. For that window it omits an advisory job that has never passed. This is accepted: it claims nothing false, it only under-describes.
- Runtime behaviour: unchanged. The server is still spawned with `detach: false`, so the Job Object cascade still happens in production. It just isn't observed in CI.

## Discipline Skills

No implementation task triggers a discipline skill. The tasks add no auth, untrusted input, latency path, endpoint, or irreversible public-API step. The one decision of that shape, removing the cascade's only (never-functional) automated observer, was stress-tested by `doubt-driven-review` during planning. That review ran single-model plus cross-model on `@propose-review-1`, and its accepted gap is recorded above.
