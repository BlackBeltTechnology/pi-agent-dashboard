## ADDED Requirements

### Requirement: Coverage behaviour is verified without a second full instrumented run

The scenario tests that verify the coverage report's behaviour SHALL NOT require a second instrumented run of the whole repository suite. Such a run grows with the repository, is pure duplication of the coverage job itself, and turned the nightly red by exceeding its own time ceiling while asserting nothing the scoped run cannot assert.

Each live coverage scenario SHALL run against a scope narrow enough to complete
well inside its declared time ceiling on CI, and SHALL declare that ceiling
explicitly. For the unloaded-file scenario, whose scope is a single fixture
project, the ceiling SHALL be recorded in the test together with the measured
CI runtime of that scoped invocation it was derived from, and SHALL be at least
1.5 times that measurement.

The property being verified — that a source file in scope which no test loads is
reported at 0% rather than omitted — SHALL be verified against a scope that
genuinely contains such a file. A fixture project SHALL therefore own a source
file that no test in the repository imports, with the coverage scope pinned to
it. Because that property decays the moment anything imports the file, a
repository check SHALL fail when any file outside the fixture imports it, and
the fixture's sources SHALL be excluded from the repository-wide coverage and
test globs.

The coverage scope SHALL remain asserted by the configuration test, against the
root configuration's include/exclude globs, rather than by a live
full-repository run. That test samples the scope — it asserts a named
unloaded-entry-point source is counted and named excluded categories are not —
and this requirement claims no more than it samples.

#### Scenario: The unloaded-file property is proven on a scoped run

- **WHEN** the coverage scenario test runs
- **THEN** it SHALL invoke coverage over a scope containing a source file no test loads
- **AND** the summary SHALL report that file at 0% lines with its lines counted in the total
- **AND** the invocation SHALL complete within the ceiling the test records

#### Scenario: Scenario verification does not re-run the whole suite under instrumentation

- **WHEN** the coverage scenario tests execute on CI
- **THEN** no scenario SHALL load every project's test suite under coverage instrumentation
- **AND** the scenario job's duration SHALL NOT scale with the repository's total test count

#### Scenario: The fixture's unloaded file stays unloaded

- **WHEN** a file outside the fixture imports the fixture's source file
- **THEN** a repository check SHALL fail naming that importer
- **AND** the scenario's premise SHALL NOT silently degrade into a passing test that proves nothing

#### Scenario: The sampled coverage scope stays pinned

- **WHEN** the root coverage configuration's include/exclude globs change
- **THEN** the configuration test SHALL fail if `packages/extension/src/bridge.ts` is no longer counted
- **AND** it SHALL fail if a sample under `__tests__/`, `test-support/`, a `*.d.ts` file or the `electron` package is no longer excluded
