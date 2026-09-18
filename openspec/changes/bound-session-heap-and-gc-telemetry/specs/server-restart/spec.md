## ADDED Requirements

### Requirement: A changed server heap ceiling requires a cold start

The in-place restart path re-launches the server with the current process's
environment. A changed `serverHeap.maxOldSpaceMb` therefore SHALL NOT take
effect across an in-place restart; the restarted server SHALL keep the ceiling
the replaced process was running under.

This is a documented consequence of environment inheritance, not a defect to
work around: the environment is inherited deliberately so the restarted server
keeps its ambient configuration.

The restart SHALL NOT report the new ceiling as applied, and the surface that
offers the setting SHALL state the cold-start requirement.

#### Scenario: In-place restart keeps the previous ceiling
- **WHEN** `serverHeap.maxOldSpaceMb` is changed and an in-place restart is triggered
- **THEN** the restarted server SHALL run under the previous ceiling

#### Scenario: Cold start adopts the new ceiling
- **WHEN** the server is stopped and started afresh after the change
- **THEN** it SHALL run under the newly configured ceiling

#### Scenario: Restart does not misreport the change as applied
- **WHEN** an in-place restart completes after a `serverHeap` change
- **THEN** the dashboard SHALL NOT indicate that the new ceiling is in effect
