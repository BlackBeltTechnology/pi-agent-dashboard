## MODIFIED Requirements

### Requirement: The check completes within a CI time budget

The check SHALL complete across every non-private workspace within a declared
CI wall-clock budget. It runs on every pull request, so an unbounded runtime
would make it the slowest gate in the pipeline and invite disabling.

The budget SHALL be stated once, here, as a formula over the number of
non-private workspaces, and SHALL be the same number the enforcing test
asserts, so the specification and the gate cannot drift apart:

```
budget_seconds = 30 + 3 * N
```

where `N` is the number of workspaces the check walks: every non-private
workspace under `packages/` plus the repository root package when the root is
not private. The fixed 30-second term is a chosen shared-runner contention
allowance, not derived from measurement; the per-workspace term is the slope
between two measurements (72.9 s at 37 and 122.2 s at 56 non-private
`packages/*` workspaces, i.e. 2.595 s per workspace) rounded up. The formula is
not a fit to those points. At today's `N` of 57 (56 workspaces plus the non-private root) the
budget is 201 seconds against a measured 122.2 seconds, so a routinely
contended run passes while a two-fold regression still fails. The enforcing
test SHALL compute `N` at runtime with the same workspace enumeration the check
itself uses, rather than hard-coding either the count or the resulting
ceiling. When the check exceeds the budget, the failure SHALL report the
measured time, the budget, and the `N` the budget was derived from.

#### Scenario: Full-repository run stays within budget

- **WHEN** the check runs across all non-private workspaces on CI
- **THEN** total wall-clock time SHALL be within `30 + 3 * N` seconds

#### Scenario: The asserted budget is the specified budget

- **WHEN** the enforcing test compares the measured runtime against its ceiling
- **THEN** that ceiling SHALL be the budget this specification declares
- **AND** a change to one without the other SHALL be visible as a specification conflict

#### Scenario: Adding a workspace does not silently breach the budget

- **WHEN** a new non-private workspace is added to the repository
- **THEN** the budget SHALL grow by 3 seconds without any edit to the test or this specification
- **AND** the check SHALL NOT fail solely because the repository grew by one workspace

#### Scenario: A breach names the measurement

- **WHEN** the check exceeds its budget on CI
- **THEN** the failure message SHALL carry the measured wall-clock time, the budget it exceeded, and the `N` that budget was computed from
