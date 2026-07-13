## ADDED Requirements

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
