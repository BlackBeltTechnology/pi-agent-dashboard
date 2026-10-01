## MODIFIED Requirements

### Requirement: Real-process tests run in a dedicated low-concurrency phase
Server tests that spawn a real operating-system process under test SHALL be collected by a dedicated vitest project that is NOT part of the parallel unit run. Such processes include a keeper, a mock-pi, a wrapper, a signal-forwarding CLI, or a full server process whose outcome is observed through the process table, a socket, or a log file.

That project SHALL NEVER run concurrently with the parallel projects on the same machine. Locally it SHALL run after the parallel projects complete. In CI it MAY instead run on its own runner. It SHALL use at most two concurrent forks and a per-test and per-hook budget of 60 s.

The main server project SHALL exclude exactly the files the real-process project includes. A repo-lint test SHALL fail when a file is in both, in neither, or when a test that spawns a process is added to the main project. The single command `npm test` SHALL run both phases in sequence, so local coverage is unchanged.

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

#### Scenario: Single command still covers everything
- **WHEN** a developer runs `npm test`
- **THEN** every test collected by either phase SHALL have executed exactly once (absent a CI retry)
