# Tasks

"The contract test command" below means `HOME=$(mktemp -d) npx vitest run --project @blackbelt-technology/pi-dashboard-shared e2e-electron-workflow-contract`. Bare `npx vitest run <path>` either finds no files from the repo root or trips the `[test-isolation]` HOME guard. That form was verified at planning time, when it reported 10 passed. After group 1 the file has 12 tests.

## 1. Contract test first (red)

All tasks in this group edit `packages/shared/src/__tests__/e2e-electron-workflow-contract.test.ts`. Harness exemplar: the existing (E13) `noGate` / `foo` mutations and the (E14) `electron-e2e` mutation in that same file, which use `mutate()`, `jobIds()` and `electronWorkflowViolations()`. Scenario ids refer to `test-plan.md`.

- [ ] 1.1 Assert the job is gone (test-plan #E1). In (E13), drop `"job-object-windows"` from the `jobIds` `arrayContaining` list, delete the `always` mutation that targets `job-object-windows`, and add `expect(jobIds(yaml)).not.toContain("job-object-windows")`.
  - Triple: real `ci-e2e-electron.yml` · `jobIds(yaml)` · contains `electron-e2e` + `runtime-overlay-e2e`, not `job-object-windows`.
  - Verify: the contract test command reports exactly 1 failed test, (E13), on the new `not.toContain` assertion.
- [ ] 1.2 Clean up (E14), with no new scenario. Rename it from `(E14) electron-e2e carries no continue-on-error; job-object-windows keeps its own` to `(E14) electron-e2e carries no continue-on-error`. Delete the `jobBlock(yaml, "job-object-windows")` assertion. Keep the `electron-e2e` mutations and `expect(electronWorkflowViolations(yaml)).toEqual([])`. Update the file-header doc bullets (lines 12-15) to say every job, not just `electron-e2e`, must not be `continue-on-error`.
  - Verify: the contract test command still reports exactly 1 failed test, (E13).
- [ ] 1.3 Ban the key on `runtime-overlay-e2e` (test-plan #E2). Add a new `it("(E16) continue-on-error is banned on every job (enumerated, any value)")` with `mutate("  runtime-overlay-e2e:\n", "  runtime-overlay-e2e:\n    continue-on-error: true\n")`, expecting output to contain `runtime-overlay-e2e: must not be continue-on-error`.
  - Triple: `continue-on-error: true` under `runtime-overlay-e2e` · `electronWorkflowViolations(mutated)` · that violation string.
  - Verify: the contract test command reports 2 failed, (E13) and (E16).
- [ ] 1.4 Prove the rule enumerates jobs (test-plan #E3). In (E16), append a job `\n  foo:\n    continue-on-error: true\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n` to the YAML (same append pattern as the (E13) `extra` job), expecting output to contain `foo: must not be continue-on-error`.
  - Triple: unknown job `foo` carrying the key · `electronWorkflowViolations(mutated)` · `foo: must not be continue-on-error`.
  - Verify: (E16) still fails, and is still 1 of exactly 2 failed tests.
- [ ] 1.5 Ban the key regardless of value (test-plan #E4). In (E16), add the same `runtime-overlay-e2e` mutation with `continue-on-error: false`, expecting the same `runtime-overlay-e2e: must not be continue-on-error` string.
  - Triple: `continue-on-error: false` under `runtime-overlay-e2e` · `electronWorkflowViolations(mutated)` · that violation string.
  - Verify: there are exactly 2 failed tests, (E13) and (E16).
- [ ] 1.6 Guard against comment false-positives (test-plan #E5). Add `it("(E17) a comment mentioning continue-on-error is not a violation")`. It inserts the 4-space comment `    # continue-on-error: true is forbidden here` under `  runtime-overlay-e2e:` and asserts that no output entry contains `must not be continue-on-error`.
  - Triple: indented `#` comment inside a job block · `electronWorkflowViolations(mutated)` · no `continue-on-error` violation.
  - This is a guard: it passes before and after task 2.1, and protects the 2.1(a) `^ {4}` anchor.
  - Verify: there are still exactly 2 failed tests, (E13) and (E16), and 10 passed out of 12.

## 2. Validator + workflow + script removal (green)

- [ ] 2.1 This is one step, because widening the validator alone turns the real-workflow `toEqual([])` red until the job is gone.
  - (a) In `electronWorkflowViolations()` (~line 195), widen the `continue-on-error` check from `electron-e2e` to every id in `jobIds(workflow)`. Message: `<id>: must not be continue-on-error`. Keep the 4-space `^ {4}continue-on-error:` anchor applied to each `jobBlock`. `jobBlock` includes trailing inter-job comments (e.g. workflow lines 134-141 sit inside `electron-e2e`'s block), so an unanchored match would false-positive on comment prose.
  - (b) In `.github/workflows/ci-e2e-electron.yml`, delete the whole `job-object-windows:` job block (~221-261; it is the last job).
  - (c) Replace the header cadence table (lines 14-17) verbatim with:
    ```
    #   event                      ubuntu  windows  macOS  runtime-overlay-e2e
    #   pull_request (path filter)   x       x        -            x
    #   workflow_dispatch (any ref)  x       x        x            x
    #   schedule (nightly, default)  -       -        x            -
    ```
  - (d) Replace lines 23-26 (`# ADVISORY — not a required check … arch matches by construction).`) verbatim with:
    ```
    # ADVISORY — not a required check (no branch-protection gate); no job is
    # `continue-on-error` (a darwin regression must turn the run red, not hide).
    # macOS is arm64 only (the app is packaged and run on the same runner, so
    # arch matches by construction).
    # COVERAGE GAP (Windows Job Object): no job observes JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    # killing the spawned server after `taskkill /F` of Electron; only the
    # `detach: false` precondition is pinned (server-lifecycle-spawn-options.test.ts).
    # See change: remove-job-object-windows-smoke.
    ```
  - (e) Delete the orphaned 3-line comment `# Job Object kill-on-close (task 7.4a) — spawn-mode …` (~134-136) above the `── Runtime overlay update cycle` comment.

  Verify all of the following:
  - the contract test command reports `12 passed`, 0 failed (this includes (E16) green and the (E17) guard green against the new `COVERAGE GAP` header comment);
  - `grep -cE "job-object-windows|continue-on-error: true|Job Object kill-on-close" .github/workflows/ci-e2e-electron.yml` prints `0`;
  - `grep -c "COVERAGE GAP (Windows Job Object)" .github/workflows/ci-e2e-electron.yml` prints `1`;
  - `node -e "require('yaml').parse(require('fs').readFileSync('.github/workflows/ci-e2e-electron.yml','utf8'))"` exits 0.
- [ ] 2.2 Delete `scripts/windows-job-object-smoke.ts` and `scripts/windows-job-object-smoke.ts.AGENTS.md`, and remove the `windows-job-object-smoke.ts` row from `scripts/AGENTS.md`. Rewrite the `ci-e2e-electron.yml` row in `.github/workflows/AGENTS.md` (line 11) in place, as the closeout for the touched workflow:
  - delete the whole "Second job `job-object-windows` (`continue-on-error`, advisory): … deep validation lives in qa VM smoke)" passage, including that false qa-coverage claim;
  - change "`runtime-overlay-e2e` + `job-object-windows` carry `if: …`" to "`runtime-overlay-e2e` carries `if: …`";
  - correct the stale facts in the same row to match the file: the matrix is event-keyed (PR → ubuntu+windows, dispatch → +macOS, schedule → macOS), not a static 2-OS list; install is `pnpm install --frozen-lockfile`, not an OS-split `npm ci` fallback;
  - add "no job `continue-on-error`; COVERAGE GAP note for Windows Job Object" and `See change: remove-job-object-windows-smoke`.

  Verify:
  - `git grep -lE "windows-job-object-smoke|job-object-windows|deep validation lives in qa" -- . ':!openspec/changes/archive' ':!Prompt stories' ':!openspec/changes/remove-job-object-windows-smoke' ':!packages/shared/src/__tests__/e2e-electron-workflow-contract.test.ts'` lists exactly `CONTRIBUTING.md`, `docs/faq.md` and `docs/pipeline-map/5-ci.mmd` (handled in 3.1). The contract test is excluded because its `not.toContain("job-object-windows")` guard keeps the literal by design;
  - if the rewritten row still exceeds the directory-AGENTS row-length threshold, promote it to a `.github/workflows/ci-e2e-electron.yml.AGENTS.md` sidecar per the size rule, leaving a one-line summary and a `→ see` pointer;
  - `HOME=$(mktemp -d) npx vitest run --project @blackbelt-technology/pi-dashboard-shared` reports 0 failed.

## 3. Docs

- [ ] 3.1 Spawn DocScribe for the two `docs/` files. Its prompt carries the caveman rule copied verbatim from root `AGENTS.md` § Docs delegation, plus the facts below as content (not as a pre-written diff). The main agent does not edit `docs/`.
  - `docs/pipeline-map/5-ci.mmd:7`: remove the `<br/>+ job-object-windows` suffix, so the node label ends `electron-e2e matrix"`.
  - `docs/faq.md:545`: replace the `job-object-windows` paragraph with these facts:
    - Windows Job Object cascade (`taskkill /F` of Electron kills the spawned server via `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) is not asserted by any automated test.
    - CI job `job-object-windows` was removed. Every logged run ended `INFRA: app never brought a server up on :8000`, so it never reached the cascade check (see change: remove-job-object-windows-smoke).
    - Precondition `detach: false` is pinned by `packages/electron/src/__tests__/server-lifecycle-spawn-options.test.ts`.
    - Zombie detection and the adoption modal are covered by `decideIsZombie` unit tests and `tests/e2e-electron/zombie-adoption.electron.spec.ts` (fake `/api/health`).
    - No qa VM test force-kills the parent: `qa/tests/07-electron-bootstrap-v2.ps1` checks starter + health only.

  The main agent edits `CONTRIBUTING.md:379` directly (not under `docs/`): remove the `<br/>+ job-object-windows` suffix there the same way.

  Verify:
  - the 2.2 `git grep` with `':!docs/faq.md'` appended prints nothing (exit 1). The FAQ names the removed job on purpose, so it stays searchable;
  - `grep -c "not asserted by any automated test" docs/faq.md` prints `1`.

## 4. Integration

- [ ] 4.1 Run the full suite and the change checks:
  - `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`, then `grep -nE 'FAIL|Tests +[0-9]+ (failed|passed)' /tmp/pi-test.log`;
  - `openspec validate remove-job-object-windows-smoke --strict` (bare global `openspec`, not `npx`, which can resolve a squatted stub);
  - `diff <(sed -n '/^### Requirement: Native-surface Electron flows/,$p' openspec/specs/electron-qa-coverage/spec.md) <(sed -n '/^### Requirement: Native-surface Electron flows/,$p' openspec/changes/remove-job-object-windows-smoke/specs/electron-qa-coverage/spec.md)`.

  Verify that the test run shows 0 failures, the change reports valid, and the `diff` prints nothing (the main spec and the delta are byte-identical for this requirement).

## Workflow follow-up

- The full MODIFIED requirement block was already applied to `openspec/specs/electron-qa-coverage/spec.md` in the planning commit. `openspec validate --strict` refuses a MODIFIED delta that omits a current scenario, so the main-spec edit was made up front. Mention this in the archive commit message. `openspec archive` then syncs as a no-op for this block.
- After archive, verify that `grep -n "job-object-windows" openspec/specs/electron-qa-coverage/spec.md` returns nothing, including the `## Purpose` preamble. Also verify that `grep -c "is NOT covered by this suite or by any other automated test" openspec/specs/electron-qa-coverage/spec.md` prints `1`: the gap statement must survive.

## 5. Post-merge

- [ ] 5.1 Manual check (test-plan: manual-only, #X1): on the first Electron-touching PR after merge, open the `ci-e2e-electron.yml` run. Confirm the job list has no `job-object-windows`, and that `electron-e2e (ubuntu-latest)`, `electron-e2e (windows-latest)` and `runtime-overlay-e2e` each report a verdict, with no always-red job left. Verify with `gh run view <id> --json jobs -q '.jobs[].name'`.
