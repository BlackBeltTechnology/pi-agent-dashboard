## ADDED Requirements

### Requirement: Real-process tests run in a dedicated low-concurrency phase
Server tests that spawn a real operating-system process under test — a keeper, a mock-pi, a wrapper, a signal-forwarding CLI, or a full server process whose outcome is observed through the process table, a socket, or a log file — SHALL be collected by a dedicated vitest project that is NOT part of the parallel unit run. That project SHALL run AFTER the parallel projects complete, with at most two concurrent forks and a per-test and per-hook budget of 60 s. The main server project SHALL exclude exactly the files the real-process project includes, and a repo-lint test SHALL fail when a file is in both, in neither, or when a test that spawns a process is added to the main project. The single command `npm test` SHALL run both phases in sequence so local coverage is unchanged.

#### Scenario: Keeper rotation test is not starved
- **WHEN** `npm test` runs on a loaded runner
- **THEN** `rpc-keeper/__tests__/keeper.test.ts` SHALL execute only after the parallel projects have finished
- **AND** at most one other real-process test file SHALL run concurrently with it

#### Scenario: A real-process test added to the main project is refused
- **WHEN** a new `packages/server/src/**/__tests__/*.test.ts` spawns a keeper or a mock-pi and is not listed in the real-process project
- **THEN** the repo-lint test SHALL fail naming the file

#### Scenario: Single command still covers everything
- **WHEN** a developer runs `npm test`
- **THEN** every test collected by either phase SHALL have executed exactly once (absent a CI retry)

### Requirement: CI-only single retry for the real-process phase is reported, never silent
Under `CI`, the real-process project — and only that project — SHALL retry a failed test once. A test that passed on retry SHALL be visible in the run output as retried, and the vitest JSON report uploaded by CI SHALL record it. No other project SHALL configure retries. Outside `CI` the retry count SHALL be zero.

#### Scenario: Retried test is attributable
- **WHEN** a real-process test fails once and passes on retry in CI
- **THEN** the job SHALL succeed
- **AND** the uploaded report SHALL list that test as passed while retaining the failed attempt's failure message, so the retry is distinguishable from a clean pass

#### Scenario: Locally there is no retry
- **WHEN** the same test fails on a developer machine
- **THEN** the run SHALL fail on the first failure

### Requirement: Named jsdom races are closed by polling
The following client tests SHALL assert on polled DOM/mock state and SHALL NOT issue a `fireEvent` before the state it depends on has been observed: `SettingsPanel` "buffers 'Initialize on worktree' and persists it only on Save"; `EditorSearchPanel` "keyboard: ArrowDown + Enter opens the selected result; Esc closes"; `FilePreviewContext` "Esc dismisses the hoisted overlay".

#### Scenario: Toggle is issued after the baseline landed
- **WHEN** the SettingsPanel test toggles "Initialize on worktree"
- **THEN** the click SHALL be issued only after the fetched config baseline is rendered
- **AND** the Save button SHALL be awaited via a polling query before it is clicked
