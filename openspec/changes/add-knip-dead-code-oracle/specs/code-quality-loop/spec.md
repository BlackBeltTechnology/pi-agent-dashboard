# Code Quality Loop

## ADDED Requirements

### Requirement: Whole-graph checks stay off the per-change loop

The quality oracle SHALL distinguish per-change checks from whole-graph checks,
and SHALL keep whole-graph checks out of `quality:changed`, because a
changed-file scope cannot decide reachability across the workspace.

#### Scenario: Changed-scope loop excludes whole-graph checks

- **WHEN** the changed-files quality loop runs
- **THEN** only per-change checks execute
- **AND** dead-code detection is not among them

#### Scenario: Whole-graph check has a documented home

- **WHEN** a check is classified as whole-graph
- **THEN** its execution home is nightly or harness, not the per-change loop
- **AND** the classification is recorded in the code-quality documentation
