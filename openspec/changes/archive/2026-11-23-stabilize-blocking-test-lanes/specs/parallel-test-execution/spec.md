## ADDED Requirements

### Requirement: Budget test files run only in the nightly budget lane
A budget test bounds a wall-clock duration or process-memory amount from above, or one by another. A budget file is named `<name>.budget.test.<ext>`. Each vitest config collecting one SHALL exclude `*.budget.test.*` unless `RUN_BUDGET_TESTS=1`. No budget case SHALL execute in `npm test`, a PR CI lane or the publish tag gate. Of the repo's scripts, configs and workflows, only `test:budget` SHALL set `RUN_BUDGET_TESTS`. In CI only the nightly `ubuntu-latest` budget job SHALL run them.

#### Scenario: The local suite does not collect budget files
- **WHEN** a developer runs `npm test` without `RUN_BUDGET_TESTS` set
- **THEN** no `*.budget.test.*` file SHALL be collected, and none of its code SHALL run

#### Scenario: Blocking runs never set the lane variable
- **WHEN** `npm test`, a PR CI job or the publish tag gate runs, including the test selector and the blocking lane check
- **THEN** no config, test, script or workflow step they run SHALL set `RUN_BUDGET_TESTS`
- **AND** the blocking lane check SHALL remove it from its own and every child's environment

#### Scenario: One command runs only the budget lane
- **WHEN** a developer runs `npm run test:budget`
- **THEN** only `*.budget.test.*` files SHALL execute, one file at a time
- **AND** a case SHALL be skipped only by a runtime gate of its own, such as the blender real-runtime gate on a machine without that runtime

#### Scenario: A deterministic byte budget stays blocking
- **WHEN** a test asserts a bundle's byte size, as `mdi-chunk-size` does
- **THEN** it SHALL NOT be classified as a budget test and SHALL stay in the PR lanes

#### Scenario: A lower-bound wait stays blocking
- **WHEN** a test asserts `expect(Date.now() - start).toBeGreaterThanOrEqual(delayMs)`
- **THEN** it SHALL NOT be classified as a budget test and SHALL stay in its blocking lane

#### Scenario: A count under fake timers stays blocking
- **WHEN** a test runs under `vi.useFakeTimers()` and asserts a render count, as `SessionList.actions-menu.test.tsx` P1 does
- **THEN** it SHALL NOT be classified as a budget test and SHALL stay in its blocking lane

#### Scenario: Blocking jobs keep blocking
- **WHEN** PR CI computes `ci-result`
- **THEN** `ci-result` SHALL still need `blender-real` and `ci-scenarios`, and neither job SHALL be `continue-on-error`

### Requirement: A blocking lane check refuses a budget file outside the budget lane
A blocking check SHALL fail the `ci` job of PR CI and `npm test` when a vitest command of `npm test`, run without `RUN_BUDGET_TESTS`, collects a budget file, or when a tracked budget file is in no project of the root vitest config (the projects `npm run test:budget` runs) that excludes it with the budget entry, judged from the resolved project configs without setting `RUN_BUDGET_TESTS`. The check SHALL be separate from the warn-only budget-assertion guard.

#### Scenario: A budget file a blocking run would collect fails the check
- **WHEN** a pull request adds `packages/x/src/__tests__/a.budget.test.ts` to a package whose vitest config does not exclude `*.budget.test.*` files
- **THEN** the blocking lane check SHALL fail the `ci` job, naming the file
- **AND** `npm test` SHALL fail through the same check

#### Scenario: A static judgement that drifts from vitest fails the check
- **WHEN** the lane check's include/exclude test, applied to the tracked non-budget test files, selects a set that differs from what `vitest list --filesOnly` collects for the root config
- **THEN** the blocking lane check SHALL fail, naming the differing files

#### Scenario: A budget file no project collects fails the check
- **WHEN** a tracked budget file sits where no vitest project collects it
- **THEN** the blocking lane check SHALL fail, naming the file

#### Scenario: A snapshot named like a budget file is not a budget file
- **WHEN** a tracked `packages/kb-plugin/src/server/__tests__/__snapshots__/kb-search-perf.budget.test.ts.snap` exists
- **THEN** the blocking lane check SHALL NOT report it
- **AND** the selector SHALL NOT list it in the budget-lane files

### Requirement: The budget cases observed failing in CI are in budget files
The budget cases observed failing in CI before the lane existed SHALL be in budget files: `kb-search-perf` P1 and its S61 tail bound, `browser-gateway-broadcast-serialize-once` P2, `ladder-perf` #P4, `graph-layout` #P1, `knip-scan` #P1, blender `real-binary` P1–P3, `provisioning` #P1 and `dependency-declarations` P1/P2. Moving a case SHALL leave in a blocking lane every functional assertion of that case that no blocking case already asserts.

#### Scenario: The blender budget cases leave the mixed file
- **WHEN** the lane is in place
- **THEN** blender P1–P3 SHALL be in `real-binary.budget.test.ts`
- **AND** the functional cases E10–E51 SHALL stay in `real-binary.test.ts` and run in their blocking job

#### Scenario: A moved case keeps its functional half blocking
- **WHEN** a moved budget case also asserts a functional outcome that no blocking case asserts, as `ladder-perf` #P4 asserts `reg.size` 0 beside its RSS bound
- **THEN** a blocking copy of the case without the bound SHALL stay in the original file

### Requirement: A budget-assertion guard reports budget assertions in blocking lanes
A guard SHALL report each upper-bound assertion outside `*.budget.test.*` files whose measured side holds a same-file clock or process-memory reading or a listed helper call, and each relative bound. It SHALL read a multi-line assertion as one statement, trace readings through assignments, `push`/`set` collections and same-file functions within the case, and ignore a clock faked for the case. A bare reading as bound side SHALL NOT be reported.

#### Scenario: A memory ceiling is reported
- **WHEN** a non-budget test file asserts `expect(process.memoryUsage().rss - rss0).toBeLessThan(limit)`
- **THEN** the guard SHALL report the file and line

#### Scenario: A relative budget is reported
- **WHEN** a non-budget test file asserts `expect(nonStatusMs).toBeLessThan(statusMs * 1.25)`, where both values are medians of `performance.now()` differences
- **THEN** the guard SHALL report the file and line

#### Scenario: A split-line assertion is reported
- **WHEN** a non-budget test file asserts `expect(` on one line, `elapsed,` on the next, and `).toBeLessThan(1000)` on a third, where `elapsed` is a `performance.now()` difference
- **THEN** the guard SHALL report the assertion

#### Scenario: A duration returned by a same-file function is reported
- **WHEN** a non-budget test file defines `async function run()` that times a loop with `performance.now()` and returns the samples, and a case asserts `expect(Math.max(...(await run()).times)).toBeLessThan(50)`
- **THEN** the guard SHALL report the file and line

#### Scenario: A file-level fake clock hides arithmetic on it
- **WHEN** a file's top-level `beforeEach` calls `vi.useFakeTimers()` with no argument and a case asserts an upper bound on a `performance.now()` difference
- **THEN** the guard SHALL NOT report that assertion

#### Scenario: Fake timers without a fake Date do not hide a real-clock bound
- **WHEN** a file calls `vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })` in one case, and another case asserts `expect(Date.now() - t0).toBeLessThan(2000)` on the real clock
- **THEN** the guard SHALL report the second case's line

#### Scenario: An ordering check is not reported
- **WHEN** a test asserts `expect(record.createdAt).toBeLessThanOrEqual(Date.now())`
- **THEN** the guard SHALL NOT report it

#### Scenario: A measurement taken in another module is out of reach
- **WHEN** the clock or memory reading happens only inside an imported helper module that is not on the guard's helper list, inside a spawned child process, or the comparison happens inside a predicate function such as `withinBudget`
- **THEN** the guard is not required to report the assertion

### Requirement: The budget guard runs warn-only in PR CI
The guard SHALL run in the `ci` job of PR CI in a warn-only mode. It SHALL write each finding as a warning annotation and the count and list to the job summary, and SHALL exit 0 whatever it finds, including on its own internal error. No job, `ci-result` input or ship gate SHALL fail because of a guard finding. It SHALL NOT analyse `*.budget.test.*` files; the blocking lane check governs them.

#### Scenario: A new elapsed-time ceiling is reported, not failed
- **WHEN** a pull request adds `const t0 = performance.now(); …; expect(performance.now() - t0).toBeLessThan(50)` to `packages/x/src/__tests__/a.test.ts`
- **THEN** the guard step SHALL write a warning naming the file and line and list it in the job summary
- **AND** the `ci` job SHALL NOT fail because of it

#### Scenario: The guard's own error does not fail the job
- **WHEN** the guard cannot read a file or its analyzer throws
- **THEN** the guard step SHALL write a warning naming the error and SHALL exit 0

### Requirement: The guard's liveness allow-list holds real-process liveness deadlines with a written reason
The guard SHALL hold a liveness allow-list for real-process liveness deadlines. Each entry SHALL name a file, the normalized first line of one assertion, and a written reason naming the process event or production timeout the bound equals. An entry SHALL exempt exactly that assertion. The guard SHALL report an entry with an empty reason, no match, or more than one match.

#### Scenario: An allow-listed liveness deadline is not reported
- **WHEN** `packages/server/src/rpc-keeper/__tests__/keeper.test.ts` asserts `expect(maxLatencyMs).toBeLessThan(1050)` and the allow-list holds that file, that text and a reason naming the production write timeout
- **THEN** the guard SHALL NOT report that occurrence
- **AND** its `--list` output SHALL show it as allow-listed

#### Scenario: A trailing comment does not break a match
- **WHEN** `packages/server/src/__tests__/cli-foreground-real.test.ts` holds `expect(Date.now() - t0).toBeLessThan(10_000 + 20_000); // classify budget + boot slack` and the allow-list entry's text is `expect(Date.now() - t0).toBeLessThan(10_000 + 20_000)`
- **THEN** the entry SHALL match that one assertion

#### Scenario: An entry without a reason is reported
- **WHEN** an allow-list entry has an empty reason
- **THEN** the guard SHALL report the entry

#### Scenario: A stale allow-list entry is reported
- **WHEN** an allow-list entry matches no assertion in its file
- **THEN** the guard SHALL report the entry

#### Scenario: An ambiguous allow-list entry is reported
- **WHEN** an allow-list entry's text begins two assertions in its file
- **THEN** the guard SHALL report the entry
- **AND** it SHALL NOT exempt either assertion

## MODIFIED Requirements

### Requirement: Real-process tests run in a dedicated low-concurrency phase
Server tests that spawn a real operating-system process under test SHALL be collected by a dedicated vitest project that is NOT part of the parallel unit run. Such processes include a keeper, a mock-pi, a wrapper, a signal-forwarding CLI, or a full server process whose outcome is observed through the process table, a socket, or a log file.

That project SHALL NEVER run concurrently with the parallel projects on the same machine. Locally it SHALL run after the parallel projects complete. In CI it MAY instead run on its own runner. It SHALL use at most two concurrent forks and a per-test and per-hook budget of 60 s.

The main server project SHALL exclude exactly the files the real-process project includes, plus `*.budget.test.*` files. A repo-lint test SHALL fail when a file is in both, when a server test file that is not a `*.budget.test.*` file is in neither, or when a test that spawns a process is added to the main project. A server `*.budget.test.*` file is in neither phase by design; the blocking budget lane check, not this lint, refuses one that the budget lane would not run. The single command `npm test` SHALL run both phases in sequence, so local coverage is unchanged.

#### Scenario: Keeper rotation test is not starved
- **WHEN** `npm test` runs on a loaded runner
- **THEN** `rpc-keeper/__tests__/keeper.test.ts` SHALL execute only after the parallel projects have finished
- **AND** at most one other real-process test file SHALL run concurrently with it

#### Scenario: CI runs the phase on its own runner
- **WHEN** CI selects any real-process test file
- **THEN** those files SHALL run in a job that executes no parallel-project tests
- **AND** that job SHALL use at most two concurrent forks

#### Scenario: A real-process test added to the main project is refused
- **WHEN** a new `packages/server/src/**/__tests__/*.test.ts` spawns a keeper or a mock-pi and is not listed in the real-process project
- **THEN** the repo-lint test SHALL fail naming the file

#### Scenario: A server budget file is in neither phase
- **WHEN** `packages/server/src/access/__tests__/ladder-perf.budget.test.ts` exists and is not listed in the real-process project
- **THEN** the repo-lint test SHALL pass
- **AND** neither phase SHALL collect it, and the blocking budget lane check SHALL count it as in the budget lane

#### Scenario: Single command still covers everything
- **WHEN** a developer runs `npm test`
- **THEN** every test collected by either phase SHALL have executed exactly once (absent a CI retry), except `*.budget.test.*` files, which neither phase SHALL collect

### Requirement: CI-only single retry for the real-process phase is reported, never silent
Under `CI`, the real-process project — and only that project — SHALL retry a failed test once. A test that passed on retry SHALL be distinguishable from a clean pass in the vitest JSON report uploaded by CI. Console output SHALL NOT be relied on for this: vitest's default reporter marks a retry only for tests it lists, so a retried PASS leaves no console trace. No other project SHALL configure retries. Outside `CI` the retry count SHALL be zero.

Separately, a failed scheduled `nightly-tests.yml` run SHALL have its failed jobs rerun once, as a whole job, as the `nightly-verification` capability defines. This is not a vitest retry and SHALL NOT add `retry` to any vitest config. `ci.yml` SHALL NOT rerun a failed job automatically.

#### Scenario: Retried test is attributable
- **WHEN** a real-process test fails once and passes on retry in CI
- **THEN** the job SHALL succeed
- **AND** the uploaded report SHALL list that test as passed while retaining the failed attempt's failure message, so the retry is distinguishable from a clean pass

#### Scenario: Locally there is no retry
- **WHEN** the same test fails on a developer machine
- **THEN** the run SHALL fail on the first failure

#### Scenario: A job rerun is not a vitest retry
- **WHEN** the nightly reruns a failed unit shard
- **THEN** no vitest config other than the real-process one SHALL set `retry`

#### Scenario: PR CI gets no rerun
- **WHEN** a unit shard fails in a `ci.yml` run
- **THEN** no job SHALL be rerun automatically, and `ci-result` SHALL fail
