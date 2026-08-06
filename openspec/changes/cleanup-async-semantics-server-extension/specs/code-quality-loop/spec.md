## ADDED Requirements

### Requirement: A performance oracle must exercise the code it claims to cover

When a change cites an existing performance or load harness as evidence that a
modification did not regress behaviour, it SHALL first verify that the harness
actually executes the modified code paths. The claim SHALL name the specific
sites the harness exercises, not the files or subsystems they belong to.

A harness that does not execute a site cannot fail because of that site, so
citing it as coverage for that site is false assurance. Where a modified site is
genuinely performance-sensitive and the harness does not reach it, the change
SHALL either extend the harness to exercise that path or state plainly that no
automated oracle covers the site.

File-level coverage claims SHALL NOT be used as a proxy for site-level coverage.

#### Scenario: Harness cited for a path it never executes

- **WHEN** a change cites a load harness as the no-regression oracle for a modified site
- **AND** the harness never invokes that site, because the message, entrypoint, or lifecycle call that reaches it is never issued
- **THEN** the coverage claim SHALL be treated as unsupported
- **AND** the change SHALL either extend the harness to reach the site or record that the site has no automated oracle

#### Scenario: Coverage claimed at file granularity

- **WHEN** a change claims a harness "covers" a file because the harness imports or constructs something in it
- **THEN** the claim SHALL be re-derived at site granularity before it is relied on

#### Scenario: Harness exercises the site

- **WHEN** the harness demonstrably invokes the modified site within its measured window
- **THEN** the harness MAY be cited as the no-regression oracle for that site

### Requirement: Lint fix vocabulary must match the site, not the rule name

A change that clears a lint rule across many sites SHALL verify that each site
exhibits the defect the rule names before applying the rule's fix vocabulary. A
type-aware rule can flag a site for a reason other than the defect its name
describes, including inference artifacts where no value of the flagged kind
exists at all.

Where a site does not exhibit the named defect, the change SHALL apply the fix
appropriate to the actual code and SHALL NOT apply a vocabulary fix that
silences the diagnostic while implying a defect that was never present.

#### Scenario: Diagnostic is an inference artifact

- **WHEN** a floating-promise diagnostic is raised on a call to a function that returns no promise
- **THEN** the fix SHALL correct the type or annotation so the diagnostic is accurate
- **AND** the fix SHALL NOT be an `await` on a non-promise, which is a no-op that documents a defect that does not exist

#### Scenario: Site exhibits the named defect

- **WHEN** a flagged site does exhibit the defect the rule names
- **THEN** the rule's normal fix vocabulary SHALL apply

### Requirement: A promise fix in a test must not weaken the test

When a promise-handling defect is fixed inside a test file, the fix SHALL
preserve what the test proves. Rejection-suppressing fixes — `void`, a `.catch`
handler, or any construct that prevents a rejection from failing the test — SHALL
NOT be used in test files, because they suppress the failure the test exists to
detect.

Where a test deliberately leaves a promise in flight, the fix SHALL settle the
promise without altering the interleaving the test depends on, and SHALL match
the promise's actual polarity: asserting rejection on a promise that resolves
changes what the test proves and is a regression.

A touched test SHALL still fail when the behaviour it covers is broken.

#### Scenario: Suppressing fix applied in a test

- **WHEN** a floating-promise diagnostic in a test file is cleared with `void` or a `.catch` handler
- **THEN** the fix SHALL be rejected, because a rejected promise in a test must fail that test

#### Scenario: Polarity mismatch

- **WHEN** a deliberately in-flight promise that resolves is settled with a rejection assertion
- **THEN** the fix SHALL be rejected, because the assertion changes what the test proves

#### Scenario: Touched test retains its teeth

- **WHEN** a test's promise handling has been modified
- **THEN** breaking the behaviour that test covers SHALL still cause the test to fail
