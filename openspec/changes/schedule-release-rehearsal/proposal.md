# Proposal

## Why

Every tag since v0.6.0 needed several `publish.yml` attempts. v0.11.0 needed nine. Each attempt failed for a new reason in a path that only runs at release time: `ci-checks :: Run pnpm test` (4 attempts, mostly wall-clock and memory budget assertions), `generate-runtime-lock` `ETARGET`, the Windows `runtime-asset` leg (`tar -czf` failure, `EXDEV`), the macOS Intel launch smoke, `EALLOWREMOTE`, and npm `E404`. The project already has a rehearsal for this path: `nightly.yml` publishes every workspace to a loopback Verdaccio and builds the 6-leg Electron matrix. But its cron was never enabled. It is commented out at `.github/workflows/nightly.yml:21-24` and the workflow has run 3 times, all on 2026-10-21. The spec `nightly-verification` already says it runs daily. The rehearsal also skips the install-smoke legs of the tag gate, and it publishes with the runner's bundled npm, while the release `publish` job upgrades to `npm@latest` first and then sets the version, generates the runtime lock and publishes each package under it.

## What Changes

- Enable the `nightly.yml` cron at `13 4 * * *` (04:13 UTC). This fixes the drift between code and spec. design.md D1 explains the time. On a bad night (change A's worst case ends 05:35 UTC) the two nightlies run at the same time, and on any night they can test different `develop` SHAs; each report names its SHA.
- Replace the inline `report` job in `nightly.yml` with the existing `scripts/test-selection/nightly-report.mjs`, generalised with four optional flags (`--label`, `--name`, `--jobs-only`, `--no-close-on-rerun`), all off by default. Only a scheduled run writes the issue. Its first attempt, when red, opens or updates the one open `nightly` issue; when green, it comments on that issue and closes it. A red re-run attempt comments on the open issue, naming the failing jobs and legs and linking the run, or opens one, so a night whose first `report` failed can still be made visible; a re-run never closes the issue. A failed issue call is named in the run summary and an error annotation. A manually dispatched run writes its verdict to the run summary only and touches no issue (B7). The report now waits for every job, including `knip`, which the current job leaves out (`nightly.yml:196`). Only the report job gets `issues: write`.
- Make `nightly.yml` `verify-publish` run the rehearsal's copies of the release `publish` job's npm commands under `npm@latest` (B6). It runs `npm install -g npm@latest` first, as `publish.yml:271-272` does, then installs, sets the version, builds, and publishes every workspace one at a time to a loopback Verdaccio, generating and linting the runtime lock before the server, as the release does. The bulk `npm publish --workspaces --dry-run`, which the release no longer runs, goes. A new `npm@latest` that breaks `npm pkg set`, runtime-lock generation or per-package publishing then fails on `develop` first. This does not run `publish.yml`'s own step text; see the residual table. The publish script gets `--allow-remote=all` on its rehearsal-only workspace lock step (design D8). A spike proves this on the current tree first (tasks.md 1.1).
- `verify-publish` no longer gates the `electron` job, so an `npm@latest` failure cannot skip the Electron rehearsal (design D3).
- Add a `smoke` job to `nightly.yml`. It calls `_smoke.yml` with `ref: ${{ github.sha }}`, so the install-smoke legs of the tag gate run every night.
- Remove the `concurrency` group from `nightly.yml`. No dispatch or re-run can then cancel, hold or replace a scheduled run (design D6).
- Tag gate: no workflow edit except one comment. `publish.yml` `ci-checks` keeps `pnpm install`, `lint`, `pnpm test` and `build`. Change `stabilize-blocking-test-lanes` puts the lane switch in the vitest configs: plain `pnpm test` does not collect `*.budget.test.*` files unless `RUN_BUDGET_TESTS=1`, and its blocking `scripts/check-budget-lane.mjs` (in the `ci.yml` `ci` job and inside `npm test`) fails when a run without the variable would collect one. Per that change, only the `test:budget` script in `package.json` sets `RUN_BUDGET_TESTS`, and nothing `npm test`, PR `ci.yml` or `publish.yml` runs sets it. This change adds a contract clause: `publish.yml`, each reusable workflow it calls through a local `uses:` (today `_smoke.yml`, `_electron-build.yml`), and the root `package.json` scripts those jobs run (today `test`, `test:parallel`, `test:real-process`, `lint`, `build`, `postinstall`) never contain `RUN_BUDGET_TESTS` or `test:budget` (B3, design D5). Not enforced by either change: a wall-clock or memory assertion that is not yet in a budget file still runs in the tag gate until `migrate-budget-assertions` lands (design D5 lists every gap).
- Add `nightly.yml` as the third `_smoke.yml` consumer in the `ci-cd-pipeline` requirements that name the consumers, and correct the `_smoke.yml` leg list there to what the workflow defines (pre-existing spec drift).
- Dispatch the finished workflow once from a throwaway branch before merge (verify step of tasks.md 4.5).
- Update the comments, per-file rows, release docs and skills that describe the gate and the nightly (B5).
- The runtime-asset rehearsal (Windows `tar`/`EXDEV`) is not in this change. It moved to `rehearse-runtime-asset-matrix`, which depends on this one and is blocked on a spike.

## Capabilities

### New Capabilities

None. Every behaviour fits `nightly-verification` or `ci-cd-pipeline`.

### Modified Capabilities

- `nightly-verification`: the cron is active and the land-dark rollout is over. `nightly.yml` has no concurrency group. The red-nightly report covers every job, names the failing legs, closes its issue on green only from a scheduled run's first attempt, lets a red re-run open or comment but never close, names a failed issue call, and ignores dispatched runs. The rehearsal also runs the install smoke and the release `publish` job's npm commands under `npm@latest`.
- `ci-cd-pipeline`: the tag-gate `ci-checks` runs the suite without the budget lane, and the release-gate repo-lint pins that `RUN_BUDGET_TESTS` is never set on the release path. `_smoke.yml` gains `nightly.yml` as a third consumer, in "CI workflow on push and PR" and "Reusable standalone-install-smoke workflow", and its leg list is corrected in "Reusable standalone-install-smoke workflow" and "On-demand smoke workflow via workflow_dispatch".

## Residual risk (B4): what a green rehearsal does not prove

A green rehearsal does not prove the next tag will publish. These release failure classes stay uncovered:

| Failure class (seen in a real release) | Covered after this change? | Why not |
|---|---|---|
| `ci-checks :: Run pnpm test` (the most frequent measured failure: 4 attempts, mostly wall-clock and memory budget assertions) | Not by the rehearsal | `nightly.yml` runs no unit suite and no `pnpm run lint`; the tag gate still runs `pnpm test` (B3). What reduces this class is change `stabilize-blocking-test-lanes`: the budget files it creates are not collected by `pnpm test` and run in the `budget` job of `nightly-tests.yml`, and `nightly-tests.yml` runs the full suite on `develop` every night (issue label `nightly-tests`). Still open: budget assertions not yet moved into budget files (until `migrate-budget-assertions`), non-budget flakes, and the untested `tag-and-push` commit (next row). |
| Windows `runtime-asset` `tar`/`EXDEV`, and every other path of the release `runtime-asset` job | No | Not rehearsed. Moved to `rehearse-runtime-asset-matrix`. |
| A defect in `publish.yml`'s own step text. Example: the v0.9.0 `EALLOWREMOTE` in "Set version from resolved tag", caused by `publish.yml`'s own `npm version` call under `npm@latest` | No | The rehearsal runs its own copies of the release commands (`nightly.yml` steps, `nightly-verdaccio-publish.mjs`), never `publish.yml`'s steps. `nightly.yml` never used `npm version`, so it would not have caught that failure. That instance was fixed in commit 60a155465 and is pinned by `publish-version-step-contract.test.ts`. |
| npm `E404` on publish, packages not resolving on the registry, `ETARGET` from propagation lag | No | Verdaccio makes a version visible at once. Public-registry visibility and lag cannot be reproduced on loopback. |
| OIDC token exchange, `--provenance`, `--access public`, `403`/`409` on publish, and any `npm@latest` behaviour that appears only on an authenticated upload to the real registry | No | Needs `id-token: write` and the real registry. The rehearsal must never hold either. `verify-publish` uploads to loopback with a fake token and `--no-provenance`. |
| An `npm@latest` refusal that `--allow-remote=all` suppresses | No | The rehearsal's workspace lock step and `generate-runtime-lock.mjs` pass that flag. |
| `assert-bundled-plugins-published.mjs` and the per-package `npm view` idempotency check of the release publish loop | No | The rehearsal publish script does not run them (`nightly-verdaccio-publish.mjs:211-233`). |
| `npm@latest` drift on macOS or Windows runners | No | Only `verify-publish` (ubuntu, the release `publish` job's runner) uses `npm@latest`. The Verdaccio publishes inside the `electron` legs use the runner's npm; the release `electron` job does not publish. |
| `tag-and-push` (commit, tag, push) | No | Forbidden by the safety contract (`nightly-workflow-contract.test.ts:71-89`). |
| `github-release` (notes extraction, `latest-mac.yml` merge, asset upload) | No | Creating a release is forbidden. |
| `runtime-release-assert`, `site-redeploy`, `discord-announce` | No | They act on a published release. |
| Deterministic test failure on the tagged commit | No | `tag-and-push` creates a new commit that was never tested (`publish.yml:224-227`). `nightly-tests.yml` tests `develop` HEAD as of its 03:00 UTC run and the rehearsal builds `develop` HEAD as of its 04:13 UTC run, which can be a different commit (design D1); neither runs on that commit. |
| macOS signing and notarisation (once `macos-notarization` lands) | No | `nightly.yml` passes no signing secrets to `_electron-build.yml` (`nightly.yml:178-192`), so the macOS legs take the unsigned path. |
| Release-only jobs proposed by active changes (`server-launch-smoke`, `mobile-android`, Authenticode signing) | No | Non-goal here. See Impact. |

Newly covered:
- A new `npm@latest` that breaks `npm pkg set`, runtime-lock generation and lint, or per-package publishing (`verify-publish` under `npm@latest`, to loopback). This is preventive: no measured release failure is known that it would have caught.
- The install-smoke legs (`smoke` job).
- The macOS Intel launch smoke and runtime-lock generation for a first-party package that is missing from the publish set. Both already exist in the `electron` legs (`nightly-verdaccio-publish.mjs:229`). They only start running nightly because the cron is enabled.

## Non-Goals

- No runtime-asset rehearsal. That is `rehearse-runtime-asset-matrix`.
- No schedule on `ci-electron.yml`. It is pinned dispatch-only by `ci-electron-no-side-effects.test.ts:102-112` and `ci-electron-on-demand-build/spec.md:10`.
- No schedule on `ci-smoke.yml`. The nightly calls `_smoke.yml` directly.
- No job reruns in `nightly.yml`. Change A's rerun policy covers `nightly-tests.yml` only (A3).
- No new reporting mechanism or trend store. The existing reporter is reused.
- No change to the `publish.yml` jobs, `needs` graph, success conditions or steps (one comment line changes).
- No edit to `_electron-build.yml`; a header-comment edit only to `_smoke.yml`.
- No "green-on-SHA" pre-tag gate, because the tagged commit is always new.
- No public npm write, tag push or GitHub Release from any rehearsal job.
- No detection of a scheduled run that GitHub drops or delays (design trade-off T-B4).
- No `npm@latest` in the `electron` legs.

## Discipline Skills

- `doubt-driven-review`: a scheduled job starts writing and closing issues, and the tag-gate contract gains a clause. Both are policy changes on the release path.
- `observability-instrumentation`: a new scheduled run plus a generalised report that must name failing legs and close on green.
- `security-hardening`: job-level `issues: write`, keeping the zero-public-write contract for a new job, a `verify-publish` that now uploads to loopback, and one newly called reusable workflow; possible new CodeQL `actions/*` alerts (task 4.5).

## Impact

- Workflows: `.github/workflows/nightly.yml` (cron, concurrency removed, `verify-publish` npm upgrade and loopback publish, `electron` no longer waits for `verify-publish`, `smoke`, `report`). Comment-only edits: `_smoke.yml` header, `publish.yml:90-93`, `nightly-tests.yml:10`, `ci-e2e-browser.yml:32`.
- Scripts: `scripts/test-selection/nightly-report.mjs` (four optional flags; `nightly-tests.yml` output unchanged when they are omitted); `scripts/nightly-verdaccio-publish.mjs` (`--allow-remote=all` on the workspace lock step, which also changes the `electron` legs' publish; header comment).
- Comment-only edits in tests: `packages/shared/src/__tests__/nightly-tests-workflow-contract.test.ts:10` and `packages/shared/src/__tests__/e2e-browser-workflow-contract.test.ts:89-90` (task 3.5).
- Contract tests that gain new assertions from the scenario fold (design.md "Pins for the scenario manifest"): `nightly-workflow-contract.test.ts`, `publish-workflow-contract.test.ts`, `scripts/__tests__/nightly-report.test.mjs`. Header comments and sidecar `*.AGENTS.md` files of the first two are updated by tasks (4.4; 3.8, which also adds the missing `publish-workflow-contract.test.ts` row to `packages/shared/src/AGENTS.md` and its new sidecar, and updates `.github/workflows/publish.yml.AGENTS.md`).
- Possibly `codeql-baseline.json` (task 4.5).
- Docs and skills: `docs/release-process.md`, `docs/ci.md`, `docs/pipeline-map/5-ci.mmd` and `.png`, `docs/security/deployment-process-supply-chain.md` (DocScribe), `CONTRIBUTING.md`, `.pi/skills/release-cut/SKILL.md`, `.pi/skills/ci-troubleshoot/SKILL.md`, `.pi/skills/ci-troubleshoot/references/release-pipeline.md`, `.pi/skills/ci-troubleshoot/references/workflow-taxonomy.md`, `.github/workflows/AGENTS.md`, `scripts/test-selection/AGENTS.md`, `scripts/nightly-verdaccio-publish.mjs.AGENTS.md`.
- CI cost per night (`unverified` until the spike and the pre-merge dispatch measure it): `smoke` about 45-50 runner-minutes (4 Linux jobs at 5-6 min, Windows 24 min); the `verify-publish` loopback publish adds about 4-9 min, now off the `electron` critical path. No macOS job is added; the existing 2 macOS electron legs start running nightly. The repo is public.
- Ship order and overlaps with active changes:
  - `stabilize-blocking-test-lanes` (A) ships first, declared in `dependencies.yaml`. It defines the budget lane (`RUN_BUDGET_TESTS`, `*.budget.test.*`) and rewrites `main`, `summarizeReports` and `buildIssueBody` in `nightly-report.mjs` (attempt logic, `--watchdog`). This change adds its four flags onto A's version (A's design section "Reporter interface (consumed by schedule-release-rehearsal)"; this design's "Reporter interface (on top of stabilize-blocking-test-lanes)"), with or without A's rerun task group. Both changes edit the `nightly-report.mjs` row in `scripts/test-selection/AGENTS.md`, the report section of `docs/ci.md`, `.github/workflows/AGENTS.md`, `.pi/skills/ci-troubleshoot/references/workflow-taxonomy.md`, `.pi/skills/ci-troubleshoot/SKILL.md` (this change: the Mermaid graph; A: the nightly triage text), `nightly-tests.yml` (this change: one comment line) and `packages/shared/src/__tests__/nightly-tests-workflow-contract.test.ts` (this change: one comment line at `:10`).
  - The rule "the publish tag gate does not set `RUN_BUDGET_TESTS`" is stated twice: by A in `parallel-test-execution` ("Budget test files run only in the nightly budget lane") and here in `ci-cd-pipeline` ("Release-gate runs lint+test+build and smoke before publish", clause 6 of "Repo-lint pins the release-gate contract"). The texts agree. This change owns the tag-gate pin; a later edit to either must keep them in step.
  - `rehearse-runtime-asset-matrix` depends on this change and adds the runtime-asset job later.
  - `migrate-budget-assertions` (depends on A) closes the largest gap of the tag-gate pin: it moves the remaining wall-clock and memory assertions into budget files and makes A's guard blocking (design D5, T-B15). No file overlap.
  - `update-pi-core-1-6-adopt-apis` edits `docs/security/deployment-process-supply-chain.md:137-138` (its task 5.1), the file task 5.4 edits at `:123` and `:254`. Text-only merge conflict at most.
  - `enforce-strict-csp-default` edits `.github/workflows/ci-e2e-browser.yml` and `packages/shared/src/__tests__/e2e-browser-workflow-contract.test.ts` (its task 3.9), where task 3.5 changes one comment each. Text-only merge conflict at most.
  - `macos-notarization` edits the macOS legs of `_electron-build.yml`, which the cron now runs every night without signing secrets. Its secret-presence gate must keep the unsigned path green for `nightly.yml`.
  - `fix-npm12-remote-tarball-install` owns the root cause of the `xlsx` `EALLOWREMOTE` and adds an npm 12 install gate to the release workflow. This change only makes the rehearsal run under the same npm as the release, and adds `--allow-remote=all` to the rehearsal-only workspace lock step of `nightly-verdaccio-publish.mjs`; once the remote tarball is gone, that flag can be removed. Whichever lands second updates the residual table in `docs/release-process.md`.
  - `add-release-video-pipeline` adds one line to `.pi/skills/release-cut/SKILL.md`, which task 5.3 also edits.
  - `server-launch-smoke-suite`, `windows-authenticode-signing` and `add-android-server-host` add release-only work to `publish.yml`. None edits `ci-checks`. Rehearsing their jobs is a later follow-up. `server-launch-smoke` is the best candidate: it does not depend on a published release.
