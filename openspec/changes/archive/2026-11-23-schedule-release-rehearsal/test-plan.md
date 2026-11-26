# Test Plan — schedule-release-rehearsal

Stage: design   Generated: 2026-11-22

Abbreviations: **NV** = `specs/nightly-verification/spec.md`, **CP** = `specs/ci-cd-pipeline/spec.md`.
Fixture conventions for the L1 reporter rows (`scripts/__tests__/nightly-report.test.mjs`): `sha=abc1234`,
`runUrl=https://github.com/o/r/actions/runs/42`, a fake GitHub API that records every call (`listOpen`, `create`,
`update`, `comment`, `close`, `jobs`, `runs`), the four new flags written as
`JO` = `--jobs-only --no-close-on-rerun --label nightly --name "Nightly Verdaccio build"`, and
`N` = "Nightly Verdaccio build". "Writes" means `create`/`update`/`comment`/`close`.
Level `L1` = vitest; `ci` = workflow-level command; `—` = manual-only (a live GitHub run, no harness fakes it).

---

## Scenarios

### Edge-case

#### Reporter: defaults and mode selection (D2, "Reporter interface")

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | D2 "with none of them, every output … stays" | regression / EP (no-new-flag class) | L1 | automated | `--reports <tmp> --expected unit-1,unit-2`; `vitest-report-unit-2` has 1 failing file; `NEEDS_JSON` all `success`; event `schedule`, attempt 1; no open issue | run the reporter without any of the 4 new flags | step summary starts `## Nightly tests: RED`; headline `Nightly full suite is red at \`abc1234\`.`; one `create` with title `Nightly full test suite is failing` and labels `["nightly-tests"]`; `<tmp>/timings.json` exists; exit 1 |
| E2 | D2 "read only in jobs-only mode" | decision table (flag × mode) | L1 | automated | E1 input plus `--label nightly --name X --no-close-on-rerun`, `GITHUB_RUN_ATTEMPT=2`, one open `nightly-tests` issue #7 | run in A's report mode | same calls as attempt 1 today: `update(7)` + `comment(7, "Still red at \`abc1234\`.")`; issue list queried with label `nightly-tests`; no string `X`, no `Re-run attempt` text anywhere; exit 1 |
| E3 | D2 "`--jobs-only` … before A's mode selection" | decision table | L1 | automated | `JO --watchdog --reports /tmp/r --expected a`; `NEEDS_JSON` all `success`; event `workflow_dispatch` | run the reporter | `/tmp/r` not created, no `timings.json`; `runs()` (bisect anchor) never called; no watchdog query; no `usage:` line; summary `## Nightly Verdaccio build: green`; exit 0 |
| E4 | D2 "jobs-only mode needs neither flag" | EP (required-flag class) | L1 | automated | `JO` only (no `--reports`, no `--expected`); `NEEDS_JSON` all `success`; event `schedule`, attempt 1; no open issue | run the reporter | no `usage:` line; `listOpen` called with label `nightly`; zero writes; exit 0 |
| E5 | D2 `--name` mapping; NV "Failure opens a tracking issue" | EP | L1 | automated | `JO`; `NEEDS_JSON` `electron: failure`, rest `success`; jobs API returns `electron / build (macos-14)` `failure`; event `schedule`, attempt 1; no open issue | run the reporter | summary heading `## Nightly Verdaccio build: RED`; one `create`, title `Nightly Verdaccio build is failing`, labels `["nightly"]`, body has headline `Nightly Verdaccio build is red at \`abc1234\`.`, the run URL and `electron / build (macos-14)` under `### Failed jobs and legs`; exit 1 |
| E6 | NV "Recovery closes the issue" | state-transition (open → closed) | L1 | automated | `JO`; `NEEDS_JSON` all `success`; event `schedule`, `GITHUB_RUN_ATTEMPT=1`; open `nightly` issue #7 | run the reporter | exactly `comment(7, "Nightly Verdaccio build is green again at \`abc1234\`. Closing.")` then `close(7)`; summary `## Nightly Verdaccio build: green`; exit 0 |
| E7 | NV "Repeat failure updates, not duplicates" | state-transition (open → open) | L1 | automated | `JO`; `NEEDS_JSON` `knip: failure`; event `schedule`, attempt 1; open `nightly` issue #7 | run the reporter | `update(7, body)` where body names `knip` and the run URL; then one `comment(7, …)`; no `create`; exit 1. Comment content: exactly `Still red at \`abc1234\`.`: the updated body carries the failing jobs, legs and run URL, so the write as a whole names them (decision G2) |

#### Reporter: event × attempt × verdict × open issue (D2, NV "A red nightly SHALL be visible…")

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E8 | NV "A red re-run comments and keeps the body" | decision table (schedule, attempt 2, red, open) | L1 | automated | `JO`; `GITHUB_RUN_ATTEMPT=2`; `NEEDS_JSON` `electron: failure`; jobs API lists `electron / build (windows-latest)` `failure`; open issue #7 | run the reporter | exactly one write: `comment(7, …)` starting `Re-run attempt 2 of https://github.com/o/r/actions/runs/42 is red at \`abc1234\`.` followed by `### Failed jobs and legs` with `electron / build (windows-latest)`; no `update`, no `close`, no `create`; exit 1 |
| E9 | NV "A red re-run makes a red night visible" | decision table (schedule, attempt 2, red, none open) | L1 | automated | E8 input but `listOpen` returns `[]` | run the reporter | one `create`, title `Nightly Verdaccio build is failing`, label `nightly`, full body naming `electron` and the leg and the run URL; exit 1 |
| E10 | NV "A re-run never closes the issue" | decision table (schedule, attempt 2, green, open) | L1 | automated | `JO`; `GITHUB_RUN_ATTEMPT=2`; `NEEDS_JSON` all `success`; open issue #7 | run the reporter | zero issue API calls (D2: "a green verdict makes no issue call"); summary has `## Nightly Verdaccio build: green` and `Re-run attempt 2: a re-run never closes the \`nightly\` issue; the next green scheduled night does.`; exit 0 |
| E11 | NV "A re-run never closes the issue" (no first-attempt record) | decision table (schedule, attempt 2, green, none open) | L1 | automated | E10 input, `listOpen` would return `[]`; no `--previous` dir, no `attempt-1.json` anywhere | run the reporter | zero issue API calls; same summary line as E10; no file read outside the repo; exit 0 |
| E12 | D2 "greater than 1" | BVA (attempt 3) | L1 | automated | `JO`; `GITHUB_RUN_ATTEMPT=3`; red; open issue #7 | run the reporter | one `comment(7, …)` starting `Re-run attempt 3 of`; no `update`/`close`; exit 1 |
| E13 | NV "Dispatch runs never touch the issue" (red) | decision table (dispatch, red) | L1 | automated | `JO`; event `workflow_dispatch`, attempt 1; `NEEDS_JSON` `smoke: failure`; open issue #7 | run the reporter | zero issue API calls; summary `## Nightly Verdaccio build: RED` naming `smoke`; exit 1 |
| E14 | NV "Dispatch runs never touch the issue" (green) | decision table (dispatch, green) | L1 | automated | `JO`; event `workflow_dispatch`, attempt 1; all `success`; open issue #7 | run the reporter | zero issue API calls (no comment, no close); summary `## Nightly Verdaccio build: green`; exit 0 |
| E15 | D2 "applied after the … `schedule` gate" | decision table (dispatch, attempt 2) | L1 | automated | `JO`; event `workflow_dispatch`, `GITHUB_RUN_ATTEMPT=2`; red; no open issue | run the reporter | zero issue API calls; no `Re-run attempt` text in summary; exit 1 |
| E16 | D2 flag table (`--no-close-on-rerun` default off); D8 attempt-probe fallback | decision table (flag absent) | L1 | automated | `--jobs-only --label nightly --name "Nightly Verdaccio build"` (no `--no-close-on-rerun`); event `schedule`, `GITHUB_RUN_ATTEMPT=2`; all `success`; open issue #7 | run the reporter | attempt-1 behaviour: `comment(7, "Nightly Verdaccio build is green again at \`abc1234\`. Closing.")` then `close(7)`; exit 0 |

#### Reporter: job results (`NEEDS_JSON`) and job list (D2, NV)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E17 | NV "Missing job results are red" | EP (unset / empty) | L1 | automated | `JO`; `NEEDS_JSON` unset, then `""`; event `schedule`, attempt 1; no open issue | run the reporter (once per value) | report contains `job results unavailable`; verdict RED; one `create` with label `nightly`; exit 1 |
| E18 | NV "Missing job results are red" | EP (invalid JSON) | L1 | automated | `JO`; `NEEDS_JSON='{not json'`; schedule, attempt 1; open issue #7 | run the reporter | no uncaught exception; `job results unavailable`; `update(7)` + one comment; summary RED; exit 1 |
| E19 | NV "Missing job results are red"; D2 "an object with no entries" | EP (empty object) | L1 | automated | `JO`; `NEEDS_JSON='{}'`; schedule, attempt 1; no open issue | run the reporter | `job results unavailable`; RED; one `create`; exit 1 (today's `JSON.parse(… \|\| "{}")` would yield green) |
| E20 | NV "SHALL NOT report green … missing or unreadable" | EP (valid JSON, not a results object) | L1 | automated | `JO`; `NEEDS_JSON='null'`, then `'[]'`; schedule, attempt 1 | run the reporter (once per value) | verdict RED with `job results unavailable`; never `## Nightly Verdaccio build: green`; exit 1 |
| E21 | NV "Skipped job is red" | EP (skipped class) | L1 | automated | `JO`; `NEEDS_JSON` `resolve: failure`, `verify-publish: skipped`, `electron: skipped`, `knip`/`install-load`/`smoke: success`; schedule, attempt 1 | run the reporter | RED; body lists `resolve: failure`, `verify-publish: skipped`, `electron: skipped`; exit 1 |
| E22 | NV "Any failing job is reported" | EP (non-electron job) | L1 | automated | `JO`; `NEEDS_JSON` only `knip: failure`; jobs API lists `knip` `failure`; schedule, attempt 1; no open issue | run the reporter | one `create`; body names `knip` in both the results list and `### Failed jobs and legs`; exit 1 |
| E23 | D2 "conclusion is `failure`, `cancelled` or `timed_out`" | EP (conclusion classes) | L1 | automated | jobs API returns 7 jobs with conclusions `failure`, `cancelled`, `timed_out`, `success`, `skipped`, `neutral`, `null` (the in-progress `report`); full names like `smoke / standalone-install-smoke-windows (node 26)` | run with `JO`, red `NEEDS_JSON` | `### Failed jobs and legs` lists exactly the 3 jobs with `failure`/`cancelled`/`timed_out`, by full name; none of the other 4 |
| E24 | D2 "paginated" | BVA (100 / 101 jobs) | L1 | automated | page 1: 100 `success` jobs with `Link: <…&page=2>; rel="next"`; page 2: 1 job `electron / build (windows-latest)` `failure` | run with `JO`, `NEEDS_JSON` `electron: failure` | fake API records 2 jobs requests with `per_page=100`; the page-2 leg is listed under `### Failed jobs and legs` |
| E25 | D2 "paginated" | BVA (exactly 100, no next link) | L1 | automated | 100 jobs, no `Link` header, one of them `failure` | run with `JO` | exactly 1 jobs request; the failed job listed |
| E26 | NV "Only a scheduled run…"; T-B1 adoption | EP (two open `nightly` issues) | L1 | automated | `listOpen` returns `[#3 (human-filed), #9]`; `JO`; schedule, attempt 1; red | run the reporter | `update(3)` + `comment(3)`; no call names #9; no `create` |
| E27 | NV "single tracking issue labelled `nightly`" | EP (other label) | L1 | automated | an open issue labelled `nightly-tests` only; `JO`; schedule, attempt 1; red | run the reporter | issue list request URL contains `labels=nightly&` (not `nightly-tests`); returns `[]`; one `create` with labels `["nightly"]`; no call names the `nightly-tests` issue |
| E28 | NV single tracking issue | EP (pull request with the label) | L1 | automated | issues API returns one item labelled `nightly` that has a `pull_request` field, no real issue; `JO`; schedule, attempt 1; red | run the reporter | the PR gets no `update`/`comment`; one `create` |

#### Workflow contract: `nightly.yml` (host `packages/shared/src/__tests__/nightly-workflow-contract.test.ts`, mutated in-memory copies as in `publish-workflow-contract.test.ts:877`)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E29 | NV "Cron is active" | BVA (commented) | L1 | automated | `nightly.yml` with `on.schedule` commented out (`# schedule:` / `#   - cron: '13 4 * * *'`) | run the contract test | the cron assertion fails |
| E30 | NV "Cron is active" ("fires once a day") | BVA (weekly) | L1 | automated | `cron: '13 4 * * 1'` | run the contract test | the cron assertion fails |
| E31 | NV "Cron is active" ("one … entry … once a day") | BVA (twice a day) | L1 | automated | `cron: '13 4,16 * * *'`; separately, two entries `'13 4 * * *'` and `'13 16 * * *'` | run the contract test (once per mutation) | the cron assertion fails for both |
| E32 | D1 "the time is a design choice, not a spec rule" | EP (other daily time) | L1 | automated | `cron: '0 7 * * *'` | run the contract test | the cron assertion passes |
| E33 | NV "No run can cancel…" (`concurrency:` outside comments) | EP (job level) | L1 | automated | `concurrency: { group: x }` added under the `electron:` job | run the contract test | fails naming `concurrency` |
| E34 | NV "No run can cancel…" | EP (workflow level) | L1 | automated | today's `concurrency: { group: nightly, cancel-in-progress: true }` restored at top level | run the contract test | fails |
| E35 | NV "outside comments"; task 4.2 | EP (comment) | L1 | automated | the task-4.2 comment block in place of the old group, plus a line `#   concurrency: none here` | run the contract test | passes |
| E36 | D6 / T-B17 "the called workflows are not checked" | EP (callee) | L1 | automated | `_smoke.yml` gains a job-level `concurrency: { group: s }` | run the nightly contract test | the no-concurrency assertion passes (it scans `nightly.yml` only) |
| E37 | NV "Report waits for every job" | EP (job dropped) | L1 | automated | `report.needs` without `knip` (today's defect, `nightly.yml:196`) | run the contract test | fails naming `knip` |
| E38 | NV "Report waits for every job" | EP (job added) | L1 | automated | a new job `foo:` added, `report.needs` unchanged | run the contract test | fails naming `foo` |
| E39 | NV "its `if:` SHALL be `always()`" | EP | L1 | automated | `report.if: failure()` | run the contract test | fails |
| E40 | NV "Only the report job can write issues" | EP (other job) | L1 | automated | `verify-publish` gains `permissions: { contents: read, issues: write }` | run the contract test | fails naming `verify-publish` |
| E41 | NV "top-level permissions SHALL be `contents: read`" | EP (top level) | L1 | automated | top-level `permissions: { contents: read, issues: write }` | run the contract test | fails |
| E42 | NV "The report uses the shared reporter" | EP (flag missing) | L1 | automated | report run step without `--no-close-on-rerun` | run the contract test | fails naming `--no-close-on-rerun` |
| E43 | NV "exactly the flags"; D7 "none of A's flags" | EP (extra flag) | L1 | automated | report run step with `--watchdog` appended | run the contract test | fails |
| E44 | NV "exactly the flags" | EP (wrong value) | L1 | automated | `--label nightly-tests` instead of `--label nightly` | run the contract test | fails |
| E45 | NV "no `actions/github-script` step" | EP | L1 | automated | an `actions/github-script` step re-added to any job | run the contract test | fails |
| E46 | NV "Every registry is loopback" (not only the first) | BVA (look-alike host, second occurrence) | L1 | automated | the first `registry_url` stays `http://localhost:4873`; a second value `REGISTRY: http://localhost.evil.com:4873` (the anchored rule of `nightly-verdaccio-publish.mjs:145-148`) | run the contract test | fails naming `localhost.evil.com` |
| E47 | NV "Every registry is loopback" | EP (public registry via env) | L1 | automated | `verify-publish` env `npm_config_registry: https://registry.npmjs.org` | run the contract test | fails |
| E48 | NV "Every registry is loopback" | EP (valid loopback form) | L1 | automated | `REGISTRY: http://127.0.0.1:4873` | run the contract test | passes |
| E49 | NV "verify-publish publishes only to loopback" | EP | L1 | automated | `npm publish --workspaces --include-workspace-root --dry-run` re-added to `verify-publish` | run the contract test | fails (a `--dry-run` does not exempt it) |
| E50 | NV "verify-publish gates no other job" | EP | L1 | automated | `electron.needs: [resolve, verify-publish]` (today's value) | run the contract test | fails naming `electron` |
| E51 | NV "npm is upgraded before the version is set" | state order (moved) | L1 | automated | `npm install -g npm@latest` step moved after `npm pkg set` (still before the publish step) | run the contract test | fails |
| E52 | NV "npm is upgraded before the version is set" | EP (absent) | L1 | automated | the `npm install -g npm@latest` step deleted | run the contract test | fails |
| E53 | NV "Smoke runs nightly against the tested commit" | EP (wrong ref) | L1 | automated | `smoke` job `with: { ref: ${{ github.ref }} }` | run the contract test | fails |
| E54 | CP "Smoke matrix is defined exactly once" (`nightly.yml` clause) | EP | L1 | automated | `nightly.yml` gains an inline `standalone-install-smoke-linux:` job | run the contract test | fails |
| E55 | CP "Reusable workflow is publication-free"; D7 strict set | EP (dry-run not exempt) | L1 | automated | `_smoke.yml` gains a non-comment `run: npm publish --dry-run` | run the contract test | fails naming `_smoke.yml` |
| E56 | D7 "the header comment at `_smoke.yml:12` … must not trip it" | EP (comment) | L1 | automated | the real `_smoke.yml` with its header comment naming `npm publish` and the task-3.4 consumer line | run the contract test | passes |
| E57 | NV "No Release, tag, or version commit"; D7 | EP | L1 | automated | `_smoke.yml` gains `run: git push origin HEAD`; separately `run: git commit -am bump` | run the contract test (once per mutation) | fails for each |
| E58 | D7 "`nightly.yml` block gains an `actions/create-release` check" | EP | L1 | automated | `nightly.yml` gains `uses: actions/create-release@v1` | run the contract test | fails |
| E59 | NV "every reusable workflow it calls via a local `uses:`" | EP (new callee) | L1 | automated | `nightly.yml` gains a job `uses: ./.github/workflows/_extra.yml`; a fixture `_extra.yml` contains `softprops/action-gh-release` | run the contract test | fails naming `_extra.yml` (the scanned set comes from parsing `nightly.yml`) |
| E60 | Context "job-order slices"; tasks 3.3 | regression | L1 | automated | the final `nightly.yml` (tasks 3.1-4.3 applied) | run `nightly-workflow-contract`, `knip-workflow-contract`, `nightly-verdaccio-publish`, `workflow-token-cache-contract` tests | all pass; the `verify-publish:`→`knip:` and `knip:`→`electron:` slices still isolate their jobs |
| E61 | D2 "`nightly-tests.yml` must never pass this flag" | EP | L1 | automated | `nightly-tests.yml` report step with `--no-close-on-rerun` (or `--jobs-only`) appended | run `nightly-tests-workflow-contract.test.ts` | fails |
| E62 | design "Spec-collateral notes" (release-privileged jobs restore no cache) | EP | L1 | automated | `report` job's `setup-node` gets `cache: pnpm` | run `workflow-token-cache-contract.test.ts` | fails naming `nightly.yml` / `report` |
| E63 | D8, task 3.1 (`--allow-remote=all` on step (c)) | regression pin | L1 | automated | `scripts/nightly-verdaccio-publish.mjs` step (c) `npm install --package-lock-only` without `--allow-remote=all` | run `scripts/__tests__/nightly-verdaccio-publish.test.mjs` | fails |

#### Release-gate clause 6 (host `packages/shared/src/__tests__/publish-workflow-contract.test.ts`)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E64 | CP "Test passes on the corrected workflow" | regression | L1 | automated | the real `publish.yml`, `_smoke.yml`, `_electron-build.yml`, root `package.json` after task 3.7 | `npm test` | all six clauses pass; no warning mentioning the release-gate contract |
| E65 | CP clause 6 "outside comments"; task 3.7 | EP (full-line comment) | L1 | automated | the task-3.7 `ci-checks` comment containing `RUN_BUDGET_TESTS=1` and `*.budget.test.*` on `#` lines | run the clause | passes |
| E66 | CP clause 6 "outside comments" | BVA (trailing comment) | L1 | automated | `run: pnpm test  # RUN_BUDGET_TESTS is never set here` | run the clause | fails naming `RUN_BUDGET_TESTS` and the line: only full-line `#` comments are excluded, as the existing `codeLines` helper does (decision G4) |
| E67 | CP "Test fails when the release path enables the budget lane" | EP (workflow env) | L1 | automated | `publish.yml` top-level `env: { RUN_BUDGET_TESTS: "1" }` | `npm test` | fails; message names `RUN_BUDGET_TESTS` and `publish.yml` and cites `schedule-release-rehearsal` |
| E68 | same | EP (callee step env) | L1 | automated | `_electron-build.yml` step `env: { RUN_BUDGET_TESTS: 1 }` | `npm test` | fails naming `_electron-build.yml` |
| E69 | same (D5 "written to `GITHUB_ENV`") | EP | L1 | automated | `_smoke.yml` step `run: echo "RUN_BUDGET_TESTS=1" >> "$GITHUB_ENV"` | `npm test` | fails naming `_smoke.yml` |
| E70 | same | EP (`test:budget`) | L1 | automated | `publish.yml` `ci-checks` gains `run: pnpm run test:budget` | `npm test` | fails; message names `RUN_BUDGET_TESTS` and `publish.yml` |
| E71 | same (root script) | EP | L1 | automated | root `test:parallel` prefixed with `RUN_BUDGET_TESTS=1` | `npm test` | fails naming `package.json` |
| E72 | CP clause 6 "plus the root `postinstall`" | EP | L1 | automated | root `postinstall` gains `&& npm run test:budget` | `npm test` | fails naming `package.json` |
| E73 | CP clause 6 "followed through `npm run <name>`" | EP (transitive) | L1 | automated | root `lint` gains `&& npm run lint:extra`; new root script `lint:extra` contains `RUN_BUDGET_TESTS=1` | `npm test` | fails naming `package.json` |
| E74 | CP clause 6 follow rule | robustness (cycle) | L1 | automated | root scripts `a` = `npm run b`, `b` = `npm run a`, `lint` = `npm run a`, none containing either name | run the clause | terminates (no stack overflow, test within vitest's default timeout) and passes |
| E75 | CP clause 6 "a call with `--workspace` is not followed" | EP (out of scope) | L1 | automated | root `build:app` contains `RUN_BUDGET_TESTS=1`; it is reached only through `npm run build:app --workspace=<pkg>` | run the clause | passes (T-B15 gap 3, by design) |
| E76 | CP clause 6 "a name that is not a root script … is not followed" | EP | L1 | automated | `publish.yml` gains `run: pnpm run not-a-root-script` | run the clause | no exception; the clause still evaluates every other text and passes |
| E77 | CP clause 6 "found by parsing `publish.yml`" | EP (new callee) | L1 | automated | `publish.yml` gains `uses: ./.github/workflows/_new.yml`; fixture `_new.yml` sets `RUN_BUDGET_TESTS: 1` | `npm test` | fails naming `_new.yml` |

#### Live-run behaviour (no harness fakes a GitHub run; spike task 1.1, pre-merge dispatch task 4.5, post-merge)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E79 | NV "Nightly runs on schedule…"; Migration step 4 | live observation | — | manual-only | `nightly.yml` merged to `develop` with the cron | first UTC day after merge | `gh run list --workflow nightly.yml --event schedule --limit 1 --json event,createdAt,headSha` shows one run with `event: schedule` created that day (start delay not asserted, T-B4) |
| E80 | NV "Zero public npm writes" | live observation | — | manual-only | spike run (task 1.1) and pre-merge dispatch (task 4.5) finished | after each run | for every non-private workspace package, `npm view <pkg> versions --json --registry https://registry.npmjs.org` lists no `-nightly.` version; `npm view @blackbelt-technology/pi-dashboard-server@<nightly> version` fails `E404` |
| E81 | NV "publish under the npm version the release publishes with"; D8 | live observation (spike criterion 1) | — | manual-only | throwaway-branch spike of task 1.1 | `gh workflow run nightly.yml --ref <branch>` | after the upgrade, `npm --version`, `npm view npm@latest version` and the `npmArgv npm` line print one version; `npm install -g verdaccio@6.11.1` green; log has `runtime-lock.json: … pinned at <nightly>` and `✓ Published <n> workspace(s) to http://localhost:4873`; `verify-publish` green |
| E82 | D8 platform quirk (`--allow-remote=all` on bundled npm) | live observation (spike criterion 3) | — | manual-only | `allow-remote-probe` matrix `macos-14`, `macos-15-intel`, `ubuntu-latest`, `ubuntu-24.04-arm`, `windows-latest`, Node 26 bundled npm | spike dispatch | each of the 5 legs exits 0 on `npm install --package-lock-only --no-audit --no-fund --allow-remote=all` |
| E83 | D2 platform assumption (`GITHUB_RUN_ATTEMPT`) | live observation (spike criterion 2) | — | manual-only | `attempt-probe` job | spike dispatch, then `gh run rerun <run-id> --job <attempt-probe id>` | log `attempt=1 event=workflow_dispatch` on the first run and `attempt=2` on the re-run |
| E84 | NV ADD "An npm@latest failure SHALL NOT skip…"; task 4.5 | live observation | — | manual-only | final workflow on a throwaway branch | `gh workflow run nightly.yml --ref <branch>` | `gh run view --json jobs`: every `electron` leg's `startedAt` is earlier than `verify-publish`'s `completedAt`; every job ran incl. `report` and the 5 `smoke` jobs (3 Linux, 1 Windows, upgrade-continuity); summary heading `## Nightly Verdaccio build: RED` or `: green`; its failed-job list equals the jobs whose conclusion is `failure`/`cancelled`/`timed_out` |
| E85 | NV "Dispatch runs never touch the issue" (runtime); task 4.5 | live observation | — | manual-only | `gh issue list --label nightly --state all --json number,state,updatedAt` saved before the dispatch | pre-merge dispatch finishes | the list saved after is identical |
| E86 | CP "Reusable workflow accepts ref input" (nightly caller) | live observation | — | manual-only | pre-merge dispatch at SHA `S` | each `smoke` leg checks out | every `smoke` leg's checkout log shows `S` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | D8 step 7 (`timeout-minutes` 20 → 35) | threshold | — | manual-only | `verify-publish` under `npm@latest`: pnpm install, build, Verdaccio install, per-package loopback publish incl. runtime lock | job wall time < 35 min (the job timeout); measured value recorded above the job (task 1.1) | the spike run and the pre-merge dispatch (task 4.5) |

### Frontend-quirk

None: this change has no rendered UI.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | NV "Job list unavailable does not turn the night green" | fault injection (abort: jobs API 500) | L1 | automated | jobs API returns HTTP 500; `NEEDS_JSON` `electron: failure`; `JO`; schedule, attempt 1; no open issue | run the reporter | body has `failed-job list unavailable: <error>` and `electron: failure` and the run URL; one `create`; exit 1 |
| X2 | NV "SHALL still decide red or green from the job results"; D2 "A failed jobs-list request alone does not change the exit code" | fault injection (abort) on a green night | L1 | automated | jobs API returns 500; `NEEDS_JSON` all `success`; `JO`; schedule, attempt 1; open issue #7 | run the reporter | verdict green; `comment(7, "… is green again …")` + `close(7)`; exit 0 |
| X3 | NV "when the run's job list cannot be read, it SHALL name the failing jobs from the job results" (re-run) | fault injection (abort) | L1 | automated | jobs API returns 500; `NEEDS_JSON` `smoke: failure`; `JO`; schedule, `GITHUB_RUN_ATTEMPT=2`; open issue #7 | run the reporter | one `comment(7, …)` starting `Re-run attempt 2 of …`, no `update`/`close`; the comment holds the `failed-job list unavailable: <error>` line and `smoke: failure` from the job results (decision G1); exit 1 |
| X4 | NV "A failed issue call is named" | fault injection (abort: create 403) | L1 | automated | `create` returns 403; `JO`; schedule, attempt 1; red; no open issue | run the reporter | step summary ends with `Issue call failed: <error>. The \`nightly\` issue may not reflect this run; re-run the \`report\` job.`; stdout has `::error::` with the same text; exit 1 |
| X5 | NV "A failed issue call is named" | fault injection (partial: close fails after comment) | L1 | automated | green attempt 1, open #7; `comment` succeeds, `close` returns 500 | run the reporter | summary line and `::error::` as in X4; exit 1 although the verdict is green |
| X6 | NV "A failed issue call is named" | fault injection (abort: list) | L1 | automated | `listOpen` returns 500; red attempt 1 | run the reporter | summary line and `::error::` as in X4; exit 1 |
| X7 | NV "A failed issue call is named" (re-run path) | fault injection (abort) | L1 | automated | attempt 2, red, open #7; `comment` returns 500 | run the reporter | summary line and `::error::` as in X4; exit 1 |
| X8 | NV ADD "npm drift fails the night" (reporter half) | fault injection (job failure) | L1 | automated | `NEEDS_JSON` `verify-publish: failure`, every other job `success`; jobs API lists `verify-publish` `failure`; `JO`; schedule, attempt 1 | run the reporter | RED; issue body names `verify-publish`; no job listed as `skipped` |
| X9 | NV ADD "npm drift fails the night" (runtime half) | live observation (not reproducible on demand) | — | manual-only | a published `npm@latest` that rejects `npm pkg set`, runtime-lock generation or a per-package loopback `npm publish` | the next scheduled night | `verify-publish` conclusion `failure` with the failing step named; `electron`, `smoke`, `knip`, `install-load` ran (not `skipped`); the `nightly` issue names `verify-publish` |
| X10 | NV "No run can cancel, hold or replace a scheduled run" (runtime half) | live observation (illegal transition: dispatch during schedule) | — | manual-only | a scheduled `nightly.yml` run in progress after 04:13 UTC | a maintainer dispatches `nightly.yml` twice while it runs | the scheduled run's conclusion is not `cancelled`; its `report` job ran (conclusion `success` or `failure`, not `skipped`/`cancelled`); both dispatches ran too |
| X11 | NV "Failure opens…" / "Recovery closes…" (first live issue path, Risks "first execution of the issue path") | live observation | — | manual-only | first red and first green scheduled nights after merge | their `report` jobs | red: an issue labelled `nightly`, title `Nightly Verdaccio build is failing`, names the failing job/leg and the run URL; green: comment `Nightly Verdaccio build is green again at \`<sha>\`. Closing.` and the issue closed |
| X12 | T-B18 (2) "check (2) on the first re-run after merge" | live observation (platform assumption) | — | manual-only | first re-run of a red scheduled run after merge | `gh run rerun <id> --failed` | `gh run view <id> --attempt 2 --json event` shows `schedule`; the open `nightly` issue gets a `Re-run attempt 2 of …` comment (or is opened); the result is recorded in `docs/ci.md` |
| X13 | Discipline `security-hardening`; task 4.5 (CodeQL ratchet) | fault injection (new alert) | ci | automated | `nightly.yml` after tasks 3.1-4.3 (`npm install -g` after `cache: pnpm`, new `schedule` trigger) | `npm run codeql` | exit 0; every new `nightly.yml` alert is `actions/cache-poisoning/poisonable-step` on a read-only job and sits in `codeql-baseline.json` with an `accepted-risk:` reason; any other new alert → `SHIP_IT_BLOCKED.md`, no merge |

---

## Coverage summary

- Requirements covered: 8/10 behavioural requirements. NV: "A scheduled nightly build … zero public npm writes", "A red nightly SHALL be visible without watching CI", "…publish under the npm version the release publishes with", "An npm@latest failure SHALL NOT skip…", "…run the standalone-install smoke". CP: "Reusable standalone-install-smoke workflow", "Release-gate runs lint+test+build and smoke before publish", "Repo-lint pins the release-gate contract". Text-only deltas with no behaviour change, no new row: CP "CI workflow on push and PR" (consumer list), CP "On-demand smoke workflow via workflow_dispatch" (leg wording). Existing coverage kept: the throwaway version slug (`computeNightlyVersion`, `nightly-verdaccio-publish.test.mjs:60-77`); the runtime half of "ci-checks does not run the budget lane" is A's blocking `scripts/check-budget-lane.mjs` (no new row, per design "Pins for the scenario manifest"). The second AND clause of CP scenario "ci-checks does not run the budget lane" (cases gated on other variables that `pnpm test` does not set, e.g. `RUN_CI_SCENARIOS`, skipped exactly as before) has no test row (owner decision G3): it holds by construction, because this change edits no release-path workflow step or root script beyond one comment (design D5, task 3.7).
- Scenarios by class: edge 85 · perf 1 · frontend 0 · error 13 (99 total)
- Scenarios by level: L1 85 · ci 1 · — 13
- Scenarios by disposition: automated 86 · manual-only 13
- Gap decisions (owner, 2026-11-22): G1 → X3 (re-run comment carries the `NEEDS_JSON` failing jobs in the jobs-API fallback); G2 → E7 (comment stays `Still red at <sha>.`, the body carries jobs, legs and run URL; spec reads "every issue write"); G3 → no row (see above; former E78 retired, id not reused); G4 → E66 (trailing comment fails the clause).

## New infra needed

- None at level/harness scale. All L1 rows use existing hosts (`nightly-workflow-contract.test.ts`, `publish-workflow-contract.test.ts`, `nightly-tests-workflow-contract.test.ts`, `workflow-token-cache-contract.test.ts`, `scripts/__tests__/nightly-report.test.mjs`, `scripts/__tests__/nightly-verdaccio-publish.test.mjs`).
- Test seam (implementation note, not a new level): today `main` in `nightly-report.mjs` is not exported and builds its own `fetch`-based API (`:113-132`, `:156-186`). The reporter rows E3-E28, X1-X8 need the jobs-only path callable with an injected API (incl. the jobs endpoint and `Link` pagination), env, and step-summary sink, as the existing `syncIssue` tests do with `fakeApi` (`nightly-report.test.mjs:150-169`). Task 2.1 requires this seam.
- Hosts outside the design's "Pins for the scenario manifest" table: E61 (`nightly-tests-workflow-contract.test.ts`, also edited by change A), E62 (`workflow-token-cache-contract.test.ts`), E63 (`nightly-verdaccio-publish.test.mjs`).
