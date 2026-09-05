# parallel-test-execution Specification

## Purpose

This capability covers running the vitest suite in parallel across worker forks for materially faster wall-clock time, while isolating per-file shared-state hazards (filesystem HOME, server ports, localStorage) so the run stays green and non-flaky.

## Requirements

### Requirement: Test files execute in parallel across worker forks
The vitest suite SHALL run test files concurrently across multiple worker forks (`maxWorkers > 1`, target `"50%"` of logical cores) rather than one serial worker per project. Parallelism SHALL be enabled per project only after that project's shared-state hazards (filesystem HOME, ports, localStorage) are isolated. The full run SHALL remain green and non-flaky (verified by 3 consecutive passing runs) at each enabled step.

The parallel worker target SHALL be declared in exactly one module and imported by every vitest config that runs in parallel, rather than duplicated as a literal per package. A project that deliberately runs serially SHALL state `maxWorkers: 1` explicitly and SHALL NOT import the module; the module carries the parallel default, not a mandate on every config. The module SHALL be positioned so that adopting it introduces no new `package.json` dependency edge for any package. The target value SHALL NOT be derived from observed machine load: a vitest config is evaluated before workers fork, so a load reading taken there cannot observe run-induced contention.

#### Scenario: Pure projects run parallel
- **WHEN** `npm test` runs the `shared`, `extension`, `client-utils`, plugin, and `scripts` projects
- **THEN** their test files SHALL execute across multiple forks
- **AND** the run SHALL pass with no flakes across 3 consecutive runs

#### Scenario: Faster than serial baseline
- **WHEN** the full suite runs with parallelism enabled
- **THEN** wall-clock time SHALL be materially lower than the `maxWorkers: 1` baseline
- **AND** no test SHALL fail due to the change in concurrency

#### Scenario: Worker target has a single source of truth
- **WHEN** a package's vitest config sets a parallel worker target
- **THEN** it SHALL import that value from the shared module
- **AND** no package config SHALL restate the parallel target as a literal

#### Scenario: Adopting the module adds no dependency edge
- **WHEN** a vitest config imports the shared worker module
- **THEN** its package SHALL NOT gain a new entry in its `package.json` dependencies or devDependencies
- **AND** no workspace dependency cycle SHALL be introduced

#### Scenario: Deliberately serial projects stay serial
- **GIVEN** the 7 projects that run serially by design — `electron`, `image-fit-extension`, `kb-extension`, `mockup-loop`, `nano-banana`, `video-production`, `video-transcription`
- **WHEN** the shared module is adopted
- **THEN** each SHALL continue to declare `maxWorkers: 1` explicitly
- **AND** each SHALL NOT import the shared module
- **AND** its effective worker count SHALL be unchanged

#### Scenario: Consolidation changes no effective worker count
- **WHEN** the suite runs before and after the shared module is adopted
- **THEN** every project's effective worker count SHALL be identical
- **AND** CI's worker count SHALL be unchanged

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

### Requirement: Timeouts and async waits tolerate fork contention
The suite SHALL set test timeouts and async-wait budgets that absorb CPU
oversubscription under parallel forks, so healthy tests do not fail on timing
alone. The server project SHALL set a package-level `testTimeout` well above the
5s default (30s) to cover full-server boots (`vi.resetModules()` + fresh
`import` cold-transforms under `pool:"forks"`), git worktree spawns, and
subprocess probes. The client project SHALL set a package-level `testTimeout`
(15s) and SHALL raise the Testing-Library global `asyncUtilTimeout` (5s) so
`waitFor`/`findBy*` polls do not expire before an effect, mock call, or state
update lands. Tests SHALL assert on polled DOM/mock state (`waitFor`) rather
than a fixed number of macrotask ticks, and SHALL NOT depend on shared
module-level fixtures restored only at a test's end (skipped on throw, which
cascades into unrelated tests).

The prohibition on fixed-tick waits SHALL be machine-enforced by a guard test rather than left to review, and the client suite SHALL contain no violations when the guard lands. A client test file SHALL NOT await a bare `setTimeout` used as an async barrier before a one-shot assertion. A test that genuinely exercises timer behaviour, or that yields inside a mock implementation rather than gating an assertion, MAY opt out with an explicit inline comment naming the reason. The opt-out SHALL apply to the annotated occurrence only, never to the whole file, so a barrier added to that file later is still flagged.

#### Scenario: Boot-heavy server test survives contention
- **WHEN** a server test that boots a full server runs concurrently with the
  rest of the suite across `"50%"` worker forks
- **THEN** it SHALL complete within the package `testTimeout`
- **AND** it SHALL NOT fail with "Test timed out in 5000ms"

#### Scenario: Client async assertion polls instead of guessing ticks
- **WHEN** a jsdom test triggers an async effect (FileReader decode, post-mount
  scroll, fetch-driven render) under fork contention
- **THEN** the assertion SHALL poll via `waitFor`/`findBy*` within
  `asyncUtilTimeout`
- **AND** it SHALL NOT fail with a one-shot `expected … got 0` / "Mock not
  called" race

#### Scenario: Shared fixture cannot cascade a failure
- **WHEN** a test mutates a shared module-level fixture and a sibling test in the
  same file depends on its canonical state
- **THEN** the fixture SHALL be reset in `beforeEach`
- **AND** a throw in one test SHALL NOT leave the fixture dirty for the next

#### Scenario: Fixed-tick barrier is rejected
- **GIVEN** a client test file that awaits a bare `setTimeout` as a barrier before a one-shot assertion
- **WHEN** the guard test runs
- **THEN** it SHALL fail and name the offending file

#### Scenario: Client suite is compliant when the guard lands
- **WHEN** the guard runs against the client suite at the moment this change lands
- **THEN** it SHALL report zero violations
- **AND** it SHALL hard-fail rather than warn

#### Scenario: Mock-internal yield is preserved, not converted
- **GIVEN** `PairLanding.test.tsx`, whose awaited timer sits inside a `postJson` mock so React can commit a render and gates no assertion
- **WHEN** this change lands
- **THEN** that timer SHALL remain in place
- **AND** the test's assertions and coverage SHALL be unchanged

#### Scenario: Deliberate timer use opts out per occurrence
- **GIVEN** a client test that awaits a timer to exercise debounce or throttle behaviour, or that yields inside a mock implementation rather than gating an assertion, and carries an inline opt-out comment naming the reason directly above it
- **WHEN** the guard test runs
- **THEN** it SHALL NOT flag that occurrence

#### Scenario: A file-level opt-out does not waive later violations
- **GIVEN** a client test file containing one annotated opt-out occurrence
- **WHEN** an un-annotated awaited-timer barrier is added elsewhere in the same file
- **THEN** the guard SHALL flag the new occurrence

#### Scenario: FileReader-backed paste assertions poll
- **WHEN** `useImagePaste.test.ts` decodes pasted images through `FileReader`
- **THEN** every assertion on `pendingImages` SHALL poll via `waitFor`
- **AND** the file SHALL pass in the full parallel run across 3 consecutive runs
