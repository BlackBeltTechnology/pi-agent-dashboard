## ADDED Requirements

### Requirement: Pure client tests run under the node environment
Client test files that exercise no DOM, browser global or React rendering SHALL run in a dedicated vitest project with `environment: "node"`, declared alongside the jsdom client project. No test file SHALL be included by both projects. The node project SHALL import the shared worker-target module and SHALL NOT restate the parallel target as a literal.

#### Scenario: Pure test runs without jsdom
- **WHEN** the suite runs a client util or reducer test that touches no DOM API
- **THEN** it SHALL execute in the node project
- **AND** the jsdom project SHALL NOT also execute it

#### Scenario: DOM test stays in jsdom
- **WHEN** a client test renders a component or reads `window`/`document`
- **THEN** it SHALL remain in the jsdom project and pass unchanged

### Requirement: Test files leave no shared state behind
Each client test file SHALL restore, before it finishes, every global it replaced or stubbed (`localStorage`, `getBoundingClientRect`, `matchMedia`, timers) and every module mock it registered, so that its pass/fail result does not depend on which file ran before it in the same worker.

#### Scenario: Order-independent result
- **WHEN** the jsdom client project runs with `--sequence.shuffle` under its current isolation setting
- **THEN** every test SHALL produce the same result as in the default order

### Requirement: Disabling per-file isolation is gated on measured safety
The jsdom client project SHALL run with `isolate: false` only if all of the following hold on the same commit: three consecutive full runs are green; a run with `--sequence.shuffle` is green; each test file still observes its own temporary `HOME`; and no two parallel forks write the same localStorage file. If any condition fails, the project SHALL keep `isolate: true` and the reason SHALL be recorded in the change's design notes.

#### Scenario: Gate passes
- **WHEN** all four conditions are verified on the candidate commit
- **THEN** `isolate: false` MAY be set on the jsdom client project
- **AND** the measured wall-clock time before and after SHALL be recorded

#### Scenario: Gate fails
- **WHEN** any condition fails
- **THEN** `isolate` SHALL remain `true`
- **AND** the hygiene and node-environment changes SHALL still land
