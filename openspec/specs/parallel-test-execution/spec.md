# parallel-test-execution Specification

## Purpose

This capability covers running the vitest suite in parallel across worker forks for materially faster wall-clock time, while isolating per-file shared-state hazards (filesystem HOME, server ports, localStorage) so the run stays green and non-flaky.

## Requirements

### Requirement: Test files execute in parallel across worker forks
The vitest suite SHALL run test files concurrently across multiple worker forks (`maxWorkers > 1`, target `"50%"` of logical cores) rather than one serial worker per project. Parallelism SHALL be enabled per project only after that project's shared-state hazards (filesystem HOME, ports, localStorage) are isolated. The full run SHALL remain green and non-flaky (verified by 3 consecutive passing runs) at each enabled step.

#### Scenario: Pure projects run parallel
- **WHEN** `npm test` runs the `shared`, `extension`, `client-utils`, plugin, and `scripts` projects
- **THEN** their test files SHALL execute across multiple forks
- **AND** the run SHALL pass with no flakes across 3 consecutive runs

#### Scenario: Faster than serial baseline
- **WHEN** the full suite runs with parallelism enabled
- **THEN** wall-clock time SHALL be materially lower than the `maxWorkers: 1` baseline
- **AND** no test SHALL fail due to the change in concurrency

### Requirement: Each test file gets an isolated HOME
A per-file setup hook (`setupFiles`, executed inside each worker fork before the test file's imports) SHALL assign `process.env.HOME` to a unique temporary directory and pre-create `.pi/agent/sessions` and `.pi/dashboard` within it. The existing `globalSetup` tripwire (throws when `HOME` equals the real user home) SHALL remain as a second-line guard.

#### Scenario: Parallel files do not share HOME state
- **WHEN** two server test files that read/write `$HOME/.pi` run in parallel forks
- **THEN** each SHALL operate on its own temporary HOME
- **AND** neither SHALL observe or corrupt the other's `.pi/dashboard` files or locks

#### Scenario: Real user home still protected
- **WHEN** any test runs
- **THEN** `process.env.HOME` SHALL NOT equal the real user home
- **AND** the tripwire SHALL abort the run if it does

### Requirement: Server-boot tests use OS-assigned ports
Tests that boot a real server SHALL bind `port: 0` (OS-assigned) via `createTestServer()` or the `httpPort()`/`piPort()` getters, NOT hardcoded port numbers. No server-boot test SHALL rely on a fixed port literal.

#### Scenario: No port collisions under parallelism
- **WHEN** multiple server-boot test files run in parallel forks
- **THEN** each SHALL bind an OS-assigned port
- **AND** no test SHALL fail with `EADDRINUSE`

#### Scenario: Hardcoded ports rejected
- **WHEN** a server-boot test is added or modified
- **THEN** a guard test SHALL fail if it binds a hardcoded port instead of `port: 0`/`createTestServer()`

### Requirement: localStorage is isolated per fork
Parallel forks SHALL NOT share a single `--localstorage-file`. The per-file setup hook SHALL assign a unique localStorage file per fork (or the suite SHALL otherwise guarantee no two parallel forks write the same localStorage file).

#### Scenario: Parallel forks do not corrupt localStorage
- **WHEN** tests in parallel forks write to localStorage
- **THEN** each fork SHALL use its own localStorage backing
- **AND** no test SHALL observe another fork's localStorage writes
