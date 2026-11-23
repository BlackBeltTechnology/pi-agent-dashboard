## MODIFIED Requirements

### Requirement: Whole-graph Knip scan

Knip SHALL analyse the whole workspace graph in a single pass and SHALL NOT be
wired into the per-change `quality:changed` loop, because a changed-file scope
cannot answer whether a symbol is used somewhere else in the graph.

#### Scenario: Knip runs whole-graph

- **WHEN** the Knip pass executes
- **THEN** it analyses every workspace package in one invocation
- **AND** it reports unused files, exports, and types

#### Scenario: Knip is absent from the per-change loop

- **WHEN** `npm run quality:changed` executes
- **THEN** no Knip invocation occurs
- **AND** the per-change loop runtime is unchanged by this capability

#### Scenario: Whole-workspace scan stays within budget

- **WHEN** the Knip pass runs on the full workspace in the nightly budget lane
- **THEN** it completes in under 30 seconds

#### Scenario: The scan-time budget does not gate a pull request

- **WHEN** the Knip scan takes longer than 30 seconds on a pull-request runner
- **THEN** no blocking `ci.yml` job SHALL fail for that reason
- **AND** the 30-second assertion SHALL run only in the nightly budget lane of `nightly-tests.yml`
